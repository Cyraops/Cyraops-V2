# CyraOps Deployment Report

Updated 2026-11-08 after promoting the combined application.

## Combined-host migration status

The combined Next.js application serves the public website and CMS on the same host. The Vite source builds the static public page into that application's `public/` directory.

## Production status

- **Public URL:** [https://cyraops.com](https://cyraops.com)
- **Canonical URL:** [https://www.cyraops.com](https://www.cyraops.com)
- On 2026-11-08, `/`, `/login`, and `/api/health` returned HTTP 200 through the public hostname; `/api/health` reported the production database connected.
- `https://cyraops.com` redirects to `https://www.cyraops.com`.
- **`cyraops.in` is not currently configured:** DNS returns NXDOMAIN, so it cannot forward to the `.com` site.
- The contact form posts to the combined app's same-origin `/api/public/inquiries` endpoint. Accepted inquiries are stored as CRM leads; email notifications still require a configured email account.
- The Vercel fallback at [https://bet-three-silk.vercel.app](https://bet-three-silk.vercel.app) responds with HTTP 200, but it is a separate deployment and still serves the previous brand build. Redeploy it separately if it is to remain an active fallback.

The inquiry form stores accepted submissions as CRM leads for Owner follow-up. Email notifications still require a configured email account. The `.in` domain needs to be corrected or removed from the claimed domain list. The Vercel fallback is separate and may still serve the previous build.

## 1. Application and hosting

| Property | Current value |
| :--- | :--- |
| Application | React single-page application |
| Tooling | React 19, TypeScript, Vite 8, Lucide React, Three.js |
| Current production host | Combined Next.js app on port 3000 behind the public HTTPS host |
| Direct Azure URL | [https://calm-wave-0a458ef0f.5.azurestaticapps.net](https://calm-wave-0a458ef0f.5.azurestaticapps.net) |
| Azure resource group | `quietcloud-rg` |
| Azure resource name | `quietcloud-ops` |
| Azure location | East US 2 |
| Azure plan | Free (verified with Azure CLI) |
| Brand mark | `public/cyraops-mark.png` (header, footer, and browser icon) |
| SPA routing | [`public/staticwebapp.config.json`](public/staticwebapp.config.json) |

The Azure values below describe the previous Static Web App resources and are retained as infrastructure history. They are not the current combined app deployment target.

The Free plan has quotas and no SLA; avoid describing it as “free forever.” Azure documents the current [hosting plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans) and [quotas](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas). Azure-managed TLS is active for the custom production host.

## 2. Domain configuration

### `cyraops.com`

- `www` CNAME points to `calm-wave-0a458ef0f.5.azurestaticapps.net`.
- The apex (`@`) redirects permanently to `https://www.cyraops.com`.

### `cyraops.in`

This domain returned NXDOMAIN during verification. The earlier report that it forwarded to `.com` was incorrect. Add/register and configure the domain before listing it as a redirect.

## 3. Azure production deployment

Run these commands from the project root. The Azure resource identifiers below are the verified existing values.

```bash
# Build the public site.
npm run build

# Read the deployment token without printing it to the terminal.
CYRAOPS_DEPLOY_TOKEN=$(az staticwebapp secrets list \
  --name quietcloud-ops \
  --resource-group quietcloud-rg \
  --query "properties.apiKey" -o tsv)

# Deploy the built static files to production.
npx --yes @azure/static-web-apps-cli deploy ./dist \
  --deployment-token "$CYRAOPS_DEPLOY_TOKEN" --env production
```

### Cyraops CMS navigation link

The main navigation places **Cyraops CMS** immediately after **Our approach** and opens `/login` in the same tab. The combined CMS app serves the public site at `/` and the full CMS at `/login` on the same host. Keep `VITE_CMS_URL` unset so the link stays on that host. The production domain must be switched to the combined CMS host before this link can reach the CMS in production; the current Static Web App serves only the standalone website.

## 4. Vercel fallback

- **Vercel project:** `bet`
- **Fallback URL:** [https://bet-three-silk.vercel.app](https://bet-three-silk.vercel.app)
- **Deploy command:** `npx vercel --prod`

This is independent of the Azure production deployment. A deployment to Azure does not update the Vercel fallback.

## 5. Contact form

The combined app serves the public site and CMS on the same host. The inquiry form posts to `/api/public/inquiries`; accepted inquiries are stored in the CRM as leads for owner follow-up.
