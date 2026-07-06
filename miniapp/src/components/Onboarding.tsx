import { useState } from 'react';
import { useApp } from '../state';
import { useAction } from '../ui';

type Step = 'welcome' | 'pin' | 'backup' | 'import';

export function Onboarding() {
  const { createWallet, finalizeNewWallet, importWallet } = useApp();
  const { pending, run } = useAction();
  const [step, setStep] = useState<Step>('welcome');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [seed, setSeed] = useState('');
  const [importSeed, setImportSeed] = useState('');
  const [err, setErr] = useState('');

  if (step === 'welcome') {
    return (
      <div className="center">
        <div className="hero">
          <div className="logo">⚽️</div>
          <h1>
            Mimic<span style={{ color: 'var(--pitch)' }}>TG</span>
          </h1>
          <p>Bet your mates on football. Your keys, your USDt.</p>
        </div>
        <button className="btn pitch block" onClick={() => setStep('pin')}>
          Create a wallet
        </button>
        <button className="btn ghost block" onClick={() => setStep('import')}>
          I have a recovery phrase
        </button>
        <p className="hint" style={{ textAlign: 'center' }}>
          Self-custodial, powered by Tether WDK. We never see your keys.
        </p>
      </div>
    );
  }

  if (step === 'pin') {
    const ok = pin.length >= 4 && pin === pin2;
    return (
      <div className="center">
        <div className="hero">
          <h1>Set a PIN</h1>
          <p>Encrypts your wallet on this device.</p>
        </div>
        <div className="field">
          <label>PIN (min 4 digits)</label>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Confirm PIN</label>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            value={pin2}
            onChange={(e) => setPin2(e.target.value)}
          />
        </div>
        {pin2 && pin !== pin2 && <div className="error">PINs don't match</div>}
        <button
          className="btn pitch block"
          disabled={!ok || pending}
          onClick={() => run(async () => setSeed(await createWallet(pin)), undefined).then(() => setStep('backup'))}
        >
          Continue
        </button>
      </div>
    );
  }

  if (step === 'backup') {
    return (
      <div className="center">
        <div className="hero">
          <h1>Back up your phrase</h1>
          <p>Write these 12 words down. They're the only way to recover your funds.</p>
        </div>
        <div className="seed-box">{seed}</div>
        <button
          className="btn pitch block"
          disabled={pending}
          onClick={() => run(finalizeNewWallet, 'Wallet ready — grab some test USDt!')}
        >
          {pending ? 'Setting up…' : "I've saved it — continue"}
        </button>
      </div>
    );
  }

  // import
  return (
    <div className="center">
      <div className="hero">
        <h1>Recover wallet</h1>
        <p>Enter your 12 or 24-word phrase.</p>
      </div>
      <div className="field">
        <label>Recovery phrase</label>
        <textarea rows={3} value={importSeed} onChange={(e) => setImportSeed(e.target.value)} />
      </div>
      <div className="field">
        <label>New PIN (min 4 digits)</label>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      {err && <div className="error">{err}</div>}
      <button
        className="btn pitch block"
        disabled={pending || pin.length < 4 || importSeed.trim().length < 10}
        onClick={() => {
          setErr('');
          run(() => importWallet(importSeed, pin)).catch((e) => setErr((e as Error).message));
        }}
      >
        {pending ? 'Recovering…' : 'Recover'}
      </button>
      <button className="btn ghost block" onClick={() => setStep('welcome')}>
        Back
      </button>
    </div>
  );
}
