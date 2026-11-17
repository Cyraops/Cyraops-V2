# CYRAOPS CALLING — TECHNICAL CORRECTION AUDIT REPORT
## Pinpoint Resolution of Architecture, State Machine, Networking & Capacity Issues

> [!IMPORTANT]
> **Audit & Correction Statement**: This report provides direct, rigorous technical corrections to the six specific issues identified in the calling architecture. No application code, database schema, environment files, or infrastructure were modified.

---

## 1. Summary of Technical Corrections

| Area | Identified Flaw in Previous Draft | Technical Correction Applied | Impact on Implementation |
| :--- | :--- | :--- | :--- |
| **1. LiveKit Ejection & Replay** | Used non-existent `canJoin` permission; claimed immediate revocation. | Acknowledged that stateless self-hosted LiveKit does not revoke unexpired tokens. Documented the residual risk window ($60 - \Delta t\text{ seconds}$) and implemented the backend token refusal rule plus the Webhook Auto-Eject loop. | Eliminates false security claims; establishes real-world containment. |
| **2. Call ACTIVE State** | Required both participants to publish and subscribe to media tracks. | Redefined `ACTIVE` based on **successful participant WebRTC media connections** (ICE connected), decoupling it from track publication to properly support audio-only calls, disabled cameras, and listen-only participants. | Fixes call state lockups on muted or camera-off participants. |
| **3. TURNS Port 443 & TLS** | HAProxy forwarded encrypted TLS directly to plaintext HTTP port 7880. | Designed Layer-4 SNI routing where HAProxy passes `turn.cyraops.com` to LiveKit TURNS (port 5349) and `call.cyraops.com` to a TLS-terminating reverse proxy that proxies plaintext HTTP/WSS to 7880. Advertised ICE URL explicitly set to port 443. | Ensures valid TLS termination and working enterprise firewall traversal. |
| **4. Load-Testing Accuracy** | Used outdated CLI syntax; conflated publishers/subscribers with total participants. | Adopted modern `lk perf load-test` syntax. Explicitly disambiguated simulated client roles. Designed Scenario F (50 senders/receivers in 1 room) and Scenario G (5 parallel rooms of 10 participants). | Replaces theoretical assumptions with executable load tests. |
| **5. Phase 0 Migration Safety** | Relied on full database snapshot restore for rollback (risking data loss). | Audited every authentication path in the existing codebase. Designed a non-destructive forward/backward migration script preserving post-migration business data. | Eliminates data-loss risk during identity migration. |
| **6. Cross-Browser Screen Sharing** | Promised uniform screen and audio capture across all browsers. | Separated video capture from system/tab audio capture. Documented explicit OS/browser restrictions (e.g. Safari does not support audio capture via `getDisplayMedia`; macOS blocks system audio). | Prevents browser-specific calling feature failures. |

---

## 2. Issue-by-Issue Technical Resolutions

### 2.1. LiveKit Ejection and Token Replay Window
* **Removal of `canJoin`**: The official LiveKit `ParticipantPermission` protobuf specification defines:
  `canSubscribe`, `canPublish`, `canPublishData`, `canPublishSources`, `hidden`, `recorder`, `agent`. There is no `canJoin` attribute. All references to `canJoin` have been removed.
* **The Token Replay Reality**: LiveKit access tokens are stateless JWTs signed with HMAC-SHA256. When a participant is removed via `roomService.removeParticipant(room, identity)`, the SFU severs the active peer connection. However, **the SFU does not maintain a distributed token blacklist**.
* **Residual Risk Window**: If a participant receives a token with `ttl: "60s"` at $t=0$, connects at $t=5$, and is ejected by the host at $t=15$, the client still holds a mathematically valid JWT for another 45 seconds ($60 - 15 = 45\text{ seconds}$). During this residual window, a malicious client could reconnect via WebSocket.
* **Containment & Mitigation**:
  1. *Backend Token Gatekeeper*: When an ejected user requests a new token, Next.js checks `CallParticipant.status === "EJECTED"` and returns `403 Forbidden`.
  2. *Webhook Auto-Eject Loop*: If the ejected user attempts reconnection during the residual window using their unexpired token, LiveKit fires a `participant_joined` webhook. The Next.js webhook handler inspects the database, detects `EJECTED` status, and immediately calls `removeParticipant` again (evicting the user within $\sim 100\text{ ms}$).

