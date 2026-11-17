# CyraOps

Two things live in this repository, served from one host:

1. **The CyraOps CRM** — a Next.js application for running the business: leads, deals,
   projects, tasks, files, chat, calendar, billing and an AI assistant with an agent runtime.
2. **The public marketing site** — a Vite + React + three.js single-page site, built into
   `public/` and served at `/`.

`www.cyraops.com` runs both: the public site at `/`, the CRM at `/login`, `/dashboard`,
`/crm`, and so on, with the API and Socket.IO on the same origin.

---

## Quick start

Requirements: Node 22–24, npm, and PostgreSQL 15+ (or Docker for the database).

```bash
cp .env.example .env          # then fill in DATABASE_URL and a random INITIAL_SETUP_KEY
docker compose up -d db       # or point DATABASE_URL at an existing PostgreSQL
npm ci
npm run db:generate
npm run db:migrate            # applies prisma/migrations
npm run dev                   # http://localhost:3001
```

The marketing site has its own toolchain:

```bash
cd site-3d
npm ci
npm run dev                   # http://127.0.0.1:3100
```

---

## Repository map

| Path | What it is |
|---|---|
| `src/app/` | Next.js routes. `/api/*` endpoints, workspace pages, auth |
| `src/lib/` | Domain logic: AI assistant, agents, CRM services, auth, storage |
| `prisma/` | Schema and migrations (34 migrations, applied on deploy) |
| `test/` | Test harness and the job suites (`test/jobs/*.test.ts`) |
| `public/` | Static assets **including the built marketing site** (`index.html`, `assets/`) |
| `site-3d/` | **The current marketing site** — Vite + React + three.js, hash-routed |
| `marketing-source/` | The previous Vite site. Superseded by `site-3d`; kept for reference |
| `marketing-deploy/` | Build output for the Azure Static Web App. Generated, not committed |
| `infra/` | Azure runbooks: stop/restart, computer VM operations |
| `docs/` | Definition of done, intake API, git workflow, phase notes |
| `scripts/` | Utilities: test database creation, marketing sync, helpers |
| `Dockerfile` / `docker-compose.yml` | Production image and local services |

---

## Everyday commands

| Command | Purpose |
|---|---|
| `npm run dev` | CRM on port 3001 with hot reload |
| `npm run build` | `prisma generate` + Next production build |
| `npm run start` | Run the production server locally (`server.ts` + Socket.IO) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Unit suite (`src/lib/**/*.test.ts`) |
| `npm run test:jobs` | End-to-end job suites against a real test database |
| `npm run db:migrate` | Apply pending migrations |
| `npm run build:marketing` | Build `marketing-source` into `public/` (legacy path) |

### The marketing site (`site-3d`)

```bash
cd site-3d
npm run dev        # local preview on :3100
npm run build      # typecheck + production bundle in site-3d/dist
node audit.mjs     # crawls all 74 routes at 2 viewports: links, console, overflow, keyboard
node axe.mjs       # WCAG 2 A/AA scan (needs network for the axe CDN)
```

The site is prerendered before it is published — crawlers must see content, not an empty
`<div id="root">`:

```bash
cd site-3d
npm run build:static   # vite build, then render all 74 routes to static HTML
npm run publish        # copy the routes, assets, sitemap and robots into ../public
cd .. && npm run build # rebuild the app so public/ is baked into the image
```

See [docs/SEO.md](docs/SEO.md) for what each route serves and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Azure steps.

---

## Testing gates

Nothing goes to `release` or `production` unless all four pass:

```bash
npm run typecheck
npm run test:unit          # 300+ unit tests
npm run test:jobs          # E2E job suites (needs a *_test database)
cd site-3d && node audit.mjs
```

The job suites **refuse to run** against a database whose name is not obviously a test
database (`test_*`, `*_test`, `*_test_*`) — `resetDb()` truncates every table.

---

## Secrets

`.env` and anything in `config/*.yaml` are git-ignored and must stay that way. Only
`.env.example` is committed. Connection strings, Azure credentials and provider API keys
never enter this repository: the deployed app receives them as container environment
variables.

If a secret is ever committed: rotate it first, then rewrite history. Removing the file in a
later commit is not enough.

---

## Deployment (summary)

Production is an Azure Container App (`cyraops-prod-app`, resource group `cyraops-prod`)
behind Cloudflare, with PostgreSQL Flexible Server and an Azure Files share for uploads.

```bash
npm run build
az acr build --registry cyraopsacr569002 --image "cyraops:<tag>" --file Dockerfile .
az containerapp update --name cyraops-prod-app --resource-group cyraops-prod \
  --image cyraopsacr569002.azurecr.io/cyraops:<tag> --revision-suffix <suffix>
curl -s https://www.cyraops.com/api/health     # expect {"status":"ok","database":"connected"}
```

Migrations apply automatically on container start (`prisma migrate deploy`). Full runbook,
including how to stop the bill while idle: [infra/STOP-RESTART.md](infra/STOP-RESTART.md).

---

## Branching

`dev` → `release` → `production`, with `dev` as the default branch. Details, commands and the
hotfix path are in [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md); how to contribute is in
[CONTRIBUTING.md](CONTRIBUTING.md).
