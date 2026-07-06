import { Challenge, UserWalletLink } from '@mimic/shared';

/**
 * In-memory store. Fine for the hackathon demo; swap for SQLite/Postgres later.
 * Holds Telegram↔wallet links and the indexed challenge set.
 */

const walletByTgId = new Map<number, UserWalletLink>();
const tgIdByAddress = new Map<string, number>();
const usernameByAddress = new Map<string, string>();

export function linkWallet(link: UserWalletLink): void {
  walletByTgId.set(link.telegramId, link);
  tgIdByAddress.set(link.address.toLowerCase(), link.telegramId);
  if (link.username) usernameByAddress.set(link.address.toLowerCase(), link.username);
}

export function getLinkByTgId(id: number): UserWalletLink | undefined {
  return walletByTgId.get(id);
}

export function getLinkByUsername(username: string): UserWalletLink | undefined {
  const u = username.replace(/^@/, '').toLowerCase();
  for (const link of walletByTgId.values()) {
    if (link.username?.toLowerCase() === u) return link;
  }
  return undefined;
}

export function usernameFor(address: string): string | undefined {
  return usernameByAddress.get(address.toLowerCase());
}

export function tgIdFor(address: string): number | undefined {
  return tgIdByAddress.get(address.toLowerCase());
}

// ─── Challenge cache (rebuilt by the indexer) ──────────────────────────────
let challenges: Map<number, Challenge> = new Map();

export function setChallenges(list: Challenge[]): void {
  challenges = new Map(list.map((c) => [c.id, c]));
}

export function upsertChallenge(c: Challenge): void {
  challenges.set(c.id, c);
}

export function getChallenge(id: number): Challenge | undefined {
  return challenges.get(id);
}

export function allChallenges(): Challenge[] {
  return [...challenges.values()].sort((a, b) => b.id - a.id);
}
