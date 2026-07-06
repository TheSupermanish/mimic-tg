import { Outcome, Match, fromBaseUnits } from '@mimic/shared';

export function pickLabel(o: Outcome, m?: Match): string {
  switch (o) {
    case Outcome.Home:
      return m?.homeTeam ?? 'Home';
    case Outcome.Draw:
      return 'Draw';
    case Outcome.Away:
      return m?.awayTeam ?? 'Away';
    default:
      return '—';
  }
}

export function shortAddr(a?: string | null): string {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function usdt(base: string | bigint): string {
  return fromBaseUnits(typeof base === 'string' ? BigInt(base) : base);
}

export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = d.getTime() - now;
  const day = 86_400_000;
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (diff < 0) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (diff < day && d.getDate() === new Date().getDate())
    return `Today ${d.toLocaleTimeString([], opts)}`;
  if (diff < 2 * day) return `Tomorrow ${d.toLocaleTimeString([], opts)}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function isBettable(m: Match): boolean {
  return (m.status === 'SCHEDULED' || m.status === 'TIMED') && new Date(m.utcKickoff).getTime() > Date.now();
}
