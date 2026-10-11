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
RUN npm install --omit=dev --package-lock=false
COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./public
EXPOSE 4000
CMD ["node", "server.js"]
