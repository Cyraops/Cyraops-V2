// Merges the agent-written axis files into one catalogue the app imports.
import fs from "node:fs";
import path from "node:path";

const SRC = "/tmp/cat-v2";
const DEST = path.join(process.cwd(), "src/data/catalog.json");
const ORDER = ["solutions", "products", "ai-foundation", "enterprise-ai", "functions", "industries"];

// NOTE: catalog.json is generated from /tmp/cat-v2 (the v2 agent outputs).
// Never run this against the old /tmp/site-content files.

const axes = [];
const missing = [];
for (const id of ORDER) {
  const file = path.join(SRC, `${id}.json`);
  if (!fs.existsSync(file)) { missing.push(id); continue; }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data.items?.length) { missing.push(`${id}(empty)`); continue; }
    axes.push({ ...data, axis: id });
  } catch (error) {
    missing.push(`${id}(invalid JSON)`);
  }
}

const extras = {};
for (const id of ["interaction-spec", "site-ia"]) {
  const file = path.join(SRC, `${id}.json`);
  if (fs.existsSync(file)) {
    try { extras[id] = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, JSON.stringify({ axes, extras }, null, 2));
console.log(`catalog: ${axes.length} axes, ${axes.reduce((n, a) => n + a.items.length, 0)} items`);
if (missing.length) console.log("MISSING:", missing.join(", "));
