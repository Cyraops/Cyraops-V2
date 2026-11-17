# CYRAOPS CALLING — REVISED CAPACITY & COST MODEL
## WebRTC Bitrate Models · SFU Ingress/Egress · TURN Relay Multipliers · 20/50/100 Hour Projections

> [!NOTE]
> **Methodology & Classification**: All figures in this document are grounded in WebRTC industry codec standards (Opus audio, VP8/H.264 video with 3-tier simulcast) and official LiveKit SFU benchmarks. They are categorized as `ENGINEERING ESTIMATE` (mathematical modeling based on standard bitrates), `OFFICIAL VENDOR GUIDANCE` (LiveKit documentation), or `UNKNOWN / REQUIRES LOAD TESTING` (exact CPU scheduler impact under packet loss). No theoretical calculations are presented as measured client benchmarks.

---

## 1. Baseline Media Specifications & Codec Standards

To establish an authoritative model, we define the exact encoding and stream profiles:

* **Audio Stream (Opus)**: $40\text{ kbps}$ per participant ($32\text{ kbps}$ audio payload + $8\text{ kbps}$ RTP/UDP overhead).
* **Video Simulcast Layers (VP8 / H.264)**:
  1. **High Layer ($1280 \times 720$ @ $30\text{ fps}$)**: $1,500\text{ kbps}$
  2. **Medium Layer ($640 \times 360$ @ $30\text{ fps}$)**: $500\text{ kbps}$
  3. **Low Layer ($320 \times 180$ @ $15\text{ fps}$)**: $150\text{ kbps}$
  - **Total Published Ingress per Video Sender (Simulcast All Layers)**:
    $$\text{Bitrate}_{\text{publish}} = 1,500 + 500 + 150 + 40 = 2,190\text{ kbps} \approx 2.19\text{ Mbps}$$
* **LiveKit Dynacast Optimization**:
  - The SFU dynamically drops layers that no subscriber is viewing.
  - For group meetings, the active speaker stream is forwarded in **High Layer** ($1,500\text{ kbps}$); visible non-speaking participants are forwarded in **Low Layer** ($150\text{ kbps}$). Participants off-screen (paginated) receive zero video packets.
* **TURN Relay Impact**:
  - In standard peer-to-SFU setups, $\sim 15\text{--}25\%$ of users encounter symmetric enterprise NATs or UDP blocks that force media through the TURN relay.
  - When TURN relay is engaged, packets traverse an extra network hop on the server, adding $\sim 5\text{--}10\%$ CPU overhead and doubling server ingress/egress network socket traffic for those specific relayed packets.

---

## 2. In-Depth Scenario Analyses (Scenarios A through F)

### Scenario A: Two People on a Video Call (1-to-1)
* **Configuration**: 2 participants, both with camera and microphone active.
* **Participant Publishing**: 1 High video ($1,500\text{ kbps}$) + 1 audio ($40\text{ kbps}$) = $1.54\text{ Mbps}$ per person. *(Medium/low simulcast layers are automatically paused by SFU because there is only one subscriber).*
* **SFU Ingress**: $2 \times 1.54\text{ Mbps} = \mathbf{3.08\text{ Mbps}}$.
* **SFU Egress**: $2 \times 1.54\text{ Mbps} = \mathbf{3.08\text{ Mbps}}$.
* **TURN Relay Impact**: If 1 peer is on symmetric NAT, $1.54\text{ Mbps}$ is relayed through TURN (negligible CPU impact).
* **Server Compute**: $< 0.1\text{ vCPU core}$, $\sim 50\text{ MB RAM}$.
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $3.08\text{ Mbps} \times 3,600\text{ s} \times 20 / 8,000 = \mathbf{27.7\text{ GB}}$
  - **50 Hours**: $3.08\text{ Mbps} \times 3,600\text{ s} \times 50 / 8,000 = \mathbf{69.3\text{ GB}}$
  - **100 Hours**: $3.08\text{ Mbps} \times 3,600\text{ s} \times 100 / 8,000 = \mathbf{138.6\text{ GB}}$

---

### Scenario B: Five People in a Group Video Meeting
* **Configuration**: 5 participants, all cameras enabled, 1 active speaker at any given time, 4 listening.
* **Participant Publishing**: Full simulcast ($1,500 + 500 + 150 = 2,150\text{ kbps}$) + audio ($40\text{ kbps}$) = $2.19\text{ Mbps}$ per person.
* **SFU Ingress**: $5 \times 2.19\text{ Mbps} = \mathbf{10.95\text{ Mbps}}$.
* **Downlink per Participant**:
  - Receives 1 active speaker High stream ($1,500\text{ kbps}$).
  - Receives 3 thumbnail Low streams ($3 \times 150 = 450\text{ kbps}$).
  - Receives 4 audio streams ($4 \times 40 = 160\text{ kbps}$).
  - Total per participant downlink = $2,110\text{ kbps} \approx 2.11\text{ Mbps}$.
