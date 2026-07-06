import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import WDK from '@tetherto/wdk';
import { Wallet } from './lib/wallet';
import { api, type AppConfig } from './lib/api';
import { encryptSeed, decryptSeed, saveVault, loadVault, hasVault, clearVault } from './lib/vault';
import { initTelegram, initDataRaw, currentUser } from './lib/telegram';

type Status = 'loading' | 'onboarding' | 'locked' | 'ready' | 'error';

interface Ctx {
  status: Status;
  error?: string;
  config?: AppConfig;
  wallet?: Wallet;
  username?: string;
  createWallet: (pin: string) => Promise<string>; // returns seed for backup
  finalizeNewWallet: () => Promise<void>;
  importWallet: (seed: string, pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
  newSeedPreview: () => string;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>();
  const [config, setConfig] = useState<AppConfig>();
  const [wallet, setWallet] = useState<Wallet>();
  const [username, setUsername] = useState<string>();
  // holds a freshly-generated seed + pin between "create" and "confirm backup"
  const [pending, setPending] = useState<{ seed: string; pin: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        initTelegram();
        setUsername(currentUser()?.username);
        const cfg = await api.config();
        setConfig(cfg);
        setStatus((await hasVault()) ? 'locked' : 'onboarding');
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    })();
  }, []);

  /** Link the wallet to the Telegram identity + drip gas. Best-effort. */
  const bootstrapWallet = useCallback(async (w: Wallet) => {
    const raw = initDataRaw();
    if (raw) await api.auth(raw, w.address).catch(() => {});
    await api.faucetGas(w.address).catch(() => {});
  }, []);

  const newSeedPreview = useCallback(() => WDK.getRandomSeedPhrase(12), []);

  // step 1: generate + stash a new seed, remember the PIN
  const createWallet = useCallback(async (pin: string) => {
    const seed = WDK.getRandomSeedPhrase(12);
    setPending({ seed, pin });
    return seed;
  }, []);

  // step 2: user confirmed they backed up the seed → persist + activate
  const finalizeNewWallet = useCallback(async () => {
    if (!pending || !config) throw new Error('nothing to finalize');
    const blob = await encryptSeed(pending.seed, pending.pin);
    await saveVault(blob);
    const w = await Wallet.fromSeed(pending.seed, config);
    setWallet(w);
    setPending(null);
    setStatus('ready');
    await bootstrapWallet(w);
  }, [pending, config, bootstrapWallet]);

  const importWallet = useCallback(
    async (seed: string, pin: string) => {
      if (!config) throw new Error('no config');
      const clean = seed.trim().replace(/\s+/g, ' ');
      if (!WDK.isValidSeed(clean)) throw new Error('Invalid recovery phrase');
      const blob = await encryptSeed(clean, pin);
      await saveVault(blob);
      const w = await Wallet.fromSeed(clean, config);
      setWallet(w);
      setStatus('ready');
      await bootstrapWallet(w);
    },
    [config, bootstrapWallet],
  );

  const unlock = useCallback(
    async (pin: string) => {
      if (!config) throw new Error('no config');
      const blob = await loadVault();
      if (!blob) throw new Error('No wallet found');
      let seed: string;
      try {
        seed = await decryptSeed(blob, pin);
      } catch {
        throw new Error('Wrong PIN');
      }
      const w = await Wallet.fromSeed(seed, config);
      setWallet(w);
      setStatus('ready');
      await bootstrapWallet(w);
    },
    [config, bootstrapWallet],
  );

  const logout = useCallback(async () => {
    await clearVault();
    setWallet(undefined);
    setStatus('onboarding');
  }, []);

  return (
    <AppCtx.Provider
      value={{
        status,
        error,
        config,
        wallet,
        username,
        createWallet,
        finalizeNewWallet,
        importWallet,
        unlock,
        logout,
        newSeedPreview,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}
