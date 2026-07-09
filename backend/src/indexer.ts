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

/** DM a named opponent once, the moment a directed challenge is created for them. */
function notifyChallenged(c: Challenge): void {
  if (!c.opponent) return;
  const tgId = tgIdFor(c.opponent);
  if (!tgId) return; // opponent hasn't linked a wallet / started the bot — nothing to DM
  const label = c.match ? `${c.match.homeTeam} vs ${c.match.awayTeam}` : `match ${c.matchId}`;
  const stake = fromBaseUnits(BigInt(c.stake));
  const pot = fromBaseUnits(BigInt(c.stake) * 2n);
  const who = c.creatorTgUsername
    ? '@' + c.creatorTgUsername
    : `${c.creator.slice(0, 6)}…${c.creator.slice(-4)}`;
  const side =
    c.creatorPick === Outcome.Home
      ? c.match?.homeTeam ?? 'Home'
      : c.creatorPick === Outcome.Away
        ? c.match?.awayTeam ?? 'Away'
        : 'the draw';
  const btn = config.botUsername
    ? { text: '🎯 Take the other side', url: `https://t.me/${config.botUsername}?start=accept_${c.id}` }
    : undefined;
  void notify(
    tgId,
    `🎯 <b>You've been challenged!</b>\n${who} backs <b>${side}</b> on <b>${label}</b> for <b>${stake} USDt</b>. Take the other side and the winner scoops the <b>${pot} USDt</b> pot ⚽️`,
    btn,
  );
}

// Raw chain data for terminal (settled/cancelled) challenges — frozen, so the
// indexer never re-fetches them from the RPC (keeps us under rate limits).
const terminalCache = new Map<number, any>();

// False until the first successful reindex has baselined the current challenge
// set, so opponent DMs only fire for challenges created *after* boot (never a
// backlog blast on startup / restart).
let primed = false;

/**
 * Rebuilds the challenge set from on-chain state. Terminal challenges are
 * cached (their chain data can't change), so each poll only re-reads the
 * still-active bets — cheap even as the total challenge count grows.
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
    // Settled/Cancelled challenges are frozen on-chain — read them once, then
    // reuse the cached chain data (only re-enrich the cheap off-chain fields).
    // This cuts the per-tick RPC load to just the still-active bets.
    const frozen = terminalCache.get(id);
    const raw = frozen ?? (await market.getChallenge(id));
    const opponent = raw.opponent === ZeroAddress ? null : raw.opponent;
    const taker = raw.taker === ZeroAddress ? null : raw.taker;
    const matchId = raw.matchId as string;
    const status = Number(raw.status) as ChallengeStatus;
    const resolution = getResolution(matchId);

    const challenge: Challenge = {
      id,
      matchId,
      creator: raw.creator,
      creatorPick: Number(raw.creatorPick) as Outcome,
      opponent,
      taker,
      takerPick: taker ? (Number(raw.takerPick) as Outcome) : null,
      stake: raw.stake.toString(),
      status,
      result: await resultFor(matchId),
      kickoff: Number(raw.kickoff),
      createdAt: 0,
      creatorTgUsername: usernameFor(raw.creator),
      opponentTgUsername: taker ? usernameFor(taker) : undefined,
      match: matchById.get(matchId),
      aiRationale: resolution?.rationale,
      aiSource: resolution?.source,
      resolvedByAi: resolution?.resolvedByAi,
      resolveTxHash: resolution?.resolveTxHash,
    };
    if (!frozen && (status === ChallengeStatus.Settled || status === ChallengeStatus.Cancelled)) {
      terminalCache.set(id, raw); // freeze the raw chain read; never re-fetched
    }
    out.push(challenge);
  }

  // Detect since-last-poll transitions and nudge the relevant people. `primed`
  // is false on the very first poll (and after a restart, before the first
  // setChallenges), so we baseline the existing challenges silently instead of
  // blasting notifications for every historical bet.
  for (const c of out) {
    const prev = getChallenge(c.id);
    // open → matched: someone took the bet — nudge both sides.
    if (prev && prev.status === ChallengeStatus.Open && c.status === ChallengeStatus.Matched) {
      notifyAccepted(c);
    }
    // newly seen directed challenge, still open → DM the named opponent once.
    if (primed && !prev && c.status === ChallengeStatus.Open && c.opponent && !c.taker) {
      notifyChallenged(c);
    }
  }

  setChallenges(out);
  primed = true;
  return out;
}

/** Poll loop to keep the challenge cache fresh. */
export function startIndexer(intervalMs = 10_000): void {
  const tick = () =>
    reindex().catch((e) => console.warn('[indexer]', (e as Error).message));
  tick();
  setInterval(tick, intervalMs);
}
