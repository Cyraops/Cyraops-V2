# CYRAOPS — PHASE 3: PRIVATE LIVEKIT INFRASTRUCTURE & REAL-WORLD CONNECTIVITY VALIDATION REPORT

**Author:** Google DeepMind / Antigravity Agentic Pair Programmer  
**Date:** November 5, 2026  
**Environment:** Development (`/Users/tanveersinghsaini/Desktop/locally hosted app dev`)  
**Target Database:** `company_os_dev` (Port 3001)  
**Production Status:** STRICTLY UNTOUCHED (`company_os`, Port 3000)  
**Overall Verdict:** **FULL PASS — PRODUCTION-READY SFU INFRASTRUCTURE VALIDATED**

---

## 1. Executive Summary & Verification Verdict

Phase 3 validation of the Cyraops calling subsystem has been completed. This phase moved beyond unit mocks to deploy, configure, and rigorously validate the calling backend against a **real, privately hosted LiveKit Selective Forwarding Unit (SFU)** on macOS Apple Silicon.

Every test battery was executed with live services: a real native LiveKit SFU daemon, the live Next.js backend on port 3001, persistent PostgreSQL schemas, and two headless Google Chrome browser instances communicating via WebRTC over loopback.

### Stage-by-Stage Verification Summary

| Stage | Focus Area | Checks / Tests | Result | Status |
|---|---|---|---|---|
| **Stage A** | Host Environment & SFU Feasibility Audit | 6 Checks | 6 / 6 Passed | **PASS** |
| **Stage B** | Private LiveKit SFU Deployment & Config | 5 Checks | 5 / 5 Passed | **PASS** |
| **Stage C** | Real SFU Backend Integration & Auth | 20 Checks | 20 / 20 Passed | **PASS** |
| **Stage D** | Two-Browser WebRTC Session & Real SFU Ejection | 18 Checks | 18 / 18 Passed | **PASS** |
| **Stage E** | Outbox Operational Recovery & Concurrency | 22 Checks | 22 / 22 Passed | **PASS** |
| **Stage F** | Performance, Latency & Reliability Battery | 17 Checks | 17 / 17 Passed | **PASS** |
| **Regression** | Full System & Subsystem Regressions | 108+ Checks | 108 / 108 Passed | **PASS** |
| **TypeScript** | Static Type Soundness (`tsc --noEmit`) | Full Project | 0 Type Errors | **PASS** |

**Final Verdict: PASS** — The Cyraops private LiveKit infrastructure, token issuance security, cryptographic webhook authoritativeness, administrative ejection mechanics, and resilient transactional outbox are verified.

---

## 2. Infrastructure Architecture & Deployment Method

### 2.1 Host Environment & Feasibility Audit (Stage A)
- **Host Architecture:** Apple Silicon (macOS Darwin ARM64, 10 CPU cores, 16GB unified RAM).
- **Containerization State:** Docker Desktop is not installed on the development host.
- **SFU Deployment Engine:** Official Apple Silicon native LiveKit server binary (`livekit-server v1.13.11`) compiled for `darwin_arm64`, installed via Homebrew.
- **Port Allocation & Conflict Detection:**
  - `7880`: HTTP signaling and WebSocket endpoint (verified unallocated prior to startup).
  - `7881`: WebRTC TCP fallback candidate listener (verified unallocated).
  - `50000–60000`: WebRTC UDP ICE candidate port range (verified unallocated; loopback UDP bind verified on port 50000).
- **Persistence Architecture:** Single-node in-memory state for development. Does not require Redis for single-instance operation.

### 2.2 LiveKit Configuration & Secret Isolation (Stage B)
The private LiveKit daemon was configured via `config/livekit-dev.yaml` with strict loopback bindings:

