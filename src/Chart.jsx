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

// Recovered ATHs get a green → yellow → orange gradient by how long the
// buyer had to wait. Permanent ATHs ("and counting") are solid red — a
// distinct visual category, not the saturating end of the same scale.
//
// We scale by log1p(wait) so that the meaningful range of wait times
// (a day to a few years) spreads cleanly across the gradient: a 1-week
// wait is barely tinted, a 1-month wait is yellow-green, a 1-year wait
// reads as orange, multi-year waits saturate.
const PERMANENT_COLOR = 'rgb(220, 38, 38)' // red-600
function lerp(a, b, t) { return Math.round(a + (b - a) * t) }
function rgb(c) { return `rgb(${c[0]}, ${c[1]}, ${c[2]})` }
const GREEN  = [34, 197, 94]   // green-500
const YELLOW = [234, 179, 8]   // yellow-500
const ORANGE = [249, 115, 22]  // orange-500
function athColor(waitTradingDays) {
  if (waitTradingDays == null) return PERMANENT_COLOR
  // Normalize log1p(wait) onto [0, 1] over [0, ~1000 trading days (~4 years)].
  const t = Math.min(1, Math.log1p(waitTradingDays) / Math.log1p(1000))
  if (t < 0.5) {
    const u = t * 2
    return rgb([lerp(GREEN[0], YELLOW[0], u), lerp(GREEN[1], YELLOW[1], u), lerp(GREEN[2], YELLOW[2], u)])
  }
  const u = (t - 0.5) * 2
  return rgb([lerp(YELLOW[0], ORANGE[0], u), lerp(YELLOW[1], ORANGE[1], u), lerp(YELLOW[2], ORANGE[2], u)])
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

  // Every ATH gets a colored marker. Recovered ATHs are colored by wait
  // length; permanent ATHs are solid red. We split into two arrays so
  // the permanent ones can render on top with a larger radius.
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
        color: athColor(wait),
        wait,
      }
      if (wait == null) perm.push(point)
      else ath.push(point)
    }
    return { athPoints: ath, permPoints: perm }
  }, [athIndices, athRecoveryDays, startIdx, endIdx, xScale, yScale, parsedDates, closes])

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

        {/* Recovered ATHs — green → yellow → orange by wait length */}
        {athPoints.map(p => (
          <circle
            key={`ath-${p.i}`}
            cx={p.x} cy={p.y} r={3}
            fill={p.color} stroke="white" strokeWidth={0.75}
          />
        ))}

        {/* Permanent ATHs — solid red, drawn on top with a thicker ring */}
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
