/** Domain types shared across contracts, backend, bot and miniapp. */

/**
 * Match outcome / a bettor's pick. Mirrors the Solidity `Outcome` enum.
 * `Pending` (0) means "not yet resolved" and is never a valid pick.
 */
export enum Outcome {
  Pending = 0,
  Home = 1,
  Draw = 2,
  Away = 3,
}

/** Lifecycle of a head-to-head challenge. Mirrors the Solidity `Status` enum exactly. */
export enum ChallengeStatus {
  Open = 0, // created, waiting for a taker
  Matched = 1, // taker locked opposing stake
  Settled = 2, // pot paid out / refunded
  Cancelled = 3, // refunded to creator, never matched
}

/** A football fixture as surfaced to clients (subset of football-data.org). */
export interface Match {
  id: string; // football-data.org match id (as string)
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeCrest?: string;
  awayCrest?: string;
  utcKickoff: string; // ISO timestamp
  status: MatchStatus;
  result?: Outcome; // set once FINISHED
  scoreHome?: number;
  scoreAway?: number;
}

export type MatchStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'FINISHED'
  | 'POSTPONED'
  | 'SUSPENDED'
  | 'CANCELLED';

/** A head-to-head challenge, as indexed from on-chain events + enriched. */
export interface Challenge {
  id: number;
  matchId: string;
  creator: string; // wallet address
  creatorPick: Outcome; // Home | Draw | Away
  opponent: string | null; // null = open challenge, address = directed
  taker: string | null; // wallet address once matched
  takerPick: Outcome | null;
  stake: string; // USDt base units (6 decimals) as string
  status: ChallengeStatus;
  result: Outcome; // Pending until resolved
  kickoff: number; // fixture start, unix seconds; no accepts once reached
  createdAt: number; // unix seconds
  // Enrichment (off-chain):
  creatorTgUsername?: string;
  opponentTgUsername?: string;
  match?: Match;
  // How the fixture was resolved (present once settled):
  aiRationale?: string; // human-readable "why", from the AI resolver
  aiSource?: string; // where the result was confirmed
  resolvedByAi?: boolean;
}

/** Telegram user identity resolved after initData validation. */
export interface TelegramUser {
  id: number;
  username?: string;
  firstName?: string;
}

/** Maps a Telegram user to their self-custodial wallet address. */
export interface UserWalletLink {
  telegramId: number;
  username?: string;
  address: string;
}

/** A single row on the social leaderboard, tallied from settled challenges. */
export interface LeaderboardEntry {
  address: string;
  username?: string;
  wins: number;
  losses: number;
  pushes: number; // draw-refunds — neither side's pick hit
  net: string; // net USDt in base units (can be negative), as string
  volume: string; // total USDt staked, base units
}
