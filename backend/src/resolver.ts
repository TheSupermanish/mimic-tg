import { ChallengeStatus, Outcome } from '@mimic/shared';
import { marketResolver, marketReader } from './chain.js';
import { getMatches } from './football.js';
import { allChallenges } from './store.js';

export interface SettlementEvent {
  challengeId: number;
  winner: string | null; // null = refund (draw / neither pick)
  matchId: string;
  result: Outcome;
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

  // 1. resolve finished fixtures
  for (const matchId of matchedMatchIds) {
    const onchain = Number(await reader.matchResult(matchId)) as Outcome;
    if (onchain !== Outcome.Pending) continue; // already resolved

    const match = byId.get(matchId);
    if (!match || match.status !== 'FINISHED' || !match.result) continue;

    try {
      const tx = await resolver.resolve(matchId, match.result);
      await tx.wait();
      console.log(`[resolver] resolved ${matchId} -> ${Outcome[match.result]}`);
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
      console.log(`[resolver] settled challenge ${c.id}, winner=${winner ?? 'refund'}`);
      onSettled?.({ challengeId: c.id, winner, matchId: c.matchId, result });
      void receipt;
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
