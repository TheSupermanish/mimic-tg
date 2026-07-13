import { Bot, InlineKeyboard, Context } from 'grammy';
import { fromBaseUnits, type Match } from '@mimic/shared';
import {
  pickLabelFromOutcome,
  isBettable,
  isLive,
  matchLine,
  betButtonLabel,
  scoreRow,
} from './format.js';
import { config } from './config.js';
import { api } from './api.js';
import { reply as aiReply, aiEnabled, aiMode } from './ai.js';

if (!config.botToken) {
  console.error('TELEGRAM_BOT_TOKEN not set — add it to .env');
  process.exit(1);
}
if (!config.miniappUrl) console.warn('MINIAPP_URL not set — launch buttons will not work');

const bot = new Bot(config.botToken);

// Catch-all: log EVERY update the bot receives (type, chat, sender, text).
// This is the ground truth for "is the bot even seeing group messages?".
bot.use(async (ctx, next) => {
  try {
    const u = ctx.update;
    const type = Object.keys(u).find((k) => k !== 'update_id') ?? 'unknown';
    const chat = ctx.chat ? `${ctx.chat.type}:${(ctx.chat as any).title ?? ctx.chat.id}` : '-';
    const from = ctx.from?.username ? '@' + ctx.from.username : ctx.from?.first_name ?? '-';
    const text = ctx.message?.text ?? ctx.channelPost?.text ?? '';
    console.log(`[update] ${type} | chat=${chat} | from=${from}${text ? ` | "${text.slice(0, 80)}"` : ''}`);
  } catch {
    /* never block on logging */
  }
  await next();
});

/**
 * A button that opens the Mini App. In private chats we can use a native
 * web_app button (opens the app directly with initData). In groups Telegram
 * forbids web_app inline buttons, so we deep-link to the bot DM with a start
 * param — one tap opens the bot, which then presents the web_app button.
 */
function launchButton(ctx: Context, label: string, startParam?: string): InlineKeyboard {
  const isPrivate = ctx.chat?.type === 'private';
  if (isPrivate) {
    const url = startParam
      ? `${config.miniappUrl}?startapp=${encodeURIComponent(startParam)}`
      : config.miniappUrl;
    return new InlineKeyboard().webApp(label, url);
  }
  const deep = `https://t.me/${config.botUsername}?start=${encodeURIComponent(startParam || 'open')}`;
  return new InlineKeyboard().url(label, deep);
}

/**
 * One tappable button per match, each opening the bet flow for that fixture.
 * Works in both private chats (web_app) and groups (deep-link), and stacks
 * one match per row so long team names stay readable.
 */
function matchesKeyboard(ctx: Context, matches: Match[]): InlineKeyboard {
  const isPrivate = ctx.chat?.type === 'private';
  const kb = new InlineKeyboard();
  for (const m of matches) {
    const label = betButtonLabel(m);
    const param = `bet_${m.id}`;
    if (isPrivate) {
      kb.row(InlineKeyboard.webApp(label, `${config.miniappUrl}?startapp=${param}`));
    } else {
      kb.row(InlineKeyboard.url(label, `https://t.me/${config.botUsername}?start=${param}`));
    }
  }
  return kb;
}

