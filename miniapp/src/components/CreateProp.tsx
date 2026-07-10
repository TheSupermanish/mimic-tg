import { useState } from 'react';
import { Match, toBaseUnits } from '@mimic/shared';
import { useApp } from '../state';
import { useAction, useToast } from '../ui';
import { api } from '../lib/api';
import { kickoffLabel, txLink, flagEmoji } from '../lib/format';

const STAKES = ['5', '10', '25', '50'];

/** "Bet on anything": pose a YES/NO prop on a fixture, settled by the AI oracle. */
export function CreateProp({
  match,
  initialQuestion = '',
  onDone,
}: {
  match: Match;
  initialQuestion?: string;
  onDone: () => void;
}) {
  const { wallet, config } = useApp();
  const { pending, run } = useAction();
  const toast = useToast();
  const [question, setQuestion] = useState(initialQuestion);
  const [backsYes, setBacksYes] = useState(true);
  const [stake, setStake] = useState('10');
  const [opponent, setOpponent] = useState('');
  const [err, setErr] = useState('');

  const templates = [
    'Over 2.5 total goals',
    'Both teams to score',
    'A red card is shown',
    `${match.homeTeam} to keep a clean sheet`,
  ];

  const submit = () =>
    run(async () => {
      setErr('');
      let opponentAddr: string | null = null;
      const uname = opponent.trim().replace(/^@/, '');
      if (uname) {
        try {
          opponentAddr = (await api.resolveUsername(uname)).address;
        } catch {
          throw new Error(`@${uname} hasn't opened Mimic yet — leave blank for an open prop`);
        }
      }
      // settle a few hours after kickoff, once the match is done
      const resolveBy = Math.floor(new Date(match.utcKickoff).getTime() / 1000) + 3 * 3600;
      const hash = await wallet!.createProp({
        question: question.trim(),
        matchId: match.id,
        resolveBy,
        backsYes,
        stake: toBaseUnits(stake),
        opponent: opponentAddr,
      });
      onDone();
      return hash;
    }).then((hash) => hash && toast('Prop posted!', 'ok', txLink(config?.explorer, hash)));

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
        <div className="teams" style={{ fontSize: 16 }}>
          {flagEmoji(match.homeTeam)} {match.homeTeam} <span className="vs">vs</span>{' '}
          {flagEmoji(match.awayTeam)} {match.awayTeam}
        </div>

        <div className="section-title">Bet on anything 🎲</div>
        <div className="field">
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Messi to score, over 2.5 goals, a red card…"
          />
        </div>
        <div className="templates">
          {templates.map((t) => (
            <span key={t} className={`tpl${question === t ? ' on' : ''}`} onClick={() => setQuestion(t)}>
              {t}
            </span>
          ))}
        </div>

        <div className="section-title">Your call</div>
        <div className="yn">
          <button className={`ynbtn yes${backsYes ? ' sel' : ''}`} onClick={() => setBacksYes(true)}>
            YES<small>it happens</small>
          </button>
          <button className={`ynbtn no${!backsYes ? ' sel' : ''}`} onClick={() => setBacksYes(false)}>
            NO<small>it doesn't</small>
          </button>
        </div>

        <div className="ai-note">
          <span>🤖</span>
          <div>
            <b>AI-settled.</b> After the match a grounded web search decides YES/NO. If it can't be
            verified, the prop <b>voids and both stakes are refunded</b>.
          </div>
        </div>

        <div className="section-title">Stake (USDt)</div>
        <div className="stake-row">
          {STAKES.map((s) => (
            <div key={s} className={`chip ${stake === s ? 'active' : ''}`} onClick={() => setStake(s)}>
              {s}
            </div>
          ))}
        </div>

        <div className="section-title">Challenge someone (optional)</div>
        <div className="field">
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="@username" />
          <div className="hint">Leave blank to open it to anyone. Winner takes the whole pot.</div>
        </div>

        {err && <div className="error">{err}</div>}
        <button
          className="btn pitch block"
          disabled={pending || !question.trim() || !stake}
          onClick={submit}
        >
          {pending ? 'Posting…' : `Post prop · ${stake} USDt`}
        </button>
      </div>
    </div>
  );
}
