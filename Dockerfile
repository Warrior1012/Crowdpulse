FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package*.json ./
# The existing backend lockfile is stale and omits runtime transitive dependencies.
# Resolve from package.json to avoid shipping a broken production node_modules tree.
RUN npm install --omit=dev --package-lock=false
COPY backend/ ./
COPY redis-certs/ ./redis-certs/
COPY --from=frontend-builder /app/backend/public ./public
EXPOSE 4000
CMD ["node", "server.js"]
