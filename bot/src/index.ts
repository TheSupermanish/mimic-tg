import { Bot, InlineKeyboard, Context } from 'grammy';
import { fromBaseUnits } from '@mimic/shared';
import { pickLabelFromOutcome } from './format.js';
import { config } from './config.js';
import { api } from './api.js';
import { reply as aiReply, aiEnabled, aiMode } from './ai.js';

if (!config.botToken) {
  console.error('TELEGRAM_BOT_TOKEN not set — add it to .env');
  process.exit(1);
}
if (!config.miniappUrl) console.warn('MINIAPP_URL not set — launch buttons will not work');

const bot = new Bot(config.botToken);

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

// ─── Commands ──────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const payload = ctx.match?.toString().trim();
  if (payload?.startsWith('accept_')) {
    const id = payload.slice('accept_'.length);
    await ctx.reply(
      `⚽️ You've been challenged!\n\nOpen MimicTG to take the other side of challenge #${id}. Winner takes the pot in USDt.`,
      { reply_markup: launchButton(ctx, '🎯 View & accept', payload) },
    );
    return;
  }
  await ctx.reply(
    `⚽️ <b>Welcome to MimicTG</b>\n\nBet your mates on football with your own self-custodial USDt wallet — powered by Tether WDK, gasless.\n\n• Your keys, your funds\n• Challenge anyone: <i>"I bet you 5 USDt on Brazil"</i>\n• Winner takes the pot, settled from real results\n\nAdd me to your football group and let the trash-talk begin 👇`,
    { parse_mode: 'HTML', reply_markup: launchButton(ctx, '🚀 Open MimicTG') },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'MimicTG — P2P football betting in USDt ⚽️',
      '',
      '/bet — open the app to post a challenge',
      '/challenges — see open challenges to accept',
      '/leaderboard — who\'s winning',
      '',
      aiEnabled()
        ? 'Or just talk to me — @mention me in a group, or DM me, for match chat and predictions.'
        : 'Add me to your group and challenge your mates!',
    ].join('\n'),
    { reply_markup: launchButton(ctx, 'Open MimicTG') },
  );
});

bot.command('bet', async (ctx) => {
  await ctx.reply('🎯 Pick a fixture and post your challenge:', {
    reply_markup: launchButton(ctx, 'Create a challenge', 'create'),
  });
});

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
  await ctx.reply(`🏆 <b>MimicTG Leaderboard</b>\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    reply_markup: launchButton(ctx, 'Climb the ranks', 'create'),
  });
});

// ─── Group onboarding ────────────────────────────────────────────────────
bot.on('my_chat_member', async (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status;
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (isGroup && (status === 'member' || status === 'administrator')) {
    await ctx.reply(
      `⚽️ MimicTG is in the chat!\n\nChallenge each other on football in USDt. Try /bet to post one, /challenges to accept, /leaderboard to see who's on top.${aiEnabled() ? ' Or @mention me for match chat.' : ''}`,
      { reply_markup: launchButton(ctx, '🚀 Open MimicTG') },
    );
  }
});

// ─── AI chat: DMs always; groups only when mentioned or replied-to ─────────
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // commands handled above
  if (!aiEnabled()) return;

  const isPrivate = ctx.chat.type === 'private';
  const mentioned = ctx.me?.username && text.includes(`@${ctx.me.username}`);
  const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me?.id;
  if (!isPrivate && !mentioned && !repliedToBot) return;

  const clean = ctx.me?.username ? text.replaceAll(`@${ctx.me.username}`, '').trim() : text;
  if (!clean) return;

  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    const raw = await aiReply(ctx.chat.id, clean, ctx.from?.username || ctx.from?.first_name);
    // extract an optional one-tap bet marker [[BET:<matchId>]]
    const betMatch = raw.match(/\[\[BET:(\d+)\]\]/);
    const answer = raw.replace(/\[\[BET:\d+\]\]/g, '').trim() || '⚽️';
    let reply_markup;
    if (betMatch) {
      const id = betMatch[1];
      const m = (await api.matches()).find((x) => x.id === id);
      const label = m ? `🎯 Bet: ${m.homeTeam} v ${m.awayTeam}` : '🎯 Place this bet';
      reply_markup = launchButton(ctx, label, `bet_${id}`);
    }
    await ctx.reply(answer, { reply_to_message_id: ctx.message.message_id, reply_markup });
  } catch (e) {
    console.warn('[ai]', (e as Error).message);
    await ctx.reply('My football brain glitched 😵‍💫 — try again in a sec.');
  }
});

// ─── Menu button (private chats) ───────────────────────────────────────────
async function configureMenu() {
  if (!config.miniappUrl) return;
  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Play', web_app: { url: config.miniappUrl } },
    });
  } catch (e) {
    console.warn('menu button setup failed:', (e as Error).message);
  }
}

bot.catch((err) => console.error('bot error', err));

await configureMenu();
console.log(`[bot] starting long-polling… (AI: ${aiMode()})`);
bot.start();
