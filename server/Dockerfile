FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js app.js db.js logic.js leaderboard.js logging.js typesafe.js schema.sql ./

ENV NODE_ENV=production
EXPOSE 8090
CMD ["node", "index.js"]
