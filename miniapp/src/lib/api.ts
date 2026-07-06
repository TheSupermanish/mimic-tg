import type { Challenge, Match, TelegramUser } from '@mimic/shared';

export interface AppConfig {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  wdkChainKey: string;
  mockUsdt: string;
  predictionMarket: string;
}

const BASE = (import.meta.env.VITE_BACKEND_URL as string) || 'http://localhost:8787';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path} → ${res.status}`);
  return res.json();
}

export const api = {
  config: () => get<AppConfig>('/config'),
  matches: () => get<{ matches: Match[] }>('/matches').then((r) => r.matches),
  markets: (q = '') => get<{ challenges: Challenge[] }>(`/markets${q}`).then((r) => r.challenges),
  market: (id: number) => get<Challenge>(`/markets/${id}`),
  resolveUsername: (username: string) =>
    get<{ username: string; address: string }>(`/users/${encodeURIComponent(username)}`),
  auth: (initData: string, address: string) =>
    post<{ user: TelegramUser; address: string }>('/auth/telegram', { initData, address }),
  faucetGas: (address: string) => post<{ ok: boolean; hash?: string }>('/faucet/gas', { address }),
};
