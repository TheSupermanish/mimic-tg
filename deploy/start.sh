#!/usr/bin/env bash
# Run all three MimicTG processes in one container. If any exits, the container
# exits (restart: always brings it back). Backend + bot + built Mini App preview
# all share localhost, so the bot hits the backend and the preview proxies /api
# to it without any cross-container networking.
set -e
cd /app

npm run start --workspace backend &

# The bot uses long-polling on a single TELEGRAM_BOT_TOKEN, and Telegram allows
# only ONE getUpdates consumer per token. To test the bot locally against the
# live token, set RUN_BOT=0 on the VM and redeploy: the backend + Mini App keep
# serving tg.mimic.markets while the token is freed for your laptop's bot.
if [ "${RUN_BOT:-1}" = "0" ]; then
  echo "[start] RUN_BOT=0 — bot disabled; token is free for local testing"
else
  npm run start --workspace bot &
fi

npm run preview --workspace miniapp -- --host --port 5173 &

wait -n
