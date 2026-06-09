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
RUN apk add --no-cache python3 make g++ nmap sqlite curl docker-cli
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./
RUN npm ci --omit=dev
RUN apk del python3 make g++
# Keep nmap for network discovery
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/src/lib/db/central-schema.ts ./src/lib/db/central-schema.ts
COPY --from=build /app/src/lib/db/tenant-schema.ts ./src/lib/db/tenant-schema.ts
COPY --from=build /app/src/lib/db/index.ts ./src/lib/db/index.ts
COPY --from=build /app/scripts ./scripts
RUN chmod +x scripts/start.sh
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["sh", "scripts/start.sh"]