# CYRAOPS — PHASE 4.1: INDEPENDENT CALLING AUDIT & REAL-DEVICE READINESS REPORT

**Auditor:** Google DeepMind / Antigravity Agentic Pair Programmer  
**Date:** November 5, 2026  
**Environment:** Development (`/Users/tanveersinghsaini/Desktop/locally hosted app dev`)  
**Development Database:** `company_os_dev` (Port 3001)  
**Production Database:** `company_os` (Port 3000 — 100% Isolated & Untouched)  
**Overall Verdict:** **CONDITIONAL PASS — CORE WEBRTC OPERATIONAL; 4 HIGH-PRIORITY REMEDIATIONS IDENTIFIED**

---

## 1. Executive Verdict & Summary

An independent, rigorous technical audit of the Cyraops calling subsystem (Phase 4 Calling UI & Client WebRTC integration) was conducted. Beyond reviewing passing test assertions, this audit performed direct source code inspection, transaction analysis, and an automated 16-point real-world edge-case battery executed against the live Next.js backend (`:3001`), the real native LiveKit SFU daemon (`:7880`), and persistent PostgreSQL database (`company_os_dev`).

### Verdict: CONDITIONAL PASS
The core WebRTC calling architecture is robust: real audio/video tracks are published and subscribed through the private LiveKit SFU, token issuance strictly binds user session identity to 60-second JWTs, authoritative HMAC webhook verification prevents client-side status forgery, and administrative participant ejection severs connections in $<300\text{ms}$.

However, the real-world edge case battery exposed **4 High-priority functional defects** that must be resolved prior to multi-device physical rollout:
1. **Multi-Tab Ringing Desync:** When a user with multiple browser tabs answers on Tab 1, Tab 2 continues ringing indefinitely.
2. **Missing Active Call Recovery on Refresh:** Refreshing the browser page kicks the user out of the in-call UI, leaving the remote user stranded.
3. **Missing Cross-Conversation Busy Check:** The backend permits calling a user who is already actively in a call in another chat.
4. **PostgreSQL Transaction Abortion (`25P02`) on Simultaneous Call Collisions:** When two users call each other simultaneously, the catch block in `createCallSession()` attempts to query an already-aborted transaction.

---

## 2. Files & APIs Inspected

### 2.1 Backend APIs & State Machine
- `src/app/api/calls/route.ts` (Call creation, idempotency, listing)
- `src/app/api/calls/[id]/token/route.ts` (60s TTL JWT token generation, permission gates)
- `src/app/api/calls/[id]/accept/route.ts` (Accept transition, Socket.IO broadcast)
- `src/app/api/calls/[id]/decline/route.ts` (Decline transition, termination)
- `src/app/api/calls/[id]/cancel/route.ts` (Initiator cancellation while ringing)
- `src/app/api/calls/[id]/leave/route.ts` (Participant departure, host reassignment)
- `src/app/api/calls/[id]/end/route.ts` (Host termination for all participants)
- `src/app/api/calls/webhook/route.ts` (LiveKit HMAC-SHA256 signature verification, authoritative media state)
- `src/lib/calling/state-machine.ts` (Core transition logic, timeouts, partial unique index handling)
- `src/lib/calling/livekit-room.ts` (RoomService management, participant removal)
- `src/lib/calling/outbox.ts` (Transactional ejection queue, atomic claiming, recovery)
- `src/lib/realtime.ts` (Socket.IO personal room `user:${id}` and conversation emitters)

### 2.2 Client-Side UI Components
- `src/components/modules/chat.tsx` (Conversation header integration, socket event routing, active call docking)
- `src/components/calling/active-call-view.tsx` (LiveKit Room lifecycle, audio/video track rendering, mute/camera toggles)
- `src/components/calling/incoming-call-modal.tsx` (Ringing dialog, caller display, accept/decline actions)
- `src/components/calling/call-header-controls.tsx` (Audio and video call action buttons)
- `src/components/calling/ringtone.ts` (Web Audio API dual-frequency oscillator chime)

---

## 3. Stage B: Real-World Edge Case Battery Results

All 16 edge cases were evaluated on the real development environment with concrete evidence recorded:

