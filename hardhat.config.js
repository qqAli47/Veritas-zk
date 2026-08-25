require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/**
 * Hardhat configuration for Veritas-zk.
 *
 * Note `paths.tests` — this project keeps its tests in `tests/` rather than
 * Hardhat's default `test/`.
 */

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      // The Groth16 verifier is large and called on every verification, so the
      // optimizer is doing real work here rather than shaving a few bytes.
      optimizer: { enabled: true, runs: 200 },
    },
  },

  paths: {
    tests: './tests',
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },

  // Generating a Groth16 proof takes a second or two, and several tests do it.
  mocha: {
    timeout: 180000,
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    // A fixed price, deliberately. The spec suggested pulling a live figure
    // from Etherscan's v1 gas oracle, but that endpoint now requires a key and
    // will hang or 403 in the middle of a test run. The assumption is stated
    // in docs/gas-report.md instead.
    gasPrice: 30,
    outputFile: process.env.GAS_OUT || undefined,
    noColors: Boolean(process.env.GAS_OUT),
    // The verifier is ~100% generated assembly; per-line gas attribution
    // inside it is not actionable.
    excludeContracts: ['Groth16Verifier'],
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || '',
  },
};