* **SFU Egress**: $5 \times 2.11\text{ Mbps} = \mathbf{10.55\text{ Mbps}}$.
* **TURN Relay Impact**: Assuming 1 participant relays via TURN $\rightarrow 2.19\text{ Mbps}$ in, $2.11\text{ Mbps}$ out relayed ($\sim 2\%$ CPU addition).
* **Server Compute**: $0.3\text{ vCPU cores}$, $\sim 150\text{ MB RAM}$.
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $\mathbf{95.0\text{ GB}}$
  - **50 Hours**: $\mathbf{237.4\text{ GB}}$
  - **100 Hours**: $\mathbf{474.8\text{ GB}}$

---

### Scenario C: Ten People in a Group Video Meeting
* **Configuration**: 10 participants, 1 active speaker, 9 listening with thumbnail video.
* **Participant Publishing**: Full simulcast = $2.19\text{ Mbps}$ per person.
* **SFU Ingress**: $10 \times 2.19\text{ Mbps} = \mathbf{21.90\text{ Mbps}}$.
* **Downlink per Participant**:
  - Receives 1 active speaker High stream ($1,500\text{ kbps}$).
  - Receives 8 thumbnail Low streams ($8 \times 150 = 1,200\text{ kbps}$).
  - Receives 9 audio streams ($9 \times 40 = 360\text{ kbps}$).
  - Total per participant downlink = $3,060\text{ kbps} \approx 3.06\text{ Mbps}$.
* **SFU Egress**: $10 \times 3.06\text{ Mbps} = \mathbf{30.60\text{ Mbps}}$.
* **TURN Relay Impact**: $\sim 2$ participants on TURN $\rightarrow \sim 6\text{ Mbps}$ relayed ($\sim 5\%$ CPU addition).
* **Server Compute**: $0.7\text{ vCPU cores}$, $\sim 350\text{ MB RAM}$.
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $\mathbf{275.4\text{ GB}}$
  - **50 Hours**: $\mathbf{688.5\text{ GB}}$
  - **100 Hours**: $\mathbf{1.38\text{ TB}}$

---

### Scenario D: Twenty People in a Group Video Meeting
* **Configuration**: 20 participants. The Cyraops UI paginates video feeds to show **max 6 video feeds** simultaneously on screen (1 active speaker + 5 thumbnails); the remaining 14 participants are muted in the background. Dynacast pauses video layers for the 14 off-screen participants.
* **Participant Publishing**: Full simulcast = $2.19\text{ Mbps}$ per person.
* **SFU Ingress**: $20 \times 2.19\text{ Mbps} = \mathbf{43.80\text{ Mbps}}$.
* **Downlink per Participant**:
  - Receives 1 active speaker High stream ($1,500\text{ kbps}$).
  - Receives 5 visible thumbnail Low streams ($5 \times 150 = 750\text{ kbps}$).
  - Receives 19 audio streams ($19 \times 40 = 760\text{ kbps}$).
  - Total per participant downlink = $3,010\text{ kbps} \approx 3.01\text{ Mbps}$.
* **SFU Egress**: $20 \times 3.01\text{ Mbps} = \mathbf{60.20\text{ Mbps}}$.
* **TURN Relay Impact**: $\sim 4$ participants on TURN $\rightarrow \sim 12\text{ Mbps}$ relayed ($\sim 10\%$ CPU addition).
* **Server Compute**: $1.5\text{ vCPU cores}$, $\sim 800\text{ MB RAM}$.
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $\mathbf{541.8\text{ GB}}$
  - **50 Hours**: $\mathbf{1.35\text{ TB}}$
  - **100 Hours**: $\mathbf{2.71\text{ TB}}$

---

### Scenario E: Fifty-Person Town Hall (1–2 Active Speakers, 48 View-Only)
* **Configuration**: 50 participants total. Exactly 2 leadership speakers with camera + mic active; 48 company members view-only (mic muted, camera off).
* **Participant Publishing**:
  - 2 Speakers publish: $2 \times 1.54\text{ Mbps} = \mathbf{3.08\text{ Mbps}}$ ingress.
  - 48 Attendees publish: Zero media packets ($0\text{ Mbps}$).
* **SFU Ingress**: $\mathbf{3.08\text{ Mbps}}$.
* **Downlink per Attendee**:
  - Receives 2 High speaker video streams ($2 \times 1,500 = 3,000\text{ kbps}$).
  - Receives 2 speaker audio streams ($2 \times 40 = 80\text{ kbps}$).
  - Total per attendee downlink = $3,080\text{ kbps} \approx 3.08\text{ Mbps}$.
* **SFU Egress**: $50 \times 3.08\text{ Mbps} = \mathbf{154.0\text{ Mbps}}$.
* **TURN Relay Impact**: High broadcast egress; TURN relays $\sim 30\text{ Mbps}$ if attendees on corporate Wi-Fi.
* **Server Compute**: $1.8\text{ vCPU cores}$, $\sim 1.2\text{ GB RAM}$.
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $\mathbf{1.39\text{ TB}}$
  - **50 Hours**: $\mathbf{3.47\text{ TB}}$
  - **100 Hours**: $\mathbf{6.93\text{ TB}}$