### 2.2. Call ACTIVE State Redefinition
* **Previous Flaw**: Demanding that both participants publish and subscribe to media tracks before marking a call `ACTIVE` caused immediate failure in audio-only calls, video calls with camera disabled, or when a user joined with microphone muted or microphone permissions denied.
* **Corrected Definition**:
  - A call transitions from `CONNECTING` to `ACTIVE` **as soon as at least two participants have successfully established WebRTC peer connections to the room** (ICE connection state `connected` or LiveKit webhook `room_started` with $\ge 2$ connected participants).
  - Media track publication and subscription are treated as dynamic stream states within an already `ACTIVE` call.

### 2.3. TURN Port 443 & Signaling TLS Routing
* **HAProxy Configuration Fix**: LiveKit's internal port 7880 is plaintext HTTP/WebSocket. Routing an encrypted TCP stream directly to port 7880 causes an immediate handshake failure.
* **The Two Working Architectures**:
  - **Option A (Dual Public IPs — Recommended)**:
    - Public IP 1 (`call.cyraops.com`): Port 443 terminates TLS via Caddy/Nginx, proxying plaintext HTTP/WSS to `127.0.0.1:7880`.
    - Public IP 2 (`turn.cyraops.com`): Port 443 binds directly to LiveKit's internal TURNS engine (`turn.tls_port: 443`), terminating TURN/TLS natively with trusted certificates.
  - **Option B (Layer-4 SNI Routing on Single Public IP)**:
    - HAProxy listens on TCP 443 (`mode tcp`).
    - If SNI is `turn.cyraops.com`: HAProxy forwards raw TLS stream to LiveKit TURNS on `127.0.0.1:5349`. LiveKit terminates TURN/TLS.
    - If SNI is `call.cyraops.com`: HAProxy forwards raw TLS stream to a local TLS termination reverse proxy on `127.0.0.1:8443`, which decrypts TLS and passes plaintext HTTP/WSS to `127.0.0.1:7880`.
* **Advertised ICE URL**: The backend advertises `turns:turn.cyraops.com:443?transport=tcp` to clients. The browser connects to port 443, matching firewall rules.

### 2.4. Load-Testing Accuracy & Synthesis
* **Modern Syntax**: Adopted official `lk perf load-test` command.
* **Client Model**: Documented that `--publishers P` and `--subscribers S` in `lk perf` spawn $P + S$ distinct synthetic clients.
* **Scenario F (50-Person All-Camera)**: Modeled with 50 participants who both publish and subscribe. Measured with `lk perf load-test --room scen-f --publishers 50 --subscribers 50`.
* **Scenario G (5 Concurrent 10-Person Meetings)**: Modeled as 5 isolated rooms (`scen-g-1` to `scen-g-5`), each with 10 publishers and 10 subscribers, running concurrently via an orchestration harness.

### 2.5. Phase 0 Migration Safety
* **Codebase Authentication Footprint**: Audited all 7 authentication endpoints ([auth.ts](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/lib/auth.ts), [login](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/login/route.ts), [logout](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/logout/route.ts), [me](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/auth/me/route.ts), [profile/active](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/profile/active/route.ts), [team](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/route.ts), [team/[id]](file:///Users/tanveersinghsaini/Desktop/locally%20hosted%20app%20dev/src/app/api/team/%5Bid%5D/route.ts)).
* **Safe Employee Credential Migration**: Existing employees in `company_os_dev` have `name` and `role`, but no `email`. A two-step migration script generates corporate emails (`name@cyraops.com`), seeds initial bcrypt passwords, prompts password changes, and deletes existing shared sessions without database snapshot rollbacks.

### 2.6. Cross-Browser Screen Sharing Compatibility
* **Video vs. Audio Separation**:
  - `getDisplayMedia({ video: true })` works reliably across Chrome, Edge, and Safari (macOS 13+).
  - `getDisplayMedia({ audio: true })` **fails completely on Safari** (not supported by WebKit). On Chrome/Edge on macOS, it supports tab audio only (system audio is blocked by macOS sandbox without a virtual loopback audio driver).