// ─── Commands ──────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const payload = ctx.match?.toString().trim();
  if (payload?.startsWith('accept_')) {
    const id = payload.slice('accept_'.length);
    await ctx.reply(
      `⚽️ You've been challenged!\n\nOpen Mimic to take the other side of challenge #${id}. Winner takes the pot in USDt.`,
      { reply_markup: launchButton(ctx, '🎯 View & accept', payload) },
    );
    return;
  }
  // viewprop_<propId> — from the "your prop is on" settlement notification; just
  // open Mimic (My Bets) to track an existing, already-matched prop.
  if (payload?.startsWith('viewprop_')) {
    await ctx.reply(
      `🔒 Your side bet is locked in — open Mimic to track it. It settles automatically after the match. ⚽️`,
      { reply_markup: launchButton(ctx, '🎟️ Track your prop', payload) },
    );
    return;
  }
  // prop_<matchId>_<b64question> — from a group "set up prop" button.
  if (payload?.startsWith('prop_')) {
    await ctx.reply(
      `🎲 Ready to set up your side bet — tap below to post it. AI-settled, gasless, winner takes the pot. 👇`,
      { reply_markup: launchButton(ctx, '🎲 Set up prop', payload) },
    );
    return;
  }
  // bet_<matchId> or bet_<matchId>_<home|draw|away> — from a group bet button.
  if (payload?.startsWith('bet_') || payload?.startsWith('create')) {
    const [, matchId, pick] = payload.split('_');
    const m = matchId ? (await api.matches()).find((x) => x.id === matchId) : undefined;
    const title = m ? `${m.homeTeam} v ${m.awayTeam}` : 'this match';
    const side =
      pick === 'home' && m ? m.homeTeam : pick === 'away' && m ? m.awayTeam : pick === 'draw' ? 'the draw' : null;
    const line = side ? `Ready to back <b>${side}</b> in ${title}` : `Ready to bet on <b>${title}</b>`;
    await ctx.reply(
      `⚽️ ${line} — tap below to place it. Your stake locks in escrow, winner takes the pot. 👇`,
      { parse_mode: 'HTML', reply_markup: launchButton(ctx, '🎯 Place your bet', payload) },
    );
    return;
  }
  await ctx.reply(
    `⚽️ <b>Welcome to Mimic</b>\n\nBet your mates on football with your own self-custodial USDt wallet — powered by Tether WDK, gasless.\n\n• Your keys, your funds\n• Challenge anyone: <i>"I bet you 5 USDt on Brazil"</i>\n• Winner takes the pot, settled from real results\n\nAdd me to your football group and let the trash-talk begin 👇`,
    { parse_mode: 'HTML', reply_markup: launchButton(ctx, '🚀 Open Mimic') },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Mimic — P2P football betting in USDt ⚽️',
      '',
      '/matches — live scores + tap a fixture to bet',
      '/bet — pick a fixture and post a challenge',
      '/challenges — see open challenges to accept',
      '/leaderboard — who\'s winning',
      '',
      aiEnabled()
        ? 'Or just talk to me — @mention me in a group, or DM me, for match chat and predictions.'
        : 'Add me to your group and challenge your mates!',
    ].join('\n'),
    { reply_markup: launchButton(ctx, 'Open Mimic') },
  );
});

/** Shared renderer for /bet and /matches: live scores + tappable upcoming fixtures. */
async function sendMatches(ctx: Context) {
  const all = await api.matches();
  const live = all.filter(isLive);
  const upcoming = all.filter(isBettable).slice(0, 6);
  const finished = all
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => b.utcKickoff.localeCompare(a.utcKickoff))
    .slice(0, 4);

  if (!upcoming.length && !live.length && !finished.length) {
    await ctx.reply('No fixtures loaded right now — try again shortly ⚽️', {
      reply_markup: launchButton(ctx, 'Open Mimic', 'create'),
    });
    return;
  }

  const parts: string[] = [];
  if (live.length) parts.push('🔴 <b>Live now</b>\n' + live.map((m) => '• ' + matchLine(m)).join('\n'));
  if (upcoming.length)
    parts.push('🎯 <b>Upcoming — tap a match to bet</b>\n' + upcoming.map((m) => '• ' + matchLine(m)).join('\n'));
  if (finished.length)
    parts.push('📋 <b>Recent results</b>\n' + finished.map((m) => '• ' + matchLine(m)).join('\n'));

  await ctx.reply(parts.join('\n\n'), {
    parse_mode: 'HTML',
    reply_markup: upcoming.length
      ? matchesKeyboard(ctx, upcoming)
      : launchButton(ctx, 'Open Mimic', 'create'),
  });
}

bot.command('bet', sendMatches);
bot.command('matches', sendMatches);

/** A clean, formatted scoreboard: live scores + recent full-time results. */
async function sendScores(ctx: Context) {
  const all = await api.matches();
  const live = all.filter(isLive);
  const finished = all
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => b.utcKickoff.localeCompare(a.utcKickoff))
    .slice(0, 8);

  if (!live.length && !finished.length) {
    await ctx.reply('No scores yet — check /matches for upcoming fixtures ⚽️');
    return;
  }
  const parts = ['📊 <b>Scoreboard</b>'];
  if (live.length) parts.push('\n🔴 <b>Live</b>\n' + live.map((m) => '• ' + scoreRow(m)).join('\n'));
  if (finished.length)
    parts.push('\n🏁 <b>Full-time</b>\n' + finished.map((m) => '• ' + scoreRow(m)).join('\n'));
  await ctx.reply(parts.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: launchButton(ctx, '🎯 Open Mimic', 'create'),
  });
}

