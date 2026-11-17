# Cyraops × DeepSeek Harness — Source-Integration Feasibility

Evidence gathered 2026-11-18 from the installed `@deepseek-ai/dsh 0.2.2-rc.1`.
This **corrects** an earlier over-broad claim in `CYRAOPS_DSH_SOURCE_AUDIT.md`,
which said "no library, CLI only". That was true of the top-level package only.

## 1. Executive recommendation

**Integrate in-process (native) as the target; keep the proven CLI-spawn as the
interim.** The agent engine is composed of typed, importable ESM libraries whose
composition is a cordis tree — the same tree the `dsh` CLI itself mounts. We can
host that tree inside the Cyraops server and drive it directly, with no separate
Harness service. This requires **vendoring the pinned 0.2.2-rc.1 package set**
(the public npm versions are stale and incoherent) and a cordis-host PoC to
validate the boot. Do not patch compiled bundles; consume the public module API.

## 2. Verified architecture and package inventory

- Top-level `@deepseek-ai/dsh` is an application (ESM, `bin: lib/bin.js`, no
  `main`/`exports`). It is the **CLI wrapper + the coherent 0.2.2-rc.1 package
  set** — that set does not exist coherently on public npm.
- The ~270 `@deepseek-ai/*` sub-packages are **importable libraries**:

| Package | `main` | `exports` | `types` | `src/` | `lib/index.js` |
| --- | --- | --- | --- | --- | --- |
| dsh-agent | lib/index.js | yes | yes | no | 831 lines |
| dsh-agent-loop | lib/index.js | yes | yes | no | yes |
| dsh-tools | lib/index.js | yes | yes | no | yes |
| dsh-session | lib/index.js | yes | yes | no | yes |
| dsh-session-query | lib/index.js | yes | yes | no | yes |
| dsh-llm | lib/index.js | yes | yes | no | yes |
| dsh-user-approval | lib/index.js | yes | yes | no | yes |
| dsh-permission-presets | lib/index.js | yes | yes | no | yes |
| dsh-sdk-minimal / -app / -protocol / -jsonrpc-server | lib/index.js | yes | yes | no | yes |

So: **compiled but readable, with shipped `.d.ts` + JSDoc** — a real, documented
API surface. There is **no `src/`**; "source integration" means "module
integration against the published types", not editing source.

## 3. Capability-by-capability headless reuse

Same as `CYRAOPS_HARNESS_CAPABILITY_MATRIX.md`, with one upgrade: the agent loop,
tools, sessions, permissions, approvals, sandbox, subagents and model adapters
are **not only present but individually importable** — so "reusable headlessly"
upgrades from *present* to *importable in-process* for: agent execution,
tool lifecycle, sessions/persistence/query, permissions + approval, model
selection/connectivity, compaction, subagents, jobs/scheduling, observability.
Still *unknown*: browser automation driver, MCP serving mode.

## 4. UI coupling and external-service dependency map

- **UI is fully separated.** Headless profile mounts `dsh-base` + `dsh-headless`
  and **no `dsh-client-ui-*`** package. No backend package imports a `dsh-client-ui-*`.
- **In-process boot is cordis.** `dsh-headless/lib/index.js` runs inside an
  already-mounted cordis `ctx` and consumes its services (`loader`, `agents`,
  `sessions`, `agentDefaultModel`, `approval`, `permissionPresets`,
  `sandboxPolicy`, `fs`, `subagents`, `appExit`). It even asserts
  `ctx.appExit` exists "before the tree mounts" — i.e. **the launcher owns the
  composition; `dsh-headless` is the runner inside it.** Native integration means
  we become that launcher (cordis host) and mount the same bundle tree.
- **External services:** DeepSeek API (model), plus optional web-search / speech /
  MCP servers. None required for a basic turn.

## 5. Four-option comparison

| Option | Feasible? | Verdict |
| --- | --- | --- |
| **A. Direct module integration** | **Yes** | Import `dsh-agent`, `dsh-session`, `dsh-llm`, … as ESM libraries. But the assembly (which services, what order, what config) is the cordis tree — importing modules alone is not a running agent. |
| **B. Extract/refactor backend** | Partial | The runner (`dsh-headless`) is already separable; the *composition* is metadata (profile/bundle patches), not code to extract. No need to refactor compiled bundles. |
| **C. Vendor the package set** | Yes | Required regardless: public npm carries only stale, mismatched versions (headless/base `0.0.1-rc.1`, agent `0.1.0-rc.6`, session `0.0.1-rc.1`) that predate the coherent `0.2.2-rc.1` distribution. |
| **D. Separate process/runtime** | Yes (proven) | `dsh --profile headless` + JSON-RPC SDK. Lower risk, already measured, but not native. |

