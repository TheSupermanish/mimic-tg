import { useApp } from '../state';
import { usePolling, useAction } from '../ui';
import { shortAddr, usdt } from '../lib/format';

export function WalletHeader() {
  const { wallet, username } = useApp();
  const { pending, run } = useAction();
  const { data: balance, refresh } = usePolling(
    () => wallet!.usdtBalance(),
    10000,
    [wallet?.address],
  );

  if (!wallet) return null;

  return (
    <div className="balance-card">
      <div className="label">
        Your balance{username ? ` · @${username}` : ''}
        {wallet.gasless && (
          <span className="pill" style={{ marginLeft: 8, background: 'rgba(255,203,69,0.25)', color: 'var(--gold)' }}>
            ⚡ Gasless
          </span>
        )}
      </div>
      <div className="amount">
        {balance !== undefined ? usdt(balance) : '—'} <small>USDt</small>
      </div>
      <div className="addr">{shortAddr(wallet.address)}</div>
      <div className="row">
        <button
          className="btn gold sm"
          disabled={pending}
          onClick={() =>
            run(async () => {
              await wallet.faucet();
              setTimeout(refresh, 2500);
            }, '+1000 test USDt on the way')
          }
        >
          {pending ? '…' : '🪙 Get test USDt'}
        </button>
      </div>
    </div>
  );
}
