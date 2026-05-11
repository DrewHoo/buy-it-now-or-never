import React, { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLog, scaleTime } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { bisector } from 'd3-array'
import { timeFormat } from 'd3-time-format'
import { format as numberFormat } from 'd3-format'

const fmtDate = timeFormat('%b %e, %Y')
const fmtMoney = numberFormat('$,.2f')

const MARGIN = { top: 18, right: 18, bottom: 32, left: 56 }

const dateBisector = bisector(d => d).left

// Yellow (#fbbf24) → red (#dc2626) over 0–365 calendar days since the ATH.
// A permanent ATH from yesterday is yellow (low confidence — hasn't had time
// to be undercut); a permanent ATH from a year+ ago is full red (this one
// stuck). Saturates at 365 so older ATHs all look equally "definitive".
function permColor(daysSinceAth) {
  const t = Math.min(Math.max(daysSinceAth, 0), 365) / 365
  const r = Math.round(251 + (220 - 251) * t)
  const g = Math.round(191 + (38 - 191) * t)
  const b = Math.round(36 + (38 - 36) * t)
  return `rgb(${r}, ${g}, ${b})`
}

// "Nice" log-scale ticks: pick powers of 10 inside [lo, hi], and if the
// resulting count is small (≤ 2) fill in 3× multiples for breathing room.
function niceLogTicks(lo, hi) {
  const loE = Math.floor(Math.log10(lo))
  const hiE = Math.ceil(Math.log10(hi))
  const powers = []
  for (let e = loE; e <= hiE; e++) powers.push(Math.pow(10, e))
  const inRange = powers.filter(v => v >= lo && v <= hi)
  if (inRange.length >= 3) return inRange
  // Add 3× of each power-of-10 step (≈ midpoint on a log axis)
  const out = []
  for (let e = loE; e <= hiE; e++) {
    const a = Math.pow(10, e)
    const b = 3 * a
    if (a >= lo && a <= hi) out.push(a)
    if (b >= lo && b <= hi) out.push(b)
  }
  return out.sort((a, b) => a - b)
}

