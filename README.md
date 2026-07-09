# MimicTG ⚽️

**Bet your mates in USDt, right inside Telegram. Your keys, your funds, settled by the final whistle.**

> Tether Developers Cup entry, **WDK track**. A peer-to-peer football prediction market where every player holds their own USDt in a self-custodial [WDK](https://wdk.tether.io) wallet **inside Telegram** and challenges friends on real match outcomes.

It's the 80th minute and the group chat is melting down. Someone types _"Argentina win this, easy."_ In MimicTG that stops being talk: _"I bet you 5 USDt on Argentina"_ locks both stakes into an on-chain escrow, and when the referee blows for full time an AI resolver settles from the real result and pays the winner. Unmatched challenges are refunded. No bookmaker, no house, no custodian, no gas.

## What makes it tick

- **WDK, for real:** every user gets a self-custodial USDt wallet generated in-app; the 12-word seed is PIN-encrypted on the device and never leaves it. Balances, signing, and transfers all go through `@tetherto/wdk`.
- **Gasless:** via EIP-7702 the wallet is delegated to a smart account, so funding, approving, betting, and claiming are all sponsored UserOperations. A brand-new fan needs zero ETH.
- **Real football:** markets are real fixtures and results from [football-data.org](https://www.football-data.org).
- **Peer-to-peer:** you bet other people (open challenges, or directed at a specific friend), never a house.
- **A witty AI football brain:** @mention the bot for live scores, standings, top scorers, and real goalscorers grounded from live web search. Say "bet @sam 10 on Spain" and it pings Sam directly with a one-tap button to take the other side.
- **Telegram-native:** a Mini App for the wallet and betting UI, and a bot for invites, deep-link accepts, directed-challenge DMs, and settlement notifications.

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

#### Testing the live bot locally (single token)

The bot uses **long-polling on one `TELEGRAM_BOT_TOKEN`**, and Telegram delivers updates to
only one `getUpdates` consumer. The deployed container (tg.mimic.markets) polls that token
24/7, so a second local bot will 409 ("terminated by other getUpdates request") and your
local changes won't reach `@mimic_markets_bot`. To hand the token to your laptop:

```bash
# On the VM: keep backend + Mini App live, but stop the deployed bot.
RUN_BOT=0 docker compose -f deploy/docker-compose.yml up -d

# On your laptop: run the backend + bot against the same live token.
npm run dev:backend
npm run dev:bot            # now @mimic_markets_bot is driven by your local code
```

`MINIAPP_URL` stays `https://tg.mimic.markets`, so the buttons your local bot sends still
open the live Mini App. When you're done, redeploy without the flag (`docker compose up -d`,
`RUN_BOT` defaults to `1`) to give the token back to the deployed bot.

### Demo flow

1. Open the bot → **Open MimicTG** → create a wallet (12-word phrase, PIN-encrypted on device).
2. Tap **Get test USDt** (MockUSDT faucet). The backend also drips a little gas ETH automatically.
3. **Fixtures** → pick a match → choose an outcome + stake → post an open or `@username` challenge.
4. A second user opens the deep link (`t.me/<bot>?start=accept_<id>`), takes the other side.
5. When the match finishes, the resolver reads the score from football-data.org, settles on-chain,
   and both players get a Telegram notification. Winner's USDt balance goes up.
6. @mention the bot in the group any time for live scores, standings, and real goalscorers, or to
   call someone out with a one-tap challenge.

## Gasless mode (EIP-7702)

Set `PIMLICO_API_KEY` (free testnet key from [Pimlico](https://dashboard.pimlico.io)) and the
Mini App automatically switches to `@tetherto/wdk-wallet-evm-7702-gasless`: the user's EOA is
delegated to a smart account and every action (faucet, approve, bet, claim) is a **sponsored
UserOperation** — the user needs **zero ETH**. Without the key, it falls back to the standard
WDK EVM wallet + the backend gas-drip. Verify with `PIMLICO_API_KEY=… node scripts/e2e.mjs`
(runs a proof that a zero-ETH wallet can faucet + bet).

## AI football brain

@mention the bot, or DM it, for banter and real football knowledge:

- **Live scores, standings, and competition top scorers**, cached server-side so we stay well under the football API's free-tier limit.
- **Real goalscorers**, which the free football feed does not provide, retrieved via Gemini with Google Search grounding and cached per match: finished matches are grounded once and persisted to disk, live matches refresh on a short TTL. Ask "who scored in Argentina's game?" and it replies with names and minutes.
- **Natural-language betting:** "bet @sam 10 on Spain" becomes a directed challenge that DMs Sam a one-tap button to take the other side.

It runs on Gemini via Vertex AI (gcloud ADC) or an AI Studio `GEMINI_API_KEY`, and is deliberately walled off from custody: it can talk football and set up challenges, but never touches anyone's keys or funds. Without a key configured the betting still works; only the chat brain is disabled. This is chat colour only, on-chain settlement always uses the authoritative football-data result.

## Third-party services

Base Sepolia RPC, football-data.org, Telegram Bot API, Pimlico bundler/paymaster (gasless mode), and Google Vertex AI / Gemini with Google Search grounding (AI resolver and sidekick).

## License

MIT — see [LICENSE](./LICENSE).
