import React, { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLog, scaleTime } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { extent, bisector } from 'd3-array'
import { timeFormat } from 'd3-time-format'
import { format as numberFormat } from 'd3-format'

const fmtDate = timeFormat('%b %e, %Y')
const fmtMoney = numberFormat('$,.2f')

const MARGIN = { top: 18, right: 18, bottom: 32, left: 56 }

const dateBisector = bisector(d => d).left

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

  const { dates, closes, athIndices, permFloorAthIndices } = data

  // Filter to the requested time range (cut from the right edge backward).
  const view = useMemo(() => {
    if (!rangeYears) {
      return {
        startIdx: 0,
        endIdx: dates.length - 1,
        parsedDates: dates.map(d => new Date(d)),
      }
    }
    const parsedDates = dates.map(d => new Date(d))
    const lastDate = parsedDates[parsedDates.length - 1]
    const cutoff = new Date(lastDate)
    cutoff.setFullYear(cutoff.getFullYear() - rangeYears)
    let startIdx = dateBisector(parsedDates, cutoff)
    if (startIdx < 0) startIdx = 0
    return { startIdx, endIdx: parsedDates.length - 1, parsedDates }
  }, [dates, rangeYears])

  const { parsedDates, startIdx, endIdx } = view

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
    // pad domain so points aren't right at the edges
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

  // ATH markers (subtle): only those NOT also in permanent-floor set
  const permSet = useMemo(() => new Set(permFloorAthIndices), [permFloorAthIndices])
  const athPoints = useMemo(() => {
    const out = []
    for (const i of athIndices) {
      if (i < startIdx || i > endIdx) continue
      if (permSet.has(i)) continue
      out.push({ i, x: xScale(parsedDates[i]), y: yScale(closes[i]) })
    }
    return out
  }, [athIndices, permSet, startIdx, endIdx, xScale, yScale, parsedDates, closes])

  const permPoints = useMemo(() => {
    const out = []
    for (const i of permFloorAthIndices) {
      if (i < startIdx || i > endIdx) continue
      out.push({ i, x: xScale(parsedDates[i]), y: yScale(closes[i]) })
    }
    return out
  }, [permFloorAthIndices, startIdx, endIdx, xScale, yScale, parsedDates, closes])

  const xTicks = useMemo(() => {
    const ticks = xScale.ticks(width < 600 ? 4 : 7)
    const fmt = xScale.tickFormat()
    return ticks.map(t => ({ v: t, label: fmt(t) }))
  }, [xScale, width])

  const yTicks = useMemo(() => {
    return yScale.ticks(6).map(v => ({ v, label: numberFormat(v < 10 ? '$.2f' : '$,.0f')(v) }))
  }, [yScale])

  // Hover state — used to render a vertical guide + tooltip
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
    // Snap to nearest of i and i-1
    if (i > startIdx) {
      const prev = parsedDates[i - 1]
      const curr = parsedDates[i]
      if (Math.abs(date - prev) < Math.abs(date - curr)) i = i - 1
    }
    setHover({ i, x: xScale(parsedDates[i]), y: yScale(closes[i]) })
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
        {/* y gridlines */}
        {yTicks.map(t => (
          <g key={`yg-${t.v}`} transform={`translate(0, ${yScale(t.v)})`}>
            <line
              x1={MARGIN.left} x2={width - MARGIN.right}
              stroke="#eaeaea" strokeWidth={1}
            />
            <text x={MARGIN.left - 8} y={4} textAnchor="end" fontSize={11} fill="#666">
              {t.label}
            </text>
          </g>
        ))}
        {/* x axis ticks */}
        {xTicks.map(t => (
          <g key={`xt-${t.v.getTime()}`} transform={`translate(${xScale(t.v)}, 0)`}>
            <line
              y1={height - MARGIN.bottom} y2={height - MARGIN.bottom + 4}
              stroke="#999"
            />
            <text
              y={height - MARGIN.bottom + 18}
              textAnchor="middle" fontSize={11} fill="#666"
            >
              {t.label}
            </text>
          </g>
        ))}
        {/* Axes */}
        <line
          x1={MARGIN.left} x2={width - MARGIN.right}
          y1={height - MARGIN.bottom} y2={height - MARGIN.bottom}
          stroke="#333"
        />
        <line
          x1={MARGIN.left} x2={MARGIN.left}
          y1={MARGIN.top} y2={height - MARGIN.bottom}
          stroke="#333"
        />

        {/* Price line */}
        <path
          d={linePath}
          fill="none"
          stroke="#1f4e8c"
          strokeWidth={1.5}
        />

        {/* ATH markers (gray) */}
        {athPoints.map(p => (
          <circle
            key={`ath-${p.i}`}
            cx={p.x} cy={p.y} r={2.5}
            fill="#9aa3b2" stroke="white" strokeWidth={0.5}
            opacity={0.85}
          />
        ))}

        {/* Permanent-floor ATH markers (red) — "blew it" moments */}
        {permPoints.map(p => (
          <circle
            key={`pf-${p.i}`}
            cx={p.x} cy={p.y} r={4.5}
            fill="#dc2626" stroke="white" strokeWidth={1.5}
          />
        ))}

        {/* Hover guide */}
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

        {/* Capture rect for mouse events — must be last so it doesn't block markers */}
        <rect
          x={MARGIN.left} y={MARGIN.top}
          width={width - MARGIN.left - MARGIN.right}
          height={height - MARGIN.top - MARGIN.bottom}
          fill="transparent"
          pointerEvents="all"
        />
      </svg>
      {hover && (
        <HoverCard
          date={parsedDates[hover.i]}
          close={closes[hover.i]}
          isAth={athIndices.includes(hover.i)}
          isPerm={permSet.has(hover.i)}
          // Position relative to container; clamp to keep on screen
          left={Math.min(Math.max(hover.x + 12, 8), width - 220)}
          top={Math.max(hover.y - 70, 8)}
        />
      )}
    </div>
  )
}

function HoverCard({ date, close, isAth, isPerm, left, top }) {
  return (
    <div className="hover-card" style={{ left, top }}>
      <div className="hover-date">{fmtDate(date)}</div>
      <div className="hover-price">{fmtMoney(close)}</div>
      {isPerm && (
        <div className="hover-tag hover-tag--perm">
          ATH — never seen again
        </div>
      )}
      {isAth && !isPerm && (
        <div className="hover-tag hover-tag--ath">
          All-time-high close
        </div>
      )}
    </div>
  )
}
