import type { Challenge, LeaderboardEntry, Match } from '@mimic/shared';
import { config } from './config.js';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${config.backendUrl}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  matches: () => get<{ matches: Match[] }>('/matches').then((r) => r.matches).catch(() => []),
  openMarkets: () =>
    get<{ challenges: Challenge[] }>('/markets?status=open').then((r) => r.challenges).catch(() => []),
  leaderboard: () =>
    get<{ leaderboard: LeaderboardEntry[] }>('/leaderboard').then((r) => r.leaderboard).catch(() => []),
};
