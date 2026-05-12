import React, { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLog, scaleUtc } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { bisector } from 'd3-array'
import { utcFormat } from 'd3-time-format'
import { format as numberFormat } from 'd3-format'

// The per-ticker JSON stores dates as bare 'YYYY-MM-DD' strings, which
// JavaScript's Date constructor parses as UTC midnight. Formatting and
// axis ticks must also read those Date objects in UTC — otherwise
// viewers west of GMT see every trading day shifted back one day on
// the axis and in hover labels.
const fmtDate = utcFormat('%b %e, %Y')
const fmtMoney = numberFormat('$,.2f')

const MARGIN = { top: 18, right: 18, bottom: 32, left: 56 }

const dateBisector = bisector(d => d).left

// All ATHs share a single color gradient driven by athBuyableDays —
// the total trading days the close stayed at or below the ATH afterward.
//   Red    = 0 buyable days (the ATH was never seen again)
//   Yellow = ~1 month of buyable opportunity
//   Green  = ~4 years of buyable opportunity
// Log1p-scaled so the meaningful range (single days to thousands of
// days) spreads cleanly. Permanent ATHs fall at the red end naturally.
function lerp(a, b, t) { return Math.round(a + (b - a) * t) }
function rgb(c) { return `rgb(${c[0]}, ${c[1]}, ${c[2]})` }
const RED    = [220, 38, 38]   // red-600
const YELLOW = [234, 179, 8]   // yellow-500
const GREEN  = [34, 197, 94]   // green-500
function athColor(buyableDays) {
  const t = Math.min(1, Math.log1p(buyableDays || 0) / Math.log1p(1000))
  if (t < 0.5) {
    const u = t * 2
    return rgb([lerp(RED[0], YELLOW[0], u), lerp(RED[1], YELLOW[1], u), lerp(RED[2], YELLOW[2], u)])
  }
  const u = (t - 0.5) * 2
  return rgb([lerp(YELLOW[0], GREEN[0], u), lerp(YELLOW[1], GREEN[1], u), lerp(YELLOW[2], GREEN[2], u)])
}

// Log-scale tick selection that adapts to the range:
//   - < ~0.7 orders of magnitude (range like $35–$55): pick clean 1-2-5
//     stepped values; on a narrow log range the axis effectively reads
//     linear so this gives nicely spaced labels.
//   - up to 2.5 orders: use 1/2/5 multipliers per power of 10
//   - up to 4 orders: use 1/3 multipliers
//   - very wide: just powers of 10
function niceLogTicks(lo, hi) {
  const orders = Math.log10(hi / lo)
  if (orders < 0.7) {
    const span = hi - lo
    const rawStep = span / 5
    const k = Math.floor(Math.log10(rawStep))
    const base = Math.pow(10, k)
    const m = rawStep / base
    const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * base
    const start = Math.ceil(lo / step) * step
    const out = []
    for (let v = start; v <= hi + step * 1e-9; v += step) out.push(v)
    return out
  }
  const multipliers = orders < 2.5 ? [1, 2, 5] : orders < 4 ? [1, 3] : [1]
  const loE = Math.floor(Math.log10(lo))
  const hiE = Math.ceil(Math.log10(hi))
  const out = []
  for (let e = loE; e <= hiE; e++) {
    for (const m of multipliers) {
      const v = m * Math.pow(10, e)
      if (v >= lo && v <= hi) out.push(v)
    }
  }
  return out.sort((a, b) => a - b)
}

// Pick black or white text for legibility on top of a given rgb(...) string.
// 0.6 is empirically the right luminance threshold for our green→orange band.
function textColorOn(rgbStr) {
  const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgbStr || '')
  if (!m) return 'white'
  const luma = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255
  return luma > 0.6 ? '#0c0f14' : 'white'
}

function formatTickValue(v) {
  if (v >= 100) return numberFormat('$,.0f')(v)
  if (v >= 10) return numberFormat('$,.0~f')(v)
  if (v >= 1) return numberFormat('$,.2~f')(v)
  if (v >= 0.1) return numberFormat('$.2f')(v)
  return numberFormat('$.4f')(v)
}

