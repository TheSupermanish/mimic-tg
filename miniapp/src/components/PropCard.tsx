import { useApp } from '../state';
import { useAction, useToast } from '../ui';
import { Prop } from '../lib/api';
import { usdt, shortAddr, avatarGradient, avatarInitial, flagEmoji, txLink } from '../lib/format';

/** One YES/NO prop market: state, accept the other side, and settlement receipt. */
export function PropCard({ p, onChanged }: { p: Prop; onChanged: () => void }) {
  const { wallet, config } = useApp();
  const explorer = config?.explorer;
  const { pending, run } = useAction();
  const toast = useToast();

  const me = wallet?.address.toLowerCase();
  const isCreator = me === p.creator.toLowerCase();
  const isTaker = !!p.taker && me === p.taker.toLowerCase();
  const stake = BigInt(p.stake);
  const pot = usdt(stake * 2n);
  const expired = p.status === 0 && p.resolveBy * 1000 <= Date.now();
  const creatorName = p.creatorTgUsername ? `@${p.creatorTgUsername}` : shortAddr(p.creator);
  const creatorSide = p.creatorBacksYes ? 'YES' : 'NO';
  const takerSide = p.creatorBacksYes ? 'NO' : 'YES';
  const m = p.match;
  const title = m ? `${flagEmoji(m.homeTeam)} ${m.homeTeam} vs ${flagEmoji(m.awayTeam)} ${m.awayTeam}` : `Match ${p.matchId}`;

  const yesWon = p.result === 1;
  const winnerIsCreator = yesWon === p.creatorBacksYes;
  const iWon = p.result !== 3 && p.result !== 0 && ((isCreator && winnerIsCreator) || (isTaker && !winnerIsCreator));

  return (
    <div className="card">
      <div className="comp">
        <span>{title}</span>
        <PropStatusPill p={p} isCreator={isCreator} isTaker={isTaker} expired={expired} iWon={iWon} />
      </div>
      <div className="prop-q">🎲 {p.question}</div>

      <div className="feedrow">
        <span className="avatar" style={{ background: avatarGradient(p.creator) }}>
          {avatarInitial(creatorName)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14 }}>
            <b>{creatorName}</b> backs{' '}
            <b className={p.creatorBacksYes ? 'yes' : 'no'}>{creatorSide}</b> for{' '}
            <b>{usdt(stake)} USDt</b>
          </div>
          {p.opponent && (
            <div className="hint">
              → directed to {p.opponentTgUsername ? `@${p.opponentTgUsername}` : shortAddr(p.opponent)}
            </div>
          )}
        </div>
        <span className="pot-chip">
          pot <b>{pot}</b>
        </span>
      </div>

      {/* Open, taker's move */}
      {p.status === 0 && !isCreator && !expired && (
        <button
          className="btn pitch block"
          style={{ marginTop: 12 }}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const h = await wallet!.acceptProp(p.id, stake);
              onChanged();
              return h;
            }).then((h) => h && toast(`You're in — backing ${takerSide}!`, 'ok', txLink(explorer, h)))
          }
        >
          {pending ? 'Locking stake…' : `Take ${takerSide} · stake ${usdt(stake)} USDt`}
        </button>
      )}

      {/* Open, creator can cancel */}
      {p.status === 0 && isCreator && (
        <button
          className={`btn ${expired ? 'gold' : 'ghost'} block sm`}
          style={{ marginTop: 12 }}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const h = await wallet!.cancelProp(p.id);
              onChanged();
              return h;
            }).then((h) => h && toast(expired ? 'Stake reclaimed' : 'Cancelled & refunded', 'ok', txLink(explorer, h)))
          }
        >
          {pending ? '…' : expired ? 'Reclaim stake' : 'Cancel & refund'}
        </button>
      )}

      {p.status === 0 && !isCreator && expired && (
        <div className="hint" style={{ marginTop: 12 }}>
          ⌛ This prop expired before anyone took it.
        </div>
      )}

      {p.status === 1 && (
        <div className="hint" style={{ marginTop: 12 }}>
          🔒 Locked — the AI oracle settles this after the match.
        </div>
      )}

      {p.status === 2 && (p.aiRationale || p.resolveTxHash) && (
        <div className="receipt">
          <div className="receipt-h">🧾 How this settled</div>
          {p.aiRationale && (
            <div className="receipt-why">
              🤖 {p.result === 3 ? 'Voided (unverifiable) — stakes refunded. ' : ''}
              {p.aiRationale}
              {p.aiSource ? ` · ${p.aiSource}` : ''}
            </div>
          )}
          {p.resolveTxHash && explorer && (
            <a
              className="receipt-tx"
              href={`${explorer}/tx/${p.resolveTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              🔗 Resolved on-chain — view on BaseScan ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PropStatusPill({
  p,
  isCreator,
  isTaker,
  expired,
  iWon,
}: {
  p: Prop;
  isCreator: boolean;
  isTaker: boolean;
  expired: boolean;
  iWon: boolean;
}) {
  if (expired) return <span className="pill warn">EXPIRED</span>;
  if (p.status === 0) return <span className="pill open">OPEN</span>;
  if (p.status === 3) return <span className="pill">REFUNDED</span>;
  if (p.status === 1) return <span className="pill live">MATCHED</span>;
  if (p.result === 3) return <span className="pill">VOID · REFUND</span>;
  if (isCreator || isTaker) return <span className={`pill ${iWon ? 'win' : 'lose'}`}>{iWon ? 'WON' : 'LOST'}</span>;
  return <span className="pill">SETTLED</span>;
}
