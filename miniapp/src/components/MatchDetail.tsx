import { Match } from '@mimic/shared';
import { api, MatchFacts } from '../lib/api';
import { usePolling } from '../ui';
import { flagEmoji, scoreText, statusLabel, isLive, isBettable, kickoffLabel } from '../lib/format';

/** Stats for ONE fixture: grounded goalscorers/events (played) or form + H2H
 * (upcoming). Deliberately match-specific — no tournament-wide tables. */
export function MatchDetail({
  match,
  onBet,
  onBack,
}: {
  match: Match;
  onBet: (m: Match) => void;
  onBack: () => void;
}) {
  const { data: facts } = usePolling<MatchFacts>(() => api.matchFacts(match.id), 20000, [match.id]);

  const live = isLive(match);
  const played = live || match.status === 'FINISHED';
  const bettable = isBettable(match);

  return (
    <div>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Back
      </button>

      <div className="card">
        <div className="comp">
          <span>{match.competition}</span>
          <span className={live ? 'pill live' : 'pill'}>{statusLabel(match)}</span>
        </div>
        <div className="detail-teams">
          <div className="dt">
            <span className="flag-lg">{flagEmoji(match.homeTeam) || '⚽'}</span>
            <span className="dt-name">{match.homeTeam}</span>
          </div>
          <div className="dt-score">{played && scoreText(match) ? scoreText(match) : 'v'}</div>
          <div className="dt">
            <span className="flag-lg">{flagEmoji(match.awayTeam) || '⚽'}</span>
            <span className="dt-name">{match.awayTeam}</span>
          </div>
        </div>
        {!played && (
          <div className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
            {kickoffLabel(match.utcKickoff)}
          </div>
        )}
      </div>

      <div className="section-title">{played ? '⚽ Goals & key moments' : '📊 Form & head-to-head'}</div>
      <div className="card">
        {facts === undefined ? (
          <div className="hint">Loading the football brain…</div>
        ) : facts.grounded && facts.summary ? (
          <>
            <div className="facts">{facts.summary}</div>
            <div className="ai-tag">🤖 grounded from live web search</div>
          </>
        ) : (
          <div className="hint">
            {played
              ? 'Goal details not in yet — the AI is still pulling them.'
              : 'Preview is being generated — check back in a moment.'}
          </div>
        )}
      </div>

      {bettable && (
        <button className="btn pitch block" style={{ marginTop: 8 }} onClick={() => onBet(match)}>
          Make your prediction →
        </button>
      )}
    </div>
  );
}
