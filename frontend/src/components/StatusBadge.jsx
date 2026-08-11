import React from 'react';

function StatusBadge({ status, errorMsg }) {
  if (status === 'idle') {
    return (
      <div className="status-badge status-idle">
        <span>Idle</span>
      </div>
    );
  }

  if (status === 'generating') {
    return (
      <div className="status-badge status-generating">
        <span className="spinner" />
        <span>Generating proof...</span>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="status-badge status-success">
        <span>Proof generated ✅</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="status-badge status-error">
        <span>Proof failed ❌{errorMsg ? ` — ${errorMsg}` : ''}</span>
      </div>
    );
  }

  return null;
}

export default StatusBadge;
