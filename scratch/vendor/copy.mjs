#!/usr/bin/env node
/**
 * copy.mjs — copy the exact package directories listed in manifest.json into
 * the V2 repo at vendor/dsh/<pkgName>, preserving exact directory contents
 * (lib/, types/, package.json, nested node_modules, hidden files, symlinks).
 *
 * Hard exclusions (never copied, always logged):
 *   - any @deepseek-ai/dsh-client-ui-* package
 *   - any path outside $DIST/node_modules (e.g. the dist root itself,
 *     $DIST/lib, bin.js, profiles are never listed because the manifest only
 *     contains packages resolved under $DIST/node_modules; this is a guard)
 *   - "nested" manifest entries: those live inside their parent package
 *     directory and are copied as part of the parent's directory contents.
 *
 * Records a copy log with per-package byte counts.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const SCRATCH = '/Users/tanveersinghsaini/Desktop/cyraops-v2/scratch/vendor';
const MANIFEST = join(SCRATCH, 'manifest.json');
const OUT_ROOT = '/Users/tanveersinghsaini/Desktop/cyraops-v2/vendor/dsh';
const LOG = join(SCRATCH, 'copy-log.json');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const srcNodeModules = join(manifest.sourceDistribution, 'node_modules');

const CLIENT_UI_RE = /^@deepseek-ai\/dsh-client-ui-/;

function countBytes(root) {
  let bytes = 0;
  let files = 0;
  let brokenSymlinks = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        try {
          bytes += statSync(p).size;
          files += 1;
        } catch {
          brokenSymlinks += 1;
        }
      } else if (st.isDirectory()) {
        stack.push(p);
      } else if (st.isFile()) {
        bytes += st.size;
        files += 1;
      }
    }
  }
  return { bytes, files, brokenSymlinks };
}

const copied = [];
const excluded = [];
const errors = [];

for (const pkg of manifest.packages) {
  if (CLIENT_UI_RE.test(pkg.name)) {
    excluded.push({ name: pkg.name, reason: 'dsh-client-ui-* package excluded by policy' });
    continue;
  }
  if (!pkg.path || !pkg.path.startsWith(srcNodeModules + '/')) {
    excluded.push({ name: pkg.name, reason: `path not under ${srcNodeModules}: ${pkg.path ?? '(none)'}` });
    continue;
  }
  if (!existsSync(pkg.path)) {
    errors.push({ name: pkg.name, error: `source path missing: ${pkg.path}` });
    continue;
  }
  const dest = join(OUT_ROOT, pkg.name);
  try {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(pkg.path, dest, { recursive: true, dereference: false });
    const { bytes, files, brokenSymlinks } = countBytes(dest);
    copied.push({ name: pkg.name, version: pkg.version, source: pkg.path, dest, bytes, files, brokenSymlinks });
  } catch (err) {
    errors.push({ name: pkg.name, error: String(err && err.message ? err.message : err) });
  }
}

copied.sort((a, b) => a.name.localeCompare(b.name));
const totalBytes = copied.reduce((acc, c) => acc + c.bytes, 0);
const totalFiles = copied.reduce((acc, c) => acc + c.files, 0);

const log = {
  generatedAt: new Date().toISOString(),
  sourceManifest: MANIFEST,
  destinationRoot: OUT_ROOT,
  manifestPackageCount: manifest.packages.length,
  manifestNestedCount: manifest.nested.length,
  note:
    'manifest "nested" entries are npm version-conflict copies that live inside their parent package directory; ' +
    'they are preserved as part of the parent directory copy and not duplicated at the vendor root.',
  copied,
  excluded,
  errors,
  totals: { packagesCopied: copied.length, files: totalFiles, bytes: totalBytes },
};

writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');

console.log(`packages listed in manifest: ${manifest.packages.length}`);
console.log(`packages copied:             ${copied.length}`);
console.log(`packages excluded:           ${excluded.length}`);
console.log(`errors:                      ${errors.length}`);
console.log(`files copied:                ${totalFiles}`);
console.log(`bytes copied:                ${totalBytes}`);
console.log(`copy log written to:         ${LOG}`);
if (excluded.length) {
  console.log('\nEXCLUDED:');
  for (const e of excluded) console.log(`  - ${e.name} (${e.reason})`);
}
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors) console.log(`  - ${e.name}: ${e.error}`);
}