**Conclusion: A + C.** Vendor the pinned 0.2.2-rc.1 backend set, become the
cordis host in-process, and mount the headless bundle tree — following
`dsh-headless` as the reference. D remains the fallback and the interim.

## 6. Licensing and third-party findings

- `@deepseek-ai/dsh` 0.2.2-rc.1 is **MIT** (Copyright (c) 2026 DeepSeek) — reuse,
  vendoring, distribution permitted with attribution.
- The sub-packages ship under the same distribution; their individual licenses
  are not separately enumerated — verify via `license-checker` over the vendored set.
- 90 runtime dependencies are unenumerated; a transitive inventory is a Phase-6
  gate, not a blocker for the PoC.
- DeepSeek **API** terms/pricing/data-policy are separate from the MIT software
  license; the product remains network-dependent on the API.
- **Not a legal guarantee** — items requiring legal review: redistribution of the
  compiled harness set, transitive-dependency license compatibility, and any
  trademark/attribution obligations for the DeepSeek brand (we rebrand, never ship
  their UI).

## 7. Risks, unknowns, and how to resolve them

| Risk | Severity | Resolution |
| --- | --- | --- |
| Cordis host boot is non-trivial (services, order, config) | high | PoC: reproduce the boot in-process by mounting the headless bundle tree; compare against `dsh --profile headless` output |
| Version coherence: npm set is stale; 0.2.2-rc.1 ships only in the distribution | high | vendor the pinned set as tarballs / a private registry; never mix with public npm alphas |
| Compiled bundles are readable but not source; upstream changes could break us | medium | consume public exports + types only; pin version; re-run PoC on upgrade |
| Next.js vs cordis process lifecycle (hot reload, serverless) | medium | run the runtime in a long-lived in-process singleton or a same-machine worker owned by our server |
| Transitive deps untested outside the dsh distribution | medium | PoC runs the real boot, catching resolution gaps early |

## 8. Recommended target architecture

```
Cyraops server (Next.js)
  └─ harness runtime (in-process, singleton)
       └─ cordis host mounting the vendored headless bundle tree
            ├─ dsh-agent / dsh-agent-loop      (reasoning)
            ├─ dsh-tools + our Cyraops plugin  (CRM tools)
            ├─ dsh-session / -query            (continuity)
            ├─ dsh-user-approval + presets     (our approval UI drives it)
            └─ dsh-llm-deepseek                (DeepSeek API)
```

The existing `AgentRuntime` interface (ADR-002) is unchanged; only its
implementation moves from `spawn("dsh")` to the in-process runtime. The customer
still sees only the Cyraops UI.

## 9. PoC plan (validate before committing to the rewrite)

1. Vendor the 0.2.2-rc.1 backend set into `vendor/dsh/` (MIT-licensed; tarballs).
2. Write a cordis host boot in a Node script that mounts the same bundles
   `dsh-base` + `dsh-headless` mount, in-process.
3. Run one turn ("Reply with exactly: banana") and assert the same `final` text
   and `sessionId` shape the CLI produces.
4. Compare wall-time and RSS against the CLI (target: no worse, ideally better).
5. Decision gate: if the in-process boot reaches parity inside two working days,
   proceed to Phase 3 on it; otherwise stay on D (JSON-RPC runtime).

## 10. Go / no-go for native source integration

**Go** when, and only when:
- the in-process cordis boot reproduces `dsh-headless` behaviour from the vendored
  0.2.2-rc.1 set (not from stale npm versions), and
- a coherent vendored dependency graph installs cleanly in the Cyraops repo, and
- legal review clears redistribution of the compiled set + transitive licenses.

**No-go** if: the boot cannot reach parity within the bounded PoC, or the
vendored graph proves unstable outside the dsh distribution — in which case D
(the JSON-RPC runtime, already shipped) is the production path.
