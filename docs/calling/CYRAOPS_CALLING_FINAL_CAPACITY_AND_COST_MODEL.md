# CYRAOPS CALLING — FINAL CAPACITY, LOAD-TESTING & BROWSER COMPATIBILITY MODEL
## Audited Bitrate Models · `lk perf` Syntax · Scenario F/G Disambiguation · OS & Browser Screen-Sharing Limits

> [!NOTE]
> **Methodology & Rigor**: All calculations in this document are audited against WebRTC protocol framing and official LiveKit server documentation. Every metric is categorized as `ENGINEERING ESTIMATE` or `OFFICIAL VENDOR GUIDANCE`. No theoretical calculations are presented as completed benchmarks.

---

## 1. Audited Workload Modeling (Scenarios A through G)

All calculations assume Opus audio ($40\text{ kbps}$), 720p VP8/H.264 video with 3-tier simulcast ($2.19\text{ Mbps}$ per video sender), and active LiveKit Dynacast:

| Scenario | Description | Senders / Receivers | Ingress (Mbps) | Egress (Mbps) | CPU (vCPU) | RAM (GB) | 20h Egress | 50h Egress | 100h Egress | Feasibility on 4 vCPU VM |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A: 1-on-1 Call** | 2 peers with video & mic | 2 senders / 2 receivers | 3.08 | 3.08 | 0.05–0.1 | 0.05 | 27.7 GB | 69.3 GB | 138.6 GB | Minimal load ($< 5\%$) |
| **B: 5-Person Call** | 1 speaker, 4 thumbs | 5 senders / 5 receivers | 10.95 | 10.55 | 0.2–0.4 | 0.15 | 95.0 GB | 237.4 GB | 474.8 GB | Low load ($< 10\%$) |
| **C: 10-Person Call** | 1 speaker, 8 thumbs | 10 senders / 10 receivers | 21.90 | 30.60 | 0.6–0.8 | 0.35 | 275.4 GB | 688.5 GB | 1.38 TB | Standard ($< 25\%$) |
| **D: 20-Person Call** | Dynacast (6 visible) | 20 senders / 20 receivers | 43.80 | 60.20 | 1.2–1.6 | 0.80 | 541.8 GB | 1.35 TB | 2.71 TB | Moderate ($< 45\%$) |
| **E: 50-Person Townhall**| 2 speakers, 48 view-only | 2 senders / 50 receivers | 3.08 | 154.00 | 1.5–2.0 | 1.20 | 1.39 TB | 3.47 TB | 6.93 TB | Egress heavy ($< 50\%$) |
| **F: 50-Person All-Cam** | Dynacast (9 visible) | 50 senders / 50 receivers | 109.50 | 233.00 | 3.0–3.6 | 2.80 | 2.10 TB | 5.24 TB | 10.49 TB | Near 4 vCPU limit |
| **G: 5x10-Person Calls**| 5 rooms of 10 users | 50 senders / 50 receivers | 109.50 | 153.00 | 2.5–3.0 | 2.00 | 1.38 TB | 3.44 TB | 6.89 TB | Balanced ($< 70\%$) |

---

## 2. Load-Testing Specifications & `lk perf` Syntax

### 2.1. Parameter Semantics in LiveKit CLI (`lk`)
In the official LiveKit CLI tool (`lk`), the command syntax is:
```bash
lk perf load-test --url <WS_URL> --api-key <KEY> --api-secret <SECRET> [flags]
```
* **Critical Clarification**: The flags `--publishers P` and `--subscribers S` **spawn $P + S$ separate simulated clients**:
  - `--publishers P`: Creates $P$ distinct headless WebRTC clients that only publish audio/video tracks.
  - `--subscribers S`: Creates $S$ distinct headless WebRTC clients that only subscribe to tracks.
  - Therefore, passing `--publishers 50 --subscribers 50` creates **100 simulated clients** (50 senders and 50 receivers), creating identical packet traffic to a 50-person full-duplex meeting!

