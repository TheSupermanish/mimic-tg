# MimicTG — single container running backend + bot + built Mini App (preview).
# Deployed alongside the existing mimic-markets stack on the same Docker host,
# on the shared `stack` network so Caddy can reverse-proxy to it by name.
FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY backend/package*.json ./backend/
COPY bot/package*.json ./bot/
COPY miniapp/package*.json ./miniapp/
COPY contracts/package*.json ./contracts/
# install all workspaces (dev deps needed to build shared + miniapp)
COPY . .
RUN npm ci --no-audit --no-fund \
  && npm run build:shared \
  && npm run build --workspace miniapp

ENV NODE_ENV=production
EXPOSE 5173 8787
CMD ["bash", "deploy/start.sh"]
