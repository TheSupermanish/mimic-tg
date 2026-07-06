# MimicTG ⚽️ — P2P Football Prediction Market on Telegram

> Tether Developers Cup entry — **WDK track**. A peer-to-peer football prediction market where you hold your own USDt in a self-custodial [WDK](https://wdk.tether.io) wallet **inside Telegram**, and challenge friends on match outcomes.

_"I bet @manish 5 USDt on Brazil"_ → he accepts → both stakes lock in an on-chain escrow → a resolver settles from the real match result → the winner claims the pot. Unmatched challenges are refunded.

## Why it's on-theme

- **WDK, for real:** every user has a self-custodial USDt wallet generated in-app. Keys never leave the device. Balances and transfers go through `@tetherto/wdk`.
- **Football:** markets are real fixtures pulled from [football-data.org](https://www.football-data.org).
- **P2P:** you bet against other people (open or directed challenges), not a house.
- **Telegram-native:** a Mini App for the wallet + betting UI, and a bot for invites, deep-link accepts, and settlement notifications.

## Architecture

```
Telegram Bot ──launch──▶ Mini App (webview, React)   runs WDK client-side (self-custody)
     │ invites / deep-links / notifications                │ create / accept challenges, deposit, claim
     ▼                                                      ▼
Backend (Fastify)  ◀── reads public state, fixtures        Escrow contract (Base Sepolia)
   fixtures proxy · event indexer · resolver worker  ──▶    holds USDt stakes, matches, refunds, pays
```

Custody boundary: **funds live in the contract, keys live in the Mini App.** The backend only orchestrates public state and triggers settlement — it is never a custodian.

## Workspaces

| Package      | What it is                                                        |
| ------------ | ----------------------------------------------------------------- |
| `contracts/` | Hardhat — `MockUSDT` (testnet USDt) + `PredictionMarket` escrow    |
| `shared/`    | Types, chain config, USDt unit helpers, deployed addresses + ABIs |
| `backend/`   | Fastify API — fixtures, market index, initData auth, resolver     |
| `bot/`       | grammY Telegram bot — launch Mini App, deep links, notifications  |
| `miniapp/`   | React + Vite Mini App — WDK wallet + betting UI                   |

## Setup

Requires Node ≥ 20.

```bash
npm install
cp .env.example .env    # fill in the values below
npm run build:shared
```

Environment (`.env`):

- `FOOTBALL_DATA_API_KEY` — free key from football-data.org
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `DEPLOYER_PRIVATE_KEY`, `RESOLVER_PRIVATE_KEY` — testnet keys
- `BASE_SEPOLIA_RPC`, `MINIAPP_URL`, `BOT_USERNAME`

### Contracts

```bash
npm run test:contracts       # full lifecycle tests (13 passing)
npm run deploy:contracts     # deploy to Base Sepolia → writes shared/src/deployed/addresses.json + ABIs
```

### Run (dev)

```bash
npm run dev                  # backend :8787 + miniapp (vite) + bot, all at once
# or individually:
npm run dev:backend
npm run dev:miniapp          # expose over https (ngrok) so Telegram can load it
npm run dev:bot
```

Point the bot at your Mini App by setting `MINIAPP_URL` (your ngrok https URL) in `.env`.
The Mini App reads its contract addresses at runtime from the backend `GET /config`, so no
rebuild is needed after deploying. Set `VITE_BACKEND_URL` if the backend isn't on localhost.

### Demo flow

1. Open the bot → **Open MimicTG** → create a wallet (12-word phrase, PIN-encrypted on device).
2. Tap **Get test USDt** (MockUSDT faucet). The backend also drips a little gas ETH automatically.
3. **Fixtures** → pick a match → choose an outcome + stake → post an open or `@username` challenge.
4. A second user opens the deep link (`t.me/<bot>?start=accept_<id>`), takes the other side.
5. When the match finishes, the resolver reads the score from football-data.org, settles on-chain,
   and both players get a Telegram notification. Winner's USDt balance goes up.

## Gasless mode (EIP-7702)

Set `PIMLICO_API_KEY` (free testnet key from [Pimlico](https://dashboard.pimlico.io)) and the
Mini App automatically switches to `@tetherto/wdk-wallet-evm-7702-gasless`: the user's EOA is
delegated to a smart account and every action (faucet, approve, bet, claim) is a **sponsored
UserOperation** — the user needs **zero ETH**. Without the key, it falls back to the standard
WDK EVM wallet + the backend gas-drip. Verify with `PIMLICO_API_KEY=… node scripts/e2e.mjs`
(runs a proof that a zero-ETH wallet can faucet + bet).

## Third-party services

Base Sepolia RPC · football-data.org · Telegram Bot API · Pimlico bundler/paymaster (gasless mode only).

## License

MIT — see [LICENSE](./LICENSE).
