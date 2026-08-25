import { Link } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';

const ROLES = [
  {
    to: '/issuer',
    icon: '🏛',
    role: 'Authority',
    title: 'Issue a credential',
    body: 'Stand in for a government registry: vouch for a birth year by publishing a commitment.',
  },
  {
    to: '/prove',
    icon: '🧑',
    role: 'Citizen',
    title: 'Prove your age',
    body: 'Generate a zero-knowledge proof in your browser and submit it for verification.',
  },
  {
    to: '/restricted',
    icon: '🏪',
    role: 'Business',
    title: 'Gated content',
    body: 'See an age-restricted resource that trusts the chain, not the interface.',
  },
];

export default function HomePage() {
  const { isConnected, connect, status, error, hasWallet } = useWallet();

  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <div className="card-header">
          <h1 className="logo">Veritas</h1>
          <p className="tagline">Privacy-Preserving Age Verification</p>
          <p className="description">
            Prove you are old enough — without revealing when you were born, who you are, or
            anything else. A zero-knowledge proof, generated on your device and checked by a smart
            contract.
          </p>
        </div>

        <div className="divider" />

        {!isConnected && (
          <>
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={connect}
              disabled={!hasWallet || status === 'connecting'}
            >
              {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
            </button>
            {!hasWallet && (
              <div className="metamask-error">
                No wallet detected. Install MetaMask to try the live demo — or read{' '}
                <Link to="/how-it-works">How it works</Link>, which needs no wallet.
              </div>
            )}
            {error && <p className="error-msg">{error}</p>}
          </>
        )}

        <div className="role-grid">
          {ROLES.map((r) => (
            <Link key={r.to} to={r.to} className="role-card">
              <span className="role-icon" aria-hidden="true">
                {r.icon}
              </span>
              <span className="role-tag">{r.role}</span>
              <strong>{r.title}</strong>
              <p>{r.body}</p>
            </Link>
          ))}
        </div>

        <div className="home-features">
          <div className="feature-item">
            <span className="feature-icon" aria-hidden="true">
              🔐
            </span>
            <div>
              <strong>Private by construction</strong>
              <p>Your birth year never leaves the browser — not encrypted, simply never sent.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon" aria-hidden="true">
              ⚡
            </span>
            <div>
              <strong>Fast</strong>
              <p>A 761-constraint circuit proves in about a second on a laptop.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon" aria-hidden="true">
              ⛓
            </span>
            <div>
              <strong>Enforced on-chain</strong>
              <p>Verification and access control are contract logic, not interface logic.</p>
            </div>
          </div>
        </div>

        <Link to="/how-it-works" className="btn btn-outline btn-full">
          How it works →
        </Link>
      </div>
    </div>
  );
}
