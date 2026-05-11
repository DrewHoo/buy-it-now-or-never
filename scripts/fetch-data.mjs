// Fetch adjusted daily closes from Yahoo Finance for every ticker in
// TICKERS, compute the ATH and permanent-floor sets, and write a compact
// JSON file per ticker into public/data/. Also writes public/data/index.json
// describing what was fetched.

import YahooFinance from 'yahoo-finance2'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'data')

const yahooFinance = new YahooFinance()
yahooFinance.suppressNotices?.(['yahooSurvey', 'ripHistorical'])

const TICKERS = [
  { symbol: 'SMH',  name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXQ', name: 'Invesco PHLX Semiconductor ETF' },
  { symbol: 'QQQ',  name: 'Invesco QQQ Trust' },
  { symbol: 'SPY',  name: 'SPDR S&P 500 ETF' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'TSM',  name: 'Taiwan Semiconductor (TSMC ADR)' },
  { symbol: 'ASML', name: 'ASML Holding' },
  { symbol: 'AMD',  name: 'Advanced Micro Devices' },
  { symbol: 'KLAC', name: 'KLA Corporation' },
  { symbol: 'MU',   name: 'Micron Technology' },
]

const PERIOD_START = '1980-01-01' // before any of these existed
const PERIOD_END = new Date()

async function fetchOne(symbol) {
  // chart() is the v3 successor to historical(). quotes[] gives daily OHLC,
  // adjclose[] is split + dividend adjusted.
  const result = await yahooFinance.chart(symbol, {
    period1: PERIOD_START,
    period2: PERIOD_END,
    interval: '1d',
    events: 'div,splits',
  })
  // result.quotes already aligns adjclose with each timestamp.
  return result.quotes
    .filter(r => Number.isFinite(r.adjclose) && r.adjclose > 0)
    .map(r => ({ date: new Date(r.date), adjClose: r.adjclose }))
    .sort((a, b) => a.date - b.date)
}

function analyze(rows) {
  const n = rows.length
  const dates = new Array(n)
  const closes = new Array(n)
  for (let i = 0; i < n; i++) {
    dates[i] = rows[i].date.toISOString().slice(0, 10)
    // round to 4 decimals to keep JSON small without losing meaningful precision
    closes[i] = Math.round(rows[i].adjClose * 10000) / 10000
  }

  // ATH: close strictly greater than every prior close
  const isAth = new Array(n).fill(false)
  let runningMax = -Infinity
  for (let i = 0; i < n; i++) {
    if (closes[i] > runningMax) {
      isAth[i] = true
      runningMax = closes[i]
    }
  }

  // Permanent floor: close <= every future close.
  // Walk right-to-left tracking running min of suffix (exclusive of current).
  // The final day is always a trivial permanent floor (no future closes).
  const isPermanentFloor = new Array(n).fill(false)
  let suffixMin = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (closes[i] <= suffixMin) isPermanentFloor[i] = true
    if (closes[i] < suffixMin) suffixMin = closes[i]
  }

  // For every ATH, compute how many trading days until the next close <= it.
  // null means "permanent" (the ATH was never undercut later).
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
  const recoveryDays = athRecoveryDays.filter(d => d != null).sort((a, b) => a - b)

  const totalDays = n
  const athCount = athIndices.length
  const permAthCount = athRecoveryDays.filter(d => d == null).length

  const percentile = (sorted, p) => {
    if (sorted.length === 0) return null
    const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
    return sorted[idx]
  }

  return {
    dates,
    closes,
    athIndices,
    athRecoveryDays,
    stats: {
      firstDate: dates[0],
      lastDate: dates[n - 1],
      totalDays,
      athCount,
      permAthCount,
      pctAthsThatWerePermanent: athCount ? permAthCount / athCount : 0,
      pctDaysThatWerePermanentAth: totalDays ? permAthCount / totalDays : 0,
      recoveryDaysMedian: percentile(recoveryDays, 0.5),
      recoveryDaysP25: percentile(recoveryDays, 0.25),
      recoveryDaysP75: percentile(recoveryDays, 0.75),
      recoveryDaysMax: recoveryDays.length ? recoveryDays[recoveryDays.length - 1] : null,
      recoveredAthCount: recoveryDays.length,
    },
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const index = []
  for (const t of TICKERS) {
    process.stdout.write(`  ${t.symbol.padEnd(5)} `)
    try {
      const rows = await fetchOne(t.symbol)
      if (rows.length === 0) {
        console.log('no data — skipping')
        continue
      }
      const analyzed = analyze(rows)
      const payload = {
        symbol: t.symbol,
        name: t.name,
        adjusted: 'split + dividend',
        ...analyzed,
      }
      await writeFile(
        resolve(OUT_DIR, `${t.symbol}.json`),
        JSON.stringify(payload),
      )
      index.push({
        symbol: t.symbol,
        name: t.name,
        firstDate: analyzed.stats.firstDate,
        lastDate: analyzed.stats.lastDate,
        totalDays: analyzed.stats.totalDays,
        athCount: analyzed.stats.athCount,
        permAthCount: analyzed.stats.permAthCount,
        pctAthsThatWerePermanent: analyzed.stats.pctAthsThatWerePermanent,
      })
      console.log(
        `${analyzed.stats.totalDays.toString().padStart(5)} days, ` +
        `${analyzed.stats.athCount} ATHs, ` +
        `${analyzed.stats.permAthCount} permanent (${
          (100 * analyzed.stats.pctAthsThatWerePermanent).toFixed(1)
        }%)`,
      )
    } catch (err) {
      console.log(`error: ${err.message}`)
      process.exitCode = 1
    }
  }
  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), tickers: index }, null, 2),
  )
  console.log(`\nWrote ${index.length} tickers + index.json to ${OUT_DIR}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
