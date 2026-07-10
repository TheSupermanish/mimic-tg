import { useState } from 'react';
import { Match } from '@mimic/shared';
import { api, MatchFacts, Prop } from '../lib/api';
import { usePolling } from '../ui';
import { flagEmoji, scoreText, statusLabel, isLive, isBettable, kickoffLabel } from '../lib/format';
import { CreateProp } from './CreateProp';
import { PropCard } from './PropCard';

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
  const { data: props, refresh: refreshProps } = usePolling<Prop[]>(
    () => api.props(`?matchId=${encodeURIComponent(match.id)}`),
    15000,
    [match.id],
  );
  const [propMode, setPropMode] = useState(false);

  const live = isLive(match);
  const played = live || match.status === 'FINISHED';
  const bettable = isBettable(match);
  const canProp = bettable || live; // props make sense pre-match or in-play

  if (propMode) return <CreateProp match={match} onDone={() => (setPropMode(false), refreshProps())} />;

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
        <button className="btn pitch block" style={{ marginTop: 8, marginBottom: 8 }} onClick={() => onBet(match)}>
          Make your prediction →
        </button>
      )}

      {/* side bets — bet on anything, AI-settled */}
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🎲 Side bets — bet on anything</span>
        {canProp && (
          <button className="btn gold sm" onClick={() => setPropMode(true)}>
            + New
          </button>
        )}
      </div>
      {(props ?? []).length === 0 ? (
        <div className="hint" style={{ marginBottom: 12 }}>
          {canProp
            ? 'No side bets yet. Post the first: "Messi to score", "over 2.5 goals", anything.'
            : 'No side bets on this match.'}
        </div>
      ) : (
        (props ?? []).map((p) => <PropCard key={p.id} p={p} onChanged={refreshProps} />)
      )}
    </div>
  );
}
