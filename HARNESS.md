# Wiring the DeepSeek Harness into Cyraops V2

**Decision: hybrid (option C).** Run the harness as-is for now; fork specific
pieces only if a concrete need appears.

## What the harness actually is (verified 2026-11-18)

```
package   @deepseek-ai/dsh 0.2.2-rc.1   MIT
npm       not published — "No matching version found"
shape     CLI application, not a library: bin = lib/bin.js, no main/exports
internals lib/bin.js, plugin-*.js, profile-boot-*.js (hashed bundles)
require() fails
```

So there is nothing to `import`. The supported surface is the CLI:

```
dsh [--profile] <name> [options] [app-args...]
dsh plugin --profile <name> <pnpm-args...>
```

A profile is an ordered stack of plugin-bundle patch layers under
`$DSH_HOME/profiles`. `--dump-config` prints the composed tree; `--dump-config-schema`
prints the JSON Schema without mounting — both are how we inspect and validate a
profile without guessing.

## Target shape

```
Cyraops UI (ours, unchanged)
      │  HTTP, same routes as today
      ▼
V2 server (Next.js)  ──►  harness host  ──►  dsh profile
                              │                 ├─ our plugin: Cyraops tools
                              │                 ├─ policy / approvals
                              │                 └─ session + context
                              └─ capability agent on the user's machine
```

Our UI never changes. The bot's engine moves behind it.

## Plan

1. **Prove a profile boots headlessly.** `dsh --profile cyraops --dump-config`,
   then boot it with a trivial app and confirm it starts and stops cleanly.
2. **Write one Cyraops plugin** (per the harness plugin docs) exposing a single
   tool — `triage_ticket` — so the CRM's own capability is callable from the
   harness.
3. **Bridge one bot turn.** V2's `/api/assistant/chat` posts to the harness host
   instead of the in-repo agent loop; the reply renders in our existing UI.
4. **Move the remaining tools** across one at a time, keeping the approval
   semantics (`CLASS_A/B/C`, `taintsRun`) on the harness policy layer.
5. **Only then** consider vendoring: if we need to change harness internals, copy
   `node_modules/@deepseek-ai/dsh` to `vendor/dsh` (MIT permits) — never before.

## Rules

- The harness stays headless: no DeepSeek UI is ever shown.
- `package.json` must not carry a `file:` path to a machine-specific install; the
  harness is resolved at runtime (`DSH_BIN` / PATH), documented in `.env.example`.
- Nothing in V1 changes. This repo is the only place V2 work happens.
