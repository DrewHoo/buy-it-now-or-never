import React, { useEffect, useMemo, useRef, useState } from 'react'
import Chart from './Chart.jsx'

const RANGE_OPTIONS = [
  { label: '1Y', years: 1 },
  { label: '5Y', years: 5 },
  { label: '10Y', years: 10 },
  { label: 'All', years: null },
]

const QUICK_PICKS = [
  'SOXQ', 'SMH', 'QQQ', 'SPY', 'NVDA', 'AAPL', 'MSFT', 'GLD', 'BTC-USD',
]

export default function App() {
  const [index, setIndex] = useState(null)
  const [selected, setSelected] = useState(null)
  const [data, setData] = useState(null)
  const [range, setRange] = useState(null)
  const [error, setError] = useState(null)
  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    fetch(`${baseUrl}data/index.json`)
      .then(r => r.json())
      .then(idx => {
        setIndex(idx)
        const def =
          idx.tickers.find(t => t.symbol === 'SOXQ') || idx.tickers[0]
        setSelected(def.symbol)
      })
      .catch(err => setError(err.message))
  }, [baseUrl])

  useEffect(() => {
    if (!selected) return
    setData(null)
    fetch(`${baseUrl}data/${encodeURIComponent(selected)}.json`)
      .then(r => r.json())
      .then(setData)
      .catch(err => setError(err.message))
  }, [selected, baseUrl])

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
          onSelect={sym => symbolSet.has(sym) && setSelected(sym)}
        />
        <div className="range-switcher">
          {RANGE_OPTIONS.map(r => (
            <button
              key={r.label}
              className={range === r.years ? 'range range--active' : 'range'}
              onClick={() => setRange(r.years)}
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
            onClick={() => setSelected(s)}
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

      <Chart data={data} rangeYears={range} />

      <Legend />

      <Stats stats={data.stats} />

      <Comparison
        tickers={index.tickers}
        selected={selected}
        onSelect={setSelected}
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
                {(100 * t.pctAthsThatWerePermanent).toFixed(1)}%
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
          {stats.recoveryDaysMedian != null ? `${stats.recoveryDaysMedian} d` : '—'}
        </div>
        <div className="stat-label">
          median wait when an ATH <em>did</em> come back
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
  const [sort, setSort] = useState({ key: 'pctAthsThatWerePermanent', dir: 'desc' })
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
        <h3>All {tickers.length} tickers — sorted by share of ATHs never undercut</h3>
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
              {header('% permanent', 'pctAthsThatWerePermanent', 'right')}
              {header('Median wait', 'recoveryDaysMedian', 'right')}
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
                <td className="num">{t.permAthCount.toLocaleString()}</td>
                <td className="num">
                  <div className="bar-cell">
                    <div
                      className="bar"
                      style={{
                        width: `${Math.min(100, 100 * t.pctAthsThatWerePermanent / 0.3)}%`,
                      }}
                    />
                    <span className="bar-label">
                      {(100 * t.pctAthsThatWerePermanent).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="num">
                  {t.recoveryDaysMedian != null ? `${t.recoveryDaysMedian} d` : '—'}
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
          later close was equal to or below it. By definition the most recent
          close is always trivially permanent — interpret the most recent red
          dot accordingly.
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
