FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache nmap sqlite curl docker-cli
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
# Keep nmap for network discovery
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/lib/db/schema.ts ./src/lib/db/schema.ts
COPY --from=build /app/src/lib/db/index.ts ./src/lib/db/index.ts
COPY --from=build /app/src/lib/incident-dedup.ts ./src/lib/incident-dedup.ts
COPY --from=build /app/src/lib/fix-verification.ts ./src/lib/fix-verification.ts
COPY --from=build /app/src/lib/bulk-resolution.ts ./src/lib/bulk-resolution.ts
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/community-packs ./community-packs
RUN chmod +x scripts/start.sh
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production DB_PATH=/app/data/stdout.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["sh", "scripts/start.sh"]