export default function Chart({ data, rangeYears }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(900)
  const height = 460

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { dates, closes, athIndices, athRecoveryDays } = data

  // Map from index → recoveryDays (null = permanent, undefined = not an ATH).
  // Used for O(1) hover lookups + classification.
  const athInfo = useMemo(() => {
    const m = new Map()
    for (let k = 0; k < athIndices.length; k++) {
      m.set(athIndices[k], athRecoveryDays[k])
    }
    return m
  }, [athIndices, athRecoveryDays])

  // Filter to the requested time range (cut from the right edge backward).
  const view = useMemo(() => {
    const parsedDates = dates.map(d => new Date(d))
    if (!rangeYears) {
      return { startIdx: 0, endIdx: dates.length - 1, parsedDates }
    }
    const lastDate = parsedDates[parsedDates.length - 1]
    const cutoff = new Date(lastDate)
    cutoff.setFullYear(cutoff.getFullYear() - rangeYears)
    let startIdx = dateBisector(parsedDates, cutoff)
    if (startIdx < 0) startIdx = 0
    return { startIdx, endIdx: parsedDates.length - 1, parsedDates }
  }, [dates, rangeYears])

  const { parsedDates, startIdx, endIdx } = view
  const lastDate = parsedDates[parsedDates.length - 1]

  const xScale = useMemo(() => {
    return scaleTime()
      .domain([parsedDates[startIdx], parsedDates[endIdx]])
      .range([MARGIN.left, width - MARGIN.right])
  }, [parsedDates, startIdx, endIdx, width])

  const yScale = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (let i = startIdx; i <= endIdx; i++) {
      const c = closes[i]
      if (c < lo) lo = c
      if (c > hi) hi = c
    }
    const padFactor = 1.08
    return scaleLog()
      .domain([Math.max(lo / padFactor, 0.001), hi * padFactor])
      .range([height - MARGIN.bottom, MARGIN.top])
  }, [closes, startIdx, endIdx])

  const linePath = useMemo(() => {
    const gen = d3line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
    const pts = []
    for (let i = startIdx; i <= endIdx; i++) {
      pts.push({ x: parsedDates[i], y: closes[i] })
    }
    return gen(pts)
  }, [parsedDates, closes, startIdx, endIdx, xScale, yScale])

  // Split the ATH points by recovery status for layered rendering.
  const { athPoints, permPoints } = useMemo(() => {
    const ath = []
    const perm = []
    for (let k = 0; k < athIndices.length; k++) {
      const i = athIndices[k]
      if (i < startIdx || i > endIdx) continue
      const wait = athRecoveryDays[k]
      const point = {
        i,
        x: xScale(parsedDates[i]),
        y: yScale(closes[i]),
      }
      if (wait == null) {
        const daysSince = Math.max(
          0,
          Math.floor((lastDate - parsedDates[i]) / 86400000),
        )
        point.color = permColor(daysSince)
        point.daysSince = daysSince
        perm.push(point)
      } else {
        ath.push(point)
      }
    }
    return { athPoints: ath, permPoints: perm }
  }, [athIndices, athRecoveryDays, startIdx, endIdx, xScale, yScale, parsedDates, closes, lastDate])

  const xTicks = useMemo(() => {
    const ticks = xScale.ticks(width < 600 ? 4 : 6)
    const fmt = xScale.tickFormat()
    return ticks.map(t => ({ v: t, label: fmt(t) }))
  }, [xScale, width])

  const yTicks = useMemo(() => {
    const [lo, hi] = yScale.domain()
    const values = niceLogTicks(lo, hi)
    return values.map(v => ({
      v,
      label: numberFormat(v < 10 ? '$.2f' : v < 100 ? '$,.1f' : '$,.0f')(v),
    }))
  }, [yScale])

  const [hover, setHover] = useState(null)

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < MARGIN.left || px > width - MARGIN.right) {
      setHover(null)
      return
    }
    const date = xScale.invert(px)
    let i = dateBisector(parsedDates, date)
    if (i < startIdx) i = startIdx
    if (i > endIdx) i = endIdx
    if (i > startIdx) {
      const prev = parsedDates[i - 1]
      const curr = parsedDates[i]
      if (Math.abs(date - prev) < Math.abs(date - curr)) i = i - 1
    }
    setHover({ i, x: xScale(parsedDates[i]), y: yScale(closes[i]) })
  }

  let hoverInfo = null
  if (hover) {
    const wait = athInfo.get(hover.i)
    const isAth = athInfo.has(hover.i)
    let daysSince = null
    if (isAth && wait == null) {
      daysSince = Math.max(
        0,
        Math.floor((lastDate - parsedDates[hover.i]) / 86400000),
      )
    }
    hoverInfo = { isAth, wait, daysSince }
  }

  return (
    <div className="chart" ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-axis labels (no gridlines — they were noisy) */}
        {yTicks.map(t => (
          <text
            key={`yl-${t.v}`}
            x={MARGIN.left - 8}
            y={yScale(t.v) + 4}
            textAnchor="end"
            fontSize={11}
            fill="#888"
          >
            {t.label}
          </text>
        ))}
        {/* X-axis ticks */}
        {xTicks.map(t => (
          <g key={`xt-${t.v.getTime()}`} transform={`translate(${xScale(t.v)}, 0)`}>
            <line
              y1={height - MARGIN.bottom} y2={height - MARGIN.bottom + 4}
              stroke="#bbb"
            />
            <text
              y={height - MARGIN.bottom + 18}
              textAnchor="middle" fontSize={11} fill="#888"
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* Baseline */}
        <line
          x1={MARGIN.left} x2={width - MARGIN.right}
          y1={height - MARGIN.bottom} y2={height - MARGIN.bottom}
          stroke="#ccc"
        />

        {/* Price line */}
        <path
          d={linePath}
          fill="none"
          stroke="#1f4e8c"
          strokeWidth={1.5}
        />

        {/* ATH markers that DID recover — subtle gray */}
        {athPoints.map(p => (
          <circle
            key={`ath-${p.i}`}
            cx={p.x} cy={p.y} r={2.5}
            fill="#9aa3b2" stroke="white" strokeWidth={0.5}
            opacity={0.7}
          />
        ))}

        {/* Permanent ATHs — color encodes confidence (age in days) */}
        {permPoints.map(p => (
          <circle
            key={`pf-${p.i}`}
            cx={p.x} cy={p.y} r={4.5}
            fill={p.color} stroke="white" strokeWidth={1.5}
          />
        ))}

        {hover && (
          <g>
            <line
              x1={hover.x} x2={hover.x}
              y1={MARGIN.top} y2={height - MARGIN.bottom}
              stroke="#999" strokeDasharray="3 3"
            />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#1f4e8c" stroke="white" strokeWidth={1.5} />
          </g>
        )}

        <rect
          x={MARGIN.left} y={MARGIN.top}
          width={width - MARGIN.left - MARGIN.right}
          height={height - MARGIN.top - MARGIN.bottom}
          fill="transparent"
          pointerEvents="all"
        />
      </svg>
      {hover && hoverInfo && (
        <HoverCard
          date={parsedDates[hover.i]}
          close={closes[hover.i]}
          info={hoverInfo}
          left={Math.min(Math.max(hover.x + 12, 8), width - 230)}
          top={Math.max(hover.y - 80, 8)}
        />
      )}
    </div>
  )
}

function HoverCard({ date, close, info, left, top }) {
  return (
    <div className="hover-card" style={{ left, top }}>
      <div className="hover-date">{fmtDate(date)}</div>
      <div className="hover-price">{fmtMoney(close)}</div>
      {info.isAth && info.wait == null && (
        <div className="hover-tag hover-tag--perm">
          ATH — never seen again
          <div className="hover-sub">
            {info.daysSince === 0
              ? 'today'
              : `${info.daysSince.toLocaleString()} day${info.daysSince === 1 ? '' : 's'} and counting`}
          </div>
        </div>
      )}
      {info.isAth && info.wait != null && (
        <div className="hover-tag hover-tag--ath">
          ATH — recovered
          <div className="hover-sub">
            could buy at this price again {info.wait} trading day{info.wait === 1 ? '' : 's'} later
          </div>
        </div>
      )}
    </div>
  )
}
