/**
 * Prerender every route to static HTML.
 *
 * Why this exists: the marketing site is a React SPA. As a hash-routed bundle it
 * served one 687-byte document and every real path returned 404, so a crawler
 * could not see a single word of the catalogue. Rendering each route to its own
 * HTML file fixes the two things that actually block indexing:
 *
 *   1. content exists in the response, not only after 455 KB of JavaScript runs;
 *   2. each route has its own URL, <title>, description, canonical and JSON-LD.
 *
 * Run after `vite build`:  node prerender.mjs
 */

import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const DIST = path.resolve("dist");
const PORT = 4317;
const SITE = "https://www.cyraops.com";

const catalog = JSON.parse(fs.readFileSync("src/data/catalog.json", "utf8"));
const slug = (value) =>
  value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const STATIC_ROUTES = ["/", "/catalogue", "/contact", "/about", "/about/how", "/about/engagement", "/about/faq"];
const routes = [
  ...STATIC_ROUTES,
  ...catalog.axes.map((a) => `/${a.axis}`),
  ...catalog.axes.flatMap((a) => a.items.map((i) => `/${a.axis}/${slug(i.name)}`)),
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Static server with SPA fallback, so /catalogue renders instead of 404ing. */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.join(DIST, url === "/" ? "index.html" : url);
  const fallback = path.join(DIST, "index.html");
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : fallback;
  const body = fs.readFileSync(target);
  res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
  res.end(body);
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const failures = [];

for (const route of routes) {
  try {
    await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Metadata is applied in an effect and the hero fades in, so give the page
    // a beat to settle before serialising what a reader would actually get.
    await page.waitForTimeout(900);

    const html = await page.evaluate(() => {
      // Nothing should still emit a hash href; rewrite if anything slipped in.
      document.querySelectorAll('a[href^="#/"]').forEach((a) => {
        a.setAttribute("href", a.getAttribute("href").replace(/^#/, ""));
      });
      // React sets the title via an effect; make sure it landed.
      return "<!doctype html>\n" + document.documentElement.outerHTML;
    });

    const title = await page.title();
    const canonical = await page.evaluate(
      () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? ""
    );
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().length);

    if (!title || title.includes("undefined")) failures.push(`${route}: missing title`);
    if (!canonical) failures.push(`${route}: missing canonical`);
    if (bodyText < 800) failures.push(`${route}: only ${bodyText} chars of text`);

    const out = route === "/" ? path.join(DIST, "index.html") : path.join(DIST, route, "index.html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  } catch (error) {
    failures.push(`${route}: ${String(error).slice(0, 100)}`);
  }
}

await browser.close();
server.close();

/** Sitemap with every route, then robots pointing at it. */
const today = new Date().toISOString().slice(0, 10);
const priority = (r) => (r === "/" ? "1.0" : r.split("/").filter(Boolean).length === 1 ? "0.8" : r.startsWith("/about") ? "0.6" : "0.7");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map((r) => `  <url><loc>${SITE}${r === "/" ? "/" : r}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>${priority(r)}</priority></url>`)
  .join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);
const APP_PATHS = [
  "/api/", "/login", "/setup", "/dashboard", "/crm", "/projects", "/tasks", "/chat",
  "/email", "/calendar", "/activity", "/website", "/cost", "/team", "/settings", "/ai",
  "/uploads/", "/index.html",
];
fs.writeFileSync(
  path.join(DIST, "robots.txt"),
  [
    "User-agent: *",
    "Allow: /",
    "",
    "# The product is not marketing content: keep it out of the index.",
    ...APP_PATHS.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n")
);

/** The route list the Next config turns into rewrites. */
fs.writeFileSync(path.join(DIST, "routes.json"), JSON.stringify({ site: SITE, routes }, null, 1));

console.log(`prerendered ${routes.length - failures.length}/${routes.length} routes`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  " + f);
  process.exitCode = 1;
}
