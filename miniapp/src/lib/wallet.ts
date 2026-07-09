import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless';
import { Interface, MaxUint256 } from 'ethers';
import MarketAbi from '@mimic/shared/src/deployed/abis/PredictionMarket.json';
import PropAbi from '@mimic/shared/src/deployed/abis/PropMarket.json';
import type { Outcome } from '@mimic/shared';
import type { AppConfig } from './api';

const marketIface = new Interface(MarketAbi as any);
const propIface = new Interface(PropAbi as any);

export interface CreateChallengeParams {
  matchId: string;
  kickoff: number; // unix seconds
  pick: Outcome;
  stake: bigint; // base units
  opponent?: string | null;
}

export interface CreatePropParams {
  question: string;
  matchId: string;
  resolveBy: number; // unix seconds
  backsYes: boolean;
  stake: bigint; // base units
  opponent?: string | null;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Thin wrapper around a self-custodial WDK account. All value movement — the
 * USDt faucet, approvals, placing/accepting bets and claiming — is signed and
 * submitted through WDK. Contract calls ride WDK's sendTransaction({data}).
 */
export class Wallet {
  // Runtime type is WalletAccountEvm (all EVM methods present, verified in the
  // browser spike); WDK's core getAccount() surfaces a narrower interface, so we
  // widen to any here to reach the EVM-specific methods.
  private account: any;
  readonly address: string;
  readonly gasless: boolean;
  private cfg: AppConfig;

  private constructor(account: any, address: string, cfg: AppConfig, gasless: boolean) {
    this.account = account;
    this.address = address;
    this.cfg = cfg;
    this.gasless = gasless;
  }

  static async fromSeed(seed: string, cfg: AppConfig): Promise<Wallet> {
    // Gasless (EIP-7702) mode when the backend provides Pimlico config — the
    // user pays no gas (UserOps sponsored by the paymaster). The account surface
    // is identical to the standard EVM account, so everything below is unchanged.
    if (cfg.gasless) {
      const manager: any = new WalletManagerEvm7702Gasless(seed, {
        provider: cfg.rpcUrl,
        bundlerUrl: cfg.gasless.bundlerUrl,
        delegationAddress: cfg.gasless.delegationAddress,
        isSponsored: true,
        sponsorshipPolicyId: cfg.gasless.sponsorshipPolicyId,
      } as any);
      const account: any = await manager.getAccount(0);
      const address = await account.getAddress();
      return new Wallet(account, address, cfg, true);
    }

    const wdk = new WDK(seed).registerWallet(cfg.wdkChainKey, WalletManagerEvm, {
      provider: cfg.rpcUrl,
      chainId: cfg.chainId,
    });
    const account: any = await wdk.getAccount(cfg.wdkChainKey, 0);
    const address = await account.getAddress();
    return new Wallet(account, address, cfg, false);
  }

  // ─── Balances ────────────────────────────────────────────────────────────
  usdtBalance(): Promise<bigint> {
    return this.account.getTokenBalance(this.cfg.mockUsdt);
  }
  ethBalance(): Promise<bigint> {
    return this.account.getBalance();
  }

  /** Wait for a submitted tx / UserOp to be mined; returns the receipt. */
  private async waitMined(hash: string): Promise<any> {
    for (let i = 0; i < 60; i++) {
      const r = await this.account.getTransactionReceipt(hash).catch(() => null);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 2000));
    }
    throw new Error('Transaction not confirmed in time — please retry');
  }

  /**
   * The real on-chain transaction hash. In gasless mode the wallet returns a
   * UserOperation hash, which BaseScan's /tx/ endpoint cannot resolve; the mined
   * receipt carries the actual bundler transaction hash, so prefer that.
   */
  private onchainHash(receipt: any, fallback: string): string {
    return (
      receipt?.receipt?.transactionHash ?? receipt?.transactionHash ?? receipt?.hash ?? fallback
    );
  }

  private send(data: string) {
    return this.account.sendTransaction({ to: this.cfg.predictionMarket, value: 0, data });
  }

  // ─── Funding ─────────────────────────────────────────────────────────────
  /** Mint test USDt from the MockUSDT faucet. */
  async faucet(): Promise<string> {
    const data = new Interface(['function faucet()']).encodeFunctionData('faucet', []);
    const res = await this.account.sendTransaction({ to: this.cfg.mockUsdt, value: 0, data });
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  /**
   * Ensure the market is approved for `amount`, waiting until the approval is
   * MINED — otherwise a dependent createChallenge/accept would be simulated
   * against a stale (zero) allowance and fail gas estimation.
   */
  private async ensureApproval(
    amount: bigint,
    spender: string = this.cfg.predictionMarket,
  ): Promise<void> {
    const current: bigint = await this.account.getAllowance(this.cfg.mockUsdt, spender);
    if (current >= amount) return;
    const res = await this.account.approve({
      token: this.cfg.mockUsdt,
      spender,
      amount: MaxUint256,
    });
    if (res?.hash) await this.waitMined(res.hash);
  }

  // ─── Betting (contract calls via WDK sendTransaction) ─────────────────────
  async createChallenge(p: CreateChallengeParams): Promise<string> {
    await this.ensureApproval(p.stake);
    const data = marketIface.encodeFunctionData('createChallenge', [
      p.matchId,
      p.kickoff,
      p.pick,
      p.stake,
      p.opponent && p.opponent !== '' ? p.opponent : ZERO,
    ]);
    const res = await this.send(data);
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async acceptChallenge(id: number, pick: Outcome, stake: bigint): Promise<string> {
    await this.ensureApproval(stake);
    const res = await this.send(marketIface.encodeFunctionData('acceptChallenge', [id, pick]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async claim(id: number): Promise<string> {
    const res = await this.send(marketIface.encodeFunctionData('claim', [id]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async cancel(id: number): Promise<string> {
    const res = await this.send(marketIface.encodeFunctionData('cancelChallenge', [id]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  // ─── Props ("bet on anything", YES/NO via PropMarket) ─────────────────────
  private sendProp(data: string) {
    return this.account.sendTransaction({ to: this.cfg.propMarket, value: 0, data });
  }

  async createProp(p: CreatePropParams): Promise<string> {
    await this.ensureApproval(p.stake, this.cfg.propMarket);
    const data = propIface.encodeFunctionData('createProp', [
      p.question,
      p.matchId,
      p.resolveBy,
      p.backsYes,
      p.stake,
      p.opponent && p.opponent !== '' ? p.opponent : ZERO,
    ]);
    const res = await this.sendProp(data);
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async acceptProp(id: number, stake: bigint): Promise<string> {
    await this.ensureApproval(stake, this.cfg.propMarket);
    const res = await this.sendProp(propIface.encodeFunctionData('acceptProp', [id]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async claimProp(id: number): Promise<string> {
    const res = await this.sendProp(propIface.encodeFunctionData('claim', [id]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }

  async cancelProp(id: number): Promise<string> {
    const res = await this.sendProp(propIface.encodeFunctionData('cancelProp', [id]));
    const rc = await this.waitMined(res.hash);
    return this.onchainHash(rc, res.hash);
  }
}
