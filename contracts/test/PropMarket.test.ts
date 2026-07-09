import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { MockUSDT, PropMarket } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// Result enum: Pending=0, Yes=1, No=2, Void=3
const YES = 1;
const NO = 2;
const VOID = 3;

const QUESTION = 'Lionel Messi to score';
const MATCH = 'match-42';
const STAKE = 10_000_000n; // 10 USDt (6 decimals)
const ZERO = ethers.ZeroAddress;

describe('PropMarket', () => {
  let usdt: MockUSDT;
  let prop: PropMarket;
  let resolver: HardhatEthersSigner;
  let alice: HardhatEthersSigner; // creator (backs YES)
  let bob: HardhatEthersSigner; // taker (gets NO)
  let resolveBy: number;

  beforeEach(async () => {
    [, resolver, alice, bob] = await ethers.getSigners();

    usdt = await (await ethers.getContractFactory('MockUSDT')).deploy();
    prop = await (await ethers.getContractFactory('PropMarket')).deploy(
      await usdt.getAddress(),
      resolver.address,
    );

    for (const p of [alice, bob]) {
      await usdt.mint(p.address, 1000_000000n);
      await usdt.connect(p).approve(await prop.getAddress(), ethers.MaxUint256);
    }
    resolveBy = (await time.latest()) + 3600;
  });

  async function open(backsYes = true, opponent = ZERO) {
    await prop.connect(alice).createProp(QUESTION, MATCH, resolveBy, backsYes, STAKE, opponent);
    return 0;
  }

  it('creates + escrows a prop', async () => {
    await expect(prop.connect(alice).createProp(QUESTION, MATCH, resolveBy, true, STAKE, ZERO))
      .to.emit(prop, 'PropCreated')
      .withArgs(0, alice.address, ZERO, MATCH, QUESTION, true, STAKE, resolveBy);
    expect(await usdt.balanceOf(await prop.getAddress())).to.equal(STAKE);
    const p = await prop.getProp(0);
    expect(p.creatorBacksYes).to.equal(true);
    expect(p.status).to.equal(0); // Open
  });

  it('accepts (opposite side) + locks the pot', async () => {
    await open(true);
    await expect(prop.connect(bob).acceptProp(0)).to.emit(prop, 'PropAccepted').withArgs(0, bob.address);
    expect(await usdt.balanceOf(await prop.getAddress())).to.equal(STAKE * 2n);
    expect((await prop.getProp(0)).status).to.equal(1); // Matched
  });

  it('pays the YES backer (creator) when result is YES', async () => {
    await open(true); // alice backs YES
    await prop.connect(bob).acceptProp(0);
    await time.increaseTo(resolveBy + 1);
    await prop.connect(resolver).resolve(0, YES);
    const before = await usdt.balanceOf(alice.address);
    await prop.claim(0);
    expect(await usdt.balanceOf(alice.address)).to.equal(before + STAKE * 2n);
  });

  it('pays the NO backer (taker) when result is NO', async () => {
    await open(true); // alice backs YES → bob gets NO
    await prop.connect(bob).acceptProp(0);
    await time.increaseTo(resolveBy + 1);
    await prop.connect(resolver).resolve(0, NO);
    const before = await usdt.balanceOf(bob.address);
    await prop.claim(0);
    expect(await usdt.balanceOf(bob.address)).to.equal(before + STAKE * 2n);
  });

  it('refunds both on VOID', async () => {
    await open(true);
    await prop.connect(bob).acceptProp(0);
    await time.increaseTo(resolveBy + 1);
    await prop.connect(resolver).resolve(0, VOID);
    const a = await usdt.balanceOf(alice.address);
    const b = await usdt.balanceOf(bob.address);
    await prop.claim(0);
    expect(await usdt.balanceOf(alice.address)).to.equal(a + STAKE);
    expect(await usdt.balanceOf(bob.address)).to.equal(b + STAKE);
  });

  it('only the resolver can resolve, and only after resolveBy', async () => {
    await open(true);
    await prop.connect(bob).acceptProp(0);
    await expect(prop.connect(alice).resolve(0, YES)).to.be.revertedWith('not resolver');
    await expect(prop.connect(resolver).resolve(0, YES)).to.be.revertedWith('too early');
    await time.increaseTo(resolveBy + 1);
    await prop.connect(resolver).resolve(0, YES);
    await expect(prop.connect(resolver).resolve(0, NO)).to.be.revertedWith('already resolved');
  });

  it('lets the creator cancel an unmatched prop for a refund', async () => {
    await open(true);
    const before = await usdt.balanceOf(alice.address);
    await expect(prop.connect(alice).cancelProp(0)).to.emit(prop, 'PropCancelled').withArgs(0);
    expect(await usdt.balanceOf(alice.address)).to.equal(before + STAKE);
    expect((await prop.getProp(0)).status).to.equal(3); // Cancelled
  });
});
