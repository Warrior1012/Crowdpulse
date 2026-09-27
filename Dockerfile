FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend-react/package*.json ./
RUN npm install
COPY frontend-react/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY redis-certs/ ./redis-certs/
COPY --from=frontend-builder /app/backend/public ./public
EXPOSE 4000
CMD ["node", "server.js"]
