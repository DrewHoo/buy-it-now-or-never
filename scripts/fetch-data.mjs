// Fetch adjusted daily closes from Yahoo Finance for every ticker in
// UNIVERSE, compute the ATH and recovery-day sets, and write a compact
// JSON file per ticker into public/data/. Also writes public/data/index.json
// describing what was fetched.

import YahooFinance from 'yahoo-finance2'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNIVERSE } from './universe.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'data')

const yahooFinance = new YahooFinance()
yahooFinance.suppressNotices?.(['yahooSurvey', 'ripHistorical'])

const PERIOD_START = '1980-01-01'
const PERIOD_END = new Date()
const CONCURRENCY = 5

async function fetchPriceSeries(symbol) {
  const result = await yahooFinance.chart(symbol, {
    period1: PERIOD_START,
    period2: PERIOD_END,
    interval: '1d',
    events: 'div,splits',
  })
  return result.quotes
    .filter(r => Number.isFinite(r.adjclose) && r.adjclose > 0)
    .map(r => ({ date: new Date(r.date), adjClose: r.adjclose }))
    .sort((a, b) => a.date - b.date)
}

async function fetchDisplayName(symbol) {
  try {
    const q = await yahooFinance.quote(symbol)
    return (
      q?.longName ||
      q?.shortName ||
      q?.displayName ||
      null
    )
  } catch {
    return null
  }
}

function analyze(rows) {
  const n = rows.length
  const dates = new Array(n)
  const closes = new Array(n)
  for (let i = 0; i < n; i++) {
    dates[i] = rows[i].date.toISOString().slice(0, 10)
    closes[i] = Math.round(rows[i].adjClose * 10000) / 10000
  }

  const isAth = new Array(n).fill(false)
  let runningMax = -Infinity
  for (let i = 0; i < n; i++) {
    if (closes[i] > runningMax) {
      isAth[i] = true
      runningMax = closes[i]
    }
  }

  const isPermanentFloor = new Array(n).fill(false)
  let suffixMin = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (closes[i] <= suffixMin) isPermanentFloor[i] = true
    if (closes[i] < suffixMin) suffixMin = closes[i]
  }

  const athIndices = []
  const athRecoveryDays = []
  for (let i = 0; i < n; i++) {
    if (!isAth[i]) continue
    athIndices.push(i)
    if (isPermanentFloor[i]) {
      athRecoveryDays.push(null)
    } else {
      let waited = null
      for (let j = i + 1; j < n; j++) {
        if (closes[j] <= closes[i]) { waited = j - i; break }
      }
      athRecoveryDays.push(waited)
    }
  }
  const recoveryDays = athRecoveryDays
    .filter(d => d != null)
    .sort((a, b) => a - b)

  const percentile = (sorted, p) => {
    if (sorted.length === 0) return null
    const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
    return sorted[idx]
  }

  const recoveryMean = recoveryDays.length
    ? recoveryDays.reduce((a, b) => a + b, 0) / recoveryDays.length
    : null

  const athCount = athIndices.length
  const permAthCount = athRecoveryDays.filter(d => d == null).length

  // Current drawdown from the all-time-high close. Gives the reader the
  // context to interpret mean wait — a long mean wait means very
  // different things at -2% off vs -75% off.
  const athClose = closes[athIndices[athCount - 1]] // last ATH = global max close
  const lastClose = closes[n - 1]
  const pctOffAth = athClose ? (athClose - lastClose) / athClose : 0

  // Recency-corrected "still standing" metric. Filter out ATHs that
  // haven't had enough calendar time to be tested yet — both the
  // numerator (still-permanent ATHs) and denominator (all ATHs) skip
  // anything from the last SETTLE_DAYS, so a young ticker doesn't
  // automatically score high just because its recent ATHs are
  // trivially-not-yet-undercut.
  const SETTLE_DAYS = 365
  const lastTime = new Date(dates[n - 1]).getTime()
  let settledAthCount = 0
  let settledPermAthCount = 0
  for (let k = 0; k < athIndices.length; k++) {
    const i = athIndices[k]
    const ageMs = lastTime - new Date(dates[i]).getTime()
    const ageDays = ageMs / 86400000
    if (ageDays < SETTLE_DAYS) continue
    settledAthCount++
    if (athRecoveryDays[k] == null) settledPermAthCount++
  }

  return {
    dates,
    closes,
    athIndices,
    athRecoveryDays,
    stats: {
      firstDate: dates[0],
      lastDate: dates[n - 1],
      totalDays: n,
      athCount,
      permAthCount,
      pctAthsThatWerePermanent: athCount ? permAthCount / athCount : 0,
      pctDaysThatWerePermanentAth: n ? permAthCount / n : 0,
      settledAthCount,
      settledPermAthCount,
      settledPctUnbroken: settledAthCount ? settledPermAthCount / settledAthCount : null,
      athClose,
      lastClose,
      pctOffAth,
      recoveryDaysMean: recoveryMean != null ? Math.round(recoveryMean) : null,
      recoveryDaysP75: percentile(recoveryDays, 0.75),
      recoveryDaysMax: recoveryDays.length ? recoveryDays[recoveryDays.length - 1] : null,
      recoveredAthCount: recoveryDays.length,
    },
  }
}

async function processOne(ticker) {
  const { symbol, name: hardcodedName, category } = ticker
  const rows = await fetchPriceSeries(symbol)
  if (rows.length === 0) {
    throw new Error('no data')
  }
  const analyzed = analyze(rows)
  const name = hardcodedName || (await fetchDisplayName(symbol)) || symbol
  const payload = {
    symbol,
    name,
    category,
    adjusted: 'split + dividend',
    ...analyzed,
  }
  await writeFile(
    resolve(OUT_DIR, `${symbol}.json`),
    JSON.stringify(payload),
  )
  return {
    symbol,
    name,
    category,
    firstDate: analyzed.stats.firstDate,
    lastDate: analyzed.stats.lastDate,
    totalDays: analyzed.stats.totalDays,
    athCount: analyzed.stats.athCount,
    permAthCount: analyzed.stats.permAthCount,
    pctAthsThatWerePermanent: analyzed.stats.pctAthsThatWerePermanent,
    settledAthCount: analyzed.stats.settledAthCount,
    settledPermAthCount: analyzed.stats.settledPermAthCount,
    settledPctUnbroken: analyzed.stats.settledPctUnbroken,
    pctOffAth: analyzed.stats.pctOffAth,
    recoveryDaysMean: analyzed.stats.recoveryDaysMean,
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function pull() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (err) {
        results[i] = { ok: false, item: items[i], error: err.message }
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, pull))
  return results
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  console.log(`Fetching ${UNIVERSE.length} tickers, ${CONCURRENCY} at a time…`)
  const t0 = Date.now()

  let done = 0
  const results = await runWithConcurrency(UNIVERSE, CONCURRENCY, async (t) => {
    const r = await processOne(t)
    done++
    process.stdout.write(`\r  ${done}/${UNIVERSE.length}  ${t.symbol.padEnd(8)}        `)
    return r
  })

  const index = []
  const failures = []
  for (const r of results) {
    if (r.ok) index.push(r.value)
    else failures.push({ symbol: r.item.symbol, error: r.error })
  }

  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), tickers: index },
      null, 2,
    ),
  )

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\nWrote ${index.length} tickers + index.json in ${elapsed}s`)
  if (failures.length) {
    console.log(`Skipped ${failures.length}:`)
    for (const f of failures) console.log(`  ${f.symbol.padEnd(10)} ${f.error}`)
    // Don't fail the build for missing data; just note it.
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
