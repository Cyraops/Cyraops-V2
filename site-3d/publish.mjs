/**
 * Publish the prerendered site into the Next app's `public/`.
 *
 * The marketing site and the CRM are served from one container, so the site's
 * output has to be baked into the Next app before its image is built. This
 * script replaces the hand-written copy steps that used to drift:
 *
 *   site-3d/dist/index.html          -> public/index.html
 *   site-3d/dist/<route>/index.html  -> public/<route>/index.html
 *   site-3d/dist/assets/*            -> public/assets/*   (stale files removed)
 *   site-3d/dist/{sitemap.xml,robots.txt,routes.json} -> public/
 *
 * Run via `npm run publish:site` from the repository root, after `build:static`.
 */

import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const PUBLIC = path.resolve("..", "public");

if (!fs.existsSync(path.join(DIST, "routes.json"))) {
  console.error("dist/routes.json is missing — run `npm run build:static` first");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "routes.json"), "utf8"));

/** Assets referenced by the document, plus the lazy 3D chunks it imports. */
function referencedAssets() {
  const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const assets = new Set(html.match(/assets\/[A-Za-z0-9._-]+/g) ?? []);
  for (const asset of [...assets]) {
    if (!asset.endsWith(".js")) continue;
    const file = path.join(DIST, asset);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const chunk of source.match(/(?:OperationsCore3D|AmbientField3D|three\.module|Hero3D)-[A-Za-z0-9_-]+\.js/g) ?? []) {
      assets.add(`assets/${chunk}`);
    }
  }
  return assets;
}

// 1. Root document and assets.
fs.mkdirSync(path.join(PUBLIC, "assets"), { recursive: true });
fs.copyFileSync(path.join(DIST, "index.html"), path.join(PUBLIC, "index.html"));

const assets = referencedAssets();
for (const existing of fs.readdirSync(path.join(PUBLIC, "assets"))) {
  if (!assets.has(`assets/${existing}`)) fs.rmSync(path.join(PUBLIC, "assets", existing));
}
for (const asset of assets) {
  const from = path.join(DIST, asset);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(PUBLIC, asset));
}

// 2. One document per route.
let published = 0;
for (const route of manifest.routes) {
  if (route === "/") continue;
  const from = path.join(DIST, route.slice(1), "index.html");
  if (!fs.existsSync(from)) continue;
  const to = path.join(PUBLIC, route.slice(1), "index.html");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  published += 1;
}

// 3. Sitemap, robots and the manifest the Next config reads for rewrites.
for (const file of ["sitemap.xml", "robots.txt", "routes.json"]) {
  fs.copyFileSync(path.join(DIST, file), path.join(PUBLIC, file));
}

console.log(`published ${published} route documents, ${assets.size} assets, sitemap (${manifest.routes.length} urls)`);
