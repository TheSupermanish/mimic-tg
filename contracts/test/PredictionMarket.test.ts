import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { MockUSDT, PredictionMarket } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// Outcome enum: Pending=0, Home=1, Draw=2, Away=3
const HOME = 1;
const DRAW = 2;
const AWAY = 3;

const MATCH = 'match-42';
const STAKE = 10_000_000n; // 10 USDt (6 decimals)
const ZERO = ethers.ZeroAddress;

describe('PredictionMarket', () => {
  let usdt: MockUSDT;
  let market: PredictionMarket;
  let owner: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let alice: HardhatEthersSigner; // creator
  let bob: HardhatEthersSigner; // taker
  let carol: HardhatEthersSigner;
  let kickoff: number;

  beforeEach(async () => {
    [owner, resolver, alice, bob, carol] = await ethers.getSigners();

    const USDTFactory = await ethers.getContractFactory('MockUSDT');
    usdt = await USDTFactory.deploy();

    const MarketFactory = await ethers.getContractFactory('PredictionMarket');
    market = await MarketFactory.deploy(await usdt.getAddress(), resolver.address);

    // fund + approve players
    for (const p of [alice, bob, carol]) {
      await usdt.mint(p.address, 1000_000000n);
      await usdt.connect(p).approve(await market.getAddress(), ethers.MaxUint256);
    }

    kickoff = (await time.latest()) + 3600;
  });

  async function openChallenge(pick = HOME, opponent = ZERO) {
    await market.connect(alice).createChallenge(MATCH, kickoff, pick, STAKE, opponent);
    return 0; // first id
  }

  describe('createChallenge', () => {
    it('escrows the stake and emits an event', async () => {
      await expect(market.connect(alice).createChallenge(MATCH, kickoff, HOME, STAKE, ZERO))
        .to.emit(market, 'ChallengeCreated')
        .withArgs(0, alice.address, ZERO, MATCH, HOME, STAKE, kickoff);

      expect(await usdt.balanceOf(await market.getAddress())).to.equal(STAKE);
      const c = await market.getChallenge(0);
      expect(c.creator).to.equal(alice.address);
      expect(c.status).to.equal(0); // Open
    });

    it('rejects a Pending pick, zero stake, past kickoff, and self-opponent', async () => {
      await expect(
        market.connect(alice).createChallenge(MATCH, kickoff, 0, STAKE, ZERO),
      ).to.be.revertedWith('bad pick');
      await expect(
        market.connect(alice).createChallenge(MATCH, kickoff, HOME, 0, ZERO),
      ).to.be.revertedWith('stake=0');
      const past = (await time.latest()) - 1;
      await expect(
        market.connect(alice).createChallenge(MATCH, past, HOME, STAKE, ZERO),
      ).to.be.revertedWith('kickoff passed');
      await expect(
        market.connect(alice).createChallenge(MATCH, kickoff, HOME, STAKE, alice.address),
      ).to.be.revertedWith('self opponent');
    });
  });

  describe('acceptChallenge', () => {
    it('locks the taker stake with an opposing pick', async () => {
      await openChallenge(HOME);
      await expect(market.connect(bob).acceptChallenge(0, AWAY))
        .to.emit(market, 'ChallengeAccepted')
        .withArgs(0, bob.address, AWAY);

      expect(await usdt.balanceOf(await market.getAddress())).to.equal(STAKE * 2n);
      const c = await market.getChallenge(0);
      expect(c.taker).to.equal(bob.address);
      expect(c.status).to.equal(1); // Matched
    });

    it('rejects same pick, self-accept, and post-kickoff', async () => {
      await openChallenge(HOME);
      await expect(market.connect(bob).acceptChallenge(0, HOME)).to.be.revertedWith('same pick');
      await expect(market.connect(alice).acceptChallenge(0, AWAY)).to.be.revertedWith(
        'creator cannot take',
      );
      await time.increaseTo(kickoff + 1);
      await expect(market.connect(bob).acceptChallenge(0, AWAY)).to.be.revertedWith(
        'kickoff passed',
      );
    });

    it('enforces directed opponent', async () => {
      await openChallenge(HOME, bob.address);
      await expect(market.connect(carol).acceptChallenge(0, AWAY)).to.be.revertedWith(
        'not invited',
      );
      await expect(market.connect(bob).acceptChallenge(0, AWAY)).to.emit(
        market,
        'ChallengeAccepted',
      );
    });

    it('cannot accept a matched or cancelled challenge', async () => {
      await openChallenge(HOME);
      await market.connect(bob).acceptChallenge(0, AWAY);
      await expect(market.connect(carol).acceptChallenge(0, DRAW)).to.be.revertedWith('not open');
    });
  });

  describe('cancelChallenge', () => {
    it('refunds an unmatched challenge to the creator', async () => {
      await openChallenge(HOME);
      const before = await usdt.balanceOf(alice.address);
      await expect(market.connect(alice).cancelChallenge(0)).to.emit(market, 'ChallengeCancelled');
      expect(await usdt.balanceOf(alice.address)).to.equal(before + STAKE);
      expect((await market.getChallenge(0)).status).to.equal(3); // Cancelled
    });

    it('only the creator can cancel, and only while open', async () => {
      await openChallenge(HOME);
      await expect(market.connect(bob).cancelChallenge(0)).to.be.revertedWith('not creator');
      await market.connect(bob).acceptChallenge(0, AWAY);
      await expect(market.connect(alice).cancelChallenge(0)).to.be.revertedWith('not open');
    });
  });

  describe('resolve', () => {
    it('is resolver-only and one-shot', async () => {
      await expect(market.connect(alice).resolve(MATCH, HOME)).to.be.revertedWith('not resolver');
      await expect(market.connect(resolver).resolve(MATCH, 0)).to.be.revertedWith('bad result');
      await expect(market.connect(resolver).resolve(MATCH, HOME))
        .to.emit(market, 'MatchResolved')
        .withArgs(MATCH, HOME);
      await expect(market.connect(resolver).resolve(MATCH, AWAY)).to.be.revertedWith(
        'already resolved',
      );
      expect(await market.matchResult(MATCH)).to.equal(HOME);
    });
  });

  describe('claim / settlement', () => {
    it('pays the whole pot to the creator when their pick wins', async () => {
      await openChallenge(HOME);
      await market.connect(bob).acceptChallenge(0, AWAY);
      await market.connect(resolver).resolve(MATCH, HOME);

      const before = await usdt.balanceOf(alice.address);
      await expect(market.claim(0))
        .to.emit(market, 'ChallengeSettled')
        .withArgs(0, alice.address, STAKE * 2n);
      expect(await usdt.balanceOf(alice.address)).to.equal(before + STAKE * 2n);
      expect((await market.getChallenge(0)).status).to.equal(2); // Settled
    });

    it('pays the whole pot to the taker when their pick wins', async () => {
      await openChallenge(HOME);
      await market.connect(bob).acceptChallenge(0, AWAY);
      await market.connect(resolver).resolve(MATCH, AWAY);

      const before = await usdt.balanceOf(bob.address);
      await expect(market.claim(0))
        .to.emit(market, 'ChallengeSettled')
        .withArgs(0, bob.address, STAKE * 2n);
      expect(await usdt.balanceOf(bob.address)).to.equal(before + STAKE * 2n);
    });

    it('refunds both when neither pick matches (e.g. a draw)', async () => {
      await openChallenge(HOME); // alice: Home
      await market.connect(bob).acceptChallenge(0, AWAY); // bob: Away
      await market.connect(resolver).resolve(MATCH, DRAW); // actual: Draw

      const aBefore = await usdt.balanceOf(alice.address);
      const bBefore = await usdt.balanceOf(bob.address);
      await expect(market.claim(0))
        .to.emit(market, 'ChallengeSettled')
        .withArgs(0, ZERO, 0);
      expect(await usdt.balanceOf(alice.address)).to.equal(aBefore + STAKE);
      expect(await usdt.balanceOf(bob.address)).to.equal(bBefore + STAKE);
    });

    it('reverts claim when unmatched, unresolved, or already settled', async () => {
      await openChallenge(HOME);
      await expect(market.claim(0)).to.be.revertedWith('not matched');
      await market.connect(bob).acceptChallenge(0, AWAY);
      await expect(market.claim(0)).to.be.revertedWith('unresolved');
      await market.connect(resolver).resolve(MATCH, HOME);
      await market.claim(0);
      await expect(market.claim(0)).to.be.revertedWith('not matched'); // status now Settled
    });
  });
});
