import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// load repo-root .env
dotenv.config({ path: resolve(__dirname, '../.env') });

const norm = (k?: string) => (k ? (k.startsWith('0x') ? k : `0x${k}`) : '');
const DEPLOYER_PRIVATE_KEY = norm(process.env.DEPLOYER_PRIVATE_KEY);
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: BASE_SEPOLIA_RPC,
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
