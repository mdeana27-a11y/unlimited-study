# NOT TESTED in the authoring environment (no Docker daemon available). Review before relying on it.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY client ./client
COPY scripts ./scripts
COPY data ./data
ENV NODE_ENV=production STORAGE_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "node scripts/seed.js && node server/index.js"]
