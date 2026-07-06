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

  mockUsdtAddress: process.env.MOCK_USDT_ADDRESS || deployed.mockUsdt || '',
  predictionMarketAddress: process.env.PREDICTION_MARKET_ADDRESS || deployed.predictionMarket || '',
  resolverPrivateKey: (() => {
    const k = process.env.RESOLVER_PRIVATE_KEY || '';
    return k && !k.startsWith('0x') ? `0x${k}` : k;
  })(),

  footballApiKey: process.env.FOOTBALL_DATA_API_KEY || '',
  // football-data.org competition codes to surface fixtures from.
  competitions: (process.env.FOOTBALL_COMPETITIONS || 'PL,CL,PD,BL1,SA,FL1').split(','),

  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  miniappUrl: process.env.MINIAPP_URL || '',
} as const;

export function assertConfig(keys: (keyof typeof config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    console.warn(`[config] missing env: ${missing.join(', ')} — some features disabled`);
  }
}
