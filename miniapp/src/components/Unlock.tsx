import { useState } from 'react';
import { useApp } from '../state';
import { useAction } from '../ui';

export function Unlock() {
  const { unlock, logout } = useApp();
  const { pending, run } = useAction();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    setErr('');
    run(() => unlock(pin)).catch((e) => setErr((e as Error).message));
  };

  return (
    <div className="center">
      <div className="hero">
        <div className="logo">🔒</div>
        <h1>Welcome back</h1>
        <p>Enter your PIN to unlock.</p>
      </div>
      <div className="field">
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {err && <div className="error">{err}</div>}
      <button className="btn pitch block" disabled={pending || pin.length < 4} onClick={submit}>
        {pending ? 'Unlocking…' : 'Unlock'}
      </button>
      <button
        className="btn ghost block"
        onClick={() => {
          if (confirm('Reset this wallet? You can only recover it with your phrase.')) logout();
        }}
      >
        Reset wallet
      </button>
    </div>
  );
}