bot.command('scores', sendScores);
bot.command('results', sendScores);

bot.command('challenges', async (ctx) => {
  const open = await api.openMarkets();
  if (!open.length) {
    await ctx.reply('No open challenges right now. Be the first — /bet 🎯', {
      reply_markup: launchButton(ctx, 'Post a challenge', 'create'),
    });
    return;
  }
  const lines = open.slice(0, 8).map((c) => {
    const m = c.match;
    const who = c.creatorTgUsername ? '@' + c.creatorTgUsername : c.creator.slice(0, 8);
    const title = m ? `${m.homeTeam} v ${m.awayTeam}` : `match ${c.matchId}`;
    return `#${c.id} — ${who} backs ${pickLabelFromOutcome(c.creatorPick, m)} on ${title} for ${fromBaseUnits(c.stake)} USDt`;
  });
  const kb = new InlineKeyboard();
  for (const c of open.slice(0, 5)) {
    kb.row(
      ctx.chat?.type === 'private'
        ? InlineKeyboard.webApp(`Take #${c.id}`, `${config.miniappUrl}?startapp=accept_${c.id}`)
        : InlineKeyboard.url(`Take #${c.id}`, `https://t.me/${config.botUsername}?start=accept_${c.id}`),
    );
  }
  await ctx.reply(`🎯 <b>Open challenges</b>\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
});

bot.command('leaderboard', async (ctx) => {
  const board = await api.leaderboard();
  if (!board.length) {
    await ctx.reply('No settled bets yet — the leaderboard is waiting for a winner 🏆');
    return;
  }
  const medal = ['🥇', '🥈', '🥉'];
  const lines = board.slice(0, 10).map((r, i) => {
    const who = r.username ? '@' + r.username : r.address.slice(0, 8);
    const net = Number(fromBaseUnits(r.net));
    const sign = net > 0 ? '+' : '';
    return `${medal[i] ?? `${i + 1}.`} ${who} — ${sign}${fromBaseUnits(r.net)} USDt (${r.wins}W/${r.losses}L)`;
  });
  await ctx.reply(`🏆 <b>Mimic Leaderboard</b>\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    reply_markup: launchButton(ctx, 'Climb the ranks', 'create'),
  });
});

// ─── Group onboarding ────────────────────────────────────────────────────
bot.on('my_chat_member', async (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status;
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  console.log(`[member] chat "${(ctx.chat as any).title ?? ctx.chat.id}" (${ctx.chat.type}) → status=${status}`);
  if (isGroup && (status === 'member' || status === 'administrator')) {
    await ctx.reply(
      `⚽️ Mimic is in the chat!\n\nChallenge each other on football in USDt. Try /bet to post one, /challenges to accept, /leaderboard to see who's on top.${aiEnabled() ? ' Or @mention me for match chat.' : ''}`,
      { reply_markup: launchButton(ctx, '🚀 Open Mimic') },
    );
  }
});

