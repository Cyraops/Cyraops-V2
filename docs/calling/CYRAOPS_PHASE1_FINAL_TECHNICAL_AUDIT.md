# CYRAOPS — PHASE 1 FINAL TECHNICAL AUDIT BEFORE LIVEKIT
## Architectural Reliability, Concurrency & Security Readiness Assessment

**Date:** November 4, 2026  
**Audit Scope:** Phase 1 Calling Database & Backend Foundations  
**Target Environment:** Development Only (`locally hosted app dev`, port 3001, database `company_os_dev`)  
**Production Status:** 100% UNTOUCHED (`locally hosted app`, port 3000, database `company_os`)  
**Audit Mode:** READ-ONLY INSPECTION & DISPOSABLE TEST FIXTURES (Zero code/schema/env changes)  

---

## 1. Executive Verdict

### **Verdict: PARTIALLY VERIFIED — NOT YET READY FOR LIVEKIT INTEGRATION**

While Phase 1 successfully established relational data models, transactional signaling endpoints, session identity immutability, and Socket.IO per-user routing, this technical audit reveals **critical architectural gaps and concurrency vulnerabilities** that must be remediated before integrating LiveKit:

1. **Inverted Media Trust Boundary (Critical Blocker)**: The current implementation accepts unauthenticated client HTTP assertions (`POST /api/calls/[id]/events` with `{"status": "CONNECTED"}`) as proof of media connectivity. A client can activate a call without opening a WebRTC socket or negotiating SDP.
2. **Concurrent Call Creation Race Condition (Critical Blocker)**: Simultaneous call creation requests in the same conversation result in two distinct active call sessions due to lack of transaction-level isolation or partial unique constraints.
3. **Authorization Leak for Removed Members (High Blocker)**: While `acceptCallInvitation` checks conversation membership, `recordParticipantConnectionState` (`/events`) does **not**. A removed conversation member can continue submitting connection events and remain connected to an active call.
4. **Timeout Worker Concurrency & Stale Overwrites (High)**: `sweepCallTimeouts` uses non-conditional `update()` statements. Under multi-process execution or high latency, the background worker can overwrite an `ACTIVE` call back to `FAILED`. In addition, `clearInterval` is missing from the server shutdown handler.
5. **Idempotency Model Disconnection (Medium)**: The `CallIdempotencyKey` table exists in PostgreSQL but is **completely disconnected** from all API routes. Concurrent duplicate invitations trigger unhandled Prisma unique constraint violations (`P2002`).
6. **Host Metadata De-synchronization (Medium)**: When a host leaves a call, `CallParticipant.isHost` on the departing participant is never reset to `false`, leaving multiple participants flagged as host.

---

## 2. Files & Database Objects Inspected

### Source Code Inspected
- `src/app/api/calls/route.ts` (List & Create calls)
- `src/app/api/calls/[id]/route.ts` (Call details & event history)
- `src/app/api/calls/[id]/invite/route.ts` (Participant invitation)
- `src/app/api/calls/[id]/accept/route.ts` (Invitation acceptance)
- `src/app/api/calls/[id]/decline/route.ts` (Invitation decline)
- `src/app/api/calls/[id]/cancel/route.ts` (Call cancellation)
- `src/app/api/calls/[id]/leave/route.ts` (Participant departure & host reassignment)
- `src/app/api/calls/[id]/end/route.ts` (Host termination)
- `src/app/api/calls/[id]/events/route.ts` (Participant connection state updates)
- `src/lib/calling/state-machine.ts` (Core calling state machine & timeout engine)
- `server.ts` (Socket.IO setup, personal rooms, background interval, shutdown)
- `src/lib/realtime.ts` (Socket manager & `disconnectUserSockets`)
- `src/lib/auth.ts` (Session identity resolution & disabled account enforcement)
- `next.config.ts` (Security response headers)
- `prisma/schema.prisma` (Data models & indexes)

