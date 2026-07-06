import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  miniappUrl: process.env.MINIAPP_URL || '',
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  backendUrl: process.env.BACKEND_PUBLIC_URL || 'http://localhost:8787',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
} as const;
