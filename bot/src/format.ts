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