### Database Objects Inspected
- Enums: `CallType`, `CallStatus`, `ParticipantStatus`, `CallTerminationReason`, `CallEventType`
- Tables: `CallSession`, `CallParticipant`, `CallEvent`, `CallIdempotencyKey`
- Related Tables: `User`, `Session`, `Conversation`, `ConversationMember`
- Triggers: `trg_session_identity_immutable` on table `Session`

---

## 3. AUDIT 1 — Media Connection Trust Boundary

### Classification: **FAILED (Architectural Inversion)**

| Investigation Question | Audit Finding | Concrete Code Evidence |
| :--- | :---: | :--- |
| **1. Can an authenticated client submit CONNECTED without establishing WebRTC?** | **YES** | In `src/app/api/calls/[id]/events/route.ts` (L18-35), any valid cookie session can submit `{"status": "CONNECTED"}` via `fetch` or `curl`. No SDP, ICE, or media handshake is validated. |
| **2. Can one participant claim that another participant is connected?** | **NO** | In `/events/route.ts` (L31), `recordParticipantConnectionState(tx, id, user.id, ...)` derives the target participant strictly from `user.id`. Actor cannot be spoofed. |
| **3. Can a client manipulate event payloads to activate a call without real media?** | **YES** | In `state-machine.ts` (L701-724), when `connectedCount >= 2`, call status is transitioned to `ACTIVE`. Two clients issuing HTTP POSTs activate the call with zero media exchanged. |
| **4. Are duplicate and out-of-order connection events handled safely?** | **NO** | In `state-machine.ts` (L683), `client.callParticipant.update` unconditionally sets `status: newStatus`. A late `DISCONNECTED` arriving after a reconnect will overwrite the state. |
| **5. Can a participant transition from LEFT, DECLINED, EJECTED back to CONNECTED?** | **YES** | `recordParticipantConnectionState` only checks `TERMINAL_CALL_STATUSES.has(call.status)`. It lacks checks against `INACTIVE_PARTICIPANT_STATUSES` on the participant. |
| **6. Is state machine incorrectly treating application events as media connectivity proof?** | **YES** | Client-submitted JSON is treated as ground-truth network state. |

### Architectural Trust Boundary Distinction
```
Current (Insecure Client-Authoritative Pattern):
[ Browser Client ] --- HTTP POST /events {"status":"CONNECTED"} ---> [ Next.js Backend ] (Activates Call)
                                                                           ❌ No proof of media

Required (Server-Authoritative LiveKit SFU Pattern):
[ Browser Client ] --- Joins via Token ---> [ LiveKit SFU Server ]
                                                    |
                                    Signed Webhook (HMAC-SHA256)
                                    participant_joined / track_published
                                                    v
                                            [ Next.js Backend ] (Activates Call)
```

### Recommendation for Phase 2/3:
1. **Revoke Client Authority**: Strip client-side ability to emit `CONNECTED` or `ACTIVE` state mutations via `/api/calls/[id]/events`.
2. **Server-Side Webhook Receiver**: Transition participant states to `CONNECTED` and call state to `ACTIVE` exclusively via cryptographically validated LiveKit SFU webhooks (`WebhookReceiver` verifying `Authorization` token).
3. **Restrict `/events`**: Relegate `/api/calls/[id]/events` strictly to passive client telemetry logging without triggering state transitions.

---

## 4. AUDIT 2 — Background Timeout Worker

### Classification: **PARTIALLY VERIFIED — NOT YET PRODUCTION READY**

