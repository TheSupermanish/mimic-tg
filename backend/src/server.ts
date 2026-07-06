import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, assertConfig, gaslessConfig } from './config.js';
import { CHAIN, fromBaseUnits, Outcome, ChallengeStatus } from '@mimic/shared';
import { getMatches } from './football.js';
import { startIndexer } from './indexer.js';
import { startResolver } from './resolver.js';
import { verifyInitData } from './auth.js';
import { linkWallet, getLinkByUsername, allChallenges, getChallenge, tgIdFor } from './store.js';
import { notify } from './notify.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// ─── Public config for the Mini App (so it needs no build-time addresses) ──
app.get('/config', async () => ({
  chainId: config.chainId,
  rpcUrl: config.rpcUrl,
  explorer: CHAIN.explorer,
  wdkChainKey: CHAIN.wdkChainKey,
  mockUsdt: config.mockUsdtAddress,
  predictionMarket: config.predictionMarketAddress,
  gasless: gaslessConfig(),
}));

app.get('/matches', async () => ({ matches: await getMatches() }));

// Markets, optionally filtered by ?status=open|matched|settled or ?address=0x..
app.get<{ Querystring: { status?: string; address?: string } }>('/markets', async (req) => {
  let list = allChallenges();
  const { status, address } = req.query;
  if (status === 'open') list = list.filter((c) => c.status === ChallengeStatus.Open);
  if (status === 'matched') list = list.filter((c) => c.status === ChallengeStatus.Matched);
  if (status === 'settled') list = list.filter((c) => c.status === ChallengeStatus.Settled);
  if (address) {
    const a = address.toLowerCase();
    list = list.filter(
      (c) => c.creator.toLowerCase() === a || c.taker?.toLowerCase() === a || c.opponent?.toLowerCase() === a,
    );
  }
  return { challenges: list };
});

app.get<{ Params: { id: string } }>('/markets/:id', async (req, reply) => {
  const c = getChallenge(Number(req.params.id));
  if (!c) return reply.code(404).send({ error: 'not found' });
  return c;
});

// Social leaderboard — global, or scoped to ?addresses=0x..,0x.. (a group's members)
app.get<{ Querystring: { addresses?: string } }>('/leaderboard', async (req) => {
  const { leaderboard } = await import('./leaderboard.js');
  const addrs = req.query.addresses?.split(',').map((a) => a.trim()).filter(Boolean);
  return { leaderboard: leaderboard(addrs) };
});

// Resolve a Telegram @username to a wallet address (for directed challenges).
app.get<{ Params: { username: string } }>('/users/:username', async (req, reply) => {
  const link = getLinkByUsername(req.params.username);
  if (!link) return reply.code(404).send({ error: 'user has no wallet yet' });
  return { username: link.username, address: link.address };
});

// Authenticate a Mini App session and link the user's wallet address.
app.post<{ Body: { initData: string; address: string } }>('/auth/telegram', async (req, reply) => {
  const { initData, address } = req.body ?? ({} as any);
  if (!initData || !address) return reply.code(400).send({ error: 'initData and address required' });
  try {
    const user = verifyInitData(initData);
    linkWallet({ telegramId: user.id, username: user.username, address });
    return { user, address };
  } catch (e) {
    return reply.code(401).send({ error: (e as Error).message });
  }
});

// Gas faucet: drip a little test ETH to a fresh wallet so it can pay gas.
app.post<{ Body: { address: string } }>('/faucet/gas', async (req, reply) => {
  const { address } = req.body ?? ({} as any);
  if (!address) return reply.code(400).send({ error: 'address required' });
  try {
    const { fundGas } = await import('./chain.js');
    const hash = await fundGas(address);
    return { ok: true, funded: !!hash, hash };
  } catch (e) {
    return reply.code(500).send({ error: (e as Error).message });
  }
});

// Manual resolve trigger (demo convenience). Guarded by resolver key presence.
app.post<{ Body: { matchId: string; outcome: Outcome } }>('/admin/resolve', async (req, reply) => {
  const { marketResolver } = await import('./chain.js');
  const r = marketResolver();
  if (!r) return reply.code(400).send({ error: 'no resolver key configured' });
  try {
    const tx = await r.resolve(req.body.matchId, req.body.outcome);
    await tx.wait();
    return { ok: true, matchId: req.body.matchId, outcome: req.body.outcome };
  } catch (e) {
    return reply.code(500).send({ error: (e as Error).message });
  }
});

// ─── Background workers ────────────────────────────────────────────────────
assertConfig(['footballApiKey', 'predictionMarketAddress', 'botToken']);
startIndexer();
startResolver(30_000, (e) => {
  // notify both sides of a settlement
  const stake = getChallenge(e.challengeId)?.stake;
  const pot = stake ? fromBaseUnits(BigInt(stake) * 2n) : '';
  const c = getChallenge(e.challengeId);
  if (!c) return;
  const label = `${c.match?.homeTeam ?? 'Home'} vs ${c.match?.awayTeam ?? 'Away'}`;
  if (e.winner) {
    const tgId = tgIdFor(e.winner);
    if (tgId) notify(tgId, `🏆 You won <b>${pot} USDt</b> on ${label}! Result: ${Outcome[e.result]}.`);
    const loser = e.winner.toLowerCase() === c.creator.toLowerCase() ? c.taker : c.creator;
    const loserTg = loser ? tgIdFor(loser) : undefined;
    if (loserTg) notify(loserTg, `😔 Your bet on ${label} didn't land. Result: ${Outcome[e.result]}.`);
  } else {
    for (const addr of [c.creator, c.taker].filter(Boolean) as string[]) {
      const tgId = tgIdFor(addr);
      if (tgId) notify(tgId, `↩️ ${label} was a wash (neither pick hit). Your stake was refunded.`);
    }
  }
});

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
  console.log(`[backend] listening on :${config.port}`);
});
