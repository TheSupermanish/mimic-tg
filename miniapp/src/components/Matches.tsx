import { useState } from 'react';
import { Match } from '@mimic/shared';
import { api } from '../lib/api';
import { usePolling } from '../ui';
import { isBettable, isLive, hasScore, scoreText, statusLabel, flagEmoji } from '../lib/format';
import { CreateChallenge } from './CreateChallenge';
import { MatchDetail } from './MatchDetail';

/** National-team flag emoji if we know it, else the club crest (rectangular). */
function Crest({ name, crest }: { name: string; crest?: string }) {
  const f = flagEmoji(name);
  if (f) return <span className="flag">{f}</span>;
  if (crest) return <img className="crest-img" src={crest} alt="" />;
  return null;
}

/** Every card opens the match detail (stats hub); the detail is where you bet. */
function MatchCard({ m, onOpen }: { m: Match; onOpen: (m: Match) => void }) {
  const live = isLive(m);
  const bettable = isBettable(m);
  return (
    <div className="card" onClick={() => onOpen(m)} style={{ cursor: 'pointer' }}>
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
          <span className="go">Predict →</span>
        ) : null}
      </div>
    </div>
  );
}

export function Matches() {
  const { data: matches, loading } = usePolling<Match[]>(() => api.matches(), 30000);
  const [selected, setSelected] = useState<Match | null>(null);
  const [detail, setDetail] = useState<Match | null>(null);

  if (selected) return <CreateChallenge match={selected} onDone={() => setSelected(null)} />;
  if (detail)
    return (
      <MatchDetail
        match={detail}
        onBet={(m) => {
          setDetail(null);
          setSelected(m);
        }}
        onBack={() => setDetail(null)}
      />
    );

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
            <MatchCard key={m.id} m={m} onOpen={setDetail} />
          ))}
        </>
      )}

      <div className="section-title">Upcoming — tap for stats & to bet</div>
      {!loading && upcoming.length === 0 && (
        <div className="empty">
          No upcoming fixtures right now.
          <br />
          <span className="hint">(Set FOOTBALL_DATA_API_KEY on the backend to load real matches.)</span>
        </div>
      )}
      {upcoming.map((m) => (
        <MatchCard key={m.id} m={m} onOpen={setDetail} />
      ))}

      {finished.length > 0 && (
        <>
          <div className="section-title">Recent results — tap for goals</div>
          {finished.map((m) => (
            <MatchCard key={m.id} m={m} onOpen={setDetail} />
          ))}
        </>
      )}
    </div>
  );
}