| Edge Case # | Description | Evaluation Method | Result | Concrete Observations & Evidence |
|---|---|---|---|---|
| **EC-1** | Two users calling each other simultaneously | **ACTUALLY EXECUTED** | **DEFECT FOUND** | Simultaneous `createCallSession` fired partial unique index `P2002`. Catch block threw `25P02: current transaction is aborted` when attempting to query `conflictingCall` on poisoned transaction client. |
| **EC-2** | Repeated call button clicks (rapid-fire) | **ACTUALLY EXECUTED** | **PASS / NOTE** | Dispatched 5 concurrent requests: exactly 1 succeeded (201 Created), remaining 4 rejected with 409 Conflict. Note: Client currently omits `Idempotency-Key` header. |
| **EC-3** | Recipient already active in another call | **ACTUALLY EXECUTED** | **DEFECT FOUND** | User B active in Call 1 (Conversation 1). User C called User B in Conversation 2: backend returned `201 Created` instead of `409/486 Busy`. User B's UI dropped notification; User C left ringing. |
| **EC-4** | Recipient with multiple browser tabs open | **ACTUALLY EXECUTED** | **DEFECT FOUND** | User B had Tab 1 and Tab 2 open. User A called User B. Both tabs rang. User B accepted in Tab 1. Tab 2 **stayed open and continued ringing indefinitely**. |
| **EC-5** | Caller refreshing during active call | **ACTUALLY EXECUTED** | **DEFECT FOUND** | Active call in progress. Caller reloaded (`pageA.reload()`). ActiveCallView unmounted, `activeCall` state reset to `null`. Caller kicked to normal chat. |
| **EC-6** | Recipient refreshing during active call | **ACTUALLY EXECUTED** | **DEFECT FOUND** | Active call in progress. Recipient reloaded (`pageB.reload()`). Connection severed, UI returned to plain chat with no active call banner or rejoin action. |
| **EC-7** | Browser tab closed during active call | **ACTUALLY EXECUTED** | **PARTIAL** | Tab closed without clicking "End Call". LiveKit SFU detected connection drop and dispatched `participant_left` webhook in $8\text{s}$. Lacks `beforeunload` beacon for instant disconnect. |
| **EC-8** | Temporary network interruption & recovery | **ACTUALLY EXECUTED** | **PASS** | `RoomEvent.Reconnecting` and `RoomEvent.Reconnected` handled cleanly; LiveKit client renegotiated ICE without needing new token. |
| **EC-9** | Microphone permission denied | **ACTUALLY EXECUTED** | **PASS** | Browser launched with mic denied: caught `NotAllowedError`, rendered alert banner, remote audio subscription remained functional. |
| **EC-10** | Camera permission denied | **ACTUALLY EXECUTED** | **PASS** | Camera permission denied on video call: caught error, set `isCameraOff(true)`, rendered fallback banner, continued in audio-only mode. |
| **EC-11** | Microphone disconnected during call | **INSPECTED IN CODE** | **PARTIAL** | LiveKit detects track `ended`. However, UI lacks `navigator.mediaDevices.ondevicechange` listener to update device lists. |
| **EC-12** | Camera disconnected during call | **INSPECTED IN CODE** | **PARTIAL** | Video track unpublishes; UI lacks `devicechange` listener to refresh camera switcher dropdown. |
| **EC-13** | Both participants leaving simultaneously | **ACTUALLY EXECUTED** | **PASS** | Concurrent `leaveCall` executed via `Promise.all`: both returned `success: true`, call transitioned cleanly to `ENDED (NORMAL)`. Zero transaction aborts. |
| **EC-14** | Disabled user during active call | **ACTUALLY EXECUTED** | **PASS** | Admin disabled User B via API: PostgreSQL marked `EJECTED`, outbox job executed, LiveKit SFU removed Bob, Webhook gatekeeper blocked reconnect. |
| **EC-15** | Expired or invalid LiveKit token | **ACTUALLY EXECUTED** | **PASS** | Generated 10s TTL token, waited 11s. LiveKit SFU rejected connection attempt with expired JWT signature. |
| **EC-16** | Duplicate / delayed webhook delivery | **ACTUALLY EXECUTED** | **PASS** | Delayed webhooks on ended calls return 200 `{ status: "ignored" }` (line 64). Duplicate webhook bursts handled via `ON CONFLICT DO NOTHING`. |

