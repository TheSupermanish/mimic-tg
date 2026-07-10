import { Challenge } from '@mimic/shared';
import { api, Prop } from '../lib/api';
import { usePolling } from '../ui';
import { useApp } from '../state';
import { ChallengeCard } from './ChallengeCard';
import { PropCard } from './PropCard';
import { isChallengeExpired } from '../lib/format';

/** The P2P board — open challenges + props anyone can take the other side of. */
export function Markets() {
  const { wallet } = useApp();
  const { data: challenges, loading, refresh } = usePolling<Challenge[]>(
    () => api.markets('?status=open'),
    8000,
  );
  const { data: props, refresh: refreshProps } = usePolling<Prop[]>(() => api.props('?status=open'), 8000);
  const me = wallet?.address.toLowerCase();

  // takeable open items: not expired, directed-to-me or open-to-anyone.
  const list = (challenges ?? []).filter((c) => {
    if (isChallengeExpired(c)) return false;
    if (!c.opponent) return true;
    return c.opponent.toLowerCase() === me;
  });
  const propList = (props ?? []).filter((p) => {
    if (p.status !== 0 || p.resolveBy * 1000 <= Date.now()) return false;
    if (!p.opponent) return true;
    return p.opponent.toLowerCase() === me;
  });

  return (
    <div>
      <div className="section-title">Open challenges</div>
      {loading && !challenges && <div className="spinner" />}
      {!loading && list.length === 0 && propList.length === 0 && (
        <div className="empty">
          No open bets yet.
          <br />
          <span className="hint">Head to Fixtures and post the first one 🎯</span>
        </div>
      )}
      {list.map((c) => (
        <ChallengeCard key={c.id} c={c} onChanged={refresh} />
      ))}

      {propList.length > 0 && <div className="section-title">🎲 Side bets (AI-settled)</div>}
      {propList.map((p) => (
        <PropCard key={p.id} p={p} onChanged={refreshProps} />
      ))}
    </div>
  );
}
