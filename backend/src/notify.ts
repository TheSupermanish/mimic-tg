import { config } from './config.js';

/** Sends a Telegram message via the Bot API. No-op if no bot token / chat id. */
export async function notify(chatId: number, text: string, deepLinkButton?: { text: string; url: string }): Promise<void> {
  if (!config.botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: deepLinkButton
          ? { inline_keyboard: [[{ text: deepLinkButton.text, url: deepLinkButton.url }]] }
          : undefined,
      }),
    });
  } catch (e) {
    console.warn('[notify]', (e as Error).message);
  }
}
