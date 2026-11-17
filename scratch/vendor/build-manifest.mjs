#!/usr/bin/env node
/**
 * build-manifest.mjs — build a provenance manifest for the EXACT pinned
 * DeepSeek Harness backend package set mounted by the `headless` profile.
 *
 * Roots: the two bundle packages the headless profile mounts
 *   (@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless).
 *
 * Resolution policy (per task spec):
 *   - Start from the two bundle packages inside $DIST/node_modules.
 *   - Recursively follow `dependencies` AND `peerDependencies` (where present).
 *   - For each dependency name, check "@deepseek-ai/<name>" first, then plain
 *     "<name>", relative to $DIST/node_modules. (For names already scoped to
 *     @deepseek-ai/ or to another scope, the alias candidate is the name
 *     itself; other-scope names like @aws-sdk/... are resolved directly.)
 *   - Fallback: if neither top-level candidate exists, look inside the
 *     requirer's own nested node_modules/ (npm version-conflict nesting;
 *     e.g. zod@4.4.3 nested under packages while top-level zod is 4.6.7).
 *     Such packages are recorded in the "nested" section, not "packages",
 *     because they are copied as part of their parent's directory.
 *   - Anything not found anywhere is recorded in "missing".
 *   - optionalDependencies and devDependencies are intentionally NOT followed.
 *
 * Output: manifest.json
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const DIST = process.env.DSH_DIST ??
  '/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh';
const OUT_DIR = '/Users/tanveersinghsaini/Desktop/cyraops-v2/scratch/vendor';
const OUT_FILE = join(OUT_DIR, 'manifest.json');

const ROOTS = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'];

const distPkgJsonPath = join(DIST, 'package.json');
if (!existsSync(distPkgJsonPath)) {
  console.error(`FATAL: distribution package.json not found at ${distPkgJsonPath}`);
  process.exit(1);
}
const distPkg = JSON.parse(readFileSync(distPkgJsonPath, 'utf8'));

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function isPkgDir(p) {
  return existsSync(join(p, 'package.json')) && statSync(join(p, 'package.json')).isFile();
}

/** Candidate dirs for a dependency name under `base`, spec order. */
function candidatesFor(name, base) {
  if (name.startsWith('@')) {
    // Scoped names (both @deepseek-ai/... and other scopes) resolve as-is;
    // "@deepseek-ai/<name> first" applies trivially to @deepseek-ai names,
    // and an alias like "@deepseek-ai/@aws-sdk/x" is not a valid layout.
    return [join(base, name)];
  }
  return [join(base, '@deepseek-ai', name), join(base, name)];
}

function resolveDep(name, requirerDir) {
  const top = join(DIST, 'node_modules');
  for (const c of candidatesFor(name, top)) {
    if (isPkgDir(c)) return c;
  }
  if (requirerDir) {
    const nested = join(requirerDir, 'node_modules');
    for (const c of candidatesFor(name, nested)) {
      if (isPkgDir(c)) return c;
    }
  }
  return null;
}

function normalizeLicense(pkg) {
  const l = pkg.license;
  if (l == null) return 'unspecified';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) {
    return l.map((x) => (typeof x === 'object' ? (x.type ?? 'unspecified') : x)).join(' OR ');
  }
  if (typeof l === 'object') return l.type ?? 'unspecified';
  return 'unspecified';
}

