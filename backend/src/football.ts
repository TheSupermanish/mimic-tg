import { config } from './config.js';
import { Match, MatchStatus, Outcome } from '@mimic/shared';

const BASE = 'https://api.football-data.org/v4';

/** Raw football-data.org match shape (subset we use). */
interface FdMatch {
  id: number;
  utcDate: string;
  status: MatchStatus;
  competition: { name: string; code: string };
  homeTeam: { name: string; crest?: string };
  awayTeam: { name: string; crest?: string };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    fullTime: { home: number | null; away: number | null };
  };
}

function mapOutcome(winner: FdMatch['score']['winner']): Outcome | undefined {
  switch (winner) {
    case 'HOME_TEAM':
      return Outcome.Home;
    case 'DRAW':
      return Outcome.Draw;
    case 'AWAY_TEAM':
      return Outcome.Away;
    default:
      return undefined;
  }
}

function mapMatch(m: FdMatch): Match {
  return {
    id: String(m.id),
    competition: m.competition?.name ?? m.competition?.code ?? 'Football',
    homeTeam: m.homeTeam?.name ?? 'TBD',
    awayTeam: m.awayTeam?.name ?? 'TBD',
    homeCrest: m.homeTeam?.crest,
    awayCrest: m.awayTeam?.crest,
    utcKickoff: m.utcDate,
    status: m.status,
    result: m.status === 'FINISHED' ? mapOutcome(m.score?.winner) : undefined,
    scoreHome: m.score?.fullTime?.home ?? undefined,
    scoreAway: m.score?.fullTime?.away ?? undefined,
  };
}

async function fdFetch(path: string): Promise<any> {
  if (!config.footballApiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Auth-Token': config.footballApiKey },
  });
  if (!res.ok) throw new Error(`football-data ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Upcoming fixtures cache (respects the 10 req/min free-tier limit) ─────
// We make a SINGLE /v4/matches call per refresh (all competitions in one
// request via the comma-separated `competitions` filter) and cache for 5
// minutes, so we stay far under the limit even with the resolver running.
let cache: { matches: Match[]; at: number } = { matches: [], at: 0 };
const CACHE_MS = 5 * 60_000;
let inflight: Promise<Match[]> | null = null;

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Upcoming (and recently finished) fixtures across configured competitions. */
export async function getMatches(force = false): Promise<Match[]> {
  if (!force && Date.now() - cache.at < CACHE_MS && cache.matches.length) {
    return cache.matches;
  }
  if (inflight) return inflight; // coalesce concurrent callers into one request

  inflight = (async () => {
    const dateFrom = isoDate(-2);
    const dateTo = isoDate(7); // /v4/matches caps the window at 10 days
    // one call for all the account's available competitions in the window
    const q = `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    try {
      const data = await fdFetch(q);
      // optional client-side narrowing by competition code (config.competitions)
      const wanted = new Set(config.competitions.map((c) => c.trim()).filter(Boolean));
      const raw = (data.matches ?? []) as any[];
      const filtered = wanted.size
        ? raw.filter((m) => wanted.has(m.competition?.code))
        : raw;
      const all = (filtered.length ? filtered : raw).map(mapMatch);
      all.sort((a: Match, b: Match) => a.utcKickoff.localeCompare(b.utcKickoff));
      cache = { matches: all, at: Date.now() };
      return all;
    } catch (e) {
      console.warn('[football] fetch failed:', (e as Error).message);
      return cache.matches; // serve stale on error (e.g. transient 429)
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Fetch a single match's current state (used by the resolver). */
export async function getMatch(id: string): Promise<Match | null> {
  try {
    const m: FdMatch = await fdFetch(`/matches/${id}`);
    return mapMatch(m);
  } catch (e) {
    console.warn(`[football] match ${id} fetch failed:`, (e as Error).message);
    return null;
  }
}
