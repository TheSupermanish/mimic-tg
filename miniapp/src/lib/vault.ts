/**
 * Encrypted seed vault. The BIP-39 seed phrase is encrypted with AES-GCM using a
 * key derived from the user's PIN (PBKDF2). Only ciphertext is ever persisted —
 * to Telegram CloudStorage (syncs across the user's devices) with a localStorage
 * fallback. The plaintext seed never leaves the device and is only held in memory
 * after the user unlocks with their PIN.
 */

const STORAGE_KEY = 'mimic_vault_v1';
const PBKDF2_ITERS = 150_000;

interface VaultBlob {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 ciphertext
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSeed(seed: string, pin: string): Promise<VaultBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(seed) as BufferSource,
  );
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decryptSeed(blob: VaultBlob, pin: string): Promise<string> {
  const key = await deriveKey(pin, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource },
    key,
    unb64(blob.ct) as BufferSource,
  );
  return dec.decode(pt);
}

// ─── Persistence (Telegram CloudStorage → localStorage fallback) ───────────

function cloud(): any | null {
  const wa = (window as any).Telegram?.WebApp;
  const cs = wa?.CloudStorage;
  if (!cs || typeof cs.setItem !== 'function') return null;
  // CloudStorage needs Bot API 6.9+; older clients throw WebAppMethodUnsupported.
  if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('6.9')) return null;
  return cs;
}

export async function saveVault(blob: VaultBlob): Promise<void> {
  const json = JSON.stringify(blob);
  const cs = cloud();
  if (cs) {
    // best-effort: any CloudStorage failure (unsupported version, etc.) falls
    // back to localStorage below — never blocks wallet creation.
    try {
      await new Promise<void>((res, rej) => {
        try {
          cs.setItem(STORAGE_KEY, json, (err: unknown) => (err ? rej(err) : res()));
        } catch (e) {
          rej(e);
        }
      });
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* private mode */
  }
}

export async function loadVault(): Promise<VaultBlob | null> {
  const cs = cloud();
  if (cs) {
    const val = await new Promise<string>((res, rej) => {
      try {
        cs.getItem(STORAGE_KEY, (err: unknown, v: string) => (err ? rej(err) : res(v)));
      } catch (e) {
        rej(e);
      }
    }).catch(() => '');
    if (val) return JSON.parse(val);
  }
  const local = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  return local ? JSON.parse(local) : null;
}

export async function hasVault(): Promise<boolean> {
  return (await loadVault()) !== null;
}

export async function clearVault(): Promise<void> {
  const cs = cloud();
  if (cs) {
    await new Promise<void>((res) => cs.removeItem(STORAGE_KEY, () => res())).catch(() => {});
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
