import { useEffect, useState } from 'react';
import { Challenge, Match, Outcome } from '@mimic/shared';
import { useApp } from './state';
import { Onboarding } from './components/Onboarding';
import { Unlock } from './components/Unlock';
import { WalletHeader } from './components/WalletHeader';
import { Matches } from './components/Matches';
import { Markets } from './components/Markets';
import { MyBets } from './components/MyBets';
import { ChallengeCard } from './components/ChallengeCard';
import { CreateChallenge } from './components/CreateChallenge';
import { startParam } from './lib/telegram';
import { api } from './lib/api';

type Tab = 'fixtures' | 'board' | 'bets';

export default function App() {
  const { status, error } = useApp();

  if (status === 'loading')
    return (
      <div className="app">
        <div className="spinner" />
      </div>
    );
  if (status === 'error')
    return (
      <div className="app">
        <div className="empty">
          Couldn't reach the backend.
          <br />
          <span className="hint">{error}</span>
        </div>
      </div>
    );
  if (status === 'onboarding')
    return (
      <div className="app">
        <Onboarding />
      </div>
    );
  if (status === 'locked')
    return (
      <div className="app">
        <Unlock />
      </div>
    );

  return <Main />;
}

function Main() {
  const [tab, setTab] = useState<Tab>('board');
  const [focused, setFocused] = useState<Challenge | null>(null);
  const [betMatch, setBetMatch] = useState<Match | null>(null);
  const [betPick, setBetPick] = useState<Outcome | null>(null);

  // handle deep links: accept_<challengeId>, bet_<matchId>, bet_<matchId>_<pick>
  useEffect(() => {
    const sp = startParam();
    if (!sp) return;
    if (sp.action === 'accept' && sp.id != null) {
      setTab('board');
      api.market(sp.id).then(setFocused).catch(() => {});
    } else if ((sp.action === 'bet' || sp.action === 'create') && sp.arg) {
      const pickMap: Record<string, Outcome> = {
        home: Outcome.Home,
        draw: Outcome.Draw,
        away: Outcome.Away,
      };
      if (sp.pick && pickMap[sp.pick]) setBetPick(pickMap[sp.pick]);
      api.match(sp.arg).then(setBetMatch).catch(() => {});
    }
  }, []);

  // a bet deep-link opens the create-challenge screen full-width
  if (betMatch) {
    return (
      <div className="app">
        <WalletHeader />
        <CreateChallenge match={betMatch} initialPick={betPick} onDone={() => setBetMatch(null)} />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">⚽</span>Mimic
        </div>
      </div>
      <WalletHeader />

      {focused && (
        <>
          <div className="section-title">You were challenged 🎯</div>
          <ChallengeCard c={focused} onChanged={() => setFocused(null)} />
        </>
      )}

      {tab === 'fixtures' && <Matches />}
      {tab === 'board' && <Markets />}
      {tab === 'bets' && <MyBets />}

      <nav className="tabbar">
        <button className={tab === 'fixtures' ? 'active' : ''} onClick={() => setTab('fixtures')}>
          <span className="ico">📅</span>Fixtures
        </button>
        <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>
          <span className="ico">🎯</span>Board
        </button>
        <button className={tab === 'bets' ? 'active' : ''} onClick={() => setTab('bets')}>
          <span className="ico">🎟️</span>My Bets
        </button>
      </nav>
    </div>
  );
}
