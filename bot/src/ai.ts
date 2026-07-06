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
    'You can talk fixtures, form, predictions and banter. When someone wants to actually place or accept a bet, tell them to tap the app button or use /bet (open a challenge) and /challenges (take one). Never invent odds or claim to move money yourself — the on-chain escrow does that.',
    "You never see or handle anyone's keys or funds. Do not give financial advice framed as guarantees; this is friendly fan betting with test USDt.",
    '',
    'Live context you can use (do not dump it verbatim; weave it in naturally):',
    context,
  ].join('\n');
}

/** Build grounding context from live fixtures + leaderboard. Best-effort. */
async function buildContext(): Promise<string> {
  const [matches, board] = await Promise.all([api.matches(), api.leaderboard()]);
  const fixtures = matches
    .filter((m) => m.status === 'SCHEDULED' || m.status === 'TIMED')
    .slice(0, 8)
    .map((m) => `- ${m.homeTeam} vs ${m.awayTeam} (${m.competition}, ${m.utcKickoff.slice(0, 16)})`)
    .join('\n');
  const top = board
    .slice(0, 5)
    .map(
      (r, i) =>
        `${i + 1}. ${r.username ? '@' + r.username : r.address.slice(0, 8)} — ${fromBaseUnits(r.net)} USDt net (${r.wins}W/${r.losses}L)`,
    )
    .join('\n');
  return `Upcoming fixtures:\n${fixtures || '(none loaded)'}\n\nLeaderboard (net USDt):\n${top || '(no settled bets yet)'}`;
}

/** Generate a reply to a user message in a given chat. */
export async function reply(chatId: number, userText: string, userName?: string): Promise<string> {
  if (!client) return "My AI brain isn't switched on yet (no API key). But you can still bet — tap the app or use /bet ⚽️";

  const turns = history.get(chatId) ?? [];
  turns.push({ role: 'user', parts: [{ text: userName ? `${userName}: ${userText}` : userText }] });

  const context = await buildContext().catch(() => '(context unavailable)');
  const res = await client.models.generateContent({
    model: config.geminiModel,
    contents: turns,
    config: {
      systemInstruction: persona(context),
      maxOutputTokens: 800, // deliberately short — snappy chat replies
    },
  });

  const text = (res.text ?? '').trim();
  turns.push({ role: 'model', parts: [{ text }] });
  history.set(chatId, turns.slice(-MAX_TURNS * 2));
  return text || '⚽️';
}
