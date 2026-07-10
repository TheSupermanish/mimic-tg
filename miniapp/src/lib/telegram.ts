/** Thin helpers over the Telegram WebApp SDK, with safe fallbacks for browser dev. */

interface TgWebApp {
  ready(): void;
  expand(): void;
  initData: string;
  initDataUnsafe: { user?: { id: number; username?: string; first_name?: string }; start_param?: string };
  themeParams: Record<string, string>;
  colorScheme: 'light' | 'dark';
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(t: string): void };
  openTelegramLink?(url: string): void;
}

export function tg(): TgWebApp | null {
  return (window as any).Telegram?.WebApp ?? null;
}

export function initTelegram(): void {
  const w = tg();
  if (!w) return;
  w.ready();
  w.expand();
  applyTheme();
}

export function initDataRaw(): string {
  return tg()?.initData ?? '';
}

export function currentUser(): { id: number; username?: string; firstName?: string } | null {
  const u = tg()?.initDataUnsafe?.user;
  if (!u) return null;
  return { id: u.id, username: u.username, firstName: u.first_name };
}

/**
 * Deep-link start param.
 *  "accept_5"          → { action: 'accept', id: 5 }                 (challenge id)
 *  "bet_537034"        → { action: 'bet', arg: '537034' }            (match id)
 *  "bet_537034_home"   → { action: 'bet', arg: '537034', pick: 'home' } (pre-selected pick)
 */
export function startParam(): {
  action: string;
  id?: number;
  arg?: string;
  pick?: string;
  q?: string; // decoded prop question, for action 'prop'
} | null {
  const p =
    tg()?.initDataUnsafe?.start_param ||
    new URLSearchParams(window.location.search).get('startapp') ||
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgWebAppStartParam') ||
    '';
  if (!p) return null;
  // prop_<matchId>_<base64url question> — matchId is numeric, question may contain
  // the split char, so parse it specially.
  if (p.startsWith('prop_')) {
    const rest = p.slice('prop_'.length);
    const us = rest.indexOf('_');
    const arg = us >= 0 ? rest.slice(0, us) : rest;
    const q = us >= 0 ? b64urlDecode(rest.slice(us + 1)) : '';
    return { action: 'prop', arg, q, id: /^\d+$/.test(arg) ? Number(arg) : undefined };
  }
  const [action, arg = '', pick] = p.split('_');
  return { action, arg, pick, id: arg && /^\d+$/.test(arg) ? Number(arg) : undefined };
}

function b64urlDecode(s: string): string {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '==='.slice((b64.length + 3) % 4);
    return decodeURIComponent(escape(atob(pad)));
  } catch {
    return '';
  }
}

export function haptic(type: 'success' | 'error' | 'light' = 'light'): void {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (type === 'success') h.notificationOccurred('success');
  else if (type === 'error') h.notificationOccurred('error');
  else h.impactOccurred('light');
}

function applyTheme(): void {
  const w = tg();
  if (!w) return;
  // Mimic keeps its own brand identity (dark canvas + yellow accent) rather
  // than adopting the user's Telegram theme — otherwise the look changes per
  // user. We only record the color scheme in case we ever want to react to it.
  if (w.colorScheme) document.documentElement.setAttribute('data-theme', w.colorScheme);
}
