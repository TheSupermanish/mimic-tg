import { GoogleGenAI, type Content } from '@google/genai';
import { fromBaseUnits } from '@mimic/shared';
import { config } from './config.js';
import { api } from './api.js';

// Prefer Vertex AI (gcloud Application Default Credentials — no API key).
// Fall back to an AI Studio API key if no GCP project is configured.
const client = config.vertexProject
  ? new GoogleGenAI({
      vertexai: true,
      project: config.vertexProject,
      location: config.vertexLocation,
    })
  : config.geminiApiKey
    ? new GoogleGenAI({ apiKey: config.geminiApiKey })
    : null;

export function aiEnabled(): boolean {
  return client !== null;
}

/** Retry a Gemini call on transient 429 / RESOURCE_EXHAUSTED with backoff. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (i < tries - 1 && /429|RESOURCE_EXHAUSTED|exhausted|rate/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 900 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

export function aiMode(): string {
  return config.vertexProject ? `vertex(${config.vertexProject})` : config.geminiApiKey ? 'apikey' : 'off';
}

// short rolling history per chat so the sidekick has conversational memory.
// Gemini uses roles 'user' and 'model'.
const history = new Map<number, Content[]>();
const MAX_TURNS = 8;

function persona(context: string): string {
  return [
    "You are the MimicTG football sidekick — a witty, knowledgeable AI inside a Telegram bot where fans bet each other in USDt on real football matches.",
    'Personality: sharp, funny, a little cheeky trash-talk, genuinely knows football. Never boring, never a corporate assistant.',
    'Keep replies SHORT — 1-3 sentences, Telegram-chat style. Use the occasional emoji, not a wall of them.',
    'You can talk fixtures, form, predictions and banter. Never invent odds or claim to move money yourself — the on-chain escrow does that.',
    "You never see or handle anyone's keys or funds. Do not give financial advice framed as guarantees; this is friendly fan betting with test USDt.",
    '',
    'ONE-TAP BETS: when you talk about a specific UPCOMING fixture from the list below that the user could bet on, end your reply with a marker on its own line: [[BET:<matchId>]] — using the EXACT numeric id shown for that fixture. If you are clearly backing one side, add the pick so the app pre-selects it: [[BET:<matchId>:HOME]] (home team wins), [[BET:<matchId>:AWAY]] (away team wins), or [[BET:<matchId>:DRAW]]. Include at most one marker, and only for a real upcoming fixture in the list (never for live/finished matches or made-up ids). The app turns it into a one-tap "bet on this match" button, so do not also paste a link.',
    '',
    "DIRECTED CHALLENGES (IMPORTANT): If a user is challenging a SPECIFIC other person to a bet — e.g. \"bet @ishan 5 on France to beat Morocco\" or \"@ishan I bet you Brazil wins\" — do NOT reply to the sender. Instead, TURN TO THE CHALLENGED PERSON: address them directly by their @handle, keep that @mention in your text so they get pinged, and wind them up into taking the OTHER side (e.g. \"@ishan — Manish is backing France. You really rate Hakimi and the Atlas Lions to spoil the party? Put your USDt where your mouth is 👇\"). One or two witty sentences, cheeky, never a wall of text. Then emit exactly one marker on its own line: [[CHALLENGE:<@target>:<matchId>:<HOME|DRAW|AWAY>]] where the outcome is the CHALLENGER's pick (the side the sender backed), matchId is the exact fixture id from the list, and @target is the challenged person's handle. The app will show the challenged person one-tap buttons for the opposing outcomes. Only use a real upcoming fixture from the list; if you can't map it to one, just banter normally without a marker.",
    '',
    'Live context you can use (do not dump it verbatim; weave it in naturally):',
    context,
  ].join('\n');
}

/** Build grounding context from live fixtures + leaderboard. Best-effort. */
async function buildContext(): Promise<string> {
  const [matches, board] = await Promise.all([api.matches(), api.leaderboard()]);
  const fixtures = matches
    .filter((m) => (m.status === 'SCHEDULED' || m.status === 'TIMED') && !/\btbd\b/i.test(m.homeTeam + m.awayTeam))
    .slice(0, 10)
    .map((m) => `- [id ${m.id}] ${m.homeTeam} vs ${m.awayTeam} (${m.competition}, ${m.utcKickoff.slice(0, 16)})`)
    .join('\n');
  const liveScores = matches
    .filter((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'FINISHED')
    .slice(0, 6)
    .map((m) => `- ${m.homeTeam} ${m.scoreHome ?? '?'}-${m.scoreAway ?? '?'} ${m.awayTeam} (${m.status})`)
    .join('\n');
  const top = board
    .slice(0, 5)
    .map(
      (r, i) =>
        `${i + 1}. ${r.username ? '@' + r.username : r.address.slice(0, 8)} — ${fromBaseUnits(r.net)} USDt net (${r.wins}W/${r.losses}L)`,
    )
    .join('\n');
  return [
    `Upcoming fixtures (use the id for [[BET:id]]):\n${fixtures || '(none loaded)'}`,
    liveScores ? `\nLive & recent scores:\n${liveScores}` : '',
    `\nLeaderboard (net USDt):\n${top || '(no settled bets yet)'}`,
  ].join('\n');
}

/** Generate a reply to a user message in a given chat. */
export async function reply(chatId: number, userText: string, userName?: string): Promise<string> {
  if (!client) return "My AI brain isn't switched on yet (no API key). But you can still bet — tap the app or use /bet ⚽️";

  const turns = history.get(chatId) ?? [];
  turns.push({ role: 'user', parts: [{ text: userName ? `${userName}: ${userText}` : userText }] });

  const context = await buildContext().catch(() => '(context unavailable)');
  const res = await withRetry(() =>
    client.models.generateContent({
      model: config.geminiModel,
      contents: turns,
      config: {
        systemInstruction: persona(context),
        maxOutputTokens: 800, // deliberately short — snappy chat replies
      },
    }),
  );

  const text = (res.text ?? '').trim();
  turns.push({ role: 'model', parts: [{ text }] });
  history.set(chatId, turns.slice(-MAX_TURNS * 2));
  return text || '⚽️';
}
