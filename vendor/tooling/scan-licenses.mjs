#!/usr/bin/env node
/**
 * scan-licenses.mjs — mechanically classify the `license` field of every
 * package.json copied into vendor/dsh (including nested node_modules copies
 * that travel inside parent directories).
 *
 * Permissive allow-list (exact token match, SPDX style):
 *   MIT, ISC, BSD (and BSD-n-Clause variants), Apache-2.0, 0BSD, Unlicense, WTFPL.
 * Compound expressions like "(MIT OR Apache-2.0)" are split on OR/AND and every
 * token must be in the allow-list. Everything else — including a missing
 * license field ("unspecified") — is flagged mechanically as "needs legal
 * review". This is a mechanical classification only, not a legal judgment.
 */
import { readdirSync, readFileSync, lstatSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const VENDOR_ROOT = '/Users/tanveersinghsaini/Desktop/cyraops-v2/vendor/dsh';
const OUT = '/Users/tanveersinghsaini/Desktop/cyraops-v2/scratch/vendor/license-review.json';

const ALLOWED_TOKEN = /^(MIT|ISC|0BSD|Unlicense|WTFPL|Apache-2\.0|BSD(?:-[0-4]-Clause(?:-[A-Za-z0-9.-]+)?)?)$/;

function normalizeLicense(pkg) {
  const l = pkg.license;
  if (l == null) return 'unspecified';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) {
    return l.map((x) => (typeof x === 'object' ? (x.type ?? 'unspecified') : String(x))).join(' OR ');
  }
  if (typeof l === 'object') return l.type ?? 'unspecified';
  return String(l);
}

function classify(licenseValue) {
  if (licenseValue === 'unspecified') return 'unspecified';
  const tokens = licenseValue
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return 'needs-legal-review';
  return tokens.every((t) => ALLOWED_TOKEN.test(t)) ? 'permissive' : 'needs-legal-review';
}

const found = [];
function walk(dir, scope) {
  if (!lstatSync(dir).isDirectory()) return;
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
        st = statSync(p);
      } catch {
        continue;
      }
    }
    if (st.isDirectory()) {
      walk(p, scope);
    } else if (entry === 'package.json') {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      const licenseValue = normalizeLicense(pkg);
      found.push({
        name: pkg.name ?? '(unnamed)',
        version: pkg.version ?? 'unspecified',
        path: p,
        relativePath: relative(VENDOR_ROOT, p),
        license: licenseValue,
        classification: classify(licenseValue),
        nestedCopy: p.includes('/node_modules/'),
      });
    }
  }
}

walk(VENDOR_ROOT, false);

found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

const byLicense = {};
for (const f of found) {
  byLicense[f.license] = (byLicense[f.license] ?? 0) + 1;
}

const needsReview = found.filter((f) => f.classification === 'needs-legal-review');
const unspecified = found.filter((f) => f.classification === 'unspecified');

const report = {
  generatedAt: new Date().toISOString(),
  scannedRoot: VENDOR_ROOT,
  packageJsonCount: found.length,
  byLicense,
  needsLegalReview: needsReview,
  unspecifiedCount: unspecified.length,
};

writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

console.log(`package.json files scanned: ${found.length}`);
console.log(`license values:             ${Object.keys(byLicense).length}`);
console.log(`needs legal review:         ${needsReview.length}`);
console.log(`unspecified (no license):   ${unspecified.length}`);
console.log('\ncount by license value:');
for (const [k, v] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v}\t${k}`);
}
console.log(`\nreport written to: ${OUT}`);
