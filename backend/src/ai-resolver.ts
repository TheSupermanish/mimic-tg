import { GoogleGenAI } from '@google/genai';
import { Match, Outcome } from '@mimic/shared';
import { config } from './config.js';

/**
 * AI market resolver. The football-data.org full-time score is authoritative
 * ground truth; Gemini corroborates it (and web sources via Google Search
 * grounding), produces a human-readable rationale + confidence, and can resolve
 * edge cases where no structured score is available. A confidence gate and a
 * consistency check with the score protect against hallucinated outcomes.
 */
const client = config.vertexProject
  ? new GoogleGenAI({
      vertexai: true,
      project: config.vertexProject,
      location: config.vertexLocation,
    })
  : config.geminiApiKey
    ? new GoogleGenAI({ apiKey: config.geminiApiKey })
    : null;

export function aiResolverEnabled(): boolean {
  return client !== null;
}

export interface AiVerdict {
  outcome: Outcome; // Home | Draw | Away (never Pending on success)
  confidence: number; // 0..1
  rationale: string; // one short sentence
  source: string; // e.g. "football-data.org / BBC Sport"
}

function parseOutcome(s: unknown): Outcome {
  const u = String(s ?? '').toUpperCase();
  if (u.includes('HOME')) return Outcome.Home;
  if (u.includes('DRAW') || u.includes('TIE')) return Outcome.Draw;
  if (u.includes('AWAY')) return Outcome.Away;
  return Outcome.Pending;
}

/**
 * Ask Gemini for a 1X2 verdict on a finished fixture. Returns null if the AI is
 * unavailable or can't produce a usable verdict (caller falls back to score).
 */
export async function aiResolve(match: Match): Promise<AiVerdict | null> {
  if (!client) return null;

  const hasScore =
    typeof match.scoreHome === 'number' && typeof match.scoreAway === 'number';

  const prompt = [
    `A football match has finished: ${match.homeTeam} (home) vs ${match.awayTeam} (away) — ${match.competition}, kickoff ${match.utcKickoff}.`,
    hasScore
      ? `The authoritative full-time score from football-data.org is ${match.homeTeam} ${match.scoreHome}–${match.scoreAway} ${match.awayTeam}. Treat this score as ground truth and confirm it against reputable sources.`
      : `No structured score was available from the primary data source — determine the final result from reliable web/news sources.`,
    `Decide the 1X2 outcome: HOME if ${match.homeTeam} won, AWAY if ${match.awayTeam} won, DRAW if the match was level at full time.`,
    `Respond with ONLY a compact JSON object, no markdown, no prose:`,
    `{"outcome":"HOME|DRAW|AWAY","confidence":0.0-1.0,"rationale":"one short sentence a fan would understand","source":"where you confirmed it, e.g. football-data.org / BBC Sport"}`,
  ].join('\n');

  try {
    let res: Awaited<ReturnType<typeof client.models.generateContent>> | undefined;
    for (let i = 0; i < 3; i++) {
      try {
        res = await client.models.generateContent({
          model: config.geminiModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            // Google Search grounding for real corroboration. If the project lacks
            // grounding the call throws and we fall back to the score — safe.
            tools: [{ googleSearch: {} }],
            temperature: 0,
            maxOutputTokens: 400,
          },
        });
        break;
      } catch (e) {
        const msg = (e as Error).message || '';
        if (i < 2 && /429|RESOURCE_EXHAUSTED|exhausted|rate/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    if (!res) return null;

    const text = (res.text ?? '').trim();
    const blob = text.match(/\{[\s\S]*\}/);
    if (!blob) return null;
    const parsed = JSON.parse(blob[0]);

    const outcome = parseOutcome(parsed.outcome);
    if (outcome === Outcome.Pending) return null;

    return {
      outcome,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      rationale: String(parsed.rationale ?? '').slice(0, 200),
      source: String(parsed.source ?? '').slice(0, 80) || 'AI',
    };
  } catch (e) {
    console.warn('[ai-resolve]', (e as Error).message);
    return null;
  }
}
