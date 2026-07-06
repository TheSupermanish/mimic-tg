/** Chain + token configuration. Base Sepolia testnet. */

export const CHAIN = {
  name: 'base-sepolia',
  chainId: 84532,
  rpcUrl: 'https://sepolia.base.org',
  explorer: 'https://sepolia.basescan.org',
  /** WDK registers wallets under a chain key; we use this string. */
  wdkChainKey: 'base',
} as const;

/** USDt uses 6 decimals (matches Tether on all chains). Our MockUSDT mirrors this. */
export const USDT_DECIMALS = 6;
