# Cyraops — cost stop / restart runbook

Use this to bring the stack back exactly as it was after a billing pause.

Recorded **2026-11-11** before stopping.

## What was running

| Component | Resource | Group | Config |
|---|---|---|---|
| App | `cyraops-prod-app` | `cyraops-prod` | image `cyraopsacr569002.azurecr.io/cyraops:fixall-11110118`, min 1 / max 1 replica, 0.5 vCPU / 1 GiB |
| Database | `cyraops-pg-si-569002` | `cyraops-prod` | PostgreSQL 17, `Standard_B1ms` Burstable, 32 GB |
| Browser VM | `cyraops-computer-vm` | `cyraops-computer` | `Standard_D2as_v4`, public IP `104.211.88.208`, container `computer` on :8787 |
| Registry | `cyraopsacr569002` | — | holds all app images |
| Storage | `cyraopsfiles569002si` | `cyraops-prod` | `uploads` share, mounted at `/app/uploads` |

Domain: `www.cyraops.com` (Cloudflare → Container App ingress).

App env vars and secrets are unchanged by a stop — they live on the container app
itself (`AI_PROVIDER`, `DEEPSEEK_*`, `COMPUTER_SERVICE_*`, `TZ`, `DATABASE_URL`,
`GODADDY_*`, `STORAGE_PATH`, `AI_KEY_ENCRYPTION_SECRET`).

## STOP (what was done)

`--max-replicas 0` is rejected by Container Apps, so the stop is: allow
scale-to-zero, then deactivate every revision. With no active revision nothing
runs and nothing is billed for compute.

```bash
# 1. App: allow zero replicas, then deactivate the revisions
az containerapp update --name cyraops-prod-app --resource-group cyraops-prod \
  --min-replicas 0
az containerapp revision list --name cyraops-prod-app --resource-group cyraops-prod \
  --query "[?properties.active].name" -o tsv | while read -r rev; do
  az containerapp revision deactivate --name cyraops-prod-app \
    --resource-group cyraops-prod --revision "$rev"
done

# 2. Database: stop compute (storage still billed)
az postgres flexible-server stop --name cyraops-pg-si-569002 --resource-group cyraops-prod

# 3. Browser VM: deallocate so compute billing stops (disk still billed)
az vm deallocate --name cyraops-computer-vm --resource-group cyraops-computer
```

### Things to know while stopped

- **Postgres auto-restarts after 7 days.** Azure stops a stopped flexible server
  and starts it again automatically. Re-stop it if the pause lasts longer, or
  check `state` with `az postgres flexible-server show`.
- Cloudflare still points at the Container App; with 0 replicas the site returns
  an error page rather than being "off". Acceptable for a pause.
- Still billed while stopped: managed disks, Postgres storage (32 GB), the
  static public IP, the ACR registry. Nothing else.

## START (in this order)

```bash
# 1. Database first — the app runs `prisma migrate deploy` on boot and needs it.
az postgres flexible-server start --name cyraops-pg-si-569002 --resource-group cyraops-prod

# 2. App: reactivate the last revision and go back to one always-on replica
az containerapp revision activate --name cyraops-prod-app \
  --resource-group cyraops-prod --revision cyraops-prod-app--<revision>
az containerapp update --name cyraops-prod-app --resource-group cyraops-prod \
  --min-replicas 1 --max-replicas 1
# (Deploying a new image also creates an active revision, which reactivates ingress.)

# 3. Browser VM (only needed for computer-use features)
az vm start --name cyraops-computer-vm --resource-group cyraops-computer

# 4. Restart the computer container inside the VM (deallocation stops it)
az vm run-command invoke --name cyraops-computer-vm --resource-group cyraops-computer \
  --command-id RunShellScript --scripts "sudo docker start computer || sudo docker run -d --name computer --restart unless-stopped -p 8787:8787 --env COMPUTER_TOKEN=\$(sudo cat /opt/computer/token) cyraops-computer:3"
```

## Verify

```bash
curl -s https://www.cyraops.com/api/health           # {"status":"ok","database":"connected"}
az containerapp revision list --name cyraops-prod-app --resource-group cyraops-prod \
  --query "[?properties.active].{name:name,health:properties.healthState}" -o table
```

Expected: one active revision, `Healthy`, and `/api/health` reporting the database
connected.

## Deploying again

```bash
npm run build
az acr build --registry cyraopsacr569002 --image "cyraops:<tag>" --file Dockerfile .
az containerapp update --name cyraops-prod-app --resource-group cyraops-prod \
  --image "cyraopsacr569002.azurecr.io/cyraops:<tag>" --revision-suffix "<suffix>"
```

---

# Always-on landing + on-demand CRM (added after this runbook)

