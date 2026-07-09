import { useState } from 'react';
import { Match, Outcome, toBaseUnits } from '@mimic/shared';
import { useApp } from '../state';
import { useAction, useToast } from '../ui';
import { api } from '../lib/api';
import { pickLabel, kickoffLabel, txLink } from '../lib/format';

const STAKES = ['5', '10', '25', '50'];

export function CreateChallenge({
  match,
  onDone,
  initialPick = null,
}: {
  match: Match;
  onDone: () => void;
  initialPick?: Outcome | null;
}) {
  const { wallet, config } = useApp();
  const { pending, run } = useAction();
  const toast = useToast();
  const [pick, setPick] = useState<Outcome | null>(initialPick);
  const [stake, setStake] = useState('10');
  const [opponent, setOpponent] = useState('');
  const [err, setErr] = useState('');

  const submit = () =>
    run(async () => {
      setErr('');
      let opponentAddr: string | null = null;
      const uname = opponent.trim().replace(/^@/, '');
      if (uname) {
        try {
          opponentAddr = (await api.resolveUsername(uname)).address;
        } catch {
          throw new Error(`@${uname} hasn't opened Mimic yet — leave blank for an open bet`);
        }
      }
      const hash = await wallet!.createChallenge({
        matchId: match.id,
        kickoff: Math.floor(new Date(match.utcKickoff).getTime() / 1000),
        pick: pick!,
        stake: toBaseUnits(stake),
        opponent: opponentAddr,
      });
      onDone();
      return hash;
    }).then((hash) => hash && toast('Prediction posted!', 'ok', txLink(config?.explorer, hash)));

  return (
    <div>
      <button className="btn ghost sm" onClick={onDone} style={{ marginBottom: 12 }}>
        ← Back
      </button>
      <div className="card">
        <div className="comp">
          <span>{match.competition}</span>
          <span>{kickoffLabel(match.utcKickoff)}</span>
        </div>
        <div className="teams" style={{ fontSize: 18 }}>
          {match.homeTeam} vs {match.awayTeam}
        </div>

        <div className="section-title">Your pick</div>
        <div className="picks">
          {[Outcome.Home, Outcome.Draw, Outcome.Away].map((o) => (
            <div key={o} className={`pick ${pick === o ? 'active' : ''}`} onClick={() => setPick(o)}>
              {pickLabel(o, match)}
              <span className="sub">{o === Outcome.Draw ? 'X' : o === Outcome.Home ? '1' : '2'}</span>
            </div>
          ))}
        </div>

        <div className="section-title">Stake (USDt)</div>
        <div className="stake-row">
          {STAKES.map((s) => (
            <div key={s} className={`chip ${stake === s ? 'active' : ''}`} onClick={() => setStake(s)}>
              {s}
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <input
            inputMode="decimal"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder="Custom amount"
          />
        </div>

        <div className="section-title">Challenge someone (optional)</div>
        <div className="field">
          <input
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="@username"
          />
          <div className="hint">
            Leave blank to open it to anyone. Winner takes the whole pot; draw-both refunds if
            neither pick hits.
          </div>
        </div>

        {err && <div className="error">{err}</div>}
        <button
          className="btn pitch block"
          disabled={pending || pick == null || !stake}
          onClick={submit}
        >
          {pending ? 'Posting…' : `Post challenge · ${stake} USDt`}
        </button>
      </div>
    </div>
  );
}