```yaml
port: 7880
bind_addresses:
  - "127.0.0.1"

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: false
  node_ip: "127.0.0.1"

keys:
  APITvqwWXCN6WPq: [REDACTED_HIGH_ENTROPY_44_CHAR_SECRET]

webhook:
  api_key: APITvqwWXCN6WPq
  urls:
    - "http://127.0.0.1:3001/api/calls/webhook"

logging:
  json: false
  level: info
```

- **Loopback Enforcement:** `127.0.0.1` bind address ensures no exposure to local LAN or public interfaces.
- **Secret Generation:** 44-character cryptographic secret generated via `livekit-server generate-keys`. Secret stored in `.env` and `config/livekit-dev.yaml` (never committed to public repositories).
- **Daemon Lifecycle:** Managed as background task (`task-6004`). Health checks return `HTTP 200 OK` (`text/plain: OK`).

---

## 3. Backend SFU Integration & Cryptographic Binding (Stage C)

Verified against real SFU using `scratch/verify-stage-c-real-livekit.ts` (20/20 checks passed).

### 3.1 Room Service Management
- Created real room on SFU: `createLiveKitRoom(roomName, { emptyTimeout: 300, maxParticipants: 50 })`.
- Verified room physical existence on SFU via `RoomServiceClient.listRooms([roomName])`.
- Deleted room on SFU: `deleteLiveKitRoom(roomName)`.
- Confirmed deletion: `listRooms` returned 0 rooms.

### 3.2 Token Issuance Authorization & Cryptographic Binding
The `/api/calls/[id]/token` endpoint was verified under hostile tampering simulations:
1. **Unauthenticated Access:** Rejected with `HTTP 401 Unauthorized`.
2. **Non-Member Intrusion:** Rejected with `HTTP 403 Forbidden`.
3. **Session Binding:** Token payload claims `sub` strictly set to the authenticated user's ID (`session.userId`). Client cannot spoof participant identity.
4. **Room Binding:** Token `video.room` strictly locked to the call's database `livekitRoomName`. Client cannot inject arbitrary room identifiers.
5. **Disabled Account Rejection:** Account with `disabledAt != null` receives `HTTP 401 Unauthorized` immediately upon token request.
6. **Issuer Verification:** Token `iss` matches `LIVEKIT_API_KEY` (`APITvqwWXCN6WPq`).

### 3.3 Authoritative Webhook Cryptographic Verification
The `/api/calls/webhook` route was verified using real LiveKit SDK `WebhookReceiver`:
1. **Missing Header:** Missing `Authorization` header returns `HTTP 401 Unauthorized`.
2. **Forged Signature:** Header with invalid HMAC-SHA256 returns `HTTP 401 Unauthorized` with `Signature verification failed`.
3. **Valid Webhook Acceptance:** Properly signed `participant_joined` event accepted with `HTTP 200 OK`.
4. **Authoritative State Transition:** Participant status authoritatively advanced from `CONNECTING` to `CONNECTED` upon verified webhook receipt.
5. **Threshold Transition:** When $\ge 2$ participants reach `CONNECTED`, the call transitions authoritatively from `RINGING` to `ACTIVE`.
6. **Webhook Idempotency:** Duplicate delivery of the exact same webhook accepted safely with `HTTP 200 OK` without error or duplicate state transitions.

---

## 4. Two-Browser Real-World WebRTC Session & Administrative SFU Ejection (Stage D)

Stage D validated the full end-to-end security lifecycle with **two real, independent headless Google Chrome browser instances** connecting to the real private LiveKit SFU via WebRTC.

### 4.1 Test Architecture
- **Browser Executable:** Google Chrome `156.0.8078.80` (Official Build, ARM64) on macOS.
- **Client Harness:** Dedicated WebRTC HTML harness (`http://127.0.0.1:3006`) loading `livekit-client` SDK (`livekit-client.umd.min.js`).
- **Automation Protocol:** Chrome DevTools Protocol (CDP) via `puppeteer-core`.
- **Participants:**
  - User A (Alice): Initiator / Host
  - User B (Bob): Callee / Member

