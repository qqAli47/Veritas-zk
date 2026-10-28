import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserProvider } from 'ethers';
import { CHAIN } from '../contracts/config.js';

const WalletContext = createContext(null);

/**
 * Wallet connection state.
 *
 * The `status` field exists to fix a specific bug in the original app: the
 * wallet address started as `null` and only populated after an async
 * `eth_accounts` probe resolved, but route guards read it on first render — so
 * a hard refresh on any protected page bounced the user home before the wallet
 * had a chance to report itself.
 *
 * With an explicit 'hydrating' state, guards can render a placeholder and wait
 * rather than making a decision on data that has not arrived yet.
 */
const STATUS = {
  HYDRATING: 'hydrating',
  NO_WALLET: 'no-wallet',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
};

export function WalletProvider({ children }) {
  const [status, setStatus] = useState(STATUS.HYDRATING);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState(null);

  const ethereum = typeof window !== 'undefined' ? window.ethereum : undefined;

  const refreshChain = useCallback(async () => {
    if (!ethereum) return;
    try {
      const hex = await ethereum.request({ method: 'eth_chainId' });
      setChainId(BigInt(hex));
    } catch {
      setChainId(null);
    }
  }, [ethereum]);

  // ── Hydration ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    if (!ethereum) {
      setStatus(STATUS.NO_WALLET);
      return undefined;
    }

    (async () => {
      try {
        const accounts = await ethereum.request({ method: 'eth_accounts' });
        if (cancelled) return;
        await refreshChain();
        if (cancelled) return;
        if (accounts?.length) {
          setAddress(accounts[0]);
          setStatus(STATUS.CONNECTED);
        } else {
          setStatus(STATUS.DISCONNECTED);
        }
      } catch {
        if (!cancelled) setStatus(STATUS.DISCONNECTED);
      }
    })();

    const onAccountsChanged = (accounts) => {
      if (accounts?.length) {
        setAddress(accounts[0]);
        setStatus(STATUS.CONNECTED);
      } else {
        setAddress(null);
        setStatus(STATUS.DISCONNECTED);
      }
    };

    // Deliberately NOT window.location.reload(). Reloading on a network change
    // destroys any in-flight proof — and it fires when the user clicks our own
    // "Switch network" button, which would be a maddening loop.
    const onChainChanged = (hex) => setChainId(BigInt(hex));

    ethereum.on?.('accountsChanged', onAccountsChanged);
    ethereum.on?.('chainChanged', onChainChanged);

    return () => {
      cancelled = true;
      ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [ethereum, refreshChain]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setError(null);
    if (!ethereum) {
      setError('No Ethereum wallet found. Install MetaMask to continue.');
      setStatus(STATUS.NO_WALLET);
      return;
    }
    setStatus(STATUS.CONNECTING);
    try {
      const provider = new BrowserProvider(ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      setAddress(await signer.getAddress());
      await refreshChain();
      setStatus(STATUS.CONNECTED);
    } catch (err) {
      setStatus(STATUS.DISCONNECTED);
      setError(err?.code === 4001 ? 'Connection request rejected.' : err.message);
    }
  }, [ethereum, refreshChain]);

  /**
   * A wallet cannot be made to forget an authorisation from the page side, so
   * this clears local state only. Saying so plainly is better than implying a
   * disconnect that did not happen.
   */
  const disconnect = useCallback(() => {
    setAddress(null);
    setStatus(STATUS.DISCONNECTED);
    setError(null);
  }, []);

  const switchChain = useCallback(async () => {
    if (!ethereum) return;
    setError(null);
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN.idHex }],
      });
    } catch (err) {
      // 4902 = chain unknown to the wallet. Some wallets bury it a level down.
      const code = err?.code ?? err?.data?.originalError?.code;
      if (code !== 4902 && code !== -32603) {
        setError(err.message);
        return;
      }
      try {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: CHAIN.idHex,
              chainName: CHAIN.name,
              nativeCurrency: CHAIN.nativeCurrency,
              rpcUrls: CHAIN.rpcUrls,
              blockExplorerUrls: CHAIN.blockExplorerUrls,
            },
          ],
        });
      } catch (addErr) {
        setError(addErr.message);
      }
    }
  }, [ethereum]);

  const value = useMemo(
    () => ({
      status,
      address,
      chainId,
      error,
      ethereum,
      isHydrating: status === STATUS.HYDRATING,
      isConnected: status === STATUS.CONNECTED,
      hasWallet: Boolean(ethereum),
      isCorrectChain: chainId !== null && chainId === CHAIN.id,
      connect,
      disconnect,
      switchChain,
    }),
    [status, address, chainId, error, ethereum, connect, disconnect, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside a WalletProvider');
  return ctx;
}
