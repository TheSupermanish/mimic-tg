import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Copies compiled ABIs from Hardhat artifacts into shared/src/deployed/abis
 * so other workspaces import a stable, typed surface (not the whole artifact).
 */
export function exportAbis() {
  const artifacts = [
    ['MockUSDT', 'contracts/MockUSDT.sol/MockUSDT.json'],
    ['PredictionMarket', 'contracts/PredictionMarket.sol/PredictionMarket.json'],
  ] as const;

  const outDir = resolve(__dirname, '../../shared/src/deployed/abis');
  mkdirSync(outDir, { recursive: true });

  for (const [name, rel] of artifacts) {
    const artifactPath = resolve(__dirname, '../artifacts', rel);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
    console.log(`Exported ABI: ${name}`);
  }
}

// allow `hardhat run scripts/export-abi.ts`
if (require.main === module) {
  exportAbis();
}
