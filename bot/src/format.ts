import { Outcome, type Match } from '@mimic/shared';

/** Human label for a pick, using team names when the fixture is known. */
export function pickLabelFromOutcome(o: Outcome, m?: Match): string {
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

function hasScore(m: Match): boolean {
  return typeof m.scoreHome === 'number' && typeof m.scoreAway === 'number';
}

/** Compact kickoff label, e.g. "Today 20:00" / "Tue 15:00". */
export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  const sameDay = d.getUTCDate() === now.getUTCDate() && d.getUTCMonth() === now.getUTCMonth();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const isTomorrow = d.getUTCDate() === tomorrow.getUTCDate() && d.getUTCMonth() === tomorrow.getUTCMonth();
  if (sameDay) return `Today ${time}`;
  if (isTomorrow) return `Tmrw ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${time}`;
}

/** Short status/score badge for a match. */
export function statusBadge(m: Match): string {
  if (isLive(m)) return m.status === 'PAUSED' ? 'HT' : '🔴 LIVE';
  if (m.status === 'FINISHED') return 'FT';
  if (m.status === 'POSTPONED') return 'postponed';
  return kickoffLabel(m.utcKickoff);
}

/** One text line for a fixture: "Brazil 1–2 Norway · FT" or "France v Morocco · Today 20:00". */
export function matchLine(m: Match): string {
  if (hasScore(m)) {
    return `${m.homeTeam} ${m.scoreHome}–${m.scoreAway} ${m.awayTeam} · ${statusBadge(m)}`;
  }
  return `${m.homeTeam} v ${m.awayTeam} · ${statusBadge(m)}`;
}

/** Short label for a tappable bet button, kept within Telegram's button width. */
export function betButtonLabel(m: Match): string {
  return `⚽️ ${m.homeTeam} v ${m.awayTeam}`;
}

/** One HTML scoreboard row: "Brazil <b>1–2</b> Norway · FT". */
export function scoreRow(m: Match): string {
  const score =
    typeof m.scoreHome === 'number' && typeof m.scoreAway === 'number'
      ? `<b>${m.scoreHome}–${m.scoreAway}</b>`
      : '<b>v</b>';
  return `${m.homeTeam} ${score} ${m.awayTeam} · ${statusBadge(m)}`;
}
