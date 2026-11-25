FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app
COPY backend/package.json ./backend/
COPY backend/src ./backend/src
COPY backend/gateway ./backend/gateway
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000 8080
CMD ["node", "backend/src/server.js"]

FROM backend AS dashboard
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
CMD ["node", "backend/gateway/server.js"]
