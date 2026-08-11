import React from 'react';

/**
 * RestrictedContent — Gated content shown after successful age verification.
 * Displays verification success and platform content.
 */
export function RestrictedContent({ proof, address, onReset }) {
  const truncate = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Unknown';

  return (
    <div className="restricted-content">
      {/* Success banner */}
      <div className="verified-banner" role="status">
        <span className="verified-icon" aria-hidden="true">✓</span>
        <div className="verified-text">
          <h2 className="verified-title">Age Verified — Welcome to the Platform</h2>
          <p className="verified-subtitle">
            Your ZK proof was accepted. Identity never revealed.
          </p>
        </div>
      </div>

      {/* Proof details */}
      <div className="proof-details card">
        <h3 className="proof-details-title">Proof Receipt</h3>
        <dl className="proof-dl">
          <div className="proof-dl-row">
            <dt>Wallet</dt>
            <dd className="mono">{truncate(address)}</dd>
          </div>
          <div className="proof-dl-row">
            <dt>Public Signals</dt>
            <dd className="mono">
              {proof?.publicSignals?.join(', ') || '—'}
            </dd>
          </div>
          <div className="proof-dl-row">
            <dt>Proof ID</dt>
            <dd className="mono proof-id">{proof?.proof || '—'}</dd>
          </div>
          <div className="proof-dl-row">
            <dt>Status</dt>
            <dd className="proof-status-ok">✓ Verified</dd>
          </div>
        </dl>
      </div>

      {/* Platform content placeholder */}
      <div className="platform-content card">
        <h3 className="platform-content-title">Platform Access</h3>
        <p className="platform-content-body">
          You now have access to age-restricted content and features. Your privacy
          is preserved — no personal data was transmitted or stored on-chain.
        </p>
        <div className="platform-features">
          <div className="feature-chip">🔐 Private Verification</div>
          <div className="feature-chip">⛓ On-Chain Proof</div>
          <div className="feature-chip">🛡 Zero Knowledge</div>
        </div>
      </div>

      {/* Reset */}
      <button
        className="btn btn-outline btn-full"
        onClick={onReset}
        aria-label="Reset verification and go back to prove page"
      >
        ↩ Reset Verification
      </button>
    </div>
  );
}
