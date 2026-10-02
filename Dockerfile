# syntax=docker/dockerfile:1
# Multi-stage build producing a small standalone Next.js server image. The same image runs the web app or the worker.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy values only so config parsing succeeds at build time; real secrets are injected at runtime.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build AUTH_SECRET=build-time-only-build-time-only-build-time-only npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --home /app familyfinance && mkdir -p /app/storage && chown -R familyfinance /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Full node_modules are kept so `prisma migrate deploy`, the seed script and the worker (tsx) work from the same image.
COPY --from=build --chown=familyfinance /app/node_modules ./node_modules
COPY --from=build --chown=familyfinance /app/.next ./.next
COPY --from=build --chown=familyfinance /app/public ./public
COPY --from=build --chown=familyfinance /app/prisma ./prisma
COPY --from=build --chown=familyfinance /app/src ./src
COPY --from=build --chown=familyfinance /app/package.json /app/next.config.mjs /app/tsconfig.json ./
COPY --chown=familyfinance docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER familyfinance
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["web"]
