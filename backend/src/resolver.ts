import { ChallengeStatus, Outcome } from '@mimic/shared';
import { marketResolver, marketReader } from './chain.js';
import { getMatches } from './football.js';
import { allChallenges, setResolution, getResolution } from './store.js';
import { aiResolve } from './ai-resolver.js';

export interface SettlementEvent {
  challengeId: number;
  winner: string | null; // null = refund (draw / neither pick)
  matchId: string;
  result: Outcome;
  rationale?: string; // how it was resolved (AI)
  source?: string;
  txHash?: string; // the on-chain settlement (claim) tx
}

type OnSettled = (e: SettlementEvent) => void;

/**
 * Resolver worker:
 *  1. For each fixture with a live matched challenge, if the match is FINISHED
 *     and not yet resolved on-chain, record the result via resolve().
 *  2. Auto-settle (permissionless claim) any matched challenge whose fixture is
 *     now resolved, so winners are paid without lifting a finger.
 */
export async function runResolverTick(onSettled?: OnSettled): Promise<void> {
  const resolver = marketResolver();
  if (!resolver) return; // no resolver key configured
  const reader = marketReader();

  const challenges = allChallenges();
  const matchedMatchIds = [
    ...new Set(challenges.filter((c) => c.status === ChallengeStatus.Matched).map((c) => c.matchId)),
  ];

  // read fixtures from the cached list (no extra API calls per fixture)
  const fixtures = await getMatches().catch(() => []);
  const byId = new Map(fixtures.map((m) => [m.id, m]));

  // 1. resolve finished fixtures — AI verdict, with the score as ground truth
  for (const matchId of matchedMatchIds) {
    const onchain = Number(await reader.matchResult(matchId)) as Outcome;
    if (onchain !== Outcome.Pending) continue; // already resolved

    const match = byId.get(matchId);
    if (!match || match.status !== 'FINISHED') continue;

    const scoreOutcome = (match.result ?? Outcome.Pending) as Outcome;
    const verdict = await aiResolve(match); // corroboration + rationale (+ edge cases)

    // Decide the final outcome. Score is authoritative when present; AI supplies
    // the human-readable rationale and can resolve when no score is available.
    let finalOutcome = scoreOutcome;
    let rationale =
      match.scoreHome != null ? `Full-time ${match.homeTeam} ${match.scoreHome}–${match.scoreAway} ${match.awayTeam}.` : '';
    let source = 'football-data.org';
    let byAi = false;

    if (scoreOutcome !== Outcome.Pending) {
      if (verdict) {
        byAi = true;
        rationale = verdict.rationale || rationale;
        source = verdict.source || source;
        // AI strongly contradicts the authoritative score → hold for review.
        if (verdict.outcome !== scoreOutcome && verdict.confidence >= 0.6) {
          console.warn(
            `[resolver] AI (${verdict.confidence}) disagrees with score for ${matchId}; holding for review`,
          );
          continue;
        }
      }
    } else {
      // No structured score — rely on the AI, but only when it's confident.
      if (!verdict || verdict.confidence < 0.7) {
        console.warn(`[resolver] no score + low AI confidence for ${matchId}; holding`);
        continue;
      }
      finalOutcome = verdict.outcome;
      rationale = verdict.rationale;
      source = verdict.source;
      byAi = true;
    }

    if (finalOutcome === Outcome.Pending) continue;

    try {
      const tx = await resolver.resolve(matchId, finalOutcome);
      await tx.wait();
      setResolution({
        matchId,
        rationale,
        source,
        confidence: verdict?.confidence ?? 1,
        resolvedByAi: byAi,
        resolveTxHash: tx.hash,
      });
      console.log(
        `[resolver] resolved ${matchId} -> ${Outcome[finalOutcome]}${byAi ? ' (AI: ' + rationale + ')' : ''}`,
      );
    } catch (e) {
      console.warn(`[resolver] resolve ${matchId} failed:`, (e as Error).message);
    }
  }

  // 2. auto-settle matched challenges whose fixture is resolved
  for (const c of challenges) {
    if (c.status !== ChallengeStatus.Matched) continue;
    const result = Number(await reader.matchResult(c.matchId)) as Outcome;
    if (result === Outcome.Pending) continue;

    try {
      const tx = await resolver.claim(c.id);
      const receipt = await tx.wait();
      const winner =
        result === c.creatorPick ? c.creator : result === c.takerPick ? c.taker : null;
      const res = getResolution(c.matchId);
      console.log(`[resolver] settled challenge ${c.id}, winner=${winner ?? 'refund'}, tx=${receipt?.hash}`);
      onSettled?.({
        challengeId: c.id,
        winner,
        matchId: c.matchId,
        result,
        rationale: res?.rationale,
        source: res?.source,
        txHash: receipt?.hash,
      });
    } catch (e) {
      console.warn(`[resolver] claim ${c.id} failed:`, (e as Error).message);
    }
  }
}

export function startResolver(intervalMs = 30_000, onSettled?: OnSettled): void {
  const tick = () =>
    runResolverTick(onSettled).catch((e) => console.warn('[resolver]', (e as Error).message));
  setInterval(tick, intervalMs);
}
