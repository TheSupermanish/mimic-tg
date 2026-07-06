import { validate, parse } from '@telegram-apps/init-data-node';
import { config } from './config.js';
import { TelegramUser } from '@mimic/shared';

/**
 * Validates raw Telegram Mini App initData against the bot token and returns
 * the authenticated user. Throws if the signature is invalid or stale.
 */
export function verifyInitData(initDataRaw: string): TelegramUser {
  if (!config.botToken) throw new Error('TELEGRAM_BOT_TOKEN not set');
  // throws on bad hash or expired auth_date (default 24h window)
  validate(initDataRaw, config.botToken, { expiresIn: 86_400 });
  const parsed = parse(initDataRaw);
  const u = parsed.user;
  if (!u) throw new Error('no user in initData');
  return { id: Number(u.id), username: u.username, firstName: (u as any).firstName ?? (u as any).first_name };
}
