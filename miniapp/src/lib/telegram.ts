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
 *  "accept_5"     → { action: 'accept', id: 5 }         (challenge id)
 *  "bet_537034"   → { action: 'bet', arg: '537034' }    (match id, string)
 */
export function startParam(): { action: string; id?: number; arg?: string } | null {
  const p =
    tg()?.initDataUnsafe?.start_param ||
    new URLSearchParams(window.location.search).get('startapp') ||
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgWebAppStartParam') ||
    '';
  if (!p) return null;
  const idx = p.indexOf('_');
  const action = idx === -1 ? p : p.slice(0, idx);
  const arg = idx === -1 ? '' : p.slice(idx + 1);
  return { action, arg, id: arg && /^\d+$/.test(arg) ? Number(arg) : undefined };
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
  const p = w.themeParams || {};
  const root = document.documentElement;
  const set = (k: string, v?: string) => v && root.style.setProperty(k, v);
  set('--tg-bg', p.bg_color);
  set('--tg-text', p.text_color);
  set('--tg-hint', p.hint_color);
  set('--tg-button', p.button_color);
  set('--tg-button-text', p.button_text_color);
  set('--tg-secondary-bg', p.secondary_bg_color);
  if (w.colorScheme) root.setAttribute('data-theme', w.colorScheme);
}
