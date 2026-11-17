# Cyraops × DeepSeek Harness — Phase 2 PoC Report

All commands were actually run; results below are observed output, not claims.

## 1. Headless run

```sh
dsh --profile headless --json --approval-policy never "Reply with exactly the word: ready"
```

Observed event stream: `session` (sessionId), `status` (turn/step lifecycle with
token `usage`), `thinking`, `text: "ready"`, `final` (text + reason completed).
Diagnostics (model list load) went to stderr — streams are cleanly separated.

## 2. Performance measurement (macOS, /usr/bin/time -l)

| Run | Wall | Max RSS |
| --- | --- | --- |
| cold | 3.24 s | 237 MB |
| warm | 1.63 s | 224 MB |

Conclusion: process-per-turn is acceptable for a single-user PoC and dev;
production concurrency should use the JSON-RPC runtime (ADR-001).

## 3. Session continuation

Run 1: "Say: banana" → session `session-d918d290…`
Run 2 (same `--session-id`): "What fruit did you just name?" →
`You said "banana" — so the fruit was a banana.` — **continuation works**.

## 4. Adapter through our own API

`src/lib/harness/client.ts` + `POST /api/harness/run` (auth + same-origin
checked), executed with a real logged-in session:

```json
{"ok":true,"text":"banana","sessionId":"session-115b013b-…","ms":4382,"steps":1}
```

So: our authenticated API → spawned headless harness → DeepSeek model → answer
back through our route. **No DeepSeek UI involved anywhere.**

## 5. What was NOT tested (honest limits)

- No tool-calling turn yet (matrix row: present, untested).
- JSON-RPC SDK server not booted (inspection only).
- Streaming from our route to a browser client not yet wired.
- Cancellation/timeout kill path not exercised.
- Harness missing from PATH: error path returns 502 with stderr tail — untested.
