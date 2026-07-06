import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { haptic } from './lib/telegram';

// ─── Toast ─────────────────────────────────────────────────────────────────
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    haptic(kind === 'ok' ? 'success' : 'error');
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

// ─── Polling hook ────────────────────────────────────────────────────────
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 8000, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current());
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, refresh };
}

/** Wraps an async action with pending state + toast on error. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const run = useCallback(
    async (fn: () => Promise<void>, okMsg?: string) => {
      setPending(true);
      try {
        await fn();
        if (okMsg) toast(okMsg, 'ok');
      } catch (e) {
        toast((e as Error).message || 'Something went wrong', 'err');
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { pending, run };
}