| Verification Criterion | Finding | Evidence & Architectural Analysis |
| :--- | :---: | :--- |
| **1. Started more than once during dev hot reload?** | **NO** | Defined in `server.ts` `start()`. Executed once per process lifecycle. |
| **2. Multiple server processes run independent sweeps?** | **YES** | If clustered or scaled horizontally, every process executes `setInterval(15s)`. |
| **3. State transitions protected by conditional atomic updates?** | **NO** | `sweepCallTimeouts` uses `client.callSession.update({ where: { id: call.id } })` without a conditional `where: { id: call.id, status: 'RINGING' }`. |
| **4. Can timeout worker overwrite a call that just became ACTIVE?** | **YES** | Race condition: If a call connects between worker `findMany` and `update`, worker will execute `status: FAILED`, clobbering the active call. |
| **5. Delayed timeout terminate reconnecting participant?** | **YES** | If a participant reconnects during the sweep window, worker reading stale state can force `CallStatus.ENDED (EMPTY_ROOM)`. |
| **6. Process crash during sweep?** | **TOLERANT** | Next sweep recovers expired deadlines, but intermediate participant statuses may be inconsistent. |
| **7. Persisted deadlines sufficient for restart recovery?** | **YES** | `ringTimeoutAt`, `staleConnectingTimeoutAt`, and `emptyRoomTimeoutAt` persist in PostgreSQL. |
| **8. Worker shutdown / cleanup mechanism?** | **MISSING** | In `server.ts` (L85-91), `clearInterval(reminderTimer)` exists, but `callSweepTimer` is **never cleared** in `SIGINT`/`SIGTERM` handlers. |
| **9. Can two workers process the same expired call?** | **YES** | No database row-level locking (`SELECT FOR UPDATE SKIP LOCKED`) or distributed advisory lock (`pg_try_advisory_xact_lock`). |
| **10. Duplicate lifecycle events generated?** | **YES** | Concurrent sweeps iterate the same calls and insert duplicate `TIMEOUT_TRIGGERED` events in `CallEvent`. |

### Worker Classification:
- **Single Process**: Conditionally safe, but vulnerable to intra-process race conditions.
- **Multiple Processes**: **UNSAFE** (generates duplicate events and race updates).
- **Production Readiness**: **NOT YET PRODUCTION READY**.

---

## 5. AUDIT 3 — Idempotency Implementation

### Classification: **FAILED (Model Exists but is Disconnected)**

### Endpoint-by-Endpoint Analysis

| Endpoint | `CallIdempotencyKey` Used? | Idempotency Mechanism Used | Concurrency Result |
| :--- | :---: | :--- | :--- |
| `POST /api/calls` | **NO** | `findFirst` check on conversation | **VULNERABLE**: Concurrent calls create duplicate sessions (Scenario 1). |
| `GET /api/calls` | N/A | Naturally idempotent read | Safe. |
| `GET /api/calls/[id]` | N/A | Naturally idempotent read | Safe. |
| `POST /api/calls/[id]/invite` | **NO** | In-memory `call.participants.find` | **VULNERABLE**: Concurrent identical invites throw Prisma `P2002` (Scenario 2). |
| `POST /api/calls/[id]/accept` | **NO** | State check (`ACCEPTED_OR_CONNECTING`) | Idempotent for sequential calls; uncoordinated under concurrency. |
| `POST /api/calls/[id]/decline` | **NO** | State check (`DECLINED`) | Idempotent for sequential calls. |
| `POST /api/calls/[id]/cancel` | **NO** | State check (`TERMINAL_CALL_STATUSES`) | Idempotent for sequential calls. |
| `POST /api/calls/[id]/leave` | **NO** | State check (`LEFT`) | Idempotent for sequential calls. |
| `POST /api/calls/[id]/end` | **NO** | State check (`TERMINAL_CALL_STATUSES`) | **PARTIAL**: Terminates call, but inserts duplicate `CALL_ENDED` events (Scenario 12). |
| `POST /api/calls/[id]/events` | **NO** | None | Overwrites status on every request. |

### Concrete Findings:
1. **Zero Route Usage**: `grep -rn "CallIdempotencyKey" src` confirmed 0 references in application code.
2. **Missing Scoping Columns**: `CallIdempotencyKey` schema has `key`, `callSessionId`, `responseJson`, `statusCode`, `expiresAt`, but lacks `userId` and `endpoint`.
3. **No Automatic Cleanup**: No cron or background sweeper cleans up expired idempotency keys from PostgreSQL.

