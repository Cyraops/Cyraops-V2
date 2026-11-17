# Cyraops × DeepSeek Harness — Third-Party Licenses & Notices

## Verified

| Package | Version | License | Evidence |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh` | 0.2.2-rc.1 | **MIT** — Copyright (c) 2026 DeepSeek | `LICENSE` at install root |

MIT grants use, copy, modification, distribution and sublicensing with
attribution — vendoring is permitted. We have chosen **not** to vendor (ADR-001);
this notice still travels with any distribution of V2.

## DeepSeek API — separate terms

The **DeepSeek API** (model inference) is a different service from the harness
software and is governed by the API's own terms, pricing and data policy. V2
calls it over the network; we make no claim of offline or local inference.

## Enumerated inventory (completed 2026-11-18)

The vendored backend graph was resolved from `dsh-base` + `dsh-headless` and
enumerated mechanically: **347 packages** (161 @deepseek-ai, 186 third-party),
each with version, license field, and package.json sha256 — recorded in
`vendor/tooling/manifest.json` and machine-readable `vendor/tooling/SBOM.json`
(CycloneDX 1.5). License breakdown:

| License | Packages |
| --- | --- |
| MIT | 272 |
| Apache-2.0 | 47 |
| BSD-3-Clause | 15 |
| ISC | 6 |
| BSD-2-Clause | 2 |
| Unlicense / 0BSD | 1 each |
| (MIT OR CC0-1.0) | 1 |
| **needs legal review** | argparse 2.0.1 (Python-2.0), lru-cache 11.5.3 (BlueOak-1.0.0), type-fest 4.41.0 (MIT OR CC0-1.0) |

Notes: 42 nested dependency copies travel inside parent directories (e.g.
zod@4.4.3 under 32 packages) and inherit their parents' licensing context; 288
license-less package.json files are subpath stubs, not separate packages; 5
declared optional peers are absent from the distribution itself (MCP SDK,
smithy hash-node, bufferutil/utf-8-validate, kerberos). A copy of the MIT
license text for `@deepseek-ai/dsh` must accompany distributions containing the
harness binary; the three flagged packages require legal review before any
commercial distribution.

## Rules we already follow

- No compiled internals copied into the V2 repo (ADR-001).
- No `.env` or credentials committed.
- Attribution: this file + `HARNESS.md` + `CYRAOPS_DSH_SOURCE_AUDIT.md` ship with the repo.
