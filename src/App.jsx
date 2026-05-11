import React, { useEffect, useState } from 'react'
import Chart from './Chart.jsx'

const RANGE_OPTIONS = [
  { label: '1Y', years: 1 },
  { label: '5Y', years: 5 },
  { label: '10Y', years: 10 },
  { label: 'All', years: null },
]

export default function App() {
  const [index, setIndex] = useState(null)
  const [selected, setSelected] = useState(null)
  const [data, setData] = useState(null)
  const [range, setRange] = useState(null) // null = All
  const [error, setError] = useState(null)

  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    fetch(`${baseUrl}data/index.json`)
      .then(r => r.json())
      .then(idx => {
        setIndex(idx)
        // Default to SOXQ since the question was prompted by it
        const def = idx.tickers.find(t => t.symbol === 'SOXQ') || idx.tickers[0]
        setSelected(def.symbol)
      })
      .catch(err => setError(err.message))
  }, [baseUrl])

  useEffect(() => {
    if (!selected) return
    setData(null)
    fetch(`${baseUrl}data/${selected}.json`)
      .then(r => r.json())
      .then(setData)
      .catch(err => setError(err.message))
  }, [selected, baseUrl])

  if (error) {
    return <main className="error">Couldn't load data: {error}</main>
  }
  if (!index || !data) {
    return <main className="loading">Loading…</main>
  }

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
        <div className="ticker-switcher" role="tablist">
          {index.tickers.map(t => (
            <button
              key={t.symbol}
              role="tab"
              aria-selected={selected === t.symbol}
              className={selected === t.symbol ? 'pill pill--active' : 'pill'}
              onClick={() => setSelected(t.symbol)}
            >
              {t.symbol}
            </button>
          ))}
        </div>
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

      <section className="legend">
        <span className="legend-item">
          <span className="legend-line" /> Adjusted close
        </span>
        <span className="legend-item">
          <span className="legend-dot legend-dot--ath" /> ATH that{' '}
          <em>did</em> come back
        </span>
        <span className="legend-item legend-item--gradient">
          <span className="legend-gradient" />
          <span className="legend-gradient-labels">
            <span>just happened</span>
            <span>1+ year unbroken</span>
          </span>
          <span className="legend-gradient-caption">
            ATH never seen again
          </span>
        </span>
      </section>

      <Stats stats={data.stats} symbol={data.symbol} />

      <Comparison tickers={index.tickers} selected={selected} onSelect={setSelected} />

      <Methodology generatedAt={index.generatedAt} />
    </main>
  )
}

function Stats({ stats, symbol }) {
  const pctPerm = (100 * stats.pctAthsThatWerePermanent).toFixed(1)
  const recovered = stats.recoveredAthCount
  return (
    <section className="stats">
      <div className="stat">
        <div className="stat-value">{stats.athCount.toLocaleString()}</div>
        <div className="stat-label">all-time-high closes</div>
      </div>
      <div className="stat stat--accent">
        <div className="stat-value">{stats.permAthCount.toLocaleString()}</div>
        <div className="stat-label">
          never seen again afterward ({pctPerm}% of ATHs)
        </div>
      </div>
      <div className="stat">
        <div className="stat-value">
          {stats.recoveryDaysMedian != null
            ? `${stats.recoveryDaysMedian} d`
            : '—'}
        </div>
        <div className="stat-label">
          median wait when an ATH <em>did</em> come back
          {recovered ? ` (n=${recovered})` : ''}
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
  const rows = [...tickers].sort(
    (a, b) => b.pctAthsThatWerePermanent - a.pctAthsThatWerePermanent,
  )
  const maxPct = rows[0]?.pctAthsThatWerePermanent || 1
  return (
    <section className="comparison">
      <h3>Across all tickers — share of ATHs that turned out to be permanent</h3>
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>History</th>
            <th>ATH closes</th>
            <th>Never seen again</th>
            <th>% permanent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr
              key={t.symbol}
              className={t.symbol === selected ? 'row row--selected' : 'row'}
              onClick={() => onSelect(t.symbol)}
            >
              <td><strong>{t.symbol}</strong></td>
              <td className="muted">
                {t.firstDate.slice(0, 4)}–{t.lastDate.slice(0, 4)}
              </td>
              <td>{t.athCount.toLocaleString()}</td>
              <td>{t.permAthCount.toLocaleString()}</td>
              <td>
                <div className="bar-cell">
                  <div
                    className="bar"
                    style={{
                      width: `${(100 * t.pctAthsThatWerePermanent) / maxPct}%`,
                    }}
                  />
                  <span className="bar-label">
                    {(100 * t.pctAthsThatWerePermanent).toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Methodology({ generatedAt }) {
  return (
    <section className="methodology">
      <h3>Notes</h3>
      <ul>
        <li>
          Daily prices are <strong>split- and dividend-adjusted closes</strong>{' '}
          from Yahoo Finance. Adjusted close treats dividends as reinvested, so
          historical numbers can be lower than the raw quote that traded on that
          day.
        </li>
        <li>
          A close is a <strong>permanent floor</strong> for this dataset if no
          later close was equal to or below it. By definition the most recent
          close is always trivially permanent — interpret with care for the last
          few months.
        </li>
        <li>
          A <strong>permanent ATH</strong> is the intersection: a new
          closing-price all-time high that also was never undercut by any later
          close. These are the "if you didn't buy, you missed it forever" days.
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
