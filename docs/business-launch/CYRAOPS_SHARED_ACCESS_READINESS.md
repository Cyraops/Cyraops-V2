# CYRAOPS — SHARED ACCESS & REMOTE COLLABORATION ARCHITECTURE
## Secure, Low-Cost Two-Collaborator Infrastructure Guide

**Document Status:** Production Ready  
**Application:** Cyraops Company Operating System  
**Version:** 1.0 (Business Launch MVP)  
**Target Architecture:** 2 Collaborators (Owner & Technical Lead)  
**Host Architecture:** Local Mac Server (Development Port 3001, Production Port 3000)

---

## 1. Executive Summary

Cyraops is architected to operate on a local machine while providing private, authenticated, multi-user collaboration between two core operators:
1. **Workspace Owner (Founder / Business Lead):** Manages client inquiries, sales pipeline, proposal issuance, commercial negotiations, and invoice tracking.
2. **Technical Lead (DevOps & Delivery Lead):** Manages cloud architecture, delivery milestones, engineering tasks, git repositories, and client closeouts.

To avoid expensive cloud hosting costs during company inception while maintaining strict enterprise security, this guide details practical, low-cost (free-tier eligible) remote access patterns that require **zero port-forwarding** and prevent public internet database exposure.

---

## 2. Remote Access Architecture Comparison

| Architecture | Setup Complexity | Monthly Cost | Security Level | Best Fit Scenario |
| :--- | :--- | :--- | :--- | :--- |
| **Option 1: Private LAN (Same Wi-Fi)** | Instant (< 1 min) | \$0 | High (Network bounded) | Same-room or local office collaboration |
| **Option 2: Tailscale WireGuard Mesh** | Minimal (5 mins) | \$0 (Free for <= 3 users) | **Maximum** (Zero attack surface) | **Recommended for 2 Collaborators** |
| **Option 3: Cloudflare Tunnel (`cloudflared`)** | Low (10 mins) | \$0 (Free tier) | High (Zero-Trust edge + TLS) | Recommended if public HTTPS domain needed |
| **Option 4: Ngrok / LocalXpose** | Minimal | Free (Ephemeral URLs) | Moderate | Temporary external client demos only |

---

## 3. Recommended Approach: Tailscale Mesh VPN (Option 2)

### Why Tailscale is the Primary Recommendation
- **Zero Attack Surface:** The application port (`3001` or `3000`) and PostgreSQL database (`5432`) are **never exposed to the public internet**.
- **Peer-to-Peer WireGuard:** Traffic is end-to-end encrypted directly between the host Mac and the collaborator's device.
- **Fixed Private MagicDNS Names:** The host machine receives a stable DNS hostname (e.g. `http://tanveer-macbook.tailnet-xyz.ts.net:3001`), eliminating dynamic IP hassles.
- **Zero Configuration:** Works seamlessly across home Wi-Fi, mobile hotspots, and corporate NATs without router port-forwarding.

### Step-by-Step Setup Instructions

