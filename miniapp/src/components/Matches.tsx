import { useState } from 'react';
import { Match } from '@mimic/shared';
import { api } from '../lib/api';
import { usePolling } from '../ui';
import { kickoffLabel, isBettable } from '../lib/format';
import { CreateChallenge } from './CreateChallenge';

export function Matches() {
  const { data: matches, loading } = usePolling<Match[]>(() => api.matches(), 30000);
  const [selected, setSelected] = useState<Match | null>(null);

  if (selected) return <CreateChallenge match={selected} onDone={() => setSelected(null)} />;

  const bettable = (matches ?? []).filter(isBettable);

  return (
    <div>
      <div className="section-title">Upcoming fixtures</div>
      {loading && !matches && <div className="spinner" />}
      {!loading && bettable.length === 0 && (
        <div className="empty">
          No upcoming fixtures right now.
          <br />
          <span className="hint">(Set FOOTBALL_DATA_API_KEY on the backend to load real matches.)</span>
        </div>
      )}
      {bettable.map((m) => (
        <div key={m.id} className="card" onClick={() => setSelected(m)} style={{ cursor: 'pointer' }}>
          <div className="comp">
            <span>{m.competition}</span>
            <span>{kickoffLabel(m.utcKickoff)}</span>
          </div>
          <div className="match-head">
            <div className="teams">
              {m.homeCrest && <img src={m.homeCrest} alt="" />}
              {m.homeTeam}
              <span className="vs">vs</span>
              {m.awayCrest && <img src={m.awayCrest} alt="" />}
              {m.awayTeam}
            </div>
            <span className="pill open">BET →</span>
          </div>
        </div>
      ))}
    </div>
  );
}