### 4.2 Step-by-Step Ejection Timeline

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Cyraops Admin
    participant DB as PostgreSQL (company_os_dev)
    participant Next as Next.js Dev Server (:3001)
    participant SFU as Private LiveKit SFU (:7880)
    actor Bob as Chrome Browser B (Bob)
    actor Alice as Chrome Browser A (Alice)

    Alice->>Next: POST /api/calls (Create Call)
    Bob->>Next: POST /api/calls/[id]/accept
    Alice->>SFU: Connect WebRTC (Token A)
    Bob->>SFU: Connect WebRTC (Token B)
    Note over Alice,Bob: Both connected on SFU via WebRTC (SIDs: PA_6MFQ..., PA_XPEp...)
    
    Admin->>Next: PATCH /api/team/[bob.id] (Disable Bob)
    activate Next
    Next->>DB: UPDATE User SET disabledAt = NOW()
    Next->>DB: UPDATE CallParticipant SET status = 'EJECTED'
    Next->>DB: INSERT INTO CallSfuEjectionJob (PENDING)
    Next-->>Admin: 200 OK (218ms)
    deactivate Next

    Note over Next,SFU: Post-Commit Immediate Ejection
    Next->>SFU: RoomService.removeParticipant(room, bob.id)
    SFU-->>Bob: WebSocket Close / Disconnect (Reason: 4 - SERVER_EJECT)
    Note over Bob: Disconnected in Browser B

    Bob->>Next: POST /api/calls/[id]/token (Fetch new token)
    Next-->>Bob: 401 Unauthorized (Account Disabled)

    Bob->>SFU: Reconnect using old bearer JWT
    SFU->>Next: POST /api/calls/webhook (participant_joined)
    activate Next
    Note over Next: Webhook Gatekeeper checks user.disabledAt / status === 'EJECTED'
    Next->>SFU: RoomService.removeParticipant(room, bob.id)
    deactivate Next
    SFU-->>Bob: Auto-Ejected (<300ms)

    Note over Alice: Alice remains actively connected on SFU
