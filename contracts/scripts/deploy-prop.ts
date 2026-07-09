import { ethers, network } from 'hardhat';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { exportAbis } from './export-abi';

/**
 * Deploys ONLY PropMarket, reusing the already-deployed MockUSDT + resolver from
 * shared/src/deployed/addresses.json. Does NOT touch the live MockUSDT or
 * PredictionMarket (which hold real testnet balances). Merges propMarket into
 * addresses.json and re-exports ABIs.
 */
async function main() {
  const addrPath = resolve(__dirname, '../../shared/src/deployed/addresses.json');
  const addresses = JSON.parse(readFileSync(addrPath, 'utf8'));
  if (!addresses.mockUsdt) throw new Error('mockUsdt missing from addresses.json');

  const [deployer] = await ethers.getSigners();
  const rk = process.env.RESOLVER_PRIVATE_KEY;
  const resolverAddr = rk
    ? new ethers.Wallet(rk.startsWith('0x') ? rk : `0x${rk}`).address
    : addresses.resolver ?? deployer.address;

  console.log(`Deploying PropMarket on ${network.name} as ${deployer.address}`);
  console.log(`Reusing MockUSDT: ${addresses.mockUsdt}`);
  console.log(`Resolver:         ${resolverAddr}`);

  const prop = await (
    await ethers.getContractFactory('PropMarket')
  ).deploy(addresses.mockUsdt, resolverAddr);
  await prop.waitForDeployment();
  const propAddr = await prop.getAddress();
  console.log(`PropMarket:       ${propAddr}`);

  addresses.propMarket = propAddr;
  writeFileSync(addrPath, JSON.stringify(addresses, null, 2));
  console.log(`\nMerged propMarket into shared/src/deployed/addresses.json`);

  exportAbis();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
