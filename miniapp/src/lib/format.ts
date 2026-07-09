import { Outcome, Match, Challenge, ChallengeStatus, fromBaseUnits } from '@mimic/shared';

/** An OPEN challenge whose kickoff has passed can no longer be accepted — the
 * creator's stake is stuck until they reclaim it. */
export function isChallengeExpired(c: Pick<Challenge, 'status' | 'kickoff'>): boolean {
  return c.status === ChallengeStatus.Open && c.kickoff > 0 && c.kickoff * 1000 <= Date.now();
}

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

/** A BaseScan tx receipt link for a toast, or undefined if we can't build one. */
export function txLink(
  explorer: string | undefined,
  hash?: string,
): { href: string; label: string } | undefined {
  return explorer && hash ? { href: `${explorer}/tx/${hash}`, label: 'View on BaseScan ↗' } : undefined;
}

export function shortAddr(a?: string | null): string {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Deterministic squircle-avatar gradient from an address/username seed. */
export function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 48) % 360} 70% 42%))`;
}

/** First letter for an avatar: '@handle' → 'H', address → its first hex char. */
export function avatarInitial(name: string): string {
  const s = name.replace(/^@/, '').replace(/^0x/, '');
  return (s[0] || '?').toUpperCase();
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

/** A fixture whose teams aren't decided yet (e.g. World Cup bracket placeholders). */
export function teamsKnown(m: Match): boolean {
  const tbd = (s?: string) => !s || /\btbd\b/i.test(s);
  return !tbd(m.homeTeam) && !tbd(m.awayTeam);
}

export function isBettable(m: Match): boolean {
  return (
    (m.status === 'SCHEDULED' || m.status === 'TIMED') &&
    new Date(m.utcKickoff).getTime() > Date.now() &&
    teamsKnown(m)
  );
}

export function isLive(m: Match): boolean {
  return m.status === 'IN_PLAY' || m.status === 'PAUSED';
}

export function hasScore(m: Match): boolean {
  return typeof m.scoreHome === 'number' && typeof m.scoreAway === 'number';
}

export function scoreText(m: Match): string {
  return hasScore(m) ? `${m.scoreHome}–${m.scoreAway}` : '';
}

/** Flag emoji for a national-team name (World Cup fixtures). '' for clubs/unknown,
 * so callers can fall back to the crest image. */
const FLAGS: Record<string, string> = {
  argentina: '🇦🇷', france: '🇫🇷', morocco: '🇲🇦', spain: '🇪🇸', belgium: '🇧🇪',
  norway: '🇳🇴', england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', switzerland: '🇨🇭', egypt: '🇪🇬', mexico: '🇲🇽',
  'united states': '🇺🇸', usa: '🇺🇸', portugal: '🇵🇹', colombia: '🇨🇴', brazil: '🇧🇷',
  germany: '🇩🇪', netherlands: '🇳🇱', croatia: '🇭🇷', italy: '🇮🇹', uruguay: '🇺🇾',
  japan: '🇯🇵', 'south korea': '🇰🇷', 'korea republic': '🇰🇷', senegal: '🇸🇳', ghana: '🇬🇭',
  nigeria: '🇳🇬', cameroon: '🇨🇲', ecuador: '🇪🇨', poland: '🇵🇱', denmark: '🇩🇰',
  sweden: '🇸🇪', serbia: '🇷🇸', 'ivory coast': '🇨🇮', "cote d'ivoire": '🇨🇮', tunisia: '🇹🇳',
  algeria: '🇩🇿', australia: '🇦🇺', canada: '🇨🇦', 'costa rica': '🇨🇷', 'saudi arabia': '🇸🇦',
  qatar: '🇶🇦', iran: '🇮🇷', wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', peru: '🇵🇪',
  chile: '🇨🇱', paraguay: '🇵🇾', turkey: '🇹🇷', turkiye: '🇹🇷', austria: '🇦🇹', ukraine: '🇺🇦',
  czechia: '🇨🇿', 'czech republic': '🇨🇿', greece: '🇬🇷', panama: '🇵🇦', jamaica: '🇯🇲',
  'south africa': '🇿🇦', 'new zealand': '🇳🇿', honduras: '🇭🇳',
};
export function flagEmoji(name?: string): string {
  if (!name) return '';
  return FLAGS[name.trim().toLowerCase()] ?? '';
}
/** "🇦🇷 Argentina" when we have a flag, else just the name. */
export function withFlag(name?: string): string {
  const f = flagEmoji(name);
  return f ? `${f} ${name}` : name ?? '';
}

/** Short status label for a match badge. */
export function statusLabel(m: Match): string {
  switch (m.status) {
    case 'IN_PLAY':
      return '🔴 LIVE';
    case 'PAUSED':
      return 'HT';
    case 'FINISHED':
      return 'FT';
    case 'POSTPONED':
      return 'POSTP';
    default:
      return kickoffLabel(m.utcKickoff);
  }
}
