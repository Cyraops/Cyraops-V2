FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Install browsers into a shared path so the non-root runtime user can read them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json ./
RUN npm install --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY server.js ./
RUN useradd -m -u 10001 cyraops \
 && chown -R cyraops:cyraops /app \
 && chmod -R a+rX /ms-playwright
USER cyraops
EXPOSE 8787
CMD ["node", "server.js"]
