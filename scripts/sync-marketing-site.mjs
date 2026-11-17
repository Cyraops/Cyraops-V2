import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = process.env.CYRAOPS_SITE_DIST;
if (!source) {
  throw new Error("Set CYRAOPS_SITE_DIST to the built Cyraops website dist directory.");
}

const dist = resolve(source);
const publicDir = resolve("public");
await mkdir(publicDir, { recursive: true });

for (const entry of ["index.html", "cyraops-mark.png", "icons.svg"]) {
  await cp(resolve(dist, entry), resolve(publicDir, entry));
}

await rm(resolve(publicDir, "assets"), { recursive: true, force: true });
await cp(resolve(dist, "assets"), resolve(publicDir, "assets"), { recursive: true });
console.log(`Synced Cyraops website files from ${dist} into public/.`);
