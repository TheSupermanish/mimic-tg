import { ZeroAddress } from 'ethers';
import { Challenge, ChallengeStatus, Outcome } from '@mimic/shared';
import { marketReader } from './chain.js';
import { config } from './config.js';
import { getMatches } from './football.js';
import { setChallenges, usernameFor } from './store.js';

/**
 * Rebuilds the challenge set by reading on-chain state. For a hackathon the
 * challenge count is small, so a full re-read each poll is simplest and robust.
 */
export async function reindex(): Promise<Challenge[]> {
  if (!config.predictionMarketAddress) return [];
  const market = marketReader();
  const next = Number(await market.nextChallengeId());

  // fixture lookup for enrichment (cached)
  const matches = await getMatches().catch(() => []);
  const matchById = new Map(matches.map((m) => [m.id, m]));

  // cache match results so each fixture is fetched once
  const resultCache = new Map<string, Outcome>();
  async function resultFor(matchId: string): Promise<Outcome> {
    if (resultCache.has(matchId)) return resultCache.get(matchId)!;
    const r = Number(await market.matchResult(matchId)) as Outcome;
    resultCache.set(matchId, r);
    return r;
  }

  const out: Challenge[] = [];
  for (let id = 0; id < next; id++) {
    const c = await market.getChallenge(id);
    const opponent = c.opponent === ZeroAddress ? null : c.opponent;
    const taker = c.taker === ZeroAddress ? null : c.taker;
    const matchId = c.matchId as string;

    out.push({
      id,
      matchId,
      creator: c.creator,
      creatorPick: Number(c.creatorPick) as Outcome,
      opponent,
      taker,
      takerPick: taker ? (Number(c.takerPick) as Outcome) : null,
      stake: c.stake.toString(),
      status: Number(c.status) as ChallengeStatus,
      result: await resultFor(matchId),
      createdAt: 0,
      creatorTgUsername: usernameFor(c.creator),
      opponentTgUsername: taker ? usernameFor(taker) : undefined,
      match: matchById.get(matchId),
    });
  }

  setChallenges(out);
  return out;
}

/** Poll loop to keep the challenge cache fresh. */
export function startIndexer(intervalMs = 15_000): void {
  const tick = () =>
    reindex().catch((e) => console.warn('[indexer]', (e as Error).message));
  tick();
  setInterval(tick, intervalMs);
}
