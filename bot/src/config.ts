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
  // Gemini powers the AI sidekick. Preferred path is Vertex AI via gcloud ADC
  // (no API key); falls back to an AI Studio GEMINI_API_KEY if no GCP project.
  vertexProject: process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT || '',
  vertexLocation:
    process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEX_LOCATION || 'global',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
} as const;
