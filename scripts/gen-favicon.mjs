// Generate favicon assets from a single SVG source. Run with:
//   node scripts/gen-favicon.mjs
// Writes:
//   public/favicon.svg          — modern browsers (vector, any size)
//   public/favicon-32.png       — generic small-pixel fallback
//   public/favicon-192.png      — Android, PWA
//   public/apple-touch-icon.png — iOS home-screen icon (180x180)

import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

// Bold, high-contrast design that reads at 16x16 in a browser tab strip:
//   - dark-blue rounded square (matches the chart's line color)
//   - white "chart line" stepping up
//   - red dot at the top-right (the "ATH never seen again" marker)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#1f4e8c"/>
  <polyline
    points="10,50 22,38 32,44 44,26 54,18"
    fill="none" stroke="white" stroke-width="5"
    stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="54" cy="18" r="8" fill="#dc2626" stroke="white" stroke-width="2.5"/>
</svg>`

writeFileSync(resolve(outDir, 'favicon.svg'), svg + '\n')
console.log('wrote favicon.svg')

const png = [
  { name: 'favicon-32.png',       size: 32 },
  { name: 'favicon-192.png',      size: 192 },
  { name: 'apple-touch-icon.png', size: 180 },
]
for (const { name, size } of png) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, name))
  console.log(`wrote ${name}`)
}
