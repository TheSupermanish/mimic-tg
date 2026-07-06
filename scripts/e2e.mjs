// End-to-end test: two real WDK wallets vs the deployed contracts on Base Sepolia.
// The match RESULT is mocked (resolver call directly) so this never hits the
// football-data.org API / its 10-req/min limit. Run: `node scripts/e2e.mjs`.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet as EthersWallet, Interface, Contract } from 'ethers';
import 'dotenv/config';
import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = (p) => resolve(__dirname, p);
const addresses = JSON.parse(readFileSync(R('../shared/src/deployed/addresses.json'), 'utf8'));
const marketAbi = JSON.parse(readFileSync(R('../shared/src/deployed/abis/PredictionMarket.json'), 'utf8'));
const usdtAbi = JSON.parse(readFileSync(R('../shared/src/deployed/abis/MockUSDT.json'), 'utf8'));

const RPC = process.env.BASE_SEPOLIA_RPC;
const CHAIN_ID = Number(process.env.CHAIN_ID || 84532);
const norm = (k) => (k.startsWith('0x') ? k : '0x' + k);
const MARKET = addresses.predictionMarket;
const USDT = addresses.mockUsdt;

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const marketIface = new Interface(marketAbi);
const usdtIface = new Interface(usdtAbi);

// enum Outcome { Pending, Home, Draw, Away }
const HOME = 1, AWAY = 3;

const log = (...a) => console.log(...a);
let failures = 0;
function assert(cond, msg) {
  log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${msg}`);
  if (!cond) failures++;
}

/** Build a WDK account from a fresh seed. */
async function makeWallet(label) {
  const seed = WDK.getRandomSeedPhrase(12);
  const wdk = new WDK(seed).registerWallet('base', WalletManagerEvm, { provider: RPC, chainId: CHAIN_ID });
  const account = await wdk.getAccount('base', 0);
  const address = await account.getAddress();
  log(`  ${label}: ${address}`);
  return { account, address, seed };
}

/** Wait for a WDK-submitted tx to be mined. */
async function mined(res, what) {
  const hash = res.hash;
  const receipt = await provider.waitForTransaction(hash, 1, 120000);
  if (!receipt || receipt.status !== 1) throw new Error(`${what} tx failed: ${hash}`);
  return receipt;
}

async function tokenBal(addr) {
  return new Contract(USDT, usdtAbi, provider).balanceOf(addr);
}

async function main() {
  log('\n=== MimicTG E2E (Base Sepolia) ===');
  log(`market=${MARKET}\nusdt=${USDT}\n`);

  const funder = new EthersWallet(norm(process.env.DEPLOYER_PRIVATE_KEY), provider);
  const resolver = new EthersWallet(norm(process.env.RESOLVER_PRIVATE_KEY), provider);

  log('1. Creating two WDK wallets…');
  const alice = await makeWallet('alice ');
  const bob = await makeWallet('bob   ');

  log('\n2. Dripping gas ETH to both…');
  for (const w of [alice, bob]) {
    const bal = await provider.getBalance(w.address);
    if (bal < 1_000_000_000_000_000n) {
      const tx = await funder.sendTransaction({ to: w.address, value: 2_000_000_000_000_000n });
      await tx.wait();
    }
  }
  const pollBal = async (addr) => {
    for (let i = 0; i < 10; i++) {
      if ((await provider.getBalance(addr)) > 0n) return true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  };
  assert(await pollBal(alice.address), 'alice has gas');
  assert(await pollBal(bob.address), 'bob has gas');

  log('\n3. Faucet 1000 test USDt to both (via WDK sendTransaction)…');
  const faucetData = usdtIface.encodeFunctionData('faucet', []);
  await mined(await alice.account.sendTransaction({ to: USDT, value: 0, data: faucetData }), 'alice faucet');
  await mined(await bob.account.sendTransaction({ to: USDT, value: 0, data: faucetData }), 'bob faucet');
  const aStart = await alice.account.getTokenBalance(USDT);
  const bStart = await bob.account.getTokenBalance(USDT);
  assert(aStart >= 1000_000000n, `alice USDt funded (${aStart})`);
  assert(bStart >= 1000_000000n, `bob USDt funded (${bStart})`);

  const STAKE = 10_000000n; // 10 USDt

  log('\n4. Approvals (WDK account.approve)…');
  await mined(await alice.account.approve({ token: USDT, spender: MARKET, amount: STAKE }), 'alice approve');
  await mined(await bob.account.approve({ token: USDT, spender: MARKET, amount: STAKE }), 'bob approve');

  log('\n5. Alice creates a challenge (backs HOME, 10 USDt)…');
  const matchId = `e2e-${Date.now()}`;
  const kickoff = Math.floor(Date.now() / 1000) + 3600;
  const createData = marketIface.encodeFunctionData('createChallenge', [
    matchId, kickoff, HOME, STAKE, '0x0000000000000000000000000000000000000000',
  ]);
  const createRcpt = await mined(
    await alice.account.sendTransaction({ to: MARKET, value: 0, data: createData }), 'createChallenge');
  // parse challenge id from the ChallengeCreated event
  let challengeId;
  for (const lg of createRcpt.logs) {
    try {
      const parsed = marketIface.parseLog(lg);
      if (parsed?.name === 'ChallengeCreated') challengeId = Number(parsed.args.id);
    } catch {}
  }
  assert(challengeId !== undefined, `challenge created (id=${challengeId})`);

  log('\n6. Bob accepts (backs AWAY)…');
  const acceptData = marketIface.encodeFunctionData('acceptChallenge', [challengeId, AWAY]);
  await mined(await bob.account.sendTransaction({ to: MARKET, value: 0, data: acceptData }), 'acceptChallenge');
  const escrow = await tokenBal(MARKET);
  assert(escrow >= STAKE * 2n, `escrow holds the pot (${escrow} >= ${STAKE * 2n})`);

  log('\n7. [MOCK] Resolver settles the match → HOME (alice wins)…');
  const rMarket = new Contract(MARKET, marketAbi, resolver);
  const rtx = await rMarket.resolve(matchId, HOME);
  await rtx.wait();
  // public RPCs can lag a block after wait(); poll the view for consistency
  let onchainResult = 0;
  for (let i = 0; i < 10 && onchainResult !== HOME; i++) {
    onchainResult = Number(await rMarket.matchResult(matchId));
    if (onchainResult !== HOME) await new Promise((r) => setTimeout(r, 1500));
  }
  assert(onchainResult === HOME, 'match resolved to HOME on-chain');

  log('\n8. Claim (permissionless) → pays the winner…');
  const claimData = marketIface.encodeFunctionData('claim', [challengeId]);
  await mined(await bob.account.sendTransaction({ to: MARKET, value: 0, data: claimData }), 'claim');

  log('\n9. Verifying balances…');
  const aEnd = await alice.account.getTokenBalance(USDT);
  const bEnd = await bob.account.getTokenBalance(USDT);
  log(`  alice: ${aStart} -> ${aEnd}  (Δ ${aEnd - aStart})`);
  log(`  bob:   ${bStart} -> ${bEnd}  (Δ ${bEnd - bStart})`);
  assert(aEnd - aStart === STAKE, `winner (alice) net +${STAKE} USDt`);
  assert(bStart - bEnd === STAKE, `loser (bob) net -${STAKE} USDt`);
  assert((await tokenBal(MARKET)) < STAKE * 2n, 'escrow released');

  log(`\n=== ${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nE2E ERROR:', e);
  process.exit(1);
});
