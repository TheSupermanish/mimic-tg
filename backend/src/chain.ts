import { JsonRpcProvider, Contract, Wallet, Interface } from 'ethers';
import { config } from './config.js';
import PredictionMarketAbi from '@mimic/shared/src/deployed/abis/PredictionMarket.json' with { type: 'json' };

export const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);

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
