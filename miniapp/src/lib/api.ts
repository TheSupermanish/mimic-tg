import type { Challenge, Match, TelegramUser } from '@mimic/shared';

export interface GaslessConfig {
  bundlerUrl: string;
  delegationAddress: string;
  isSponsored: boolean;
  sponsorshipPolicyId?: string;
}

export interface AppConfig {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  wdkChainKey: string;
  mockUsdt: string;
  predictionMarket: string;
  gasless: GaslessConfig | null;
}

export interface MatchFacts {
  matchId: string;
  summary: string; // scorers/events (played) or form + H2H (upcoming), grounded
  grounded: boolean;
  kind: 'result' | 'preview';
}
export interface CompetitionInsight {
  code: string;
  name: string;
  scorers: { player: string; team: string; goals: number; assists: number | null }[];
  standings: { group: string; table: { position: number; team: string; played: number; points: number; goalDiff: number }[] }[];
}
export interface Insights {
  competitions: CompetitionInsight[];
  matches: { teams: string; score: string; summary: string }[];
}

// Default to same-origin '/api' (proxied to the backend by Vite) so the app
// works both on localhost and when served through a public tunnel.
const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '/api';

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
  match: (id: string) => get<Match>(`/matches/${encodeURIComponent(id)}`),
  matchFacts: (id: string) =>
    get<MatchFacts>(`/matches/${encodeURIComponent(id)}/facts`).catch(
      () => ({ matchId: id, summary: '', grounded: false, kind: 'result' }) as MatchFacts,
    ),
  insights: () =>
    get<Insights>('/insights').catch(() => ({ competitions: [], matches: [] }) as Insights),
  markets: (q = '') => get<{ challenges: Challenge[] }>(`/markets${q}`).then((r) => r.challenges),
  market: (id: number) => get<Challenge>(`/markets/${id}`),
  resolveUsername: (username: string) =>
    get<{ username: string; address: string }>(`/users/${encodeURIComponent(username)}`),
  auth: (initData: string, address: string) =>
    post<{ user: TelegramUser; address: string }>('/auth/telegram', { initData, address }),
  faucetGas: (address: string) => post<{ ok: boolean; hash?: string }>('/faucet/gas', { address }),
};
