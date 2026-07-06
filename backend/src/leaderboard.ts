import { ChallengeStatus, LeaderboardEntry } from '@mimic/shared';
import { allChallenges, usernameFor } from './store.js';

interface Tally {
  wins: number;
  losses: number;
  pushes: number;
  net: bigint;
  volume: bigint;
}

/**
 * Builds the social leaderboard from settled challenges. Winner nets +stake,
 * loser nets -stake; a draw-refund (neither pick hit) is a push for both.
 * Optionally scoped to a set of addresses (e.g. a single group's members).
 */
export function leaderboard(addresses?: string[]): LeaderboardEntry[] {
  const scope = addresses ? new Set(addresses.map((a) => a.toLowerCase())) : null;
  const tallies = new Map<string, Tally>();

  const bump = (addr: string, fn: (t: Tally) => void) => {
    const key = addr.toLowerCase();
    if (scope && !scope.has(key)) return;
    const t = tallies.get(key) ?? { wins: 0, losses: 0, pushes: 0, net: 0n, volume: 0n };
    fn(t);
    tallies.set(key, t);
  };

  for (const c of allChallenges()) {
    if (c.status !== ChallengeStatus.Settled || !c.taker) continue;
    const stake = BigInt(c.stake);
    bump(c.creator, (t) => (t.volume += stake));
    bump(c.taker, (t) => (t.volume += stake));

    if (c.result === c.creatorPick) {
      bump(c.creator, (t) => ((t.wins += 1), (t.net += stake)));
      bump(c.taker, (t) => ((t.losses += 1), (t.net -= stake)));
    } else if (c.result === c.takerPick) {
      bump(c.taker, (t) => ((t.wins += 1), (t.net += stake)));
      bump(c.creator, (t) => ((t.losses += 1), (t.net -= stake)));
    } else {
      bump(c.creator, (t) => (t.pushes += 1));
      bump(c.taker, (t) => (t.pushes += 1));
    }
  }

  const rows: LeaderboardEntry[] = [...tallies.entries()].map(([address, t]) => ({
    address,
    username: usernameFor(address),
    wins: t.wins,
    losses: t.losses,
    pushes: t.pushes,
    net: t.net.toString(),
    volume: t.volume.toString(),
  }));

  // rank by net winnings, then win count
  rows.sort((a, b) => {
    const d = BigInt(b.net) - BigInt(a.net);
    if (d !== 0n) return d > 0n ? 1 : -1;
    return b.wins - a.wins;
  });
  return rows;
}