function recordPackage(dir, nestedUnder) {
  const pkgJsonPath = join(dir, 'package.json');
  const raw = readFileSync(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(raw);
  return {
    name: pkg.name ?? '(unnamed)',
    version: pkg.version ?? 'unspecified',
    path: dir,
    license: normalizeLicense(pkg),
    packageJsonSha256: sha256(raw),
    ...(nestedUnder ? { nestedUnder } : {}),
  };
}

/** Direct child packages inside `dir/node_modules`, scope-aware. */
function nestedChildren(dir) {
  const nm = join(dir, 'node_modules');
  if (!existsSync(nm)) return [];
  const out = [];
  for (const entry of readdirSync(nm)) {
    const p = join(nm, entry);
    if (entry.startsWith('@')) {
      if (!statSync(p).isDirectory()) continue;
      for (const sub of readdirSync(p)) {
        if (isPkgDir(join(p, sub))) out.push(join(p, sub));
      }
    } else if (isPkgDir(p)) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BFS over the graph.
// Queue items: { depName, range, requiredBy, requirerDir }
//   - depName/range/requiredBy describe a declared dependency edge.
//   - requirerDir enables the nested-node_modules fallback.
// Discovered nested package dirs are recorded under `nested` and their own
// deps are enqueued as well (resolved top-level first, as Node would).
// ---------------------------------------------------------------------------
const queue = ROOTS.map((r) => ({ depName: r, range: null, requiredBy: null, requirerDir: null }));
const visited = new Set();        // resolved dirs (top-level AND nested)
const packages = [];              // top-level resolved entries (the copyable set)
const nested = [];                // nested-copy entries (travel inside parents)
const missingMap = new Map();     // depName -> { name, versionRange, requiredBy: Set }

const topLevelCandidates = (name) => candidatesFor(name, join(DIST, 'node_modules'));

while (queue.length) {
  const { depName, range, requiredBy, requirerDir } = queue.shift();
  const dir = resolveDep(depName, requirerDir);
  if (!dir) {
    const entry = missingMap.get(depName) ?? { name: depName, versionRange: range, requiredBy: [] };
    if (range != null && entry.versionRange == null) entry.versionRange = range;
    if (requiredBy != null && !entry.requiredBy.includes(requiredBy)) entry.requiredBy.push(requiredBy);
    missingMap.set(depName, entry);
    continue;
  }
  if (visited.has(dir)) continue;
  visited.add(dir);

  const isNested = requirerDir != null && !topLevelCandidates(depName).some((c) => c === dir);
  const entry = recordPackage(dir, isNested ? requiredBy : undefined);
  if (isNested) {
    nested.push(entry);
  } else {
    packages.push(entry);
  }

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  for (const [name, rangeValue] of Object.entries(deps)) {
    queue.push({
      depName: name,
      range: rangeValue ?? null,
      requiredBy: entry.name,
      requirerDir: dir,
    });
  }
  // Document nested copies (npm version-conflict nesting) under this package.
  // These are recorded directly (not re-resolved to the top level) because
  // they ship inside the parent's directory and are copied with it.
  for (const childDir of nestedChildren(dir)) {
    if (visited.has(childDir)) continue;
    visited.add(childDir);
    const child = recordPackage(childDir, entry.name);
    nested.push(child);
    const childPkg = JSON.parse(readFileSync(join(childDir, 'package.json'), 'utf8'));
    const childDeps = { ...(childPkg.dependencies ?? {}), ...(childPkg.peerDependencies ?? {}) };
    for (const [name, rangeValue] of Object.entries(childDeps)) {
      queue.push({
        depName: name,
        range: rangeValue ?? null,
        requiredBy: child.name,
        requirerDir: childDir,
      });
    }
  }
}

packages.sort((a, b) => a.name.localeCompare(b.name));
nested.sort((a, b) => (a.path).localeCompare(b.path));
const missing = [...missingMap.values()]
  .map((m) => ({ name: m.name, versionRange: m.versionRange, requiredBy: m.requiredBy.sort() }))
  .sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  sourceDistribution: DIST,
  sourceVersion: distPkg.version,
  generatedAt: new Date().toISOString(),
  rootBundles: ROOTS,
  packages,
  nested,
  missing,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2) + '\n');

console.log(`sourceDistribution: ${DIST}`);
console.log(`sourceVersion:       ${distPkg.version}`);
console.log(`packages (top-level): ${packages.length}`);
console.log(`nested copies:        ${nested.length}`);
console.log(`missing:              ${missing.length}`);
console.log(`manifest written to:  ${OUT_FILE}`);
