import { JsonRpcProvider, Contract, Wallet, Interface } from 'ethers';
import { config } from './config.js';
import PredictionMarketAbi from '@mimic/shared/src/deployed/abis/PredictionMarket.json' with { type: 'json' };
import PropMarketAbi from '@mimic/shared/src/deployed/abis/PropMarket.json' with { type: 'json' };

// staticNetwork: the chain never changes, so don't let ethers re-fetch
// eth_chainId on every call (that spam was tripping the public RPC's rate limit).
export const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, {
  staticNetwork: true,
});

export const marketInterface = new Interface(PredictionMarketAbi as any);

/** Read-only market contract (indexing, views). */
export function marketReader(): Contract {
  if (!config.predictionMarketAddress) throw new Error('PREDICTION_MARKET_ADDRESS not set');
  return new Contract(config.predictionMarketAddress, PredictionMarketAbi as any, provider);
}

/** Resolver-signing market contract (settlement). Null if no resolver key. */
export function marketResolver(): Contract | null {
  if (!config.resolverPrivateKey || !config.predictionMarketAddress) return null;
  const wallet = new Wallet(config.resolverPrivateKey, provider);
  return new Contract(config.predictionMarketAddress, PredictionMarketAbi as any, wallet);
}

/** Read-only PropMarket contract (indexing, views). */
export function propReader(): Contract | null {
  if (!config.propMarketAddress) return null;
  return new Contract(config.propMarketAddress, PropMarketAbi as any, provider);
}

/** Resolver-signing PropMarket contract (settles YES/NO/VOID). */
export function propResolver(): Contract | null {
  if (!config.resolverPrivateKey || !config.propMarketAddress) return null;
  const wallet = new Wallet(config.resolverPrivateKey, provider);
  return new Contract(config.propMarketAddress, PropMarketAbi as any, wallet);
}

/**
 * Drips a little test ETH so a fresh WDK wallet can pay gas. Demo-only; uses the
 * resolver key as the funding source. Returns null if not configured.
 */
export async function fundGas(to: string, minWei = 500_000_000_000_000n): Promise<string | null> {
  if (!config.resolverPrivateKey) return null;
  const balance = await provider.getBalance(to);
  if (balance >= minWei) return null; // already funded
  const wallet = new Wallet(config.resolverPrivateKey, provider);
  const tx = await wallet.sendTransaction({ to, value: minWei });
  await tx.wait();
  return tx.hash;
}