### 2.2. Scenario F Load-Test Design (Single 50-Person Meeting)
To stress-test the SFU with 50 simultaneous video/audio participants in a single room:
```bash
# Execute on a separate load-generator VM in the same cloud region
lk perf load-test \
  --url wss://call-dev.cyraops.com \
  --api-key <DEV_KEY> \
  --api-secret <DEV_SECRET> \
  --room scenario-f-room \
  --publishers 50 \
  --subscribers 50 \
  --video-resolution 720p \
  --simulcast \
  --duration 10m
```
* **Target Measurements**: Monitor host CPU via Prometheus on port 6789. If CPU exceeds $80\%$, flag production sizing for an 8 vCPU instance.

### 2.3. Scenario G Load-Test Design (Five Concurrent 10-Person Meetings)
To test cross-room isolation and multi-room scheduler performance:
```bash
#!/usr/bin/env bash
# Coordinated multi-room test harness
for i in {1..5}; do
  lk perf load-test \
    --url wss://call-dev.cyraops.com \
    --api-key <DEV_KEY> \
    --api-secret <DEV_SECRET> \
    --room "scenario-g-room-$i" \
    --publishers 10 \
    --subscribers 10 \
    --video-resolution 720p \
    --simulcast \
    --duration 10m &
done
wait
```

### 2.4. Synthetic vs. Real-Browser Testing
* **Synthetic (`lk perf`)**: Measures raw Go scheduler, network interface saturation, UDP buffer drops, and SFU CPU load. Does **not** render DOM elements, execute JavaScript UI code, or run browser audio echo cancellation.
* **Real-Browser E2E Testing**: Executed via Playwright Chromium/WebKit instances to measure actual WebAssembly/WebCodecs decoding latency, hardware acceleration, and UI rendering performance.

---

## 3. Cross-Browser & Cross-OS Screen Sharing Compatibility Matrix

Capturing screen video is fundamentally distinct from capturing system or application audio:

| Operating System | Browser | Screen Video (`getDisplayMedia`) | System Audio Capture | Tab / App Audio Capture | Technical Limitation / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Windows 10/11** | **Google Chrome** | Full (Screen, Window, Tab) | Supported | Supported | Full native Chromium support. |
| **Windows 10/11** | **Microsoft Edge** | Full (Screen, Window, Tab) | Supported | Supported | Full native Chromium support. |
| **Windows 10/11** | **Mozilla Firefox** | Full (Screen, Window) | Not Supported | Experimental | Audio capture restricted to tab. |
| **macOS** | **Google Chrome** | Full (Screen, Window, Tab) | **NOT SUPPORTED** | Supported (Tab only) | macOS sandbox blocks system audio without a virtual loopback kernel driver (e.g. BlackHole). |
| **macOS** | **Microsoft Edge** | Full (Screen, Window, Tab) | **NOT SUPPORTED** | Supported (Tab only) | Identical Chromium macOS sandbox restriction. |
| **macOS** | **Apple Safari** | Screen & Window Only | **NOT SUPPORTED** | **NOT SUPPORTED** | **WebKit does not support audio capture via `getDisplayMedia`**. Tab sharing not supported. |
| **macOS** | **Mozilla Firefox** | Screen & Window Only | **NOT SUPPORTED** | **NOT SUPPORTED** | macOS system audio blocked. |
| **iOS (iPhone/iPad)**| **Safari / Chrome** | **NOT SUPPORTED** | **NOT SUPPORTED** | **NOT SUPPORTED** | `getDisplayMedia` is disabled in mobile WebKit. Requires native OS broadcast extensions. |
| **Android** | **Chrome** | Full Screen Only | **NOT SUPPORTED** | **NOT SUPPORTED** | Captures device display only; system audio is blocked by Android security policy. |

> [!IMPORTANT]
> **Engineering Invariant**: The Cyraops UI must never promise system audio sharing on macOS or Safari. The screen sharing modal must detect the browser/OS environment:
> - On **Safari**: The "Share Audio" checkbox is hidden or disabled with a tooltip: *"Audio sharing is not supported by Safari"*.
> - On **macOS (Chrome/Edge)**: The tooltip clarifies: *"Audio sharing is limited to Chrome browser tabs on macOS"*.
