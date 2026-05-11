// Generate a 1200x630 OG preview image. Run with: node scripts/gen-og.mjs
// The output (public/og.png) is committed; CI does not regenerate it.

import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

const W = 1200
const H = 630
const MUTED = '#9ba3b5'
const TEXT = '#ffffff'

// A stylized price series for the right-side illustration. Drawn by
// hand so the visual reads as "stocks go up, mostly" without being
// any real ticker. ATH markers are colored on the same buyable-days
// gradient used in the live chart (red = 0 buyable days "never seen
// again", through yellow, to green = 1y+ of opportunity afterward).
const seriesPath = `M 0 360 L 38 348 L 76 330 L 114 338 L 152 312 L 190 320 L 228 290 L 266 296 L 304 270 L 342 282 L 380 254 L 418 244 L 456 254 L 494 222 L 532 200 L 570 174`
const athDots = [
  { x: 76,  y: 330, c: '#22c55e', r: 7 },  // early ATH — undercut many times later → green
  { x: 152, y: 312, c: '#22c55e', r: 7 },
  { x: 228, y: 290, c: '#84cc16', r: 7 },
  { x: 304, y: 270, c: '#eab308', r: 8 },
  { x: 380, y: 254, c: '#f59e0b', r: 8 },
  { x: 418, y: 244, c: '#f97316', r: 8 },
  { x: 494, y: 222, c: '#dc2626', r: 10 }, // recent ATH — never seen again → red
  { x: 570, y: 174, c: '#dc2626', r: 10 },
]

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#11151c"/>
      <stop offset="100%" stop-color="#0a0d12"/>
    </linearGradient>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"  stop-color="#dc2626"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Left column: title + subtitle -->
  <text x="60" y="120" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="22" fill="${MUTED}" font-weight="600" letter-spacing="3">
    BUY IT NOW
  </text>
  <text x="60" y="220" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="96" fill="${TEXT}" font-weight="700" letter-spacing="-2">
    or never
  </text>

  <text x="60" y="300" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="26" fill="${TEXT}" font-weight="500">
    Every closing-price all-time high
  </text>
  <text x="60" y="335" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="26" fill="${TEXT}" font-weight="500">
    that was never undercut afterward.
  </text>

  <text x="60" y="395" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="20" fill="${MUTED}" font-weight="400">
    216 tickers · SOXQ, NVDA, SPY, BTC,
  </text>
  <text x="60" y="420" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="20" fill="${MUTED}" font-weight="400">
    the Nasdaq 100 + S&amp;P 100, sector ETFs
  </text>

  <!-- Right column: stylized chart card -->
  <g transform="translate(580, 120)">
    <rect x="0" y="0" width="560" height="380" rx="14" fill="#151921"
      stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <!-- Faint axis labels for "chart-ness" -->
    <text x="20" y="50" font-family="DM Mono, monospace" font-size="11" fill="${MUTED}">$300</text>
    <text x="20" y="190" font-family="DM Mono, monospace" font-size="11" fill="${MUTED}">$100</text>
    <text x="20" y="340" font-family="DM Mono, monospace" font-size="11" fill="${MUTED}"> $30</text>

    <!-- Price line -->
    <g transform="translate(60, 30)">
      <path d="${seriesPath}" fill="none" stroke="#60a5fa" stroke-width="2.5"/>
      ${athDots.map(d => `
        <circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.c}" stroke="white" stroke-width="1.5"/>
      `).join('')}
    </g>
  </g>

  <!-- Legend below chart -->
  <g transform="translate(580, 520)">
    <rect x="0" y="-10" width="240" height="10" rx="2" fill="url(#grad)"/>
    <text x="0" y="14" font-family="DM Mono, monospace" font-size="10" fill="${MUTED}">never seen again</text>
    <text x="240" y="14" font-family="DM Mono, monospace" font-size="10" fill="${MUTED}" text-anchor="end">1y+ buyable</text>
    <text x="0" y="38" font-family="DM Sans, Helvetica, Arial, sans-serif"
      font-size="13" fill="${MUTED}">ATH — days afterward at this price or lower</text>
  </g>

  <!-- Footer URL + accent bar -->
  <text x="60" y="580" font-family="DM Sans, Helvetica, Arial, sans-serif"
    font-size="18" fill="${MUTED}" font-weight="500">
    drewhoover.com/buy-it-now-or-never
  </text>
  <rect x="60" y="600" width="80" height="3" fill="#dc2626"/>
</svg>`

const out = resolve(outDir, 'og.png')
await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(out)
console.log(`wrote ${out}`)
