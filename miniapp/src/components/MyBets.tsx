import { Challenge, ChallengeStatus } from '@mimic/shared';
import { api } from '../lib/api';
import { usePolling } from '../ui';
import { useApp } from '../state';
import { ChallengeCard } from './ChallengeCard';

export function MyBets() {
  const { wallet } = useApp();
  const { data: challenges, loading, refresh } = usePolling<Challenge[]>(
    () => api.markets(`?address=${wallet!.address}`),
    8000,
    [wallet?.address],
  );

  const list = challenges ?? [];
  const active = list.filter(
    (c) => c.status === ChallengeStatus.Open || c.status === ChallengeStatus.Matched,
  );
  const done = list.filter(
    (c) => c.status === ChallengeStatus.Settled || c.status === ChallengeStatus.Cancelled,
  );

  return (
    <div>
      {loading && !challenges && <div className="spinner" />}
      {!loading && list.length === 0 && (
        <div className="empty">
          <div style={{ fontSize: 44, marginBottom: 8 }}>🎟️</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--tg-text)' }}>No bets yet</div>
          <div className="hint" style={{ marginTop: 4 }}>
            Head to the <b>Board</b> to take a challenge, or <b>Fixtures</b> to post your own.
          </div>
        </div>
      )}
      {active.length > 0 && <div className="section-title">Active</div>}
      {active.map((c) => (
        <ChallengeCard key={c.id} c={c} onChanged={refresh} />
      ))}
      {done.length > 0 && <div className="section-title">History</div>}
      {done.map((c) => (
        <ChallengeCard key={c.id} c={c} onChanged={refresh} />
      ))}
    </div>
  );
}
