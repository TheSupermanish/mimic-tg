import { useApp } from '../state';
import { usePolling, useAction, useToast } from '../ui';
import { shortAddr, usdt, txLink } from '../lib/format';

export function WalletHeader() {
  const { wallet, username, config } = useApp();
  const { pending, run } = useAction();
  const toast = useToast();
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
        {wallet.gasless && <span className="gasless-badge">⚡ GASLESS</span>}
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
              const hash = await wallet.faucet();
              setTimeout(refresh, 2500);
              return hash;
            }).then((hash) => hash && toast('+1000 test USDt on the way', 'ok', txLink(config?.explorer, hash)))
          }
        >
          {pending ? '…' : '🪙 Get test USDt'}
        </button>
      </div>
    </div>
  );
}
