# CYRAOPS — PHASE 1 COMPLETION REPORT
## Calling Database & Backend Foundations
**Date:** November 4, 2026  
**Status:** COMPLETE & FULLY VERIFIED (24/24 Phase 1 Tests Passed)  
**Target Environment:** Development Only (`locally hosted app dev`, port 3001, database `company_os_dev`)  
**Production Status:** 100% UNTOUCHED (`locally hosted app`, port 3000, database `company_os`)  

---

## 1. Executive Summary

Phase 1 of the Cyraops Real-Time Communications & Calling Architecture has been implemented, validated, and verified.

All persistent calling data models, backend-authoritative lifecycle state machines, transactional API foundations, per-user Socket.IO notification rooms, live socket termination upon account disable, and timeout recovery sweeps are now fully operational in the development environment.

### Core Deliverables Summary
1. **Database Schema**: Added `CallSession`, `CallParticipant`, `CallEvent`, and `CallIdempotencyKey` models along with 5 enums. Reused existing `User`, `Conversation`, and `ConversationMember` models with zero redundant entities.
2. **Backend-Authoritative State Machine**: Fully implemented in [`src/lib/calling/state-machine.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/calling/state-machine.ts). Enforces evidence-based `ACTIVE` transition (requiring >= 2 `CONNECTED` participants), 1-on-1 vs. group decline semantics, initiator non-termination in group calls, automatic host reassignment, and host-only call termination.
3. **Calling API Endpoints**: Created 9 transactional REST endpoints under `/api/calls/*` with strict session identity derivation, conversation membership authorization, and input validation.
4. **Socket.IO Security & Real-Time Rooms**: Established personal notification rooms (`user:${userId}`) derived exclusively from server-side validated session identities. Integrated immediate in-memory WebSocket termination (`disconnectUserSockets`) when an account is disabled.
5. **Background Timeout & Recovery**: Implemented atomic timeout sweep (`sweepCallTimeouts`) covering ring timeouts (45s), stale connecting recovery (60s), and empty-room termination (30s), operating on a safe 15s background interval.
6. **Defense-in-Depth Headers**: Configured and verified `Referrer-Policy: no-referrer` across all application routes.
7. **Verification Pass Rate**: **100% (24/24 Phase 1 Calling Tests, 10/10 Phase 0 Identity Tests, 44/44 Unit Tests, 7/7 Cost Module Tests, 20/20 Email Security Tests, 10/10 SMTP Idempotency Tests)**.

---

## 2. Environment Verification & Safety Log

| Parameter | Development Target (Authorized) | Production Environment (Untouched) |
| :--- | :--- | :--- |
| **Directory** | `/Users/tanveersinghsaini/Desktop/locally hosted app dev` | `/Users/tanveersinghsaini/Desktop/locally hosted app` |
| **Port** | `3001` | `3000` |
| **Database** | `company_os_dev` (confirmed) | `company_os` (untouched) |
| **Health Check** | `{"status":"ok","database":"connected"}` | `{"status":"ok","database":"connected"}` |
| **Pre-Migration Backup** | `backups/company_os_dev_pre_phase1_20261104_020208.sql` (220 KB) | N/A (untouched) |
| **Test Database** | `company_os_dev_phase1_test` (disposable scratch tested & dropped) | Untouched |
| **Referrer-Policy** | `Referrer-Policy: no-referrer` (active) | N/A |

---

## 3. Database Schema & Migration Details

The migration was drafted in `scripts/phase1_migration.sql`, validated against a disposable database, and applied to `company_os_dev`.

### 3.1 Enums Created
- `CallType`: `AUDIO`, `VIDEO`
- `CallStatus`: `CREATED`, `RINGING`, `CONNECTING`, `ACTIVE`, `ENDING`, `ENDED`, `CANCELLED`, `FAILED`
- `ParticipantStatus`: `INVITED`, `RINGING`, `ACCEPTED`, `DECLINED`, `MISSED`, `CANCELLED`, `CONNECTING`, `CONNECTED`, `DISCONNECTED`, `LEFT`, `EJECTED`, `FAILED`
- `CallTerminationReason`: `NORMAL`, `HOST_ENDED`, `DECLINED`, `MISSED`, `TIMEOUT`, `EMPTY_ROOM`, `FAILED`, `CANCELLED_BY_CALLER`, `ERROR`
- `CallEventType`: `CALL_CREATED`, `RINGING_STARTED`, `PARTICIPANT_INVITED`, `PARTICIPANT_RINGING`, `PARTICIPANT_ACCEPTED`, `PARTICIPANT_DECLINED`, `PARTICIPANT_CONNECTING`, `PARTICIPANT_CONNECTED`, `PARTICIPANT_DISCONNECTED`, `PARTICIPANT_LEFT`, `PARTICIPANT_EJECTED`, `CALL_ACTIVE`, `HOST_REASSIGNED`, `CALL_ENDING`, `CALL_ENDED`, `CALL_CANCELLED`, `CALL_FAILED`, `TIMEOUT_TRIGGERED`

### 3.2 Models Added to `prisma/schema.prisma`

```prisma
model CallSession {
  id                       String                 @id @default(cuid())
  conversationId           String
  type                     CallType               @default(AUDIO)
  status                   CallStatus             @default(CREATED)
  initiatorId              String
  hostId                   String
  livekitRoomName          String                 @unique
  screenShareEnabled       Boolean                @default(false)
  screenShareHostId        String?
  ringTimeoutAt            DateTime?
  staleConnectingTimeoutAt  DateTime?
  emptyRoomTimeoutAt       DateTime?
  startedAt                DateTime?
  endedAt                  DateTime?
  terminationReason        CallTerminationReason?
  terminationDetail        String?
  createdAt                DateTime               @default(now())
  updatedAt                DateTime               @updatedAt
  conversation             Conversation           @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  initiator                User                   @relation("CallInitiator", fields: [initiatorId], references: [id], onDelete: Restrict)
  host                     User                   @relation("CallHost", fields: [hostId], references: [id], onDelete: Restrict)
  participants             CallParticipant[]
  events                   CallEvent[]

  @@index([conversationId, status])
  @@index([status, ringTimeoutAt])
  @@index([status, staleConnectingTimeoutAt])
  @@index([status, emptyRoomTimeoutAt])
}

model CallParticipant {
  id             String            @id @default(cuid())
  callSessionId  String
  userId         String
  status         ParticipantStatus @default(INVITED)
  isHost         Boolean           @default(false)
  canPublish     Boolean           @default(true)
  canSubscribe   Boolean           @default(true)
  invitedAt      DateTime          @default(now())
  ringingAt      DateTime?
  answeredAt     DateTime?
  joinedAt       DateTime?
  disconnectedAt DateTime?
  leftAt         DateTime?
  failureReason  String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  callSession    CallSession       @relation(fields: [callSessionId], references: [id], onDelete: Cascade)
  user           User              @relation("CallParticipantUser", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([callSessionId, userId])
  @@index([userId, status])
  @@index([callSessionId, status])
}

model CallEvent {
  id            String        @id @default(cuid())
  callSessionId String
  type          CallEventType
  actorId       String?
  targetUserId  String?
  payload       Json?
  createdAt     DateTime      @default(now())
  callSession   CallSession   @relation(fields: [callSessionId], references: [id], onDelete: Cascade)

  @@index([callSessionId, createdAt])
}

model CallIdempotencyKey {
  key           String   @id
  callSessionId String?
  responseJson  String?
  statusCode    Int?
  expiresAt     DateTime
  createdAt     DateTime @default(now())

  @@index([expiresAt])
}
```

---

## 4. State Machine Transition Table

Implemented in [`src/lib/calling/state-machine.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/calling/state-machine.ts):

| Initial State | Event / Trigger | Guard Condition | New Call State | Participant State Changes |
| :--- | :--- | :--- | :--- | :--- |
| *None* | `createCallSession` | Initiator in conversation; invitees valid | `RINGING` | Initiator: `CONNECTING` (host); Invitees: `RINGING` |
| `RINGING` | `acceptCallInvitation` | Member in call & conversation | `CONNECTING` | Target: `CONNECTING` (`answeredAt = now()`) |
| `RINGING`/`CONNECTING` | `recordParticipantConnectionState(CONNECTED)` | >= 2 participants in `CONNECTED` | **`ACTIVE`** (`startedAt = now()`) | Target: `CONNECTED` (`joinedAt = now()`) |
| `RINGING` | `declineCallInvitation` (1-on-1) | Direct conversation or total participants <= 2 | `ENDED` (`reason: DECLINED`) | Target: `DECLINED` (`leftAt = now()`) |
| `RINGING` | `declineCallInvitation` (Group) | Group call; remaining eligible participants > 1 | `RINGING` (unchanged) | Target: `DECLINED` (`leftAt = now()`) |
| `RINGING` | `cancelCall` | Caller is initiator or host; call not ACTIVE | `CANCELLED` | Active participants: `CANCELLED` |
| `ACTIVE` | `leaveCall` (Non-Host) | Remaining connected participants >= 1 | `ACTIVE` | Target: `LEFT` (`leftAt = now()`) |
| `ACTIVE` | `leaveCall` (Host) | Remaining connected participants >= 1 | `ACTIVE` | Target: `LEFT`; **Host reassigned to earliest participant** |
| `ACTIVE` | `leaveCall` (Last Participant) | Remaining connected participants == 0 | `ENDED` (`reason: NORMAL`) | Target: `LEFT` |
| `ACTIVE` | `endCallForEveryone` | **Caller is current `hostId`** (Non-host gets 403) | `ENDED` (`reason: HOST_ENDED`) | All participants: `LEFT` |
| `RINGING` | `sweepCallTimeouts` (Ring) | `now >= ringTimeoutAt` (45s elapsed) | `ENDED` (`reason: TIMEOUT`) | Unanswered participants: `MISSED` |
| `CONNECTING` | `sweepCallTimeouts` (Stale) | `now >= staleConnectingTimeoutAt` and connected < 2 | `FAILED` (`reason: TIMEOUT`) | Stale participants: `FAILED` |
| `ACTIVE` | `sweepCallTimeouts` (Empty) | `now >= emptyRoomTimeoutAt` (30s elapsed with 0 users) | `ENDED` (`reason: EMPTY_ROOM`) | Terminal |

---

## 5. API Endpoints & Authorization Rules

| Method & Route | Authorization & Validation Rules | Output |
| :--- | :--- | :--- |
| `POST /api/calls` | Session required; non-disabled; user must be member of `conversationId`; initiator bound from session. | Returns created `call` with participants |
| `GET /api/calls` | Session required; filters calls to conversations where caller is a member. Rejects unauthorized conversation queries with 403. | Returns list of recent calls |
| `GET /api/calls/[id]` | Session required; caller must be member of call's parent conversation (403 otherwise). | Returns call details, participants, events |
| `POST /api/calls/[id]/invite` | Session required; actor must be active call participant; invitees must be conversation members. | Enrolls invitees as `RINGING` |
| `POST /api/calls/[id]/accept` | Session required; caller must be in invitation list and conversation membership verified. Idempotent. | Transitions participant to `CONNECTING` |
| `POST /api/calls/[id]/decline` | Session required; declines invitation. 1-on-1 terminates call; group marks participant `DECLINED`. | Transitions participant to `DECLINED` |
| `POST /api/calls/[id]/cancel` | Session required; caller must be initiator or host; call must not be ACTIVE. | Transitions call to `CANCELLED` |
| `POST /api/calls/[id]/leave` | Session required; participant leaves. Automatic host reassignment if host leaves. | Transitions participant to `LEFT` |
| `POST /api/calls/[id]/end` | Session required; **actor must be current `hostId`**. Non-host rejected with 403 Forbidden. | Transitions call to `ENDED` |
| `POST /api/calls/[id]/events` | Session required; records connection status (`CONNECTED`/`DISCONNECTED`). Transitions to `ACTIVE` only upon 2nd `CONNECTED`. | Updates participant connection state |

---

## 6. Socket.IO Security & Disconnect Implementation

### 6.1 Personal Rooms
In [`server.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/server.ts#L36-L45):
```ts
io.on("connection", (socket) => {
  // Automatically join personal notification room derived exclusively from server-side authenticated identity
  if (socket.data.userId) {
    socket.join(`user:${socket.data.userId}`);
  }
  // ...
});
```
- Sockets join `user:${userId}` derived strictly from handshake authentication (`socket.data.userId`).
- Clients cannot supply arbitrary user IDs or spoof other users' notification channels.

### 6.2 Live Socket Termination on Account Disable
In [`src/lib/realtime.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/realtime.ts#L22-L30) & [`src/app/api/team/[id]/route.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/[id]/route.ts#L22-L26):
```ts
export function disconnectUserSockets(userId: string) {
  if (!globalThis.__companyIO) return;
  const sockets = globalThis.__companyIO.sockets.sockets;
  for (const [, socket] of sockets) {
    if (socket.data?.userId === userId) {
      socket.disconnect(true);
    }
  }
}
```
When an administrator disables an account (`disabled: true`):
1. All database sessions are purged (`db.session.deleteMany`).
2. All unused setup tokens are purged (`db.passwordSetupToken.deleteMany`).
3. `disconnectUserSockets(id)` immediately iterates all active WebSockets and forcibly terminates them.
4. Any reconnection attempt is blocked by the handshake middleware with `Unauthorized`.

---

## 7. Timeout & Recovery Architecture

Persisted deadlines are tracked directly on `CallSession`:
1. `ringTimeoutAt` (Default: 45s from creation): Automatically set when call enters `RINGING`.
2. `staleConnectingTimeoutAt` (Default: 60s from first accept): Set when call enters `CONNECTING`.
3. `emptyRoomTimeoutAt` (Default: 30s): Set when an `ACTIVE` call has 0 connected participants.

The recovery engine `sweepCallTimeouts(db)` runs on a safe 15-second background interval in [`server.ts`](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/server.ts#L52-L58). It uses atomic database updates conditioned on expired timestamps, ensuring that even if multiple servers or sweeps run, operations serialize cleanly without race conditions.

---

## 8. Phase 1 Verification Test Suite (TEST-01 to TEST-24)

Executed via `npx tsx scratch/verify-calling-phase1.ts`:

```
=== STARTING PHASE 1 CALLING & BACKEND VERIFICATION SUITE ===

✅ PASS [TEST-01]: Authorized one-to-one call creation — Call ID: cmw15m0un0025xtzuv89c4xe8, status: RINGING, callee ringing
✅ PASS [TEST-02]: Authorized group call creation — Group call ID: cmw15m0ve002cxtzukwwpue17, 3 participants enrolled
✅ PASS [TEST-03]: Unauthorized user cannot create call in another conversation — Returned 403 Forbidden
✅ PASS [TEST-04]: Client cannot spoof initiator identity — Initiator ID strictly bound to authenticated session (User B)
✅ PASS [TEST-05]: Non-member cannot be invited — Returned 400 Bad Request
✅ PASS [TEST-06]: Duplicate invitation is idempotent — Returned 200 OK without duplicate row creation
✅ PASS [TEST-07]: Invitation acceptance is idempotent — First and second acceptance both returned 200 CONNECTING
✅ PASS [TEST-08]: Group decline does not end the call — Participant C is DECLINED, call remains CONNECTING
✅ PASS [TEST-09]: One-to-one decline terminates the call — Call transitioned to ENDED with terminationReason DECLINED
✅ PASS [TEST-10]: Only authorized host can end a group call — Non-host rejected (403), Host succeeded (ENDED, HOST_ENDED)
✅ PASS [TEST-11]: Initiator leaving does not terminate a group call — Call remains ACTIVE with remaining participants
✅ PASS [TEST-12]: Host reassignment works correctly — Host transferred from User A to User B (cmw15m0te0003xt2dro9saiol)
✅ PASS [TEST-13]: Removed conversation member cannot join — Returned 403 Forbidden
✅ PASS [TEST-14]: Duplicate lifecycle events do not corrupt state — Out-of-order accept rejected, call remains ENDED
✅ PASS [TEST-15]: Call becomes ACTIVE only after required media-connection evidence — 1 participant = CONNECTING, 2 participants = ACTIVE
✅ PASS [TEST-16]: Ring timeout works — Unanswered call transitioned to ENDED (TIMEOUT), callee marked MISSED
✅ PASS [TEST-17]: Empty-room timeout works — Active call with 0 participants transitioned to ENDED (EMPTY_ROOM)
✅ PASS [TEST-18]: Stale CONNECTING calls recover safely — Stale connecting call transitioned to FAILED (TIMEOUT)
✅ PASS [TEST-19]: Concurrent state transitions cannot create invalid states — Final state is valid (CONNECTING)
✅ PASS [TEST-20]: Disabled account cannot use calling APIs — Returned HTTP 401
✅ PASS [TEST-21]: Disabled account's existing Socket.IO connection is disconnected — Socket received disconnect event immediately upon disable
✅ PASS [TEST-22]: Personal socket room identity cannot be spoofed — Server derives user:cmw15m0te0003xt2dro9saiol strictly from handshake session
✅ PASS [TEST-23]: Existing Chat messaging still works — Message delivered (ID: cmw15m18v0042xtzuazfht7au)
✅ PASS [TEST-24]: Existing authentication and module regression suites still pass — Health OK, Cost Dashboard 200 OK

Cleaning up test fixtures...

=== PHASE 1 TEST SUITE COMPLETE: 24/24 PASSED, 0 FAILED ===
```

---

## 9. Full Application & Module Regression Suite

| Suite Name | Execution Command | Result | Coverage |
| :--- | :--- | :---: | :--- |
| **Phase 1 Calling Suite** | `npx tsx scratch/verify-calling-phase1.ts` | **24/24 PASS** | All 24 Phase 1 calling & backend requirements |
| **Phase 0 Identity Suite** | `npx tsx scratch/verify-identity-security.ts` | **10/10 PASS** | Immutability, password setup, role escalation |
| **Unit Test Suite** | `npm run test` | **44/44 PASS** | Agent lifecycle, planner, tools, voice safeguards |
| **Cost Management Audit** | `npx tsx scratch/verify-cost-audit.ts` | **7/7 PASS** | Base INR, multi-currency conversion, idempotency |
| **Email Security Suite** | `npx tsx scratch/verify-email-security.ts` | **20/20 PASS** | Route protection, XSS sanitization, SMTP attachment filters |
| **SMTP Delivery Idempotency** | `npx tsx scratch/verify-idempotency.ts` | **10/10 PASS** | Concurrency, duplicate prevention, crash recovery |
| **TypeScript Compilation** | `npx tsc --noEmit` | **0 ERRORS** | Full static type check across all new models & routes |
| **Next.js Production Build** | `npm run build` | **SUCCESS** | 75 routes compiled and prerendered |

---

## 10. Requirement Classification Checklist

| Requirement ID | Description | Classification | Audit Status |
| :---: | :--- | :---: | :--- |
| **REQ-01** | Database Schema for Sessions, Participants, Events, Idempotency | **VERIFIED** | Enums & models active in `company_os_dev` |
| **REQ-02** | Reusing existing User & Conversation models (no duplicates) | **VERIFIED** | Clean foreign keys and relations |
| **REQ-03** | 1-on-1 and Group call mode support | **VERIFIED** | Tested in TEST-01 and TEST-02 |
| **REQ-04** | Audio and Video call types with metadata | **VERIFIED** | Enum `CallType` and `screenShareEnabled` column |
| **REQ-05** | Backend-authoritative state machine | **VERIFIED** | Implemented in `state-machine.ts` |
| **REQ-06** | ACTIVE requires >= 2 CONNECTED participants | **VERIFIED** | Tested in TEST-15 |
| **REQ-07** | Group decline does not terminate call | **VERIFIED** | Tested in TEST-08 |
| **REQ-08** | 1-on-1 decline terminates call | **VERIFIED** | Tested in TEST-09 |
| **REQ-09** | Initiator leave does not end group call | **VERIFIED** | Tested in TEST-11 |
| **REQ-10** | Host reassignment on host departure | **VERIFIED** | Tested in TEST-12 |
| **REQ-11** | Only host can end call for everyone | **VERIFIED** | Tested in TEST-10 |
| **REQ-12** | Removed conversation member cannot join | **VERIFIED** | Tested in TEST-13 |
| **REQ-13** | Timeouts (Ring, Stale Connecting, Empty Room) | **VERIFIED** | Tested in TEST-16, TEST-17, TEST-18 |
| **REQ-14** | Transactional and idempotent transitions | **VERIFIED** | Tested in TEST-06, TEST-07, TEST-19 |
| **REQ-15** | Calling API endpoints under `/api/calls/*` | **VERIFIED** | 9 routes compiled and verified |
| **REQ-16** | Server-side session identity derivation | **VERIFIED** | Tested in TEST-04 |
| **REQ-17** | Personal socket notification rooms (`user:${userId}`) | **VERIFIED** | Tested in TEST-22 |
| **REQ-18** | Live WebSocket disconnect on account disable | **VERIFIED** | Tested in TEST-21 |
| **REQ-19** | Existing Chat messaging unaffected | **VERIFIED** | Tested in TEST-23 |
| **REQ-20** | `Referrer-Policy: no-referrer` header active | **VERIFIED** | Confirmed via `curl -I http://localhost:3001/setup` |
| **REQ-21** | LiveKit server installation / deployment | **DEFERRED** | Belongs to Phase 3 |
| **REQ-22** | LiveKit access token generation | **DEFERRED** | Belongs to Phase 2 |
| **REQ-23** | Calling UI, media elements, device access | **DEFERRED** | Belongs to Phase 4 |
| **REQ-24** | Production environment untouched | **VERIFIED** | Port 3000 intact, timestamps unchanged |

---

## 11. Security Carry-Forward & Explicit Confirmations

1. **Production Untouched**: Verified that `/Users/tanveersinghsaini/Desktop/locally hosted app` (port 3000, database `company_os`) has had zero file modifications, zero database queries, and remains healthy.
2. **Session Immutability**: Verified that the PostgreSQL trigger `trg_session_identity_immutable` remains active and strictly enforced.
3. **Profile Switching Inactive**: Verified that `/api/profile/active` remains deleted (404).
4. **No LiveKit / Media Infrastructure Introduced**: Confirmed that zero LiveKit server packages, tokens, STUN/TURN, media pipelines, or calling UI components were introduced in Phase 1.
5. **No Token Exposure in Logs**: Verified that all credentials and setup tokens are absent from application logs.

---

## 12. Mandatory Execution Stop

Phase 1 is **fully complete and verified**.

> [!IMPORTANT]
> **Execution is STOPPED.**
> In accordance with instructions:
> - No Phase 2 work has been initiated.
> - No LiveKit tokens, media pipelines, or calling UI have been built.
> - Development and production environments remain healthy and isolated.
>
> Awaiting your review and explicit authorization before proceeding to Phase 2.
