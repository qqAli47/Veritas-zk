import { useWallet } from '../providers/WalletProvider.jsx';
import { Skeleton } from '../components/primitives.jsx';
import { CHAIN } from '../contracts/config.js';

/**
 * Two principles here, both learned from bugs in the original app:
 *
 *   1. A guard must never decide anything before its data has settled. While
 *      the wallet is hydrating we render a placeholder — we do not redirect.
 *   2. Guards render in place rather than navigating away. Ejecting someone to
 *      the home page mid-flow because their wallet briefly reported the wrong
 *      chain is hostile, and loses whatever they had in progress.
 */

export function RequireWallet({ children }) {
  const { isHydrating, hasWallet, isConnected, connect, status, error } = useWallet();

  if (isHydrating) {
    return (
      <div className="page">
        <div className="card">
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  if (!hasWallet) {
    return (
      <div className="page">
        <div className="card fade-in">
          <h2>A wallet is required</h2>
          <p className="page-subtitle">
            Veritas needs an Ethereum wallet to read the registry and submit proofs.
          </p>
          <div className="metamask-error">
            No injected wallet found. Install MetaMask, then reload this page.
          </div>
          <a
            className="btn btn-primary btn-full"
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Install MetaMask ↗
          </a>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="page">
        <div className="card fade-in">
          <h2>Connect your wallet</h2>
          <p className="page-subtitle">This page needs a connected account to continue.</p>
          <button
            type="button"
            className="btn btn-primary btn-full"
            onClick={connect}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
          </button>
          {error && <p className="error-msg">{error}</p>}
        </div>
      </div>
    );
  }

  return children;
}

export function RequireChain({ children }) {
  const { isCorrectChain, chainId, switchChain, isConnected } = useWallet();

  if (!isConnected || isCorrectChain) return children;

  return (
    <div className="page">
      <div className="card fade-in">
        <h2>Wrong network</h2>
        <p className="page-subtitle">
          Your wallet is on chain {String(chainId)}, but this deployment lives on{' '}
          <strong>{CHAIN.name}</strong> (chain {String(CHAIN.id)}).
        </p>
        <button type="button" className="btn btn-primary btn-full" onClick={switchChain}>
          Switch to {CHAIN.name}
        </button>
      </div>
    </div>
  );
}

export const RequireWalletAndChain = ({ children }) => (
  <RequireWallet>
    <RequireChain>{children}</RequireChain>
  </RequireWallet>
);
