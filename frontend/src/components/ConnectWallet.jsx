import React from 'react';

function truncateAddress(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function ConnectWallet({ address, isConnected, connect, disconnect, error }) {
  if (typeof window.ethereum === 'undefined') {
    return (
      <div className="metamask-error">
        MetaMask not found. Please install the MetaMask extension to continue.
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div>
        <div className="address-display">
          <span className="dot" />
          <span className="address">{truncateAddress(address)}</span>
          <button className="disconnect" onClick={disconnect}>Disconnect</button>
        </div>
        {error && <p className="error-msg">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={connect}>
        Connect Wallet
      </button>
      {error && <p className="error-msg" style={{ marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}

export default ConnectWallet;