The marketing page and the CRM are now meant to live in different places, because
the landing page must never sleep while the CRM should not bill while idle.

## Components

| Piece | What it is | Cost |
|---|---|---|
| `cyraops-marketing` (Static Web App, Free) | Always-on marketing page + the `/crm` control page | ~$0 |
| `cyraops-power` (Function App, Consumption) | The only thing that flips the CRM on/off | ~$0 (free grant) |
| `cyraops-prod-app` (Container App) | The CRM itself, `minReplicas` 0 = on demand | only while awake |
| Service principal `cyraops-crm-power` | Contributor on *only* the container app | n/a |

Marketing URL: `https://wonderful-river-0e4512f00.8.azurestaticapps.net`
Gate page: `/crm` (button for on/off, PIN protected)
Power API: `https://cyraops-power.azurewebsites.net/api/power`

The PIN lives in the Function App setting `POWER_PIN`. Rotate it there.

## Turn the CRM on / off

UI: open `/crm` on the static host and use the buttons.
API:

```bash
curl -s -X POST https://cyraops-power.azurewebsites.net/api/power \
  -H "Content-Type: text/plain" \
  -d '{"action":"off","pin":"<POWER_PIN>"}'      # or "on"
curl -s https://cyraops-power.azurewebsites.net/api/power   # current state
```

Notes learned the hard way:
- ARM **echoes the pre-patch state**, and the change takes ~20s to settle, so the
  function polls before replying.
- Container Apps rejects a bare `scale` patch and also rejects the read-only
  `cooldownPeriod` / `pollingInterval` fields that GET returns, so the function
  sends the whole writable `template`.
- Rapid toggles hit `409 ContainerAppOperationInProgress`; the function retries.

## Rebuild and redeploy the marketing site

```bash
cd marketing-source && VITE_CMS_URL=/crm npm run build && cd ..
cp -R marketing-source/dist/. marketing-deploy/
# marketing-deploy/crm/index.html is the hand-written gate page - do not overwrite it
cp marketing-deploy/staticwebapp.config.json marketing-source/public/staticwebapp.config.json
SWA_TOKEN=$(az staticwebapp secrets list --name cyraops-marketing \
  --resource-group cyraops-prod --query "properties.apiKey" -o tsv)
npx @azure/static-web-apps-cli deploy ./marketing-deploy --deployment-token "$SWA_TOKEN" --env production
```

The Static Web App CLI always reads `marketing-source/public/staticwebapp.config.json`,
**not** the copy inside `marketing-deploy` — edit the source one.

## Still required: point the domain at the static host

Until this is done, `cyraops.com` still resolves to the Container App, so the
landing page cold-starts whenever the CRM is asleep.

In Cloudflare DNS for `cyraops.com`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `www` | `wonderful-river-0e4512f00.8.azurestaticapps.net` | proxied |
| CNAME | `@` | `wonderful-river-0e4512f00.8.azurestaticapps.net` | proxied (Cloudflare flattens apex) |

Then bind the hostnames on the Static Web App:

```bash
az staticwebapp hostname set --name cyraops-marketing --resource-group cyraops-prod --hostname www.cyraops.com
az staticwebapp hostname set --name cyraops-marketing --resource-group cyraops-prod --hostname cyraops.com
```

Once that resolves, the CRM can stay at `minReplicas: 0` permanently and the
landing page still loads instantly from the edge.

---

## Computer VM (browser for the AI team)

Enabled on request. It is the most expensive component; deallocate it when the
research/browsing capability is not needed.

```bash
az vm start    --name cyraops-computer-vm --resource-group cyraops-computer
az vm deallocate --name cyraops-computer-vm --resource-group cyraops-computer
```

After a start, the container needs starting too (deallocation stops it):

```bash
az vm run-command invoke --name cyraops-computer-vm --resource-group cyraops-computer \
  --command-id RunShellScript --scripts "sudo docker start computer"
```

**Check the firewall after every app deploy.** The NSG rule `allow-cyraops-app`
pins the 181 Container Apps outbound IPs; if a revision changes them, browser
tools fail with a network error while the VM itself looks healthy:

```bash
az containerapp show -n cyraops-prod-app -g cyraops-prod \
  --query "properties.outboundIpAddresses" -o tsv | tr ',' '\n' | sort -u > /tmp/app.txt
az network nsg rule show --nsg-name cyraops-computer-vmNSG -g cyraops-computer \
  --name allow-cyraops-app --query "sourceAddressPrefixes" -o tsv | tr ' ' '\n' | sort -u > /tmp/nsg.txt
comm -23 /tmp/app.txt /tmp/nsg.txt    # must print nothing
```

Verified working: navigate, extract, screenshot; cloud-metadata (169.254.169.254)
is still refused by the service's own SSRF guard.
