// Lazy-loaded Mixpanel wrapper. mixpanel-browser is ~130KB gzipped —
// big enough to hurt initial paint if we ship it in the critical bundle.
// Dynamic import() puts it in its own chunk that loads after first paint.
//
// Token is the shared write-only client token for the drewhoover.com
// data-viz sites project. Safe to commit.
const TOKEN = '1c6a0f45b8a5768185a8d9a2f4d65452'

let mp = null
const queue = []

function flush() {
  for (const args of queue) {
    try { mp.track(...args) } catch {}
  }
  queue.length = 0
}

if (typeof window !== 'undefined') {
  import('mixpanel-browser')
    .then(m => {
      mp = m.default
      mp.init(TOKEN, {
        // Auto-fire pageviews on initial load and on every history API
        // change (replaceState included), so each ticker/range/zoom URL
        // update counts as its own pageview.
        track_pageview: 'url-with-path-and-query-string',
      })
      flush()
    })
    .catch(() => {
      // Adblockers commonly block any script with 'mixpanel' in the URL.
      // Drop queued events silently — analytics failure must not break
      // the app.
      queue.length = 0
    })
}

export function track(name, props) {
  if (mp) {
    try { mp.track(name, props) } catch {}
  } else {
    queue.push([name, props])
  }
}
