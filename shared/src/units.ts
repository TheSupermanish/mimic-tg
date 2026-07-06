import { USDT_DECIMALS } from './chain.js';

const FACTOR = 10n ** BigInt(USDT_DECIMALS);

/**
 * Convert a human USDt amount (e.g. "5", "2.5") to base units (bigint).
 * 5 USDt -> 5_000000n
 */
export function toBaseUnits(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USDt amount: ${amount}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > USDT_DECIMALS)
    throw new Error(`too many decimals (max ${USDT_DECIMALS}): ${amount}`);
  const padded = (frac + '0'.repeat(USDT_DECIMALS)).slice(0, USDT_DECIMALS);
  return BigInt(whole) * FACTOR + BigInt(padded || '0');
}

/**
 * Format base units (bigint or string) to a human USDt string.
 * 5_000000n -> "5", 2_500000n -> "2.5"
 */
export function fromBaseUnits(base: bigint | string): string {
  const v = typeof base === 'string' ? BigInt(base) : base;
  const whole = v / FACTOR;
  const frac = v % FACTOR;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}
