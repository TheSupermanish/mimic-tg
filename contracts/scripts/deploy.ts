import { ethers, network } from 'hardhat';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { exportAbis } from './export-abi';

/**
 * Deploys MockUSDT + PredictionMarket, then writes addresses + ABIs into shared/
 * so the backend, bot and miniapp can import them.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const rk = process.env.RESOLVER_PRIVATE_KEY;
  const resolverAddr = rk
    ? new ethers.Wallet(rk.startsWith('0x') ? rk : `0x${rk}`).address
    : deployer.address;

  console.log(`Deploying on ${network.name} as ${deployer.address}`);
  console.log(`Resolver: ${resolverAddr}`);

  const usdt = await (await ethers.getContractFactory('MockUSDT')).deploy();
  await usdt.waitForDeployment();
  const usdtAddr = await usdt.getAddress();
  console.log(`MockUSDT:         ${usdtAddr}`);

  const market = await (
    await ethers.getContractFactory('PredictionMarket')
  ).deploy(usdtAddr, resolverAddr);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log(`PredictionMarket: ${marketAddr}`);

  const sharedDir = resolve(__dirname, '../../shared/src/deployed');
  mkdirSync(sharedDir, { recursive: true });
  const addresses = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    mockUsdt: usdtAddr,
    predictionMarket: marketAddr,
    resolver: resolverAddr,
  };
  writeFileSync(resolve(sharedDir, 'addresses.json'), JSON.stringify(addresses, null, 2));
  console.log(`\nWrote shared/src/deployed/addresses.json`);

  exportAbis();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