export default function Chart({ data, rangeYears, zoom, onZoomChange }) {
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

  const { dates, closes, athIndices, athRecoveryDays, athBuyableDays } = data

  // Map from index → { wait, buyable } for O(1) hover lookups.
  // wait == null means permanent; absence from the map means not an ATH.
  const athInfo = useMemo(() => {
    const m = new Map()
    for (let k = 0; k < athIndices.length; k++) {
      m.set(athIndices[k], {
        wait: athRecoveryDays[k],
        buyable: athBuyableDays ? athBuyableDays[k] : null,
      })
    }
    return m
  }, [athIndices, athRecoveryDays, athBuyableDays])

  // Zoom is now controlled by the parent (App holds it so the URL effect
  // can see it). Brush state is the mid-drag selection rectangle and
  // stays local — once the user releases, we hand the new range up via
  // onZoomChange.
  const [brush, setBrush] = useState(null)

  const view = useMemo(() => {
    const parsedDates = dates.map(d => new Date(d))
    const n = parsedDates.length
    let baseStart = 0
    let baseEnd = n - 1
    if (rangeYears) {
      const cutoff = new Date(parsedDates[baseEnd])
      cutoff.setFullYear(cutoff.getFullYear() - rangeYears)
      baseStart = Math.max(0, dateBisector(parsedDates, cutoff))
    }
    if (zoom) {
      const z0 = dateBisector(parsedDates, zoom[0])
      const z1 = dateBisector(parsedDates, zoom[1])
      const lo = Math.max(baseStart, Math.min(z0, z1))
      const hi = Math.min(baseEnd,  Math.max(z0, z1))
      if (hi > lo + 1) return { startIdx: lo, endIdx: hi, parsedDates }
    }
    return { startIdx: baseStart, endIdx: baseEnd, parsedDates }
  }, [dates, rangeYears, zoom])

  const { parsedDates, startIdx, endIdx } = view
  const lastDate = parsedDates[parsedDates.length - 1]

  const xScale = useMemo(() => {
    return scaleUtc()
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

  // Every ATH gets a single colored marker on the buyable-days gradient.
  // We still split into "perm" and "recovered" for rendering order —
  // permanent (red) markers draw on top so they pop in dense clusters.
  const { athPoints, permPoints } = useMemo(() => {
    const ath = []
    const perm = []
    for (let k = 0; k < athIndices.length; k++) {
      const i = athIndices[k]
      if (i < startIdx || i > endIdx) continue
      const wait = athRecoveryDays[k]
      const buyable = athBuyableDays ? athBuyableDays[k] : null
      const point = {
        i,
        x: xScale(parsedDates[i]),
        y: yScale(closes[i]),
        color: athColor(buyable),
      }
      if (wait == null) perm.push(point)
      else ath.push(point)
    }
    return { athPoints: ath, permPoints: perm }
  }, [athIndices, athRecoveryDays, athBuyableDays, startIdx, endIdx, xScale, yScale, parsedDates, closes])

  const xTicks = useMemo(() => {
    const ticks = xScale.ticks(width < 600 ? 4 : 6)
    const fmt = xScale.tickFormat()
    return ticks.map(t => ({ v: t, label: fmt(t) }))
  }, [xScale, width])

  const yTicks = useMemo(() => {
    const [lo, hi] = yScale.domain()
    return niceLogTicks(lo, hi).map(v => ({ v, label: formatTickValue(v) }))
  }, [yScale])

  const [hover, setHover] = useState(null)

  function svgXFromEvent(e) {
    const r = e.currentTarget.getBoundingClientRect()
    // viewBox width may differ from rendered pixel width; rescale.
    return ((e.clientX - r.left) / r.width) * width
  }

  function clampX(x) {
    return Math.max(MARGIN.left, Math.min(width - MARGIN.right, x))
  }

  function indexAtX(px) {
    const date = xScale.invert(px)
    let i = dateBisector(parsedDates, date)
    if (i < startIdx) i = startIdx
    if (i > endIdx) i = endIdx
    if (i > startIdx) {
      const prev = parsedDates[i - 1]
      const curr = parsedDates[i]
      if (Math.abs(date - prev) < Math.abs(date - curr)) i = i - 1
    }
    return i
  }

  // Pointer events unify mouse + touch. We branch on pointerType so a
  // mouse drag still triggers brush-to-zoom while a finger drag scrubs
  // the tooltip along the line (no zoom on touch — pinch/zoom gestures
  // are reserved for the OS).
  function isTouch(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen'
  }

  function updateHoverAt(px) {
    if (px < MARGIN.left || px > width - MARGIN.right) {
      setHover(null)
      return
    }
    const i = indexAtX(px)
    setHover({ i, x: xScale(parsedDates[i]), y: yScale(closes[i]) })
  }

  function onPointerDown(e) {
    const px = svgXFromEvent(e)
    if (px < MARGIN.left || px > width - MARGIN.right) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (isTouch(e)) {
      // Finger-down = start scrubbing for info. No brush on touch.
      updateHoverAt(px)
    } else {
      setBrush({ startX: px, endX: px })
      setHover(null)
    }
  }

  function onPointerMove(e) {
    const px = svgXFromEvent(e)
    if (brush) {
      setBrush(b => ({ ...b, endX: clampX(px) }))
      return
    }
    updateHoverAt(px)
  }

  function onPointerUp(e) {
    if (brush) {
      const drag = Math.abs(brush.endX - brush.startX)
      if (drag > 8) {
        const lo = Math.min(brush.startX, brush.endX)
        const hi = Math.max(brush.startX, brush.endX)
        onZoomChange([xScale.invert(lo), xScale.invert(hi)])
      }
      setBrush(null)
    }
    // On touch, clear the tooltip when the finger lifts. On mouse, leave
    // hover state alone so the value follows the cursor.
    if (isTouch(e)) setHover(null)
  }

  function onPointerCancel() {
    setBrush(null)
    setHover(null)
  }

  function onPointerLeave(e) {
    // Only clear on real mouse-out — touch's pointerleave fires right
    // after pointerup, which we've already handled.
    if (!isTouch(e)) {
      setBrush(null)
      setHover(null)
    }
  }

  let hoverInfo = null
  if (hover) {
    const ath = athInfo.get(hover.i)
    const isAth = athInfo.has(hover.i)
    const wait = ath ? ath.wait : undefined
    const buyable = ath ? ath.buyable : null
    let daysSince = null
    let color = null
    if (isAth) {
      if (wait == null) {
        daysSince = Math.max(
          0,
          Math.floor((lastDate - parsedDates[hover.i]) / 86400000),
        )
      } else {
        color = athColor(buyable)
      }
    }
    hoverInfo = { isAth, wait, daysSince, color, buyable }
  }

  return (
    <div className="chart" ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{
          cursor: brush ? 'crosshair' : 'default',
          // Let vertical scrolls pass through; capture horizontal drags
          // so scrubbing the chart doesn't fight with page scroll.
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
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

        {/* All ATHs share the buyable-days gradient. Borders dropped so
            overlapping dots compound via alpha — clusters darken, which
            encodes density on top of the per-dot color. Permanents keep
            a slightly larger radius so red dots still read in clusters. */}
        {athPoints.map(p => (
          <circle
            key={`ath-${p.i}`}
            cx={p.x} cy={p.y} r={3}
            fill={p.color} opacity={0.7}
          />
        ))}
        {permPoints.map(p => (
          <circle
            key={`pf-${p.i}`}
            cx={p.x} cy={p.y} r={4.5}
            fill={p.color} opacity={0.7}
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

        {/* Brush selection rectangle during drag */}
        {brush && Math.abs(brush.endX - brush.startX) > 1 && (
          <rect
            x={Math.min(brush.startX, brush.endX)}
            y={MARGIN.top}
            width={Math.abs(brush.endX - brush.startX)}
            height={height - MARGIN.top - MARGIN.bottom}
            fill="rgba(31, 78, 140, 0.10)"
            stroke="rgba(31, 78, 140, 0.45)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        <rect
          x={MARGIN.left} y={MARGIN.top}
          width={width - MARGIN.left - MARGIN.right}
          height={height - MARGIN.top - MARGIN.bottom}
          fill="transparent"
          pointerEvents="all"
          style={{ cursor: 'crosshair' }}
        />
      </svg>
      {zoom && (
        <button className="chart-reset" onClick={() => onZoomChange(null)}>
          Reset zoom
        </button>
      )}
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
        <div
          className="hover-tag hover-tag--ath"
          style={info.color ? { background: info.color, color: textColorOn(info.color) } : undefined}
        >
          ATH — recovered
          <div className="hover-sub">
            {info.wait} day{info.wait === 1 ? '' : 's'} until seen again
          </div>
          {info.buyable != null && (
            <div className="hover-sub">
              {info.buyable} day{info.buyable === 1 ? '' : 's'} at or below afterward
            </div>
          )}
        </div>
      )}
    </div>
  )
}