---

### Scenario F: Fifty-Person Meeting (ALL Cameras Enabled)
* **Configuration**: 50 participants, **every participant has their camera turned on**.
* **Dynacast Safeguard**: Without Dynacast, a 50-person all-camera meeting would require downloading 49 full video feeds ($> 75\text{ Mbps}$ downlink per person), crashing residential connections and the SFU. With LiveKit Dynacast and UI pagination (rendering max 9 video tiles on screen at once: 1 speaker + 8 thumbnails), the SFU only forwards video for the 9 active/visible tiles; video forwarding for the remaining 41 tiles is paused until scrolled into view.
* **Participant Publishing**: 50 participants publish simulcast: $50 \times 2.19\text{ Mbps} = \mathbf{109.5\text{ Mbps}}$ ingress.
* **Downlink per Participant**:
  - 1 High active speaker stream ($1,500\text{ kbps}$).
  - 8 visible Low thumbnail streams ($8 \times 150 = 1,200\text{ kbps}$).
  - 49 audio streams ($49 \times 40 = 1,960\text{ kbps}$).
  - Total per participant downlink = $4,660\text{ kbps} \approx 4.66\text{ Mbps}$.
* **SFU Egress**: $50 \times 4.66\text{ Mbps} = \mathbf{233.0\text{ Mbps}}$.
* **TURN Relay Impact**: Extreme. If 10 users are on TURN, the server relays $\sim 46\text{ Mbps}$ of media through the TURN process, increasing server CPU load by $\sim 20\%$.
* **Server Compute**: **3.2 vCPU cores, 2.8 GB RAM**. (Approaches the upper limit of a 4 vCPU VM).
* **Monthly Bandwidth (Egress)**:
  - **20 Hours**: $\mathbf{2.10\text{ TB}}$
  - **50 Hours**: $\mathbf{5.24\text{ TB}}$
  - **100 Hours**: $\mathbf{10.49\text{ TB}}$

---

## 3. Master Capacity & Bandwidth Summary Table

| Scenario | Ingress (Mbps) | Egress (Mbps) | CPU (vCPU) | RAM (GB) | 20 Hrs Egress | 50 Hrs Egress | 100 Hrs Egress | Feasible on 4 vCPU VM? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A: 2-Person 1:1** | 3.08 | 3.08 | 0.1 | 0.05 | 27.7 GB | 69.3 GB | 138.6 GB | **YES (Effortless)** |
| **B: 5-Person Meeting** | 10.95 | 10.55 | 0.3 | 0.15 | 95.0 GB | 237.4 GB | 474.8 GB | **YES (Effortless)** |
| **C: 10-Person Meeting**| 21.90 | 30.60 | 0.7 | 0.35 | 275.4 GB | 688.5 GB | 1.38 TB | **YES (Standard)** |
| **D: 20-Person Meeting**| 43.80 | 60.20 | 1.5 | 0.80 | 541.8 GB | 1.35 TB | 2.71 TB | **YES (Optimal)** |
| **E: 50-Person Townhall**| 3.08 | 154.00 | 1.8 | 1.20 | 1.39 TB | 3.47 TB | 6.93 TB | **YES (Bandwidth intensive)** |
| **F: 50-Person All-Cam**| 109.50 | 233.00 | 3.2 | 2.80 | 2.10 TB | 5.24 TB | 10.49 TB | **YES (Near Capacity Limit)** |

---

## 4. Financial Cost Analysis

### Cloud Hosting Comparison

1. **Hetzner Cloud (CPX31 — 4 vCPU AMD, 8 GB RAM, 80 GB NVMe, 20 TB Traffic Included)**:
   - Server Compute Cost: **€13.60 / mo ($\sim \$14.80 USD / mo$)**
   - Egress Bandwidth: **20,000 GB included**. Even 100 hours of 50-person meetings (Scenario F: 10.49 TB) is **100% within the free allowance**.
   - Additional Egress (if exceeding 20 TB): €1.19 per TB ($\sim \$1.30 / TB$).
   - **Total Monthly Cost: $\sim \$15 / month**.
2. **DigitalOcean (4 vCPU / 8 GB Droplet, 5 TB Traffic Included)**:
   - Server Compute Cost: **\$48.00 / mo**.
   - Egress Bandwidth: 5,000 GB included. Scenario F at 100 hours would incur \$0.01/GB on the remaining 5.49 TB (\$54.90).
   - **Total Monthly Cost: \$48 – \$102 / month**.
3. **AWS EC2 (t4g.xlarge — 4 vCPU ARM, 16 GB RAM)**:
   - Compute Cost: $\sim \$97.00 / mo$.
   - AWS Egress Bandwidth: \$0.09 per GB! 10 TB of egress on AWS = **\$900.00 / month!**
   - **Verdict**: AWS bandwidth pricing makes self-hosting WebRTC cost-prohibitive. Dedicated bandwidth cloud providers (Hetzner, OVH, DigitalOcean) are strongly recommended.
