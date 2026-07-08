#!/usr/bin/env bash
# Run all three MimicTG processes in one container. If any exits, the container
# exits (restart: always brings it back). Backend + bot + built Mini App preview
# all share localhost, so the bot hits the backend and the preview proxies /api
# to it without any cross-container networking.
set -e
cd /app

npm run start --workspace backend &
npm run start --workspace bot &
npm run preview --workspace miniapp -- --host --port 5173 &

wait -n
