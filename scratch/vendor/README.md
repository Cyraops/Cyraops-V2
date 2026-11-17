# DSH Backend Vendoring (headless profile) — provenance artifacts

Generated 2026-11-18 (IST) from the pinned DSH distribution
`/Users/tanveersinghsaini/.nvm/versions/node/v22.23.2/lib/node_modules/@deepseek-ai/dsh` (0.2.2-rc.1, MIT).

## Artifacts

- `manifest.json` — package graph manifest: `packages` (347 top-level entries with
  name/version/path/license/sha256 of package.json), `nested` (42 npm
  version-conflict nested copies that ship inside their parent dirs), `missing`
  (5 declared deps absent from the distribution).
- `copy-log.json` — copy record with per-package byte/file counts, exclusions, errors.
- `license-review.json` — mechanical license classification of all 678 package.json
  files under `../../vendor/dsh`, including the `needsLegalReview` list.
- `build-manifest.mjs` — rebuilds `manifest.json` from $DIST.
- `copy.mjs` — copies manifest packages into `../../vendor/dsh`.
- `scan-licenses.mjs` — rebuilds `license-review.json` from the vendored tree.

## Key facts

- Roots: `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` (headless profile bundles).
- Graph: 347 packages (161 `@deepseek-ai/*`, 186 third-party), 0 `dsh-client-ui-*`.
- Vendored at `/Users/tanveersinghsaini/Desktop/cyraops-v2/vendor/dsh/`:
  42,413 files, 296,696,826 bytes (du: 405,744 KB).
- Never copied: $DIST/lib, dist bin.js, profiles, any dsh-client-ui-* package.
- Missing (absent from dist): @modelcontextprotocol/sdk, @smithy/hash-node,
  bufferutil, utf-8-validate, kerberos (all optional peers).
- Mechanical "needs legal review": argparse@2.0.1 (Python-2.0),
  lru-cache@11.5.3 (BlueOak-1.0.0), type-fest@4.41.0 ((MIT OR CC0-1.0)).