---

## 6. AUDIT 4 — Lifecycle & Concurrency Edge Cases (Empirical Test Results)

All 15 scenarios were executed against a disposable PostgreSQL database (`company_os_audit_scratch`), initialized with clean fixtures for each test:

```
=== STARTING PHASE 1 CALLING AUDIT: 15 LIFECYCLE & CONCURRENCY SCENARIOS ===
```

| Scenario ID | Edge Case Description | Expected Result | Actual Empirical Result | Status |
| :---: | :--- | :--- | :--- | :---: |
| **01** | Two simultaneous call creations in same conversation | Only 1 call created; 2nd returns 409 Conflict | Both succeeded (`cmw160wbz...` and `cmw160wc4...`). Two active calls created in same conversation. | **FAILED** |
| **02** | Two simultaneous invitations to same participant | Idempotent enrollment; returns 200 OK | Request 1 succeeded (`addedCount: 1`). Request 2 crashed with Prisma `P2002` Unique Constraint violation. | **FAILED** |
| **03** | Multiple group participants declining | Call remains ringing until last invitee declines | Declined B (`RINGING`), declined C (`RINGING`), declined D (`ENDED`, `DECLINED`). | **VERIFIED** |
| **04** | Host leaving while call is CONNECTING | Host reassigned to next participant; call stays alive | Reassigned to User B (`newHostId: user_b`). Departing User A still has `isHost: true`. | **PARTIALLY VERIFIED** |
| **05** | Host leaving while call is ACTIVE | Host reassigned to connected participant; call stays alive | Reassigned to User B (`newHostId: user_b`). Departing User A still has `isHost: true`. | **PARTIALLY VERIFIED** |
| **06** | Last connected participant disconnecting unexpectedly | Arm empty room timeout (30s) without killing call | Call remains `ACTIVE`; `emptyRoomTimeoutAt` armed to +30s. | **VERIFIED** |
| **07** | Participant reconnecting after temporary network interruption | Status changes DISCONNECTED -> CONNECTED | Reconnect succeeded; participant `CONNECTED`; call remains `ACTIVE`. | **VERIFIED** |
| **08** | Participant removed from conversation during active call | Actions rejected with 403 Forbidden | `recordParticipantConnectionState` and `leaveCall` both succeeded without checking membership. | **FAILED** |
| **09** | Account disable during active call | User proactively ejected from call session | WebSockets killed, but participant DB record remains `CONNECTED` indefinitely until next call action. | **PARTIALLY VERIFIED** |
| **10** | Ring timeout concurrent with invitation acceptance | Coordinated atomic resolution | Sweep expired call to `ENDED`; accept concurrently marked participant `CONNECTING` on an `ENDED` call. | **FAILED** |
| **11** | Empty-room timeout concurrent with reconnection | Reconnection registered; timeout cleared | Reconnection registered; participant `CONNECTED`; call remains `ACTIVE`. | **VERIFIED** |
| **12** | Duplicate end-call requests | Exactly one `CALL_ENDED` event emitted | Both succeeded; two duplicate `CALL_ENDED` events inserted into `CallEvent`. | **PARTIALLY VERIFIED** |
| **13** | Late CONNECTED event arriving after call has ended | Rejected with 400 Bad Request | Rejected with error: `"Call is already ended"`, HTTP 400. | **VERIFIED** |
| **14** | Host reassignment with null or identical `joinedAt` | Selects valid remaining participant gracefully | Falls back to `remainingParticipants[0]` (`user_b`); host transferred safely. | **VERIFIED** |
| **15** | Call with no eligible host after departures | Call terminates cleanly | Transitions to `ENDED` (`reason: DECLINED`); no orphan hostless call. | **VERIFIED** |

