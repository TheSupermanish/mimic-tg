import { ZeroAddress } from 'ethers';
import { Challenge, ChallengeStatus, Outcome, fromBaseUnits } from '@mimic/shared';
import { marketReader } from './chain.js';
import { config } from './config.js';
import { getMatches } from './football.js';
import { setChallenges, usernameFor, getResolution, getChallenge, tgIdFor } from './store.js';
import { notify } from './notify.js';

/** Telegram nudge both sides when an open challenge gets taken. */
function notifyAccepted(c: Challenge): void {
  const label = c.match ? `${c.match.homeTeam} vs ${c.match.awayTeam}` : `match ${c.matchId}`;
  const stake = fromBaseUnits(BigInt(c.stake));
  const pot = fromBaseUnits(BigInt(c.stake) * 2n);
  const takerName = c.opponentTgUsername
    ? '@' + c.opponentTgUsername
    : c.taker
      ? `${c.taker.slice(0, 6)}…${c.taker.slice(-4)}`
      : 'someone';
  const btn = config.botUsername
    ? { text: '🎟️ View your bet', url: `https://t.me/${config.botUsername}?start=accept_${c.id}` }
    : undefined;

  const creatorTg = tgIdFor(c.creator);
  if (creatorTg)
    void notify(
      creatorTg,
      `🔥 <b>Your challenge was taken!</b>\n${takerName} took the other side of <b>${label}</b>. Pot is now <b>${pot} USDt</b> — it settles automatically when the result's in. Good luck ⚽️`,
      btn,
    );
  const takerTg = c.taker ? tgIdFor(c.taker) : undefined;
  if (takerTg)
    void notify(
      takerTg,
      `✅ <b>You're in!</b>\nYou took <b>${label}</b> for <b>${stake} USDt</b>. Pot <b>${pot} USDt</b> — may the best pick win 🍀`,
      btn,
    );
}

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
    const resolution = getResolution(matchId);

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
      kickoff: Number(c.kickoff),
      createdAt: 0,
      creatorTgUsername: usernameFor(c.creator),
      opponentTgUsername: taker ? usernameFor(taker) : undefined,
      match: matchById.get(matchId),
      aiRationale: resolution?.rationale,
      aiSource: resolution?.source,
      resolvedByAi: resolution?.resolvedByAi,
      resolveTxHash: resolution?.resolveTxHash,
    });
  }

  // Detect open→matched transitions since the last poll and nudge both sides.
  for (const c of out) {
    const prev = getChallenge(c.id);
    if (prev && prev.status === ChallengeStatus.Open && c.status === ChallengeStatus.Matched) {
      notifyAccepted(c);
    }
  }

  setChallenges(out);
  return out;
}

/** Poll loop to keep the challenge cache fresh. */
export function startIndexer(intervalMs = 6_000): void {
  const tick = () =>
    reindex().catch((e) => console.warn('[indexer]', (e as Error).message));
  tick();
  setInterval(tick, intervalMs);
}