#### Step 1: Install Tailscale on the Host Machine
1. Download Tailscale on the Mac host from [tailscale.com](https://tailscale.com) or via Homebrew:
   ```bash
   brew install tailscale
   sudo tailscale up
   ```
2. Log in with Google/GitHub and enable **MagicDNS**.
3. Note the host device Tailscale IP (e.g., `100.x.y.z`) and MagicDNS name.

#### Step 2: Install Tailscale on Collaborator's Laptop
1. Collaborator installs Tailscale and joins the same Tailscale network (tailnet) via invitation.
2. Verify connectivity:
   ```bash
   tailscale ping 100.x.y.z
   ```

#### Step 3: Configure Application Environment
In `/Users/tanveersinghsaini/Desktop/locally hosted app dev/.env`:
```ini
# Canonical base URL for Tailscale
APP_URL="http://tanveer-macbook.tailnet-xyz.ts.net:3001"
```
Collaborator B opens `http://tanveer-macbook.tailnet-xyz.ts.net:3001` in their browser and logs in with their individual account credentials.

---

## 4. Alternative Approach: Cloudflare Tunnel (Option 3)

If the team desires a clean HTTPS domain (e.g. `https://ops.cyraops.com`) without requiring Tailscale client installation on the second device:

### Architecture
- `cloudflared` runs as a daemon on the host Mac.
- An outbound TLS connection is established to Cloudflare's edge network.
- Requests to `ops.cyraops.com` are proxied through Cloudflare to `localhost:3001`.
- **Zero firewall ports opened on the local router.**

### Step-by-Step Setup Instructions
1. Install Cloudflare Daemon:
   ```bash
   brew install cloudflared
   ```
2. Authenticate with Cloudflare:
   ```bash
   cloudflared tunnel login
   ```
3. Create the secure tunnel:
   ```bash
   cloudflared tunnel create cyraops-dev
   ```
4. Create the routing configuration (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: <TUNNEL_UUID>
   credentials-file: ~/.cloudflared/<TUNNEL_UUID>.json

   ingress:
     - hostname: ops.cyraops.com
       service: http://localhost:3001
     - service: http_status:404
   ```
5. Route DNS:
   ```bash
   cloudflared tunnel route dns cyraops-dev ops.cyraops.com
   ```
6. Run as background service:
   ```bash
   brew services start cloudflared
   ```
7. **Cloudflare Zero Trust Access Rule:** In the Cloudflare Zero Trust dashboard, protect `ops.cyraops.com` with a One-Time PIN (OTP) email policy allowing only `@cyraops.com` addresses.

---

## 5. Security & Isolation Controls

1. **Strict Role-Based Access Control (RBAC):**
   - Founder/Owner retains the `OWNER` role (workspace settings, user creation, deletion, banking setup).
   - Technical Lead holds the `MEMBER` role (project execution, task delivery, milestone updates).
   - Server-side guards prevent non-admin members from modifying financial accounts payable, archiving companies, or altering others' sales deals.

2. **Session Isolation & Token Security:**
   - Sessions are bound to 64-character cryptographically secure token hashes (`tokenHash` in PostgreSQL).
   - HTTP-only, `SameSite=Lax` cookies prevent token extraction via XSS.
   - When a user changes their password, all active sessions for that account are invalidated immediately.

3. **CSRF & Origin Verification:**
   - All state-mutating requests (`POST`, `PATCH`, `DELETE`) require `sameOrigin` verification against the incoming request headers (`origin`, `referer`, `host`, `sec-fetch-site`).

---

## 6. Automated Backup & Disaster Recovery Routine

Because the application runs locally, automated database snapshots are mandatory to prevent data loss.

### 1. Daily Automated Database Backup Script
A backup script is established at `scripts/backup-db.sh`:
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/Users/tanveersinghsaini/Desktop/locally hosted app dev/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/company_os_dev_${TIMESTAMP}.sql"

mkdir -p "${BACKUP_DIR}"

# Dump database
PGDATABASE=company_os_dev pg_dump -F c -b -v -f "${BACKUP_FILE}"

# Keep last 14 days of backups; delete older
find "${BACKUP_DIR}" -name "company_os_dev_*.sql" -mtime +14 -delete

echo "[$(date)] Backup completed: ${BACKUP_FILE}"
```

### 2. Cron Schedule
Add to `crontab -e`:
```cron
# Run backup daily at 02:00 AM
0 2 * * * /Users/tanveersinghsaini/Desktop/locally\ hosted\ app\ dev/scripts/backup-db.sh >> /Users/tanveersinghsaini/Desktop/locally\ hosted\ app\ dev/backups/backup.log 2>&1
```

### 3. Off-Site Storage
For complete disaster recovery, sync `/backups` to an encrypted AWS S3 bucket using the AWS CLI or Cloudflare R2:
```bash
aws s3 sync /Users/tanveersinghsaini/Desktop/locally\ hosted\ app\ dev/backups s3://cyraops-internal-backups/dev/ --storage-class GLACIER_IR
```