// ─── AI chat: DMs always; groups only when mentioned or replied-to ─────────
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const who = ctx.from?.username ? '@' + ctx.from.username : ctx.from?.first_name || 'unknown';
  const where = ctx.chat.type === 'private' ? 'DM' : `group "${(ctx.chat as any).title ?? ctx.chat.id}"`;

  if (text.startsWith('/')) {
    console.log(`[msg] ${where} ${who}: command "${text}"`);
    return; // commands handled above
  }
  if (!aiEnabled()) return;

  const isPrivate = ctx.chat.type === 'private';
  const mentioned = ctx.me?.username && text.includes(`@${ctx.me.username}`);
  const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
  const willReply = isPrivate || mentioned || repliedToBot;
  console.log(
    `[msg] ${where} ${who}: "${text.slice(0, 80)}" → ${willReply ? 'REPLYING' : 'ignored (not mentioned/replied)'}`,
  );
  if (!willReply) return;

  const clean = ctx.me?.username ? text.replaceAll(`@${ctx.me.username}`, '').trim() : text;
  if (!clean) return;

  // Route only BARE, command-like asks to the structured views. Anchored (not a
  // loose \bword\b test) so a real question that merely contains "games"/"score"
  // — e.g. "who scored in the last games?" — still goes to the AI, not here.
  const asks = clean.trim();

  // "scores" / "results" / "scoreboard" → structured scoreboard.
  if (/^(show |latest |the )?(scores?|results?|score ?board|score ?line)!?\??$/i.test(asks)) {
    console.log(`[msg] → scoreboard`);
    await sendScores(ctx);
    return;
  }

  // "matches" / "fixtures" / "upcoming" / "games" → interactive tap-to-bet list.
  // Same handler the /matches command uses.
  if (/^(show |list |the )?(upcoming )?(matches|fixtures|games|upcoming)( to bet)?!?\??$/i.test(asks)) {
    console.log(`[msg] → matches`);
    await sendMatches(ctx);
    return;
  }

  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    const raw = await aiReply(ctx.chat.id, clean, ctx.from?.username || ctx.from?.first_name);
    // directed challenge: [[CHALLENGE:@target:matchId:PICK]] — the AI is calling out
    // a specific person; offer THEM the opposing sides to take.
    const chMatch = raw.match(/\[\[CHALLENGE:@?([A-Za-z0-9_]+):(\d+):(HOME|DRAW|AWAY)\]\]/i);
    // prop bet ("bet on anything") — a free-text YES/NO market; takes precedence.
    const propMatch = raw.match(/\[\[PROP:(?:@?[A-Za-z0-9_]+:)?(\d+):([^\]]+)\]\]/i);
    // otherwise, optional one-tap bet marker for the sender.
    const betMatch = !chMatch && !propMatch && raw.match(/\[\[BET:(\d+)(?::(HOME|DRAW|AWAY))?\]\]/i);
    const answer = raw.replace(/\[\[(?:BET|CHALLENGE|PROP):[^\]]*\]\]/g, '').trim() || '⚽️';

    let reply_markup: InlineKeyboard | undefined;
    let logNote = '';
    if (propMatch) {
      // "bet on anything": deep-link to the prop create flow, question pre-filled.
      const [, matchId, question] = propMatch;
      const q = question.trim();
      const b64 = Buffer.from(q, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      reply_markup = launchButton(ctx, `🎲 Set up: ${q.slice(0, 38)}`, `prop_${matchId}_${b64}`);
      logNote = ` +prop(${matchId})`;
    } else if (chMatch) {
      const [, , matchId, pickRaw] = chMatch;
      const pick = pickRaw.toUpperCase();
      const m = (await api.matches()).find((x) => x.id === matchId);
      // opposing outcomes = the two sides the challenger did NOT back
      const sides = [
        ['HOME', 'home', m ? `🏠 ${m.homeTeam} win` : 'Home win'],
        ['DRAW', 'draw', '🤝 Draw'],
        ['AWAY', 'away', m ? `✈️ ${m.awayTeam} win` : 'Away win'],
      ] as const;
      const isPrivate = ctx.chat.type === 'private';
      const kb = new InlineKeyboard();
      for (const [, slug, label] of sides.filter(([P]) => P !== pick)) {
        kb.row(
          isPrivate
            ? InlineKeyboard.webApp(label, `${config.miniappUrl}?startapp=bet_${matchId}_${slug}`)
            : InlineKeyboard.text(label, `t:${matchId}:${slug}`), // native one-tap in group
        );
      }
      reply_markup = kb;
      logNote = ` +challenge(${matchId}:${pick}→opp)`;
    } else if (betMatch) {
      const id = betMatch[1];
      const pick = betMatch[2]?.toLowerCase(); // home | draw | away | undefined
      const m = (await api.matches()).find((x) => x.id === id);
      let label = m ? `🎯 Bet: ${m.homeTeam} v ${m.awayTeam}` : '🎯 Place this bet';
      if (m && pick === 'home') label = `🎯 Bet ${m.homeTeam} to win`;
      else if (m && pick === 'away') label = `🎯 Bet ${m.awayTeam} to win`;
      else if (pick === 'draw') label = '🎯 Bet the draw';
      if (ctx.chat.type !== 'private' && pick) {
        // one-tap native callback in groups (instant toast + DM confirm)
        reply_markup = new InlineKeyboard().text(label, `t:${id}:${pick}`);
      } else {
        reply_markup = launchButton(ctx, label, pick ? `bet_${id}_${pick}` : `bet_${id}`);
      }
      logNote = ` +betbtn(${id}${pick ? ':' + pick : ''})`;
    }
    console.log(`[msg] → replied${logNote}`);
    await ctx.reply(answer, { reply_to_message_id: ctx.message.message_id, reply_markup });
  } catch (e) {
    console.warn('[ai]', (e as Error).message);
    await ctx.reply('My football brain glitched 😵‍💫 — try again in a sec.');
  }
});

