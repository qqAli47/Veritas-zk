/**
 * Contract instances.
 *
 * Reads and writes go through different providers on purpose:
 *
 *   - READS use a plain JSON-RPC provider, so the explorer and the on-chain
 *     access gate work with no wallet connected at all, and log queries are
 *     not throttled by the wallet's rate limits.
 *   - WRITES use the injected wallet, because only it can sign.
 */

import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers';
import coreAbi from './abis/VeritasCore.json';
import registryAbi from './abis/CredentialRegistry.json';
import gatedAbi from './abis/GatedContent.json';
import { CONTRACTS, CHAIN } from './config.js';

let _readProvider = null;

export function readProvider() {
  if (!_readProvider) {
    _readProvider = new JsonRpcProvider(
      CHAIN.rpcUrls[0],
      { chainId: Number(CHAIN.id), name: CHAIN.name },
      // staticNetwork avoids a chainId round-trip on every single call.
      { staticNetwork: true },
    );
  }
  return _readProvider;
}

export const readCore = () => new Contract(CONTRACTS.core, coreAbi.abi, readProvider());
export const readRegistry = () =>
  new Contract(CONTRACTS.registry, registryAbi.abi, readProvider());
export const readGated = () => new Contract(CONTRACTS.gated, gatedAbi.abi, readProvider());

/** A signer for the connected wallet, refusing to proceed on the wrong chain. */
export async function getSigner(ethereum) {
  // 'any' so ethers does not throw when the user switches networks mid-session.
  const provider = new BrowserProvider(ethereum, 'any');
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN.id) {
    const err = new Error(
      `Wallet is on chain ${net.chainId}; this deployment is on ${CHAIN.name} (${CHAIN.id}).`,
    );
    err.code = 'WRONG_CHAIN';
    throw err;
  }
  return provider.getSigner();
}

export const writeCore = async (eth) => new Contract(CONTRACTS.core, coreAbi.abi, await getSigner(eth));
export const writeRegistry = async (eth) =>
  new Contract(CONTRACTS.registry, registryAbi.abi, await getSigner(eth));
export const writeGated = async (eth) =>
  new Contract(CONTRACTS.gated, gatedAbi.abi, await getSigner(eth));
