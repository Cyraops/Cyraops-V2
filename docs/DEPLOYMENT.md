# Deployment

Production runs on Azure Container Apps behind Cloudflare. One container serves both the CRM
and the marketing site.

| Piece | Value |
|---|---|
| Container app | `cyraops-prod-app` (resource group `cyraops-prod`, South India) |
| Image registry | `cyraopsacr569002.azurecr.io/cyraops:<tag>` |
| Database | PostgreSQL Flexible Server `cyraops-pg-si-569002` (Standard_B1ms, 32 GB) |
| Uploads | Azure Files share mounted at `/app/uploads` |
| Public hostname | `https://www.cyraops.com` (apex redirects to `www`) |
| Health probe | `GET /api/health` → `{"status":"ok","database":"connected"}` |

---

## Deploy a commit

```bash
# 1. Confirm the branch is what you think it is
git switch production && git pull --ff-only && git log --oneline -1

# 2. Build the image in ACR (no local Docker needed; takes ~7 minutes)
TAG="prod-$(date +%m%d%H%M)"
az acr build --registry cyraopsacr569002 --image "cyraops:$TAG" --file Dockerfile .

# 3. Point the app at it
az containerapp update --name cyraops-prod-app --resource-group cyraops-prod \
  --image "cyraopsacr569002.azurecr.io/cyraops:$TAG" \
  --revision-suffix "$(git rev-parse --short HEAD)"

# 4. Wait for the new revision, then probe
az containerapp revision list -n cyraops-prod-app -g cyraops-prod \
  --query "[].{name:name,health:properties.healthState}" -o table
curl -s https://www.cyraops.com/api/health
```

The revision must report `Healthy` **and** the health endpoint must say `database: connected`.
A running container with a failed database connection serves 500s, so check both.

## What happens on container start

1. `prisma migrate deploy` — applies any pending migration from `prisma/migrations/`
2. `tsx server.ts` — Next.js plus Socket.IO on one port

Migrations are therefore part of the deploy. A migration that fails blocks startup, and the
previous revision keeps serving — check the revision list, not just the URL.

## Publishing the marketing site

The current site lives in `site-3d/` and is served from the app's `public/` directory.

```bash
cd site-3d
npm run audit                      # must report 0 problems across all routes
npm run build:static               # vite build + prerender all 74 routes to HTML
npm run publish                    # publish routes, assets, sitemap and robots into ../public
cd ..
npm run build                      # rebuild the Next app so public/ is baked into the image
```

`publish` writes `public/routes.json`, which `next.config.ts` turns into rewrites — without
it, `/catalogue` and the other 73 paths 404 instead of serving their prerendered document.

Then deploy as above. Because `public/` is baked into the image at build time, a site change
requires a full image build — it cannot be hot-swapped.

## Rolling back

```bash
az containerapp revision list -n cyraops-prod-app -g cyraops-prod \
  --query "[].{name:name, image:properties.template.containers[0].image}" -o table
az containerapp update -n cyraops-prod-app -g cyraops-prod --image <previous-image>
```

Then revert the commit on `production` so the branch matches reality.
See [GIT-WORKFLOW.md](GIT-WORKFLOW.md#rolling-back).

## Running costs

The container app is the biggest lever: `minReplicas: 1` keeps it always warm. When the site
is idle, stopping the app and the database is the cheapest option.

```bash
az containerapp stop  -n cyraops-prod-app -g cyraops-prod   # site returns 503
az containerapp start -n cyraops-prod-app -g cyraops-prod
```

Full stop/start runbook, including the computer VM and the NSG egress list:
[../infra/STOP-RESTART.md](../infra/STOP-RESTART.md).

## Secrets

The app reads its configuration from container environment variables, never from this
repository. To inspect or change them:

```bash
az containerapp show -n cyraops-prod-app -g cyraops-prod --query "properties.template.containers[0].env" -o table
```

Values are not printed by that query — only names. Set a value with
`az containerapp update --set-env-vars NAME=value`, and remember the revision it creates.
