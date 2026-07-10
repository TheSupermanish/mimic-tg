import { GoogleGenAI } from '@google/genai';
import { fromBaseUnits, type Match } from '@mimic/shared';
import { propResolver } from './chain.js';
import { config } from './config.js';
import { getMatches } from './football.js';
import { allProps, setPropResolution, tgIdFor, type Prop } from './store.js';
import { notify } from './notify.js';

const ai = config.vertexProject
  ? new GoogleGenAI({ vertexai: true, project: config.vertexProject, location: config.vertexLocation })
  : config.geminiApiKey
    ? new GoogleGenAI({ apiKey: config.geminiApiKey })
    : null;

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

// Result enum: 1 Yes, 2 No, 3 Void
interface Verdict {
  result: number;
  rationale: string;
  source: string;
  confidence: number;
}

/** Grounded YES/NO judgement of a prop. Anything not confidently verifiable
 * returns VOID (3), so on-chain both stakes are refunded. */
async function judgeProp(p: Prop, match?: Match): Promise<Verdict> {
  if (!ai) return { result: 3, rationale: 'No AI oracle configured — voided.', source: '', confidence: 0 };
  const teams = match ? `${match.homeTeam} vs ${match.awayTeam}` : `match ${p.matchId}`;
  const date = match ? match.utcKickoff.slice(0, 10) : '';
  const score =
    match && match.scoreHome != null
      ? `Final score: ${match.homeTeam} ${match.scoreHome}-${match.scoreAway} ${match.awayTeam}.`
      : '';
  const prompt =
    `Judge this YES/NO football prop bet using web search. Match: ${teams} on ${date}. ${score} ` +
    `Prop: "${p.question}". Did it actually happen? ` +
    `Reply strictly as JSON: {"verdict":"YES|NO|UNKNOWN","confidence":0-1,"reason":"one sentence","source":"where confirmed"}. ` +
    `Use UNKNOWN if you cannot verify it from reliable sources — do not guess.`;
  try {
    const r = await withRetry(() =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], maxOutputTokens: 500 },
      }),
    );
    const text = (r.text ?? '').replace(/```json|```/g, '').trim();
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const v = String(j.verdict || '').toUpperCase();
    const conf = Number(j.confidence) || 0;
    if (v === 'YES' && conf >= 0.6) return { result: 1, rationale: j.reason || '', source: j.source || 'web', confidence: conf };
    if (v === 'NO' && conf >= 0.6) return { result: 2, rationale: j.reason || '', source: j.source || 'web', confidence: conf };
    return {
      result: 3,
      rationale: j.reason ? `Couldn't verify confidently: ${j.reason}` : 'Could not verify — voided, stakes refunded.',
      source: j.source || '',
      confidence: conf,
    };
  } catch (e) {
    console.warn(`[props] judge ${p.id} failed:`, (e as Error).message);
    return { result: 3, rationale: 'Verification failed — voided, stakes refunded.', source: '', confidence: 0 };
  }
}

function settleNotify(p: Prop, result: number, rationale: string, txHash?: string): void {
  const pot = fromBaseUnits(BigInt(p.stake) * 2n);
  const receipt =
    (rationale ? `\n🤖 ${rationale}` : '') +
    (txHash && config.explorer ? `\n🔗 <a href="${config.explorer}/tx/${txHash}">View on BaseScan</a>` : '');
  if (result === 3) {
    for (const addr of [p.creator, p.taker].filter(Boolean) as string[]) {
      const tg = tgIdFor(addr);
      if (tg) void notify(tg, `↩️ Prop "<b>${p.question}</b>" couldn't be verified — voided, your stake was refunded.${receipt}`);
    }
    return;
  }
  const yesWon = result === 1;
  const winner = yesWon === p.creatorBacksYes ? p.creator : p.taker;
  const loser = winner === p.creator ? p.taker : p.creator;
  const wtg = winner ? tgIdFor(winner) : undefined;
  if (wtg) void notify(wtg, `🏆 You won <b>${pot} USDt</b> on "<b>${p.question}</b>"!${receipt}`);
  const ltg = loser ? tgIdFor(loser) : undefined;
  if (ltg) void notify(ltg, `😔 Your prop "<b>${p.question}</b>" didn't land.${receipt}`);
}

export async function runPropResolverTick(): Promise<void> {
  const resolver = propResolver();
  if (!resolver) return;
  const matches = await getMatches().catch(() => []);
  const byId = new Map(matches.map((m) => [m.id, m]));
  const now = Math.floor(Date.now() / 1000);

  for (const p of allProps()) {
    if (p.status !== 1) continue; // only matched props settle
    const match = byId.get(p.matchId);
    let result = p.result;
    let rationale = p.aiRationale ?? '';

    if (result === 0) {
      if (now < p.resolveBy) continue; // too early
      if (match && match.status !== 'FINISHED') continue; // wait for the whistle
      const verdict = await judgeProp(p, match);
      try {
        const tx = await resolver.resolve(p.id, verdict.result);
        await tx.wait();
        result = verdict.result;
        rationale = verdict.rationale;
        setPropResolution({
          id: p.id,
          rationale: verdict.rationale,
          source: verdict.source,
          confidence: verdict.confidence,
          result: verdict.result,
          resolveTxHash: tx.hash,
        });
        console.log(`[props] resolved ${p.id} -> ${['', 'YES', 'NO', 'VOID'][verdict.result]} (${verdict.confidence})`);
      } catch (e) {
        console.warn(`[props] resolve ${p.id} failed:`, (e as Error).message);
        continue;
      }
    }
    if (result === 0) continue;

    try {
      const tx = await resolver.claim(p.id);
      const rc = await tx.wait();
      settleNotify(p, result, rationale, rc?.hash);
      console.log(`[props] settled ${p.id}`);
    } catch (e) {
      console.warn(`[props] claim ${p.id} failed:`, (e as Error).message);
    }
  }
}

export function startPropResolver(intervalMs = 30_000): void {
  const tick = () =>
    runPropResolverTick().catch((e) => console.warn('[props-resolver]', (e as Error).message));
  setInterval(tick, intervalMs);
}
