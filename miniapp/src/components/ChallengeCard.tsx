import { useState } from 'react';
import { Challenge, ChallengeStatus, Outcome } from '@mimic/shared';
import { useApp } from '../state';
import { useAction } from '../ui';
import {
  pickLabel,
  usdt,
  kickoffLabel,
  shortAddr,
  isChallengeExpired,
  avatarGradient,
  avatarInitial,
} from '../lib/format';

function Avatar({ seed, label }: { seed: string; label: string }) {
  return (
    <span className="avatar" style={{ background: avatarGradient(seed) }}>
      {avatarInitial(label)}
    </span>
  );
}

const OUTCOMES = [Outcome.Home, Outcome.Draw, Outcome.Away];

export function ChallengeCard({ c, onChanged }: { c: Challenge; onChanged: () => void }) {
  const { wallet } = useApp();
  const { pending, run } = useAction();
  const [takerPick, setTakerPick] = useState<Outcome | null>(null);
  const me = wallet?.address.toLowerCase();
  const isCreator = me === c.creator.toLowerCase();
  const isTaker = c.taker && me === c.taker.toLowerCase();
  const expired = isChallengeExpired(c);
  const m = c.match;
  const stake = BigInt(c.stake);
  const pot = usdt(stake * 2n);

  const title = m ? `${m.homeTeam} vs ${m.awayTeam}` : `Match ${c.matchId}`;
  const creatorName = c.creatorTgUsername ? `@${c.creatorTgUsername}` : shortAddr(c.creator);

  const live = !!m && (m.status === 'IN_PLAY' || m.status === 'PAUSED');
  const scoreLine =
    m && (m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'FINISHED') && m.scoreHome != null
      ? `${m.scoreHome}–${m.scoreAway}`
      : m
        ? kickoffLabel(m.utcKickoff)
        : '';

  return (
    <div className="card">
      <div className="comp">
        <span>{m?.competition ?? 'Football'}</span>
        {live ? <span className="pill live">🔴 LIVE {scoreLine}</span> : <span>{scoreLine}</span>}
      </div>
      <div className="match-head">
        <div className="teams">{title}</div>
        <StatusPill c={c} isCreator={isCreator} isTaker={!!isTaker} expired={expired} />
      </div>

      <div className="feedrow">
        <Avatar seed={c.creator} label={creatorName} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14 }}>
            <b>{creatorName}</b> backs{' '}
            <b style={{ color: 'var(--pitch)' }}>{pickLabel(c.creatorPick, m)}</b> for{' '}
            <b>{usdt(stake)} USDt</b>
          </div>
          {c.opponent && (
            <div className="hint">
              → directed to {c.opponentTgUsername ? `@${c.opponentTgUsername}` : shortAddr(c.opponent)}
            </div>
          )}
        </div>
        <span className="pot-chip">
          pot <b>{pot}</b>
        </span>
      </div>

      {c.status === ChallengeStatus.Matched && (
        <div style={{ marginTop: 6, fontSize: 14 }} className="hint">
          {isTaker || c.takerPick != null
            ? `${c.opponentTgUsername ? '@' + c.opponentTgUsername : 'Taker'} backs ${pickLabel(c.takerPick!, m)}`
            : ''}{' '}
          · pot <b style={{ color: 'var(--gold)' }}>{pot} USDt</b>
        </div>
      )}

      {/* actions */}
      {c.status === ChallengeStatus.Open && isCreator && (
        <>
          {expired && (
            <div className="hint" style={{ marginTop: 10 }}>
              ⌛ Kickoff passed with no taker — reclaim your stake.
            </div>
          )}
          <button
            className={`btn ${expired ? 'gold' : 'ghost'} block sm`}
            style={{ marginTop: expired ? 8 : 12 }}
            disabled={pending}
            onClick={() =>
              run(async () => (await wallet!.cancel(c.id), onChanged()), expired ? 'Stake reclaimed' : 'Cancelled & refunded')
            }
          >
            {pending ? '…' : expired ? 'Reclaim stake' : 'Cancel & refund'}
          </button>
        </>
      )}

      {c.status === ChallengeStatus.Open && !isCreator && expired && (
        <div className="hint" style={{ marginTop: 12 }}>
          ⌛ This challenge expired — kickoff has passed, so it can no longer be taken.
        </div>
      )}

      {c.status === ChallengeStatus.Open && !isCreator && !expired && (
        <div style={{ marginTop: 12 }}>
          <div className="hint" style={{ marginBottom: 6 }}>
            Take the other side — pick a different outcome:
          </div>
          <div className="picks">
            {OUTCOMES.filter((o) => o !== c.creatorPick).map((o) => (
              <div
                key={o}
                className={`pick ${takerPick === o ? 'active' : ''}`}
                onClick={() => setTakerPick(o)}
              >
                {pickLabel(o, m)}
              </div>
            ))}
          </div>
          <button
            className="btn pitch block"
            disabled={pending || takerPick == null}
            onClick={() =>
              run(async () => {
                await wallet!.acceptChallenge(c.id, takerPick!, stake);
                onChanged();
              }, `Bet on! ${usdt(stake)} USDt locked`)
            }
          >
            {pending ? 'Locking stake…' : `Accept · stake ${usdt(stake)} USDt`}
          </button>
        </div>
      )}

      {c.status === ChallengeStatus.Matched &&
        (isCreator || isTaker) &&
        (c.result === Outcome.Pending ? (
          <div className="hint" style={{ marginTop: 12 }}>
            🔒 Locked — settles automatically once the result is in.
          </div>
        ) : (
          <button
            className="btn gold block sm"
            style={{ marginTop: 12 }}
            disabled={pending}
            onClick={() => run(async () => (await wallet!.claim(c.id), onChanged()), 'Settled')}
          >
            Claim winnings
          </button>
        ))}

      {c.status === ChallengeStatus.Settled && c.aiRationale && (
        <div className="hint" style={{ marginTop: 10 }}>
          {c.resolvedByAi ? '🤖 ' : ''}
          {c.aiRationale}
          {c.aiSource ? ` · ${c.aiSource}` : ''}
        </div>
      )}
    </div>
  );
}

function StatusPill({
  c,
  isCreator,
  isTaker,
  expired,
}: {
  c: Challenge;
  isCreator: boolean;
  isTaker: boolean;
  expired: boolean;
}) {
  if (expired) return <span className="pill warn">EXPIRED</span>;
  if (c.status === ChallengeStatus.Open) return <span className="pill open">OPEN</span>;
  if (c.status === ChallengeStatus.Cancelled) return <span className="pill">REFUNDED</span>;
  if (c.status === ChallengeStatus.Matched) return <span className="pill live">MATCHED</span>;
  // Settled
  if (c.result === Outcome.Pending) return <span className="pill">SETTLED</span>;
  const iWon =
    (isCreator && c.result === c.creatorPick) || (isTaker && c.result === c.takerPick);
  const refund = c.result !== c.creatorPick && c.result !== c.takerPick;
  if (refund) return <span className="pill">DRAW · REFUND</span>;
  if (isCreator || isTaker) return <span className={`pill ${iWon ? 'win' : 'lose'}`}>{iWon ? 'WON' : 'LOST'}</span>;
  return <span className="pill">SETTLED</span>;
}
