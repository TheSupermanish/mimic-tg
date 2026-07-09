import { GoogleGenAI } from '@google/genai';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type { Match } from '@mimic/shared';
import { config } from './config.js';
import { getMatches } from './football.js';

/**
 * Per-match "facts" the football-data free tier doesn't give us — chiefly the
 * goalscorers — retrieved via Gemini's Google Search grounding and cached by
 * status:
 *   FINISHED → enriched once, then frozen + persisted to disk (results are
 *              immutable, so we never spend a grounded call on them again).
 *   IN_PLAY  → refreshed on a short TTL, storing the latest.
 *   else     → skipped (nothing to enrich yet).
 *
 * This is CHAT-ONLY colour. On-chain settlement still uses football-data's
 * authoritative result, so a grounding glitch can never move anyone's money.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const FACTS_FILE = resolve(__dirname, '../.data/match-facts.json');
const LIVE_TTL = 2 * 60_000;

export interface MatchFacts {
  matchId: string;
  teams: string; // "Argentina vs Egypt"
  competition: string;
  score: string; // "3-2" | "in progress"
  status: string;
  kickoff: string;
  summary: string; // grounded: goalscorers + one line of context
  grounded: boolean; // false when no reliable web data was found
  attempts: number; // grounding attempts so far (bounds retries on "no data")
  at: number;
}

const MAX_ATTEMPTS = 3; // give up on a stubborn "no data" match after this many tries
const RETRY_COOLDOWN = 60_000;

const facts = new Map<string, MatchFacts>();
const inflight = new Set<string>();

const ai = config.vertexProject
  ? new GoogleGenAI({ vertexai: true, project: config.vertexProject, location: config.vertexLocation })
  : config.geminiApiKey
    ? new GoogleGenAI({ apiKey: config.geminiApiKey })
    : null;

// Restore persisted (finished) facts so a restart never re-pays for them.
try {
  if (existsSync(FACTS_FILE)) {
    for (const f of JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as MatchFacts[])
      facts.set(f.matchId, { ...f, attempts: f.attempts ?? 0 });
    if (facts.size) console.log(`[facts] restored ${facts.size} match fact(s)`);
  }
} catch {
  /* no facts file yet — fine */
}

function persist(): void {
  try {
    mkdirSync(dirname(FACTS_FILE), { recursive: true });
    // only freeze FINISHED matches we actually grounded — a "no data" miss
    // shouldn't be cached forever (let a restart retry it).
    const frozen = [...facts.values()].filter((f) => f.status === 'FINISHED' && f.grounded);
    writeFileSync(FACTS_FILE, JSON.stringify(frozen, null, 2));
  } catch (e) {
    console.warn('[facts] persist failed:', (e as Error).message);
  }
}

/** Retry a grounded call on transient 429 / RESOURCE_EXHAUSTED with backoff. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (i < tries - 1 && /429|RESOURCE_EXHAUSTED|exhausted|rate/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

function needsEnrich(m: Match): boolean {
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  if (m.status !== 'FINISHED' && !live) return false;
  const f = facts.get(m.id);
  if (!f) return true;
  if (m.status === 'FINISHED') {
    if (f.grounded) return false; // frozen once we have real data
    // "no data" so far — retry a few times (spaced) before giving up
    return f.attempts < MAX_ATTEMPTS && Date.now() - f.at > RETRY_COOLDOWN;
  }
  return Date.now() - f.at > LIVE_TTL; // live: refresh on TTL
}

async function enrich(m: Match): Promise<void> {
  if (!ai || inflight.has(m.id)) return;
  inflight.add(m.id);
  try {
    const hasScore = typeof m.scoreHome === 'number' && typeof m.scoreAway === 'number';
    const score = hasScore ? `${m.scoreHome}-${m.scoreAway}` : 'in progress';
    const date = m.utcKickoff.slice(0, 10);
    const prompt =
      `Search the web for this exact real football match: ${m.homeTeam} vs ${m.awayTeam}, ` +
      `${m.competition}, on ${date}, ${m.status === 'FINISHED' ? `final score ${score}` : `currently ${score}`}. ` +
      `List the goalscorers for each team (with minute if known), plus one short line of context ` +
      `(stage / notable events). Be factual and concise, max 4 lines. Do not invent names — ` +
      `if you genuinely cannot find this specific match, reply with exactly NO_DATA.`;
    const r = await withRetry(() =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], maxOutputTokens: 400 },
      }),
    );
    const text = (r.text ?? '').trim();
    const grounded = text.length > 0 && !/^NO_DATA/i.test(text);
    facts.set(m.id, {
      matchId: m.id,
      teams: `${m.homeTeam} vs ${m.awayTeam}`,
      competition: m.competition,
      score,
      status: m.status,
      kickoff: m.utcKickoff,
      summary: grounded ? text : '',
      grounded,
      attempts: (facts.get(m.id)?.attempts ?? 0) + 1,
      at: Date.now(),
    });
    if (m.status === 'FINISHED') persist();
    console.log(`[facts] ${m.homeTeam} v ${m.awayTeam} ${score} → ${grounded ? 'enriched' : 'no data'}`);
  } catch (e) {
    console.warn(`[facts] enrich ${m.id} failed:`, (e as Error).message);
  } finally {
    inflight.delete(m.id);
  }
}

/**
 * Background backfill: enrich ONE match per tick (finished first) so we never
 * burst the grounding quota. Finished facts persist, so this is effectively a
 * one-time backfill that then goes quiet apart from live-match refreshes.
 */
export function startFactsWorker(intervalMs = 15_000): void {
  if (!ai) {
    console.warn('[facts] no Gemini configured — match enrichment disabled');
    return;
  }
  const tick = async () => {
    const matches = await getMatches().catch(() => [] as Match[]);
    // finished (un-enriched) first, then live due for a refresh
    const next =
      matches.find((m) => m.status === 'FINISHED' && needsEnrich(m)) ?? matches.find(needsEnrich);
    if (next) await enrich(next);
  };
  setTimeout(tick, 3000);
  setInterval(tick, intervalMs);
}

/** Grounded facts for recently-played matches, newest kickoff first. */
export function getRecentFacts(limit = 8): MatchFacts[] {
  return [...facts.values()]
    .filter((f) => f.grounded)
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, limit);
}

export function factsFor(matchId: string): MatchFacts | undefined {
  return facts.get(matchId);
}
