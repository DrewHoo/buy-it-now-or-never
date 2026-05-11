import React, { useEffect, useMemo, useRef, useState } from 'react'
import Chart from './Chart.jsx'

const RANGE_OPTIONS = [
  { label: '1Y', years: 1, code: '1y' },
  { label: '5Y', years: 5, code: '5y' },
  { label: '10Y', years: 10, code: '10y' },
  { label: 'All', years: null, code: 'all' },
]

const QUICK_PICKS = [
  'SOXQ', 'SMH', 'QQQ', 'SPY', 'NVDA', 'AAPL', 'MSFT', 'GLD', 'BTC-USD',
]

const RANGE_BY_CODE = Object.fromEntries(
  RANGE_OPTIONS.map(r => [r.code, r.years]),
)

function readInitialState() {
  if (typeof window === 'undefined') return { selected: null, range: null, zoom: null }
  const params = new URLSearchParams(window.location.search)
  const t = (params.get('t') || '').toUpperCase().trim() || null
  const rRaw = (params.get('r') || '').toLowerCase()
  const range = rRaw in RANGE_BY_CODE ? RANGE_BY_CODE[rRaw] : null
  let zoom = null
  const z = params.get('z')
  if (z && z.includes(',')) {
    const [a, b] = z.split(',')
    const d1 = new Date(`${a}T00:00:00Z`)
    const d2 = new Date(`${b}T00:00:00Z`)
    if (!isNaN(d1) && !isNaN(d2) && d1 < d2) zoom = [d1, d2]
  }
  return { selected: t, range, zoom }
}

