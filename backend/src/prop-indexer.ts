import { ZeroAddress } from 'ethers';
import { fromBaseUnits } from '@mimic/shared';
import { propReader } from './chain.js';
import { config } from './config.js';
import { getMatches } from './football.js';
import { setProps, getProp, getPropResolution, usernameFor, tgIdFor, type Prop } from './store.js';
import { notify } from './notify.js';

/** Telegram nudge both sides when a prop gets taken. */
function notifyPropAccepted(p: Prop): void {
  const stake = fromBaseUnits(BigInt(p.stake));
  const pot = fromBaseUnits(BigInt(p.stake) * 2n);
  const btn = config.botUsername
    ? { text: '🎟️ Track your prop', url: `https://t.me/${config.botUsername}?start=viewprop_${p.id}` }
    : undefined;
  const creatorTg = tgIdFor(p.creator);
  if (creatorTg)
    void notify(
      creatorTg,
      `🔥 <b>Your prop is on!</b>\nSomeone took the other side of "<b>${p.question}</b>". Pot <b>${pot} USDt</b> — it settles after the match (AI-judged). Good luck ⚽️`,
      btn,
    );
  const takerTg = p.taker ? tgIdFor(p.taker) : undefined;
  if (takerTg)
    void notify(
      takerTg,
      `✅ <b>You're in!</b>\nYou took "<b>${p.question}</b>" for <b>${stake} USDt</b>. Pot <b>${pot} USDt</b> 🍀`,
      btn,
    );
}

const terminal = new Set<number>(); // frozen ids (settled/cancelled) — skip re-reads
let primed = false;

export async function reindexProps(): Promise<Prop[]> {
  const market = propReader();
  if (!market) return [];
  const next = Number(await market.nextPropId());

  const matches = await getMatches().catch(() => []);
  const byId = new Map(matches.map((m) => [m.id, m]));

  const out: Prop[] = [];
  for (let id = 0; id < next; id++) {
    if (terminal.has(id)) {
      const kept = getProp(id);
      if (kept) {
        out.push(kept);
        continue;
      }
    }
    const raw = await market.getProp(id);
    const opponent = raw.opponent === ZeroAddress ? null : raw.opponent;
    const taker = raw.taker === ZeroAddress ? null : raw.taker;
    const status = Number(raw.status);
    const res = getPropResolution(id);
    out.push({
      id,
      question: raw.question,
      matchId: raw.matchId,
      creator: raw.creator,
      opponent,
      taker,
      stake: raw.stake.toString(),
      creatorBacksYes: raw.creatorBacksYes,
      result: Number(raw.result),
      status,
      resolveBy: Number(raw.resolveBy),
      creatorTgUsername: usernameFor(raw.creator),
      opponentTgUsername: taker
        ? usernameFor(taker)
        : opponent
          ? usernameFor(opponent)
          : undefined,
      match: byId.get(raw.matchId),
      aiRationale: res?.rationale,
      aiSource: res?.source,
      resolveTxHash: res?.resolveTxHash,
    });
    if (status === 2 || status === 3) terminal.add(id); // Settled / Cancelled
  }

  // open → matched: nudge both sides
  for (const p of out) {
    const prev = getProp(p.id);
    if (primed && prev && prev.status === 0 && p.status === 1) notifyPropAccepted(p);
  }

  setProps(out);
  primed = true;
  return out;
}

export function startPropIndexer(intervalMs = 12_000): void {
  const tick = () =>
    reindexProps().catch((e) => console.warn('[props]', (e as Error).message));
  tick();
  setInterval(tick, intervalMs);
}
