#!/bin/sh
# Deploy to production by building here, not in Azure.
#
# `az acr build` runs an ACR Task, which Azure bills per vCPU-second of build
# time. A dozen deploys in one evening cost more than the whole app runs for a
# week. Docker is local and free: build for linux/amd64 (Azure's architecture),
# push, then point the app at the image.
#
# It also keeps the registry small — each ACR build left a ~1 GB image behind,
# and the registry had grown to 71 GB of stale tags.
set -eu

REGISTRY="cyraopsacr569002"
APP="cyraops-prod-app"
RESOURCE_GROUP="cyraops-prod"
TAG="local-$(date +%m%d%H%M)"
IMAGE="$REGISTRY.azurecr.io/cyraops:$TAG"
SUFFIX="${1:-deploy}"

echo "→ building $TAG for linux/amd64"
docker build --platform linux/amd64 -t "$IMAGE" .

echo "→ pushing to $REGISTRY"
az acr login --name "$REGISTRY" >/dev/null
docker push "$IMAGE"

echo "→ deploying ($SUFFIX)"
az containerapp update \
  --name "$APP" --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE" --revision-suffix "$SUFFIX" >/dev/null

echo "→ pruning old tags (keeping the newest 4)"
az acr repository show-tags --name "$REGISTRY" --repository cyraops --orderby time_desc -o tsv \
  | tail -n +5 \
  | while read -r old; do
      az acr repository delete --name "$REGISTRY" --image "cyraops:$old" --yes >/dev/null 2>&1 || true
    done

echo "→ waiting for the revision to report healthy"
for _ in $(seq 1 40); do
  sleep 15
  state=$(az containerapp revision list --name "$APP" --resource-group "$RESOURCE_GROUP" \
    --query "[?properties.active] | [0].properties.healthState" -o tsv 2>/dev/null || true)
  [ "$state" = "Healthy" ] && break
done

echo "→ health: $(curl -s -m 20 https://www.cyraops.com/api/health)"
echo "done: $IMAGE"