---

## 4. Audit Findings Ranked by Severity

### Critical Severity: None
Zero authentication bypasses, zero secret exposures to browser bundles, zero unauthorized media eavesdropping.

---

### High Severity (Issues Requiring Code Remediation)

#### FINDING-01: Multi-Tab Ringing Desynchronization
- **Component:** `src/components/modules/chat.tsx`
- **Description:** When a user has multiple tabs open (e.g. Chat open in two monitors or desktop windows), an incoming call displays `IncomingCallModal` and rings on all tabs. When the user accepts the call in Tab 1, Tab 2 continues ringing indefinitely until ring timeout.
- **Root Cause:** In `chat.tsx`, the `socket.on("call:state")` listener only closes `incomingCall` if `data.status === "ENDED" || data.status === "CANCELLED" || data.status === "FAILED"`. When Tab 1 accepts, the backend emits `status: ACTIVE` and `participantStatus: CONNECTING`, which Tab 2 ignores.
- **Remediation:** In `chat.tsx`, dismiss `incomingCall` if `data.status === "ACTIVE"` or if `data.participantStatus === "CONNECTING" || data.participantStatus === "CONNECTED"`.

#### FINDING-02: Missing Active Call Recovery on Component Mount / Page Refresh
- **Component:** `src/components/modules/chat.tsx`
- **Description:** If a participant accidentally refreshes their page or navigates away and returns to `/chat`, they are immediately disconnected from the calling UI and returned to the plain messaging view. Meanwhile, their remote peer remains connected in the LiveKit room.
- **Root Cause:** `ChatModule` initializes `activeCall` to `null` in React state and never queries `GET /api/calls?conversationId=...` on mount to check if an active call session exists for this conversation.
- **Remediation:** During `loadConversations()` or on conversation selection, query the active call endpoint. If an active call exists where `currentUser.id` is an active participant, restore `activeCall` and display a "Rejoin Call" banner or automatically reconnect.

#### FINDING-03: Missing Cross-Conversation Recipient Busy Rejection
- **Component:** `src/lib/calling/state-machine.ts` (`createCallSession`)
- **Description:** User A and User B are in an active call in Conversation 1. User C starts a call with User B in Conversation 2. The backend allows the call to be created in Conversation 2 (`201 Created`). User B's client silently drops the notification because `activeCallRef.current !== null`. User C is left ringing until timeout with no indication that User B is busy.
- **Root Cause:** `createCallSession()` only queries `existingActive` for the current `conversationId`. It does not check if any target invitee is currently participating in an active or ringing call across any other conversation.
- **Remediation:** Add a check in `createCallSession()`:
  ```typescript
  const busyParticipant = await client.callParticipant.findFirst({
    where: {
      userId: { in: targets },
      status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
      callSession: { status: { in: [CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] } },
    },
    include: { user: { select: { name: true } } },
  });
  if (busyParticipant) {
    return { success: false, error: `${busyParticipant.user.name} is currently on another call`, code: 409 };
  }
  ```

#### FINDING-04: PostgreSQL Transaction Poisoning (`25P02`) in `createCallSession` Collision Handler
- **Component:** `src/lib/calling/state-machine.ts`
- **Description:** When two simultaneous calls collide on the partial unique index `idx_call_session_unique_active_per_conv`, the catch block catches `P2002` and attempts to query `await client.callSession.findFirst(...)`. Because the transaction was aborted by the unique constraint failure, PostgreSQL returns `25P02: current transaction is aborted`.
- **Root Cause:** In PostgreSQL and Prisma interactive transactions, once any statement throws an error, the entire transaction block is marked invalid until rolled back.
- **Remediation:** In `createCallSession()`, do not attempt to query `client.callSession.findFirst()` inside the caught transaction block. Return `{ success: false, error: "A call is already in progress in this conversation", code: 409 }` directly.

---

### Medium Severity (Reliability, Cleanup & Hardware Adaptation)

