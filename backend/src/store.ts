import { Challenge, UserWalletLink } from '@mimic/shared';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

/**
 * In-memory store with disk-backed Telegram↔wallet links. Challenges are always
 * re-read from chain by the indexer, but the identity links (username↔address)
 * only exist off-chain, so they're persisted to a JSON file to survive restarts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINKS_FILE = resolve(__dirname, '../.data/links.json');

const walletByTgId = new Map<number, UserWalletLink>();
const tgIdByAddress = new Map<string, number>();
const usernameByAddress = new Map<string, string>();

function indexLink(link: UserWalletLink): void {
  walletByTgId.set(link.telegramId, link);
  tgIdByAddress.set(link.address.toLowerCase(), link.telegramId);
  if (link.username) usernameByAddress.set(link.address.toLowerCase(), link.username);
}

function persistLinks(): void {
  try {
    mkdirSync(dirname(LINKS_FILE), { recursive: true });
    writeFileSync(LINKS_FILE, JSON.stringify([...walletByTgId.values()]));
  } catch (e) {
    console.warn('[store] persist links failed:', (e as Error).message);
  }
}

// Load persisted links on boot so usernames/auth survive a restart.
try {
  const saved = JSON.parse(readFileSync(LINKS_FILE, 'utf8')) as UserWalletLink[];
  for (const l of saved) indexLink(l);
  if (saved.length) console.log(`[store] restored ${saved.length} wallet link(s)`);
} catch {
  /* no links file yet — fine */
}

export function linkWallet(link: UserWalletLink): void {
  indexLink(link);
  persistLinks();
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

// ─── Resolution verdicts (how each fixture was resolved) ────────────────────

export interface ResolutionRecord {
  matchId: string;
  rationale: string; // human-readable "why", from the AI
  source: string; // where it was confirmed
  confidence: number; // 0..1
  resolvedByAi: boolean;
}

const resolutionByMatchId = new Map<string, ResolutionRecord>();

export function setResolution(r: ResolutionRecord): void {
  resolutionByMatchId.set(r.matchId, r);
}

export function getResolution(matchId: string): ResolutionRecord | undefined {
  return resolutionByMatchId.get(matchId);
}
