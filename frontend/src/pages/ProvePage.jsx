import React, { useEffect, useState } from 'react';
import ProveForm from '../components/ProveForm.jsx';
import { navigate } from '../utils/router.js';

function ProvePage({ wallet }) {
  const [redirecting, setRedirecting] = useState(false);

  // Route guard: redirect to home if wallet is not connected
  useEffect(() => {
    if (!wallet.isConnected) {
      setRedirecting(true);
      navigate('#/');
    }
  }, [wallet.isConnected]);

  if (redirecting || !wallet.isConnected) {
    return null;
  }

  const handleProofSuccess = (proof) => {
    // Navigate to restricted page with proof data
    navigate('#/restricted', { proof, address: wallet.address });
  };

  return (
    <div className="page">
      <div className="card fade-in">
        <div className="page-nav">
          <button className="btn-back" onClick={() => navigate('#/')}>
            ← Back
          </button>
        </div>

        <h2>
          <span className="page-title-icon">🛡</span>
          Prove Your Age
        </h2>
        <p className="page-subtitle">
          Enter your details below. Your private data never leaves your browser.
        </p>

        <div className="divider" />

        <div className="wallet-info">
          <span className="dot" />
          <span className="address">
            {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}
          </span>
        </div>

        <ProveForm onProofSuccess={handleProofSuccess} />
      </div>
    </div>
  );
}

export default ProvePage;
