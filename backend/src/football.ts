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
      const source = filtered.length ? filtered : raw;
      // track which competitions are in play so getInsights() knows what to fetch
      activeCodes = [...new Set(source.map((m: any) => m.competition?.code).filter(Boolean))];
      for (const m of source) {
        if (m.competition?.code) compName.set(m.competition.code, m.competition.name ?? m.competition.code);
      }
      const all = source.map(mapMatch);
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

// ─── Competition insights: top scorers + standings ─────────────────────────
// These give the AI real grounding (who's scoring, who's top of the group)
// without per-match detail (goalscorers aren't on the free tier). Cached for
// 30 min per competition, so we add at most ~2 API calls per active comp per
// half-hour — far under the 10 req/min limit.
export interface ScorerRow {
  player: string;
  team: string;
  goals: number;
  assists: number | null;
}
export interface StandingRow {
  position: number;
  team: string;
  played: number;
  points: number;
  goalDiff: number;
}
export interface CompetitionInsight {
  code: string;
  name: string;
  scorers: ScorerRow[];
  standings: { group: string; table: StandingRow[] }[];
}

const INSIGHT_MS = 30 * 60_000;
const compName = new Map<string, string>(); // code → display name
let activeCodes: string[] = []; // competition codes present in the current fixtures
const scorerCache = new Map<string, { rows: ScorerRow[]; at: number }>();
const standingCache = new Map<string, { groups: CompetitionInsight['standings']; at: number }>();

async function getScorers(code: string, limit = 10): Promise<ScorerRow[]> {
  const cached = scorerCache.get(code);
  if (cached && Date.now() - cached.at < INSIGHT_MS) return cached.rows;
  try {
    const data = await fdFetch(`/competitions/${code}/scorers?limit=${limit}`);
    const rows: ScorerRow[] = (data.scorers ?? []).map((s: any) => ({
      player: s.player?.name ?? '—',
      team: s.team?.name ?? '—',
      goals: s.goals ?? 0,
      assists: s.assists ?? null,
    }));
    scorerCache.set(code, { rows, at: Date.now() });
    return rows;
  } catch (e) {
    console.warn(`[football] scorers ${code} failed:`, (e as Error).message);
    return cached?.rows ?? []; // serve stale on error
  }
}

async function getStandings(code: string): Promise<CompetitionInsight['standings']> {
  const cached = standingCache.get(code);
  if (cached && Date.now() - cached.at < INSIGHT_MS) return cached.groups;
  try {
    const data = await fdFetch(`/competitions/${code}/standings`);
    const groups: CompetitionInsight['standings'] = (data.standings ?? [])
      .filter((s: any) => s.type === 'TOTAL')
      .map((s: any) => ({
        group: s.group ?? 'Table',
        table: (s.table ?? []).map((r: any) => ({
          position: r.position,
          team: r.team?.name ?? '—',
          played: r.playedGames ?? 0,
          points: r.points ?? 0,
          goalDiff: r.goalDifference ?? 0,
        })),
      }));
    standingCache.set(code, { groups, at: Date.now() });
    return groups;
  } catch (e) {
    console.warn(`[football] standings ${code} failed:`, (e as Error).message);
    return cached?.groups ?? []; // serve stale on error
  }
}

/** Top scorers + standings for the competitions currently in play. */
export async function getInsights(): Promise<CompetitionInsight[]> {
  if (!activeCodes.length) await getMatches().catch(() => {});
  const out: CompetitionInsight[] = [];
  // cap to 3 comps so a cold cache can never burst past the rate limit
  for (const code of activeCodes.slice(0, 3)) {
    const [scorers, standings] = [await getScorers(code), await getStandings(code)];
    out.push({ code, name: compName.get(code) ?? code, scorers, standings });
  }
  return out;
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
