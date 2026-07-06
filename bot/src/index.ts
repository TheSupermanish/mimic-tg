import { Bot, InlineKeyboard } from 'grammy';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MINIAPP_URL = process.env.MINIAPP_URL || '';
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not set — add it to .env');
  process.exit(1);
}
if (!MINIAPP_URL) console.warn('MINIAPP_URL not set — buttons will not open the Mini App');

const bot = new Bot(TOKEN);

/** Build a web_app button that opens the Mini App, optionally deep-linking. */
function openButton(label: string, startParam?: string): InlineKeyboard {
  const url = startParam ? `${MINIAPP_URL}?startapp=${encodeURIComponent(startParam)}` : MINIAPP_URL;
  return new InlineKeyboard().webApp(label, url);
}

bot.command('start', async (ctx) => {
  const payload = ctx.match?.toString().trim(); // e.g. "accept_5"
  if (payload?.startsWith('accept_')) {
    const id = payload.slice('accept_'.length);
    await ctx.reply(
      `⚽️ You've been challenged to a bet!\n\nOpen MimicTG to take the other side of challenge #${id}. Winner takes the pot in USDt.`,
      { reply_markup: openButton('🎯 View & accept', payload) },
    );
    return;
  }
  await ctx.reply(
    `⚽️ <b>Welcome to MimicTG</b>\n\nBet your mates on football with your own self-custodial USDt wallet — powered by Tether WDK.\n\n• Create a wallet in seconds (your keys, your funds)\n• Challenge anyone: <i>"I bet you 5 USDt on Brazil"</i>\n• Winner takes the pot, settled from real match results\n\nTap below to kick off 👇`,
    { parse_mode: 'HTML', reply_markup: openButton('🚀 Open MimicTG') },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    'MimicTG — P2P football betting in USDt.\n\n/start — open the app\n\nInside: create a wallet, grab test USDt, post a challenge on any fixture, and share the accept link with a friend.',
    { reply_markup: openButton('Open MimicTG') },
  );
});

// Set the persistent menu button to launch the Mini App.
async function configureMenu() {
  if (!MINIAPP_URL) return;
  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Play', web_app: { url: MINIAPP_URL } },
    });
  } catch (e) {
    console.warn('menu button setup failed:', (e as Error).message);
  }
}

bot.catch((err) => console.error('bot error', err));

await configureMenu();
console.log('[bot] starting long-polling…');
bot.start();
