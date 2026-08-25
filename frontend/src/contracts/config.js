/**
 * Deployment configuration, read from Vite env vars.
 *
 * `scripts/deploy.js` writes frontend/.env.local automatically, so these
 * normally do not need to be filled in by hand.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function readAddress(key) {
  const value = import.meta.env[key];
  if (!value || !ADDRESS_RE.test(value)) {
    // Deliberately NOT thrown. Throwing at module scope would white-screen the
    // whole app — including the pages that need no contracts at all, like the
    // explainer. Report it and let the UI degrade to a clear "not configured"
    // panel instead.
    console.error(
      `[veritas] ${key} is missing or malformed. ` +
        `Run \`npm run deploy:local\` from the repo root, or copy .env.example to .env.`,
    );
    return null;
  }
  return value;
}

export const CONTRACTS = {
  core: readAddress('VITE_CORE_ADDRESS'),
  registry: readAddress('VITE_REGISTRY_ADDRESS'),
  verifier: readAddress('VITE_VERIFIER_ADDRESS'),
  gated: readAddress('VITE_GATED_ADDRESS'),
};

export const CHAIN_ID = BigInt(import.meta.env.VITE_CHAIN_ID ?? '31337');
export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME ?? 'localhost';
export const DEPLOY_BLOCK = Number(import.meta.env.VITE_DEPLOY_BLOCK ?? 0);
export const EXPLORER_URL = (import.meta.env.VITE_EXPLORER_URL ?? '').replace(/\/$/, '');

export const isConfigured = Object.values(CONTRACTS).every(Boolean);

/** Chain parameters for wallet_addEthereumChain / wallet_switchEthereumChain. */
export const CHAIN = {
  id: CHAIN_ID,
  idHex: '0x' + CHAIN_ID.toString(16),
  name: NETWORK_NAME === 'sepolia' ? 'Sepolia' : 'Localhost 8545',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls:
    NETWORK_NAME === 'sepolia'
      ? ['https://ethereum-sepolia-rpc.publicnode.com']
      : ['http://127.0.0.1:8545'],
  blockExplorerUrls: EXPLORER_URL ? [EXPLORER_URL] : [],
  faucet: 'https://www.alchemy.com/faucets/ethereum-sepolia',
};

export const txUrl = (hash) => (EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null);
export const addressUrl = (addr) => (EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : null);
