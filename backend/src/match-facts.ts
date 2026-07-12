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
const PREVIEW_TTL = 6 * 3_600_000; // upcoming previews refresh every ~6h as form changes

export interface MatchFacts {
  matchId: string;
  teams: string; // "Argentina vs Egypt"
  competition: string;
  score: string; // "3-2" | "in progress"
  status: string;
  kind: 'result' | 'preview'; // result = scorers/events; preview = form + H2H
  kickoff: string;
  summary: string; // grounded: goalscorers+events (result) or form+H2H (preview)
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
      facts.set(f.matchId, { ...f, attempts: f.attempts ?? 0, kind: f.kind ?? 'result' });
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

/** Strip Google-Search-grounding artifacts (citations, brackets, dupes, markdown). */
function cleanGrounded(text: string): string {
  let t = text
    .replace(/\[cite[^\]]*\]?/gi, '') // [cite: 1], and truncated "[cite: 1"
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '') // [1], [2, 3]
    .replace(/\((?:https?:\/\/|source:)[^)]*\)/gi, '') // (source: ...) / (http...)
    .replace(/\*\*/g, '') // markdown bold
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // grounded output sometimes repeats the whole answer twice back-to-back —
  // if the second half duplicates the first, keep just the first.
  const half = Math.floor(t.length / 2);
  if (t.length > 40 && t.slice(0, half).trim() && t.slice(half).trim().startsWith(t.slice(0, 20).trim())) {
    t = t.slice(0, half).trim();
  }
  return t;
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

function isUpcoming(m: Match): boolean {
  // test each name separately — concatenating "TBD"+"TBD" defeats \btbd\b
  const tbd = /\btbd\b/i.test(m.homeTeam) || /\btbd\b/i.test(m.awayTeam);
  return (
    (m.status === 'SCHEDULED' || m.status === 'TIMED') &&
    !tbd &&
    new Date(m.utcKickoff).getTime() > Date.now()
  );
}

function needsEnrich(m: Match): boolean {
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const upcoming = isUpcoming(m);
  if (m.status !== 'FINISHED' && !live && !upcoming) return false;
  const f = facts.get(m.id);
  if (!f) return true;
  if (m.status === 'FINISHED') {
    if (f.grounded) return false; // frozen once we have real data
    // "no data" so far — retry a few times (spaced) before giving up
    return f.attempts < MAX_ATTEMPTS && Date.now() - f.at > RETRY_COOLDOWN;
  }
  if (upcoming) {
    // previews go stale as form changes — refresh on a long TTL
    if (f.grounded) return Date.now() - f.at > PREVIEW_TTL;
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
    const preview = isUpcoming(m);
    const prompt = preview
      ? `Give a short pre-match briefing for ${m.homeTeam} vs ${m.awayTeam} (${m.competition}), kicking off around ${date}. ` +
        `Cover recent form (last 5 results) for each team, their historical head-to-head, and 1-2 key players to watch. ` +
        `Use web search and general football knowledge. Do NOT predict or invent the result of this specific upcoming match. ` +
        `Keep it factual, max 5 short lines. Only reply NO_DATA if you genuinely know nothing about these teams.`
      : [
          `Real football match: ${m.homeTeam} vs ${m.awayTeam} — ${m.competition}, ${date}.`,
          m.status === 'FINISHED' ? `Final score: ${m.homeTeam} ${score} ${m.awayTeam}.` : `Live, currently ${score}.`,
          `Search the web and report the facts. Do NOT invent anything.`,
          `Reply in EXACTLY this plain-text format, nothing else:`,
          `<one sentence: the result and how it went — stage, and if it went to extra time / penalties>`,
          `Goalscorers:`,
          `- ${m.homeTeam}: <Player> <min>', <Player> <min>'   (or "none")`,
          `- ${m.awayTeam}: <Player> <min>', <Player> <min>'   (or "none")`,
          `Rules: plain text only. NO markdown, NO asterisks, NO citation markers like [1] or [cite: ...], NO source links.`,
          `If you genuinely cannot find this specific match, reply with exactly: NO_DATA`,
        ].join('\n');
    const r = await withRetry(() =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0, maxOutputTokens: 450 },
      }),
    );
    const text = cleanGrounded((r.text ?? '').trim());
    // Result facts must actually carry a Goalscorers block to count as grounded
    // (otherwise retry); previews just need real, non-empty content.
    const grounded = preview
      ? text.length > 15 && !/^NO_DATA/i.test(text)
      : text.length > 15 && !/^NO_DATA/i.test(text) && /goalscorer/i.test(text);
    facts.set(m.id, {
      matchId: m.id,
      teams: `${m.homeTeam} vs ${m.awayTeam}`,
      competition: m.competition,
      score,
      status: m.status,
      kind: preview ? 'preview' : 'result',
      kickoff: m.utcKickoff,
      summary: grounded ? text : '',
      grounded,
      attempts: (facts.get(m.id)?.attempts ?? 0) + 1,
      at: Date.now(),
    });
    if (m.status === 'FINISHED') persist();
    console.log(
      `[facts] ${preview ? 'preview' : 'result'} ${m.homeTeam} v ${m.awayTeam} → ${grounded ? 'ok' : 'no data'}`,
    );
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
    const needy = matches.filter(needsEnrich);
    // Priority: live (fast-changing) → soonest upcoming (the previews users open
    // before betting) → finished backfill. Upcoming no longer starves behind old
    // results. Finished facts persist, so after a restart they're already done
    // and the worker heads straight to upcoming.
    const live = needy.find((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    const upcoming = needy
      .filter(isUpcoming)
      .sort((a, b) => a.utcKickoff.localeCompare(b.utcKickoff))[0];
    const finished = needy.find((m) => m.status === 'FINISHED');
    const next = live ?? upcoming ?? finished;
    if (next) await enrich(next);
  };
  setTimeout(tick, 3000);
  setInterval(tick, intervalMs);
}

/** Grounded RESULT facts (scorers) for recently-played matches, newest first.
 * Previews are excluded — they belong to the match detail view, not the AI's
 * "who scored" context. */
export function getRecentFacts(limit = 8): MatchFacts[] {
  return [...facts.values()]
    .filter((f) => f.grounded && f.kind !== 'preview')
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, limit);
}

export function factsFor(matchId: string): MatchFacts | undefined {
  return facts.get(matchId);
}