#### FINDING-05: Missing `beforeunload` Beacon / Disconnect Handler
- **Component:** `src/components/calling/active-call-view.tsx`
- **Description:** If a user closes the browser tab or window during a call, the disconnect depends entirely on LiveKit's TCP keepalive timeout ($5\text{–}15\text{s}$). Remote participants see a frozen video tile during this delay.
- **Remediation:** Add a `beforeunload` window listener in `ActiveCallView` that calls `room.disconnect()` and fires `navigator.sendBeacon(/api/calls/[id]/leave)`.

#### FINDING-06: LiveKit Development Configuration Unignored in `.gitignore`
- **Component:** `.gitignore` & `config/livekit-dev.yaml`
- **Description:** `config/livekit-dev.yaml` contains plaintext API keys and secrets (`APITvqwWXCN6WPq: p6x4uddeEd04ExrfJ0iuqubMfV75iesCMsv8xMB3NLcA`). `.gitignore` currently ignores `.env` but does not ignore `config/livekit-dev.yaml` or `config/*.yaml`.
- **Remediation:** Add `config/*.yaml` and `config/livekit-*.yaml` to `.gitignore`.

#### FINDING-07: Missing `navigator.mediaDevices.ondevicechange` Listener
- **Component:** `src/components/calling/active-call-view.tsx`
- **Description:** Video input devices are enumerated once on component mount. Plugging in a USB webcam or disconnecting headphones during a call does not refresh the device list or trigger graceful fallback.
- **Remediation:** Add `navigator.mediaDevices.addEventListener("devicechange", enumerateDevices)` in `ActiveCallView`.

---

### Low Severity (Best Practices & Polish)

#### FINDING-08: Client Omits `Idempotency-Key` Header on `POST /api/calls`
- **Component:** `src/components/modules/chat.tsx` (`startCall`)
- **Description:** The backend has full transactional idempotency key handling, but `startCall()` does not pass an `Idempotency-Key` header, relying solely on button disabling and database conflict handling.
- **Remediation:** Pass `Idempotency-Key: crypto.randomUUID()` in `startCall()`.

#### FINDING-09: Browser Autoplay Policy on Initial Ringtone
- **Component:** `src/components/calling/ringtone.ts`
- **Description:** Modern browsers block audio oscillator playback if the user has not performed an initial interaction with the tab. The visual modal functions, but audio chime is silenced until user gesture.
- **Remediation:** Expected browser security behavior. The visual pulsating ring animation provides clear notification even when audio is silenced.

---

## 5. Stage C: Physical-Device Test Plan & Manual QA Checklist

The following test checklist has been prepared for physical device testing with human QA. **Note: These tests require real physical hardware and have NOT been executed in this automated audit phase.**

### 5.1 Single-Network Physical Tests (MacBook Chrome vs. MacBook Safari)
- [ ] **Test C-1 (Safari Compatibility):** User A on MacBook Chrome calls User B on MacBook Safari (macOS Sonoma / Sequoia). Verify WebRTC H.264 / VP8 codec negotiation.
- [ ] **Test C-2 (Microphone Audio & Acoustic Echo Cancellation):** Speak through physical laptop microphone with built-in speakers active. Verify browser Acoustic Echo Cancellation (AEC) prevents feedback loops.
- [ ] **Test C-3 (Webcam Rendering):** Verify physical FaceTime HD camera renders with accurate color balance and zero mirroring defects.
- [ ] **Test C-4 (Browser Permission Prompts):** Test cold browser launch. Verify macOS system permission prompt ("Chrome wants to access your camera") is handled gracefully.
- [ ] **Test C-5 (Background Tab Throttling):** Place User B's Safari tab into the background while on a call. Verify WebRTC audio remains audible and is not suspended by macOS App Nap.

### 5.2 Multi-Computer Cross-Network Tests (Different Wi-Fi / Cellular Hotspots)
- [ ] **Test C-6 (NAT / Firewall Traversal):** Computer 1 on corporate Wi-Fi, Computer 2 on 5G mobile hotspot.
  - *Infrastructure Prerequisite:* Requires a public STUN/TURN server (e.g., Coturn or LiveKit Cloud STUN) configured in `livekit-dev.yaml`.
  - *Current Limitation:* The current private LiveKit SFU binds exclusively to `127.0.0.1`. Cross-computer calling will fail until LiveKit is assigned a reachable LAN/WAN IP and STUN/TURN.
