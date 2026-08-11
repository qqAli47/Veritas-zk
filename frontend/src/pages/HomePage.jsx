import React from 'react';
import ConnectWallet from '../components/ConnectWallet.jsx';
import { navigate } from '../utils/router.js';

function HomePage({ wallet }) {
  return (
    <div className="page">
      <div className="card fade-in">
        <div className="card-header">
          <h1 className="logo">Veritas</h1>
          <p className="tagline">Privacy-Preserving Age Verification</p>
          <p className="description">
            Prove you meet the age requirement without revealing your birth date.
            Powered by zero-knowledge proofs on Ethereum.
          </p>
        </div>

        <div className="divider" />

        <ConnectWallet
          address={wallet.address}
          isConnected={wallet.isConnected}
          connect={wallet.connect}
          disconnect={wallet.disconnect}
          error={wallet.error}
        />

        {wallet.isConnected && (
          <button
            className="btn btn-secondary"
            onClick={() => navigate('#/prove')}
            style={{ marginTop: '1rem' }}
          >
            Prove Your Age →
          </button>
        )}

        <div className="home-features">
          <div className="feature-item">
            <span className="feature-icon">🔐</span>
            <div>
              <strong>Private</strong>
              <p>Your birth year never leaves your device</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">⚡</span>
            <div>
              <strong>Fast</strong>
              <p>Generate a proof in seconds</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">⛓</span>
            <div>
              <strong>On-Chain</strong>
              <p>Verified by smart contracts</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
