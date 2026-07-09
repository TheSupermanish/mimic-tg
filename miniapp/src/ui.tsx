import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { haptic } from './lib/telegram';

// ─── Toast ─────────────────────────────────────────────────────────────────
export interface ToastLink {
  href: string;
  label: string;
}
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err', link?: ToastLink) => void>(
  () => {},
);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; link?: ToastLink } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string, kind: 'ok' | 'err' = 'ok', link?: ToastLink) => {
    haptic(kind === 'ok' ? 'success' : 'error');
    setToast({ msg: m, link });
    clearTimeout(timer.current);
    // linger longer when there's a link to tap (e.g. a BaseScan tx receipt)
    timer.current = setTimeout(() => setToast(null), link ? 7500 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast">
          {toast.msg}
          {toast.link && (
            <a className="toast-link" href={toast.link.href} target="_blank" rel="noreferrer">
              {toast.link.label}
            </a>
          )}
        </div>
      )}
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
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setPending(true);
      try {
        const result = await fn();
        if (okMsg) toast(okMsg, 'ok');
        return result;
      } catch (e) {
        toast((e as Error).message || 'Something went wrong', 'err');
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { pending, run };
}
