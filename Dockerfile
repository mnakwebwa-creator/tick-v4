# Tick in one container: web app + API + built-in database. No Python needed.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server server
COPY scripts scripts
COPY --from=build /app/web/dist web/dist
RUN mkdir -p data
VOLUME /app/data
EXPOSE 4000
CMD ["node", "server/node.js"]