// ─── One-tap "Take" in a group: instant toast + a single Confirm&sign DM ─────
// The tap is a non-binding social claim; the money only moves when the user
// signs in the mini app (self-custodial). Callback data: t:<matchId>:<pick>.
bot.callbackQuery(/^t:(\d+):(home|draw|away)$/, async (ctx) => {
  const matchId = ctx.match![1];
  const pick = ctx.match![2];
  const uname = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name || 'you';
  const m = (await api.matches()).find((x) => x.id === matchId);
  const side = pick === 'home' && m ? m.homeTeam : pick === 'away' && m ? m.awayTeam : 'the draw';
  const title = m ? `${m.homeTeam} v ${m.awayTeam}` : 'this match';
  const param = `bet_${matchId}_${pick}`;
  try {
    await bot.api.sendMessage(
      ctx.from.id,
      `🎯 Locking in your bet: <b>${side}</b> — ${title}.\nTap to confirm &amp; sign — gasless, and only you can authorize it. 👇`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('✅ Confirm & sign', `${config.miniappUrl}?startapp=${param}`),
      },
    );
    await ctx.answerCallbackQuery({ text: `You're in, ${uname}! Confirm in your DM with me 🖊️` });
    // soft, non-blocking social hint so the whole group sees the action land
    const msg = ctx.callbackQuery.message;
    const orig = msg && 'text' in msg ? msg.text : undefined;
    if (orig && !orig.includes(`${uname} is in`)) {
      await ctx
        .editMessageText(`${orig}\n\n👀 ${uname} is in — confirming…`, {
          reply_markup: msg && 'reply_markup' in msg ? (msg.reply_markup as InlineKeyboard) : undefined,
        })
        .catch(() => {});
    }
    console.log(`[callback] ${uname} take ${matchId}:${pick} → DM sent`);
  } catch {
    // bots can only DM users who've started them
    await ctx.answerCallbackQuery({
      text: `First tap Start in @${config.botUsername} (DM me), then tap Take again — I need to DM you the confirm link.`,
      show_alert: true,
    });
    console.log(`[callback] ${uname} take ${matchId}:${pick} → DM failed (user hasn't started bot)`);
  }
});

// ─── Menu button (private chats) ───────────────────────────────────────────
async function configureMenu() {
  try {
    await bot.api.setMyCommands([
      { command: 'matches', description: 'Live scores + tap a fixture to bet' },
      { command: 'scores', description: 'Live scores + full-time results' },
      { command: 'bet', description: 'Pick a fixture and post a challenge' },
      { command: 'challenges', description: 'Open challenges to accept' },
      { command: 'leaderboard', description: "Who's winning" },
      { command: 'help', description: 'How Mimic works' },
    ]);
  } catch (e) {
    console.warn('setMyCommands failed:', (e as Error).message);
  }
  if (!config.miniappUrl) return;
  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Play', web_app: { url: config.miniappUrl } },
    });
  } catch (e) {
    console.warn('menu button setup failed:', (e as Error).message);
  }
}

bot.catch((err) => {
  // 409 = another process is polling the same TELEGRAM_BOT_TOKEN (usually the
  // deployed container). Long-polling allows only one consumer, so surface a
  // clear hint instead of a confusing silent flap.
  const desc = (err?.error as any)?.description ?? (err?.error as any)?.message ?? '';
  if (String(desc).includes('terminated by other getUpdates')) {
    console.error(
      '[bot] 409 conflict: another instance is polling this token. ' +
        'To test locally, stop the deployed bot first (set RUN_BOT=0 on the VM and redeploy).',
    );
    return;
  }
  console.error('bot error', err);
});

await configureMenu();
console.log(`[bot] starting long-polling… (AI: ${aiMode()})`);
// Explicitly subscribe to group + membership updates so nothing is filtered out
// by the default allowed_updates set.
bot.start({
  allowed_updates: ['message', 'edited_message', 'my_chat_member', 'chat_member', 'callback_query'],
  onStart: (me) => console.log(`[bot] online as @${me.username} (id ${me.id})`),
});
