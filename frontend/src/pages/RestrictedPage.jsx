import React, { useEffect, useState } from 'react';
import { RestrictedContent } from '../components/RestrictedContent.jsx';
import { navigate } from '../utils/router.js';

function RestrictedPage({ wallet, locationState }) {
  const [proof, setProof] = useState(null);
  const [address, setAddress] = useState(null);

  useEffect(() => {
    // Route guard: redirect to /prove if no proof data provided
    if (!locationState || !locationState.proof) {
      navigate('#/prove');
      return;
    }
    setProof(locationState.proof);
    setAddress(locationState.address);
  }, [locationState]);

  // Also redirect if wallet disconnects
  useEffect(() => {
    if (!wallet.isConnected) {
      navigate('#/');
    }
  }, [wallet.isConnected]);

  if (!proof) {
    return null;
  }

  const handleReset = () => {
    navigate('#/prove');
  };

  return (
    <div className="page">
      <div className="card card-wide fade-in">
        <RestrictedContent
          proof={proof}
          address={address || wallet.address}
          onReset={handleReset}
        />
      </div>
    </div>
  );
}

export default RestrictedPage;
