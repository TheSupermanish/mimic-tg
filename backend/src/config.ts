import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

/** Deployed addresses written by the contracts deploy script (if run). */
function readDeployed(): { mockUsdt?: string; predictionMarket?: string; resolver?: string } {
  const p = resolve(__dirname, '../../shared/src/deployed/addresses.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

const deployed = readDeployed();

export const config = {
  port: Number(process.env.BACKEND_PORT ?? 8787),
  rpcUrl: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  explorer: process.env.EXPLORER_URL ?? 'https://sepolia.basescan.org',

  mockUsdtAddress: process.env.MOCK_USDT_ADDRESS || deployed.mockUsdt || '',
  predictionMarketAddress: process.env.PREDICTION_MARKET_ADDRESS || deployed.predictionMarket || '',
  resolverPrivateKey: (() => {
    const k = process.env.RESOLVER_PRIVATE_KEY || '';
    return k && !k.startsWith('0x') ? `0x${k}` : k;
  })(),

  // Gemini (AI market resolver). Prefer Vertex AI via gcloud ADC / service account;
  // falls back to an AI Studio API key. Mirrors the bot's AI config.
  vertexProject: process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT || '',
  vertexLocation: process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEX_LOCATION || 'global',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  footballApiKey: process.env.FOOTBALL_DATA_API_KEY || '',
  // football-data.org competition codes to surface fixtures from.
  competitions: (process.env.FOOTBALL_COMPETITIONS || 'PL,CL,PD,BL1,SA,FL1').split(','),

  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  miniappUrl: process.env.MINIAPP_URL || '',
  // Secret guarding admin/internal endpoints (e.g. manual resolve). When unset,
  // those endpoints are disabled rather than left open to the public.
  adminSecret: process.env.ADMIN_SECRET || '',

  // Gasless (EIP-7702) — enabled when a Pimlico key is present.
  pimlicoApiKey: process.env.PIMLICO_API_KEY || '',
  // EIP-7702 delegate (SimpleAccount) — same address across chains; overridable.
  delegationAddress:
    process.env.DELEGATION_ADDRESS || '0xe6Cae83BdE06E4c305530e199D7217f42808555B',
  sponsorshipPolicyId: process.env.PIMLICO_SPONSORSHIP_POLICY_ID || '',
} as const;

/** Gasless config surfaced to the Mini App (null when not configured). */
export function gaslessConfig() {
  if (!config.pimlicoApiKey) return null;
  return {
    bundlerUrl: `https://api.pimlico.io/v2/${config.chainId}/rpc?apikey=${config.pimlicoApiKey}`,
    delegationAddress: config.delegationAddress,
    isSponsored: true,
    sponsorshipPolicyId: config.sponsorshipPolicyId || undefined,
  };
}

export function assertConfig(keys: (keyof typeof config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    console.warn(`[config] missing env: ${missing.join(', ')} — some features disabled`);
  }
}
