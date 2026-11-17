# Deploying, and what it costs

## Build locally, never with `az acr build`

`az acr build` runs an **ACR Task**: Azure bills it per *vCPU-second* of build
time, and each run also leaves a ~1 GB image in the registry. A dozen deploys in
one evening rang up more than the application itself runs for in a week, and the
registry had grown to 71 GB across 89 tags.

Use:

```sh
./scripts/deploy-prod.sh [revision-suffix]
```

which builds `linux/amd64` with local Docker, pushes, updates the container app
and prunes everything but the four newest tags.

## Where the bill actually goes (measured 2026-11)

Billing is in **INR**. Figures are the 7-day actuals at the time of writing.

| Service | 7 days | Notes |
| --- | --- | --- |
| Virtual Machines | ₹740 | the computer-use VM, since deleted |
| Container Registry | ₹687 | mostly ACR Task build minutes; storage overage |
| Virtual Network | ₹329 | private endpoint + static IP + private DNS |
| Azure Container Apps | ₹297 | active vCPU while serving |
| DNS / Storage / bandwidth | ₹20 | negligible |

Postgres does not appear as a separate line — worth confirming on the invoice.

## Keeping it small

- Deploy only when the change matters; every deploy is a push.
- `scripts/deploy-prod.sh` prunes tags automatically so storage stays inside the
  10 GiB Basic allowance.
- The computer-use VM has been removed, along with `COMPUTER_SERVICE_URL` and
  `COMPUTER_SERVICE_TOKEN`; the browser panel now reports itself unconfigured.