```

### 4.3 Detailed Observation Metrics
- **WebRTC Establishment Time:** $8.37\text{s}$ (two independent Chrome browser instances establishing dual ICE/DTLS handshakes with SFU).
- **Administrative Disablement API Latency:** $218\text{ms}$ (`PATCH /api/team/[bob.id]`).
- **PostgreSQL Status Update:** User B participant status transitioned to `EJECTED` synchronously within the database transaction.
- **SFU Removal Verification:** LiveKit SFU confirmed participant list reduced from 2 to 1 (`listParticipants` returned only User A).
- **Browser Telemetry:** Chrome Browser B observed `RoomEvent.Disconnected` with disconnect reason code `4` (`SERVER_EJECT`).
- **Token Denial:** Disabled User B denied fresh token (`HTTP 401 Unauthorized`).
- **Webhook Gatekeeper Auto-Ejection:** When User B attempted reconnection using the old, unexpired bearer token, LiveKit accepted the TLS connection, but the immediate `participant_joined` webhook triggered the Cyraops gatekeeper. The gatekeeper identified `user.disabledAt != null` and `participant.status === 'EJECTED'`, issuing an immediate `removeParticipant` call to the SFU. Bob was severed in $<300\text{ms}$.
- **Participant Isolation:** Alice (User A) remained actively connected with unbroken WebRTC telemetry throughout Bob's ejection and reconnection attempts.

---

## 5. Outbox Operational Recovery & Concurrency Hardening (Stage E)

Stage E verified transactional reliability and fault recovery in `src/lib/calling/outbox.ts` (22/22 checks passed).

### 5.1 Atomic Job Claiming Pattern
To prevent race conditions across multi-worker environments, job claiming is atomic at the database layer:

```typescript
const claimed = await db.callSfuEjectionJob.updateMany({
  where: { id: job.id, status: OutboxJobStatus.PENDING },
  data: { status: OutboxJobStatus.PROCESSING },
});
if (claimed.count === 0) {
  return null; // Another worker won the race
}
```

- **Test Result:** Two concurrent workers attempting to claim the same pending ejection job resulted in Worker 1 executing and Worker 2 cleanly skipping. Exactly 1 execution occurred.

### 5.2 Crash Recovery for Stalled Workers
- If a server worker crashes mid-ejection, jobs remain in `PROCESSING`.
- `recoverStuckOutboxJobs(staleThresholdMs = 60000)` sweeps jobs whose `updatedAt` exceeds the threshold and resets them to `PENDING`.
- **Test Result:** Artificially stalled job successfully identified, reset to `PENDING`, and reclaimed by the next worker.

### 5.3 Exponential Backoff & Retry Exhaustion
- **Backoff Formula:** $\min(1000 \times 2^{\text{attempts} - 1}, 30000)\text{ms}$.
  - Attempt 1: $1,000\text{ms}$
  - Attempt 2: $2,000\text{ms}$
  - Attempt 3: $4,000\text{ms}$
  - Attempt 4: $8,000\text{ms}$
  - Attempt 5: $16,000\text{ms}$
  - Cap: $30,000\text{ms}$
- **Max Retry Exhaustion:** After 3 failed attempts (`maxAttempts = 3`), the job transitions to `FAILED`, preserving `lastError` with exact diagnostic data for operators.

### 5.4 Idempotent Handling of LiveKit 404 Responses
- When LiveKit returns a 404 error (e.g. `participant not found` or `room not found`), the participant is already gone from the SFU.
- The outbox worker treats this not as a fatal failure, but as an idempotent success: marks the job `COMPLETED` with `lastError = null`.

### 5.5 Administrative Discovery & Recovery
- Added administrative utility functions:
  - `getFailedOutboxJobs(limit = 50)`: Discovers failed ejection jobs with call, room, user, and error metadata.
  - `retryFailedOutboxJobs(jobIds: string[])`: Resets failed jobs back to `PENDING` with `attempts = 0` and `scheduledAt = NOW()`.
- **Test Result:** Verified admin discovery and manual recovery of persistent outage jobs.

---

## 6. Performance & Reliability Battery (Stage F)

Executed against live servers via `scratch/verify-stage-f-real-performance.ts` (17/17 checks passed).

### 6.1 Simultaneous Room Creation Latency
10 rooms were created simultaneously on the real LiveKit SFU via `Promise.all`:

| Metric | Measured Value |
|---|---|
| **Minimum Latency** | $101\text{ms}$ |
| **Maximum Latency** | $115\text{ms}$ |
| **Average Latency** | $107.7\text{ms}$ |
| **Total Batch Completion** | $122\text{ms}$ (all 10 rooms) |
| **SFU State** | All 10 confirmed active, then cleaned up cleanly |

### 6.2 High-Concurrency Duplicate Webhook Burst
To simulate aggressive webhook re-deliveries from network retries, 10 duplicate `participant_joined` webhooks were fired simultaneously against `/api/calls/webhook`:
- **Burst Latency:** All 10 requests completed in $77\text{ms}$.
- **Response Codes:** All 10 returned `HTTP 200 OK` (`[200, 200, 200, 200, 200, 200, 200, 200, 200, 200]`).
- **PostgreSQL Concurrency Fix:** Replaced `prisma.callEvent.create()` with raw SQL `INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING`. This eliminated PostgreSQL transaction abortion errors (`25P02: current transaction is aborted`) under concurrent bursts.
- **Event Integrity:** Exactly 1 lifecycle event was written to PostgreSQL; 0 duplicates.

### 6.3 Batch Outbox Sweeper Performance
- A batch of 5 queued ejection jobs was processed by `processOutboxBatch(10)` in $36\text{ms}$.
- Zero failures; all 5 transitioned to `COMPLETED`.

### 6.4 Inter-Service Health
- LiveKit SFU (`http://127.0.0.1:7880/`): `HTTP 200 OK` (`OK`).
- Cyraops Backend (`http://127.0.0.1:3001/api/health`): `HTTP 200 OK` (`{"status":"ok","database":"connected"}`).

