FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# The native harness runtime boots entirely from the vendored tree; fail the
# build fast (instead of shipping an image with a broken harness) when the
# extracted tree is missing from the context. The repo stores the pinned
# tarball (vendor/dsh-pinned-0.2.2-rc.1.tar.gz) but the image needs the
# EXTRACTED vendor/dsh directory — see .dockerignore re-inclusions.
RUN test -f vendor/dsh/package.json && test -f vendor/tooling/vendored-boot/native-host.mjs \
  || (echo "ERROR: vendor/dsh (extracted) and vendor/tooling must be in the build context" >&2 && exit 1)
# Native addons for the image platform. The vendored tree was captured on a
# darwin-arm64 dev machine, so it carries the darwin-arm64 prebuilds; the two
# entry packages resolve per-platform binaries from their optional-dependency
# families at runtime. Install the linux-x64 prebuilds into the vendored tree
# (from a scratch dir so npm never reifies the vendored tree itself).
RUN mkdir -p /tmp/cyraops-addons && cd /tmp/cyraops-addons \
 && printf '{"name":"cyraops-addons","version":"0.0.0","private":true}\n' > package.json \
 && npm install --ignore-scripts --no-save --package-lock=false \
      node-addon-require-builtin-linux-x64-gnu@0.1.9 \
      @deepseek-ai/node-addon-system-linux-x64@0.1.2 \
 && cp -R node_modules/node-addon-require-builtin-linux-x64-gnu /app/vendor/dsh/node_modules/ \
 && mkdir -p /app/vendor/dsh/node_modules/@deepseek-ai \
 && cp -R node_modules/@deepseek-ai/node-addon-system-linux-x64 /app/vendor/dsh/node_modules/@deepseek-ai/ \
 && rm -rf /tmp/cyraops-addons
# The CRM plugin bundle: the profile declares @cyraops/harness-crm and dev
# checkouts resolve it through a gitignored symlink
# (vendor/tooling/vendored-boot/profile/node_modules/@cyraops/harness-crm ->
# src/lib/harness/plugins/cyraops-crm). Install a REAL copy into the profile's
# node_modules so image-local resolution never depends on symlink semantics
# (the Dockerfile cannot rely on COPY preserving or dereferencing that link).
RUN rm -rf vendor/tooling/vendored-boot/profile/node_modules/@cyraops \
 && mkdir -p vendor/tooling/vendored-boot/profile/node_modules/@cyraops \
 && cp -R src/lib/harness/plugins/cyraops-crm vendor/tooling/vendored-boot/profile/node_modules/@cyraops/harness-crm
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# The image's harness runtime is the in-process native tree (the CLI runtime
# would need the dsh distribution install, which the image does not carry).
ENV HARNESS_RUNTIME=native
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/vendor ./vendor
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/server.ts ./server.ts
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