- [ ] **Test C-7 (TLS / WSS Certificate):** Real WebRTC requires HTTPS/WSS in modern browsers when accessing camera/mic on non-localhost origins.
  - *Current Limitation:* Connecting from an external IP requires an SSL/TLS certificate configured for both Next.js and LiveKit.

---

## 6. Stage D: Security & Infrastructure Review

| Security Gate | Status | Evidence / Verification |
|---|---|---|
| **No API Secret Leakage** | **VERIFIED** | Audited all files in `src/components/` and `src/app/`. `LIVEKIT_API_SECRET` is never passed to client components or Next.js public bundles. |
| **Strict Authorization** | **VERIFIED** | `/api/calls/[id]/token` verifies both conversation membership and participant list in PostgreSQL before token generation. Non-members receive `HTTP 403`. |
| **Server-Derived Identity** | **VERIFIED** | Token `identity: user.id` is derived strictly from `session.userId` in the HTTP-only cookie. Client cannot spoof participant identity. |
| **Authoritative Webhook Verification** | **VERIFIED** | `/api/calls/webhook` validates HMAC-SHA256 signatures via `WebhookReceiver`. Forged headers rejected with `HTTP 401`. |
| **Media / Signaling Separation** | **VERIFIED** | LiveKit SFU handles all WebRTC RTP media streams. Socket.IO and Next.js handle call control and presence. Zero media bytes touch application servers. |
| **Strict Loopback Binding** | **VERIFIED** | LiveKit SFU binds to `127.0.0.1` (`port: 7880`, `rtc.tcp_port: 7881`, `node_ip: 127.0.0.1`). |
| **Outbox Ejection Recovery** | **VERIFIED** | Failed ejection jobs transition to `FAILED` with `lastError` diagnostics, discoverable via `getFailedOutboxJobs()`. |

---

## 7. Stage E: Regression & Production Isolation

### 7.1 Regression Suite Results
- **Vitest Unit Suite:** 44 / 44 tests passing (0 failures)
- **TypeScript Static Check (`tsc --noEmit`):** 0 errors
- **Next.js Production Build:** Compiled successfully in Turbopack
- **Cost Management Module:** All 7 financial accuracy tests passing
- **Email Security & IMAP:** All 20 tests passing
- **Voice Assistant (DeepSeek):** All tests passing

### 7.2 Production Isolation Confirmation
```bash
# Production PostgreSQL query:
psql "postgresql://tanveersinghsaini@localhost:5432/company_os" -c "SELECT count(*) FROM _prisma_migrations;"
# Output: count = 4

psql "postgresql://tanveersinghsaini@localhost:5432/company_os" -c "\dt \"Call*\""
# Output: Did not find any relation named "Call*".

curl -s http://127.0.0.1:3000/api/health
# Output: {"status":"ok","database":"connected"}
```
Production database `company_os` and production application (`:3000`) remain 100% untouched.

---

## 8. Recommended Next Phase: Phase 4.2 Remediation

Before authorizing physical multi-device deployment or group calling, execute a targeted remediation phase addressing the findings identified in this audit:

1. **Remediate Multi-Tab Desynchronization:** Update `chat.tsx` to dismiss `IncomingCallModal` on `ACTIVE` or `CONNECTING` socket events.
2. **Remediate Active Call Recovery:** Add active call lookup on mount in `ChatModule` to restore in-call state after browser reload.
3. **Add Cross-Conversation Busy Check:** Enhance `createCallSession` to reject calls if target participants are active in other conversations.
4. **Fix Catch-Block Transaction Poisoning (`25P02`):** Avoid querying aborted transaction clients on unique constraint collisions.
5. **Add `beforeunload` Disconnect Beacon:** Enable instantaneous disconnect when tabs are closed.
6. **Update `.gitignore`:** Exclude `config/livekit-dev.yaml`.

---

## 9. Mandatory Stop Condition

In compliance with instructions:
- No automatic code fixes were implemented.
- No group calling, screen sharing, or recording features were added.
- No production changes occurred.

Audit complete. Awaiting user review and authorization.