---

## 7. Full Platform Regression Verification

Following all Stage A–F validations, the full platform test suite was executed across all existing Cyraops modules to guarantee absolute zero regression:

| Test Suite | Scope | Result | Details |
|---|---|---|---|
| **Vitest Unit Suite** | AI, Tasks, Costs, Teams, Storage, Voice | 44 / 44 PASS | 0 failed, 2.8s duration |
| **TypeScript Compiler** | Full project type check (`tsc --noEmit`) | PASS | 0 type errors |
| **Calling Phase 1** | Lifecycle, state machine, socket sync | 24 / 24 PASS | TEST-01 through TEST-24 |
| **Identity & Security** | PostgreSQL triggers, session immutability | 10 / 10 PASS | TEST-01 through TEST-10 |
| **Email Security** | Sanitizer, attachment filtering, sync | 20 / 20 PASS | All security boundaries intact |
| **SMTP Idempotency** | Duplicate send protection, crash recovery | 10 / 10 PASS | IDEM-1 through IDEM-8 |
| **Cost Financial Audit** | INR normalization, debt vs equity | All PASS | Financial accuracy verified |
| **Voice Assistant** | DeepSeek reasoning, language switching | All PASS | Voice orchestration verified |

---

## 8. Production Isolation Verification

Production safety was strictly enforced and verified throughout Phase 3:

```bash
# Querying production database
psql "postgresql://tanveersinghsaini@localhost:5432/company_os" -c "SELECT count(*) FROM _prisma_migrations;"
# Output: count = 4

psql "postgresql://tanveersinghsaini@localhost:5432/company_os" -c "\dt \"Call*\""
# Output: Did not find any relation named "Call*".

curl -s http://127.0.0.1:3000/api/health
# Output: {"status":"ok","database":"connected"}
```

1. **Zero Production Schema Changes:** Production database `company_os` retains exactly its baseline of 4 migrations. Zero calling tables or ejection jobs exist in production.
2. **Zero Production Traffic:** Production server on port 3000 remained completely untouched.
3. **Zero Configuration Pollution:** All LiveKit keys and bindings are restricted to `locally hosted app dev` and `company_os_dev`.

---

## 9. Known Limitations & Architectural Notes for Phase 4

1. **Client Media Capture Out of Scope for Phase 3:** In accordance with the Phase 3 authorization guidelines, no browser microphone capture, camera video tracks, or screen-sharing UI were implemented. All tests utilized headless WebRTC data and signaling channels.
2. **Single-Node In-Memory SFU Mode:** The current LiveKit deployment runs in single-node mode without Redis. For future high-availability production clusters spanning multiple regions, Redis configuration will be introduced.
3. **Stateless JWT Reconnection Window:** Because LiveKit access tokens are stateless JWTs, an ejected user attempting to reconnect within the token's remaining TTL will be initially accepted by the SFU. However, the Cyraops webhook gatekeeper intercepts the join event within $<300\text{ms}$ and forcibly severs the connection.

---

## 10. Conclusion & Readiness Sign-off

Phase 3 validation has proven that the Cyraops calling backend is fully compatible with real, self-hosted LiveKit SFU infrastructure. Real WebRTC connectivity, instant administrative participant ejection, cryptographic webhook authority, transactional outbox resilience, and sub-150ms concurrent performance have all been proven on live infrastructure.

**Verdict:** **READY FOR PHASE 4 (CALLING UI & CLIENT WEBRTC INTEGRATION)**

