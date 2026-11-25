FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY dashboard ./dashboard
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000 8080
CMD ["node", "src/server.js"]
