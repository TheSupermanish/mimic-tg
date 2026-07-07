import { Challenge } from '@mimic/shared';
import { api } from '../lib/api';
import { usePolling } from '../ui';
import { useApp } from '../state';
import { ChallengeCard } from './ChallengeCard';
import { isChallengeExpired } from '../lib/format';

/** The P2P board — open challenges anyone can take the other side of. */
export function Markets() {
  const { wallet } = useApp();
  const { data: challenges, loading, refresh } = usePolling<Challenge[]>(
    () => api.markets('?status=open'),
    8000,
  );
  const me = wallet?.address.toLowerCase();

  // show takeable open challenges: not expired (kickoff still ahead),
  // directed-to-me or open-to-anyone.
  const list = (challenges ?? []).filter((c) => {
    if (isChallengeExpired(c)) return false;
    if (!c.opponent) return true;
    return c.opponent.toLowerCase() === me;
  });

  return (
    <div>
      <div className="section-title">Open challenges</div>
      {loading && !challenges && <div className="spinner" />}
      {!loading && list.length === 0 && (
        <div className="empty">
          No open challenges yet.
          <br />
          <span className="hint">Head to Fixtures and post the first one 🎯</span>
        </div>
      )}
      {list.map((c) => (
        <ChallengeCard key={c.id} c={c} onChanged={refresh} />
      ))}
    </div>
  );
}
