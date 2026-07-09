import { useState } from 'react';
import { Match } from '@mimic/shared';
import { api } from '../lib/api';
import { usePolling } from '../ui';
import { isBettable, isLive, hasScore, scoreText, statusLabel, flagEmoji } from '../lib/format';
import { CreateChallenge } from './CreateChallenge';

/** National-team flag emoji if we know it, else the club crest (rectangular). */
function Crest({ name, crest }: { name: string; crest?: string }) {
  const f = flagEmoji(name);
  if (f) return <span className="flag">{f}</span>;
  if (crest) return <img className="crest-img" src={crest} alt="" />;
  return null;
}

function MatchCard({ m, onBet }: { m: Match; onBet?: (m: Match) => void }) {
  const bettable = !!onBet;
  const live = isLive(m);
  return (
    <div
      className="card"
      onClick={bettable ? () => onBet!(m) : undefined}
      style={bettable ? { cursor: 'pointer' } : undefined}
    >
      <div className="comp">
        <span>{m.competition}</span>
        <span className={live ? 'pill live' : 'pill'}>{statusLabel(m)}</span>
      </div>
      <div className="match-head">
        <div className="teams">
          <Crest name={m.homeTeam} crest={m.homeCrest} /> {m.homeTeam}
          <span className="vs">vs</span>
          <Crest name={m.awayTeam} crest={m.awayCrest} /> {m.awayTeam}
        </div>
        {hasScore(m) ? (
          <span className="score">{scoreText(m)}</span>
        ) : bettable ? (
          <span className="go">Bet →</span>
        ) : null}
      </div>
    </div>
  );
}

export function Matches() {
  const { data: matches, loading } = usePolling<Match[]>(() => api.matches(), 30000);
  const [selected, setSelected] = useState<Match | null>(null);

  if (selected) return <CreateChallenge match={selected} onDone={() => setSelected(null)} />;

  const all = matches ?? [];
  const live = all.filter(isLive);
  const upcoming = all.filter(isBettable);
  const finished = all
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => b.utcKickoff.localeCompare(a.utcKickoff))
    .slice(0, 8);

  return (
    <div>
      {loading && !matches && (
        <>
          <div className="section-title">Loading fixtures…</div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </>
      )}

      {live.length > 0 && (
        <>
          <div className="section-title">🔴 Live now</div>
          {live.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </>
      )}

      <div className="section-title">Upcoming — tap to bet</div>
      {!loading && upcoming.length === 0 && (
        <div className="empty">
          No upcoming fixtures right now.
          <br />
          <span className="hint">(Set FOOTBALL_DATA_API_KEY on the backend to load real matches.)</span>
        </div>
      )}
      {upcoming.map((m) => (
        <MatchCard key={m.id} m={m} onBet={setSelected} />
      ))}

      {finished.length > 0 && (
        <>
          <div className="section-title">Recent results</div>
          {finished.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </>
      )}
    </div>
  );
}
