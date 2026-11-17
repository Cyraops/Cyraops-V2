# Boot from the vendored tree (verified 2026-11-18)

`boot.mjs` boots the headless harness tree with ALL package resolution from
`vendor/dsh/` — zero imports from the distribution install. The resolution root
is the `installAnchor` function parameter threaded through `dsh-app-boot`'s
primitives; the only hard-coded distribution path is in the CLI's own launcher
(`profile-boot-e2mS45fC.js:120`), which this launcher replaces.

Required layout: `vendor/dsh/package.json` (exact copy of the distribution
manifest) + `vendor/dsh/node_modules/<pkg>` (anchor walk = Node's node_modules
resolution from the anchor). Two native addons are required on darwin-arm64 and
were added to the vendored set: `node-addon-require-builtin-darwin-arm64@0.1.9`
and `@deepseek-ai/node-addon-system-darwin-arm64@0.1.2`.

Observed: final text "banana", 350-entry runtime resolution table, 280 recorded
resolutions — every one under `vendor/dsh/node_modules` (hard assertion), wall
~3.4 s, exit 0. The project `.env` supplies the DeepSeek key through
`loadLayeredEnv`; its value is never read or printed.
