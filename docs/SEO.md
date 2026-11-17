# SEO: what the site actually serves

**Status:** 15 November 2026. Written after an external teardown found that the marketing
site was invisible to search engines, and after fixing it.

## The problem, measured

Crawlers received a **687-byte document** — a `<title>`, one description, one script tag, and
`<div id="root"></div>`. Everything else lived in a 455 KB JavaScript bundle behind hash routes
(`#/catalogue`). The consequences, all verified against production before any change:

| Symptom | Measured |
|---|---|
| HTML delivered to crawlers | 687 bytes, no content |
| Real paths (`/catalogue`, `/about`, `/contact`) | **HTTP 404** |
| URLs in `sitemap.xml` | 1 |
| Canonical, Open Graph, JSON-LD | zero occurrences |
| Per-route `<title>` | one title for every route |
| `www` vs apex | both 200, no redirect, no canonical |
| Counters in HTML | "0 offerings", "00%" |
| Footer | "Local development build — not published" |

## What was changed

1. **Path-based routing.** `/catalogue` is now the URL. Legacy `#/catalogue` links are rewritten
   to real paths on load, so old shares keep working.
2. **Prerendering.** `site-3d/prerender.mjs` renders all 74 routes to static HTML after the Vite
   build. A crawler, or a reader with JavaScript disabled, gets the whole page.
3. **Per-route metadata.** Title, description, canonical, Open Graph, Twitter card and JSON-LD
   (`Organization`, `WebSite`, `Service` on offering pages, `ItemList` on the catalogue) — applied
   at prerender time and again on client navigation.
4. **Rewrites.** `public/routes.json` is turned into rewrites by `next.config.ts`, so each path
   serves its own document instead of 404ing.
5. **One canonical host.** `cyraops.com` 301s to `www.cyraops.com` via `middleware.ts`, and
   sitemap, robots and every canonical agree.
6. **Sitemap** lists 74 URLs with lastmod and priority; robots points at it.
7. Counters render their real values in HTML (the count-up is an enhancement), the nav percentage
   no longer renders `00%`, and the footer no longer claims to be a development build.

## Verified

Measured with JavaScript disabled against the built app, then again on production:

- 74/74 routes return `200`
- every route has a unique `<title>` and a canonical
- no page under 120 words
- `cyraops.com/catalogue` → `301` → `www.cyraops.com/catalogue`
- browser: SPA navigation without reloads, titles and canonicals follow the route, back button
  works, legacy `#/about` resolves to `/about`, 0 console errors

## What is still missing (content, not plumbing)

The teardown's later phases are editorial, and no amount of prerendering substitutes for them:

| Item | Why it matters | Effort |
|---|---|---|
| Guides and insight articles (2/week) | Ranking for buyer questions needs pages that answer them; the catalogue alone only ranks for brand and product terms | ongoing |
| Comparison and alternative pages | Captures "X vs Y" and "best X" queries that currently go elsewhere | 1–2 days |
| Digital PR for links | Prerendered pages are necessary, not sufficient — links still drive ranking | ongoing |
| Search Console + Bing verification, baseline | You cannot measure a 90-day plan without a baseline | 30 min |

**Honest expectation:** the technical fix makes the site *eligible* to rank. Indexable pages go
from 1 to 74; traffic does not follow on its own until the editorial work exists.