---

## 7. AUDIT 5 — Authorization & Data Isolation

### Classification: **PARTIALLY VERIFIED**

| Authorization Requirement | Status | Detailed Finding |
| :--- | :---: | :--- |
| **Identity from authenticated session** | **VERIFIED** | `userFromRequest` enforces session validation across all endpoints. |
| **Cross-conversation call access blocked** | **VERIFIED** | `GET /api/calls` and `GET /api/calls/[id]` enforce conversation membership (403). |
| **Outside conversation invite blocked** | **VERIFIED** | `inviteParticipants` validates all `inviteeIds` against `ConversationMember`. |
| **Accepting another user's invitation blocked** | **VERIFIED** | Participant looked up strictly by `user.id`. |
| **Non-host ending group call blocked** | **VERIFIED** | `endCallForEveryone` strictly checks `call.hostId === actorId` (403 otherwise). |
| **Removed member reconnect blocked** | **FAILED** | `recordParticipantConnectionState` does **not** check `ConversationMember`. A removed employee can post connection events. |
| **Disabled account blocked from calls** | **VERIFIED** | `userFromRequest` returns `null` for `disabledAt !== null`, returning 401 across all routes. |
| **Actor identity spoofing in payloads blocked** | **VERIFIED** | All mutation routes discard client-supplied actor IDs and bind `user.id`. |
| **No sensitive data exposed in history** | **VERIFIED** | `select` clauses restrict user fields to `id`, `name`, `email`, `avatarUrl`, `role`. |
| **Pagination on call lists and events** | **PARTIALLY VERIFIED** | `GET /api/calls` has hardcoded `take: 30`; `GET /api/calls/[id]` has hardcoded `take: 25` events. No cursor pagination supported. |

---

## 8. AUDIT 6 — Schema & Data Integrity

### Classification: **PARTIALLY VERIFIED**

1. **Foreign Keys & Deletion Rules**:
   - `CallSession.conversationId` -> Cascade.
   - `CallSession.initiatorId` / `hostId` -> Restrict (prevents accidental deletion of users).
   - `CallParticipant` -> Cascade on both call session and user.
   - **Gap**: `CallEvent.actorId` and `CallEvent.targetUserId` have no foreign keys to `User`.
   - **Gap**: `CallIdempotencyKey.callSessionId` has no foreign key to `CallSession`.
2. **Missing Constraints & Indexes**:
   - **Critical Gap**: Missing partial unique constraint on active calls per conversation:
     `CREATE UNIQUE INDEX idx_unique_active_call_per_conv ON "CallSession" ("conversationId") WHERE status IN ('CREATED', 'RINGING', 'CONNECTING', 'ACTIVE');`
   - **Missing Index**: `CallSession.initiatorId` and `CallSession.hostId` are not indexed.
3. **Insecure Room Name Generation**:
   - `state-machine.ts` (L121): `const tempId = call_${Date.now()}_${Math.random().toString(36).substring(2, 9)};`
   - **Vulnerability**: `Math.random()` is a pseudo-random, predictable PRNG. Must be replaced with `crypto.randomUUID()` or `crypto.randomBytes(16).toString("hex")`.
4. **Host Flag Desynchronization**:
   - `state-machine.ts` (L562-585): When host departs, `nextHost.isHost` is set to `true`, but departing host's `isHost` is never updated to `false`.
5. **Premature Screen Share Columns**:
   - `screenShareEnabled` and `screenShareHostId` exist on `CallSession`, but have zero enforcement or synchronization logic.

---

## 9. AUDIT 7 — Existing Application Regression

### Classification: **VERIFIED (100% Passing)**

The entire existing Cyraops test infrastructure was re-verified against `company_os_dev`:

