FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./
RUN npm ci --omit=dev
RUN apk del python3 make g++
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/src/lib/db/schema.ts ./src/lib/db/schema.ts
COPY --from=build /app/scripts ./scripts
RUN chmod +x scripts/start.sh
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
