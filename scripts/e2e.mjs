// End-to-end test: two real WDK wallets vs the deployed contracts on Base Sepolia.
// The match RESULT is mocked (resolver call directly) so this never hits the
// football-data.org API / its 10-req/min limit. Run: `node scripts/e2e.mjs`.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet as EthersWallet, NonceManager, Interface, Contract } from 'ethers';
import 'dotenv/config';
import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless';

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

  // Deployer & resolver may be the same key; when so, share ONE NonceManager so
  // funding drips and the resolve tx never collide on nonce (flaky public RPC).
  const deployerW = new EthersWallet(norm(process.env.DEPLOYER_PRIVATE_KEY), provider);
  const resolverW = new EthersWallet(norm(process.env.RESOLVER_PRIVATE_KEY), provider);
  const funder = new NonceManager(deployerW);
  const resolver =
    deployerW.address.toLowerCase() === resolverW.address.toLowerCase()
      ? funder
      : new NonceManager(resolverW);

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
  const escrowBefore = await tokenBal(MARKET);
  const claimData = marketIface.encodeFunctionData('claim', [challengeId]);
  await mined(await bob.account.sendTransaction({ to: MARKET, value: 0, data: claimData }), 'claim');

  log('\n9. Verifying balances…');
  const aEnd = await alice.account.getTokenBalance(USDT);
  const bEnd = await bob.account.getTokenBalance(USDT);
  log(`  alice: ${aStart} -> ${aEnd}  (Δ ${aEnd - aStart})`);
  log(`  bob:   ${bStart} -> ${bEnd}  (Δ ${bEnd - bStart})`);
  assert(aEnd - aStart === STAKE, `winner (alice) net +${STAKE} USDt`);
  assert(bStart - bEnd === STAKE, `loser (bob) net -${STAKE} USDt`);
  // escrow dropped by exactly this pot (other challenges may still be escrowed)
  assert(escrowBefore - (await tokenBal(MARKET)) === STAKE * 2n, 'escrow released this pot');

  await gaslessProof();

  log(`\n=== ${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Gasless (EIP-7702) proof — runs only if PIMLICO_API_KEY is set. Creates a
 * wallet with ZERO ETH, faucets USDt and settles a bet entirely via sponsored
 * UserOperations, proving the user never needs a gas token.
 */
async function gaslessProof() {
  if (!process.env.PIMLICO_API_KEY) {
    log('\n[gasless] PIMLICO_API_KEY not set — skipping gasless proof (set it to verify no-gas UX).');
    return;
  }
  log('\n=== GASLESS (EIP-7702, sponsored) proof — full head-to-head, zero ETH ===');
  const bundlerUrl = `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const delegationAddress = process.env.DELEGATION_ADDRESS || '0xe6Cae83BdE06E4c305530e199D7217f42808555B';
  const STAKE = 10_000000n;

  const mkGasless = async (label) => {
    const seed = WDK.getRandomSeedPhrase(12);
    const manager = new WalletManagerEvm7702Gasless(seed, {
      provider: RPC, bundlerUrl, delegationAddress, isSponsored: true,
    });
    const account = await manager.getAccount(0);
    const address = await account.getAddress();
    log(`  ${label}: ${address}`);
    return { account, address };
  };
  // wait for a sponsored UserOp to land
  const minedOp = async (account, res) => {
    for (let i = 0; i < 45; i++) {
      const r = await account.getTransactionReceipt(res.hash).catch(() => null);
      if (r) return r;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('UserOp not mined in time');
  };
  const faucetData = usdtIface.encodeFunctionData('faucet', []);

  const g1 = await mkGasless('gasless-A');
  const g2 = await mkGasless('gasless-B');
  assert((await provider.getBalance(g1.address)) === 0n && (await provider.getBalance(g2.address)) === 0n,
    'both wallets start with ZERO ETH');

  // fund USDt gaslessly
  await minedOp(g1.account, await g1.account.sendTransaction({ to: USDT, value: 0, data: faucetData }));
  await minedOp(g2.account, await g2.account.sendTransaction({ to: USDT, value: 0, data: faucetData }));
  const a0 = await g1.account.getTokenBalance(USDT);
  assert(a0 >= 1000_000000n, `gasless-A funded USDt (${a0})`);

  // A approves + creates a challenge (both sponsored)
  await minedOp(g1.account, await g1.account.approve({ token: USDT, spender: MARKET, amount: STAKE }));
  const matchId = `e2e-gasless-${Date.now()}`;
  const kickoff = Math.floor(Date.now() / 1000) + 3600;
  const createData = marketIface.encodeFunctionData('createChallenge', [matchId, kickoff, HOME, STAKE, '0x0000000000000000000000000000000000000000']);
  const createRcpt = await minedOp(g1.account, await g1.account.sendTransaction({ to: MARKET, value: 0, data: createData }));
  let cid;
  for (const lg of createRcpt.logs) { try { const p = marketIface.parseLog(lg); if (p?.name === 'ChallengeCreated') cid = Number(p.args.id); } catch {} }
  assert(cid !== undefined, `gasless challenge created (id=${cid})`);

  // B approves + accepts (both sponsored)
  await minedOp(g2.account, await g2.account.approve({ token: USDT, spender: MARKET, amount: STAKE }));
  const acceptData = marketIface.encodeFunctionData('acceptChallenge', [cid, AWAY]);
  await minedOp(g2.account, await g2.account.sendTransaction({ to: MARKET, value: 0, data: acceptData }));

  // operator resolves (mock) → HOME, then anyone claims (gasless by B)
  // NonceManager + idempotent verify to ride out flaky public-RPC nonce issues
  const resolver = new NonceManager(new EthersWallet(norm(process.env.RESOLVER_PRIVATE_KEY), provider));
  const rc = new Contract(MARKET, marketAbi, resolver);
  const rcRead = new Contract(MARKET, marketAbi, provider);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Number(await rcRead.matchResult(matchId)) === HOME) break;
    try {
      await (await rc.resolve(matchId, HOME)).wait();
    } catch (e) {
      /* tolerate 'already known'/nonce — verify state below */
    }
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      ok = Number(await rcRead.matchResult(matchId)) === HOME;
      if (!ok) await new Promise((r) => setTimeout(r, 1500));
    }
    if (ok) break;
  }
  const claimData = marketIface.encodeFunctionData('claim', [cid]);
  await minedOp(g2.account, await g2.account.sendTransaction({ to: MARKET, value: 0, data: claimData }));

  const a1 = await g1.account.getTokenBalance(USDT);
  assert(a1 - a0 === STAKE, `winner (gasless-A) net +${STAKE} USDt`);
  assert((await provider.getBalance(g1.address)) === 0n && (await provider.getBalance(g2.address)) === 0n,
    'both wallets STILL hold zero ETH — entire bet was gasless ✨');
}

main().catch((e) => {
  console.error('\nE2E ERROR:', e);
  process.exit(1);
});