export default function App() {
  const [index, setIndex] = useState(null)
  const initial = useMemo(() => readInitialState(), [])
  const [selected, setSelected] = useState(initial.selected)
  const [data, setData] = useState(null)
  const [range, setRange] = useState(initial.range)
  const [zoom, setZoom] = useState(initial.zoom)
  const [error, setError] = useState(null)
  const baseUrl = import.meta.env.BASE_URL

  // Load the ticker index once.
  useEffect(() => {
    fetch(`${baseUrl}data/index.json`)
      .then(r => r.json())
      .then(setIndex)
      .catch(err => setError(err.message))
  }, [baseUrl])

  // Once the index has loaded, validate the URL ticker and fall back to a
  // default if it isn't real. This only runs when `selected` would
  // otherwise be invalid (missing or unknown).
  useEffect(() => {
    if (!index) return
    const syms = new Set(index.tickers.map(t => t.symbol))
    if (!selected || !syms.has(selected)) {
      const def = syms.has('SOXQ') ? 'SOXQ' : index.tickers[0]?.symbol
      if (def) setSelected(def)
    }
  }, [index, selected])

  // Fetch the selected ticker. Crucially, we do NOT clear `data` here —
  // the old chart stays on screen until the new one arrives, so the
  // scroll position is preserved when the user clicks a row deep down
  // the page. Stale responses are dropped via the cancellation flag.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    fetch(`${baseUrl}data/${encodeURIComponent(selected)}.json`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [selected, baseUrl])

  // Mirror state into the URL so links are shareable.
  useEffect(() => {
    if (!selected) return
    const params = new URLSearchParams()
    if (selected !== 'SOXQ') params.set('t', selected)
    const rangeCode = RANGE_OPTIONS.find(r => r.years === range)?.code
    if (rangeCode && rangeCode !== 'all') params.set('r', rangeCode)
    if (zoom) {
      const iso = d => d.toISOString().slice(0, 10)
      params.set('z', `${iso(zoom[0])},${iso(zoom[1])}`)
    }
    const qs = params.toString()
    const next = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next)
    }
  }, [selected, range, zoom])

  // User-initiated ticker change. Clears zoom because date ranges from
  // one ticker rarely make sense for another.
  function selectTicker(sym) {
    if (sym === selected) return
    setZoom(null)
    setSelected(sym)
  }

  // User-initiated range pill click. Clears zoom because brushing inside
  // a 1Y window then jumping to 5Y should reveal the broader view.
  function changeRange(years) {
    setZoom(null)
    setRange(years)
  }

  // Hook calls must precede any early returns (React rules of hooks).
  const symbolSet = useMemo(
    () => new Set((index?.tickers || []).map(t => t.symbol)),
    [index],
  )

  if (error) return <main className="error">Couldn't load data: {error}</main>
  if (!index || !data) return <main className="loading">Loading…</main>

  return (
    <main>
      <header>
        <h1>Buy it now or never</h1>
        <p className="lede">
          You see a stock at an all-time high and think{' '}
          <em>I'll wait for the pullback.</em> Sometimes the pullback never comes.
          This is a tally of <strong>closing-price all-time highs that were never
          undercut afterward</strong> — the days where, if you didn't buy, you
          never got another chance at that price (or lower).
        </p>
      </header>

      <section className="controls">
        <TickerSearch
          tickers={index.tickers}
          selected={selected}
          onSelect={sym => symbolSet.has(sym) && selectTicker(sym)}
        />
        <div className="range-switcher">
          {RANGE_OPTIONS.map(r => (
            <button
              key={r.label}
              className={range === r.years ? 'range range--active' : 'range'}
              onClick={() => changeRange(r.years)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>

      <div className="quick-picks">
        <span className="quick-picks-label">Quick picks:</span>
        {QUICK_PICKS.filter(s => symbolSet.has(s)).map(s => (
          <button
            key={s}
            className={selected === s ? 'pill pill--active' : 'pill'}
            onClick={() => selectTicker(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <section className="ticker-header">
        <h2>
          <span className="ticker-symbol">{data.symbol}</span>
          <span className="ticker-name">{data.name}</span>
        </h2>
        <div className="adjustment-note">
          Adjusted close (split + dividend) · {data.stats.firstDate} → {data.stats.lastDate}
        </div>
      </section>

      <Chart
        data={data}
        rangeYears={range}
        zoom={zoom}
        onZoomChange={setZoom}
      />

      <Legend />

      <Stats stats={data.stats} />

      <Comparison
        tickers={index.tickers}
        selected={selected}
        onSelect={selectTicker}
      />

      <Methodology generatedAt={index.generatedAt} tickerCount={index.tickers.length} />
    </main>
  )
}

function TickerSearch({ tickers, selected, onSelect }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return tickers.slice(0, 50)
    return tickers
      .filter(t =>
        t.symbol.includes(q) ||
        (t.name || '').toUpperCase().includes(q),
      )
      .slice(0, 50)
  }, [query, tickers])

  function commit(sym) {
    onSelect(sym)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="ticker-search" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={`Search ${tickers.length.toLocaleString()} tickers — symbol or name`}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Enter' && filtered[0]) commit(filtered[0].symbol)
          else if (e.key === 'Escape') { setOpen(false); setQuery('') }
        }}
      />
      {open && (
        <ul className="ticker-search-results" role="listbox">
          {filtered.map(t => (
            <li
              key={t.symbol}
              role="option"
              aria-selected={t.symbol === selected}
              className={t.symbol === selected ? 'is-selected' : ''}
              onMouseDown={() => commit(t.symbol)}
            >
              <span className="result-symbol">{t.symbol}</span>
              <span className="result-name">{t.name}</span>
              <span className="result-pct">
                {t.permAthCount} stuck
              </span>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="no-results">No tickers match "{query}"</li>
          )}
        </ul>
      )}
    </div>
  )
}

function Legend() {
  return (
    <section className="legend">
      <span className="legend-item">
        <span className="legend-line" /> Adjusted close
      </span>
      <span className="legend-item legend-item--gradient">
        <span className="legend-gradient legend-gradient--recovery" />
        <span className="legend-gradient-labels">
          <span>recovered in days</span>
          <span>1 year+</span>
        </span>
        <span className="legend-gradient-caption">
          ATH — how long you waited to buy back in
        </span>
      </span>
      <span className="legend-item">
        <span className="legend-dot legend-dot--perm" />
        <span>
          ATH <strong>never seen again</strong>
        </span>
      </span>
    </section>
  )
}

function Stats({ stats }) {
  const pctPerm = (100 * stats.pctAthsThatWerePermanent).toFixed(1)
  return (
    <section className="stats">
      <div className="stat">
        <div className="stat-value">{stats.athCount.toLocaleString()}</div>
        <div className="stat-label">all-time-high closes</div>
      </div>
      <div className="stat stat--accent">
        <div className="stat-value">{stats.permAthCount.toLocaleString()}</div>
        <div className="stat-label">
          never seen again ({pctPerm}% of ATHs)
        </div>
      </div>
      <div className="stat">
        <div className="stat-value">
          {stats.recoveryDaysMean != null ? `${stats.recoveryDaysMean} d` : '—'}
        </div>
        <div className="stat-label">
          mean wait when an ATH <em>did</em> come back
          {stats.recoveredAthCount ? ` (n=${stats.recoveredAthCount})` : ''}
        </div>
      </div>
      <div className="stat">
        <div className="stat-value">
          {stats.recoveryDaysP75 != null ? `${stats.recoveryDaysP75} d` : '—'}
        </div>
        <div className="stat-label">75th-percentile wait</div>
      </div>
    </section>
  )
}

function Comparison({ tickers, selected, onSelect }) {
  const [sort, setSort] = useState({ key: 'permAthCount', dir: 'desc' })
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return tickers
    return tickers.filter(t => t.category === filter)
  }, [tickers, filter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const { key, dir } = sort
    const m = dir === 'desc' ? -1 : 1
    arr.sort((a, b) => {
      const av = a[key]; const bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return av.localeCompare(bv) * m
      return (av - bv) * m
    })
    return arr
  }, [filtered, sort])

  function header(label, key, align = 'left') {
    const active = sort.key === key
    const arrow = active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''
    return (
      <th
        className={`th-sortable th-${align}${active ? ' is-active' : ''}`}
        onClick={() =>
          setSort(s =>
            s.key === key
              ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
              : { key, dir: 'desc' },
          )
        }
      >
        {label}{arrow}
      </th>
    )
  }

  return (
    <section className="comparison">
      <div className="comparison-header">
        <h3>All {tickers.length} tickers — click a row to chart it</h3>
        <div className="category-filter">
          {[
            { value: 'all',       label: 'All' },
            { value: 'stock',     label: 'Stocks' },
            { value: 'etf',       label: 'ETFs' },
            { value: 'commodity', label: 'Commodities' },
            { value: 'crypto',    label: 'Crypto' },
          ].map(c => (
            <button
              key={c.value}
              className={filter === c.value ? 'cat cat--active' : 'cat'}
              onClick={() => setFilter(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="comparison-table-wrap">
        <table>
          <thead>
            <tr>
              {header('Ticker', 'symbol')}
              {header('Name', 'name')}
              {header('History', 'firstDate')}
              {header('ATH closes', 'athCount', 'right')}
              {header('Never seen again', 'permAthCount', 'right')}
              <th
                className={`th-sortable th-right${sort.key === 'settledPctUnbroken' ? ' is-active' : ''}`}
                title="Share of ATHs at least 1 year old that have never been undercut. Recent ATHs are excluded from both numerator and denominator so a young ticker like SOXQ doesn't trivially top the list."
                onClick={() =>
                  setSort(s =>
                    s.key === 'settledPctUnbroken'
                      ? { key: 'settledPctUnbroken', dir: s.dir === 'desc' ? 'asc' : 'desc' }
                      : { key: 'settledPctUnbroken', dir: 'desc' },
                  )
                }
              >
                1y+ unbroken{sort.key === 'settledPctUnbroken' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
              {header('Mean wait', 'recoveryDaysMean', 'right')}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr
                key={t.symbol}
                className={t.symbol === selected ? 'row row--selected' : 'row'}
                onClick={() => onSelect(t.symbol)}
              >
                <td><strong>{t.symbol}</strong></td>
                <td className="muted name-cell">{t.name}</td>
                <td className="muted">
                  {t.firstDate.slice(0, 4)}–{t.lastDate.slice(0, 4)}
                </td>
                <td className="num">{t.athCount.toLocaleString()}</td>
                <td className="num">
                  <div className="bar-cell">
                    <div
                      className="bar"
                      style={{
                        width: `${Math.min(100, 100 * t.permAthCount / 50)}%`,
                      }}
                    />
                    <span className="bar-label">
                      {t.permAthCount.toLocaleString()}
                    </span>
                  </div>
                </td>
                <td className="num">
                  {t.settledPctUnbroken != null
                    ? `${(100 * t.settledPctUnbroken).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="num">
                  {t.recoveryDaysMean != null ? `${t.recoveryDaysMean} d` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Methodology({ generatedAt, tickerCount }) {
  return (
    <section className="methodology">
      <h3>Notes</h3>
      <ul>
        <li>
          {tickerCount} tickers: Nasdaq 100 + S&P 100 (deduped union) plus
          major tech / growth / sector / semi ETFs, gold and silver, and a
          few flavors of bitcoin. Daily prices are{' '}
          <strong>split- and dividend-adjusted closes</strong> from Yahoo
          Finance. Adjusted close treats dividends as reinvested.
        </li>
        <li>
          A close is a <strong>permanent floor</strong> for this dataset if no
          later close was equal to or below it. The "1y+ unbroken" column
          corrects for the obvious recency bias here: it only counts ATHs
          from at least a year ago, so a young ticker doesn't trivially
          score high just because its recent ATHs haven't had time to be
          undercut.
        </li>
        <li>
          <strong>Zoom</strong>: click and drag horizontally on the chart
          to focus on a sub-range; a "Reset zoom" button appears in the
          corner once you're zoomed. The 1Y / 5Y / 10Y / All pills set the
          default view that zoom operates within.
        </li>
        <li>
          Recovered ATHs are colored by how many trading days passed before
          the price was matched or undercut: <em>green</em> for short waits,
          <em> orange</em> for waits approaching a year, <em>red</em> only
          for ATHs that haven't been undercut at all (yet).
        </li>
        <li>
          We only check <em>closes</em>, not intraday lows. A stock can dip
          below a prior close intraday without ever closing there.
        </li>
        <li>
          Data refreshed {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}.
        </li>
      </ul>
    </section>
  )
}
