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

## Not yet verified

The harness declares **90 runtime dependencies** (cordis, cosmokit, schemastery,
third-party LLM/telemetry libraries, etc.). Their individual licenses have not
been enumerated. Before any commercial distribution (Phase 6):

```sh
cd <dsh install>
npx license-checker --production --json > third-party-licenses.json
```

and record each license in this file. A copy of the MIT license text for dsh
must accompany distributions containing the harness binary.

## Rules we already follow

- No compiled internals copied into the V2 repo (ADR-001).
- No `.env` or credentials committed.
- Attribution: this file + `HARNESS.md` + `CYRAOPS_DSH_SOURCE_AUDIT.md` ship with the repo.