```
=== REGRESSION VERIFICATION RESULTS ===
✔ Core Unit Test Suite: 44/44 PASS (Agent framework, browser SSRF, cost service, voice tools)
✔ Phase 1 Calling Verification: 24/24 PASS (Baseline signaling scenarios)
✔ Phase 0 Identity Security: 10/10 PASS (Session immutability, role escalations, trigger safety)
✔ Cost Management Audit: 7/7 PASS (Base INR, multi-currency, accounting segregation)
✔ Email Module Security: 20/20 PASS (HTML sanitizer, SMTP attachment blocking, XSS prevention)
✔ SMTP Delivery Idempotency: 10/10 PASS (Concurrency, retry policies, crash recovery)
✔ Response Headers: Referrer-Policy: no-referrer CONFIRMED ACTIVE
✔ Dev Server (Port 3001): Healthy ({"status":"ok","database":"connected"})
✔ Prod Server (Port 3000): Healthy & Isolated ({"status":"ok","database":"connected"})
```

---

## 10. Prioritized Remediation Roadmap Before LiveKit Integration

### Priority 0 — Critical Architecture & Security Blockers (Must Fix First)
1. **Invert Trust Model for Media Connectivity**:
   - Deprecate client-driven `CONNECTED` and `ACTIVE` mutations on `POST /api/calls/[id]/events`.
   - Prepare `POST /api/calls/webhook` for cryptographically verified LiveKit webhooks (`participant_joined`, `track_published`).
2. **Prevent Concurrent Duplicate Call Creation**:
   - Add PostgreSQL partial unique index on `CallSession(conversationId)` where `status IN ('CREATED', 'RINGING', 'CONNECTING', 'ACTIVE')`.
   - Wrap `createCallSession` in a row-locking transaction (`SELECT ... FOR UPDATE`).
3. **Enforce Conversation Membership on `/events` and Departure**:
   - Add strict `ConversationMember` verification inside `recordParticipantConnectionState` and `leaveCall`.

### Priority 1 — High Reliability & Concurrency Gaps
4. **Synchronize Host Participant Metadata**:
   - In `leaveCall`, set `isHost: false` on the departing participant when host role is transferred.
5. **Conditionalize Background Timeout Updates**:
   - Replace blind updates in `sweepCallTimeouts` with atomic conditional queries (`where: { id: call.id, status: 'RINGING' }`).
   - Add `clearInterval(callSweepTimer)` to `server.ts` process shutdown handlers (`SIGINT`/`SIGTERM`).
6. **Cryptographically Secure Room Names**:
   - Replace `Math.random()` in `createCallSession` with `crypto.randomUUID()`.

### Priority 2 — Idempotency & Cleanliness Improvements
7. **Connect Idempotency Engine**:
   - Integrate `CallIdempotencyKey` into `POST /api/calls` and `/invite`, or use atomic upsert to handle concurrent duplicate invites gracefully without throwing `P2002`.
8. **Cursor Pagination**:
   - Add `cursor` and `limit` parameters to `GET /api/calls` and `GET /api/calls/[id]`.

---

## 11. Environment Isolation & Safety Confirmation

- **Development Project**: `/Users/tanveersinghsaini/Desktop/locally hosted app dev` (Inspected in read-only mode).
- **Development Database**: `company_os_dev` (Untouched during audit; zero schema alterations, zero manual records created).
- **Disposable Test Database**: `company_os_audit_scratch` (Used exclusively for the 15 edge case tests; completely dropped and purged).
- **Production Project**: `/Users/tanveersinghsaini/Desktop/locally hosted app` (**100% UNTOUCHED**; 0 queries, 0 files modified).
- **Production Port 3000**: Untouched, healthy (`{"status":"ok","database":"connected"}`).

---

## 12. Mandatory Execution Stop

This audit is **complete**.

> [!IMPORTANT]
> **Execution is STOPPED.**
> - Phase 2 has NOT been started.
> - LiveKit packages have NOT been installed.
> - No access tokens or media infrastructure have been generated.
> - No calling UI has been built.
> 
> Awaiting user review of this audit report and explicit instructions.
