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
  // Gemini powers the AI sidekick. GOOGLE_API_KEY is accepted as an alias.
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
} as const;
