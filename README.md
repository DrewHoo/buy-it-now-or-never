# buy-it-now-or-never

When a stock closes at a new all-time high, how often is that price gone
forever? This visualization charts adjusted closing prices for a handful of
semiconductor names and broad-market ETFs, and marks every ATH close that
was *never undercut afterward* — the days where, if you didn't buy, you
never got another shot at that price (or lower).

Live: <https://drewhoover.com/buy-it-now-or-never/>

## How it works

`scripts/fetch-data.mjs` pulls daily split- and dividend-adjusted closes
from Yahoo Finance via `yahoo-finance2` for every ticker, computes:

- the **ATH set** — closes that beat every prior close
- the **permanent-floor set** — closes that no future close ever undercut
- a few summary stats per ticker, including the share of ATHs that turned
  out to be permanent and the median wait-time when an ATH *did* come back

and writes one compact JSON file per ticker into `public/data/`. The Vite
build then serves those statically.

A scheduled GitHub Action re-runs the fetch on weekdays after the US close,
so the data stays current without manual intervention.

## Running locally

```bash
npm install
npm run fetch     # refresh price data (network call to Yahoo)
npm run dev
```
