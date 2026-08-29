import { Link } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';

const ROLES = [
  {
    to: '/issuer',
    icon: '🏛',
    role: 'Authority',
    title: 'Issue a credential',
    body: 'Stand in for a government registry: vouch for a birth year and a region by publishing a single commitment.',
  },
  {
    to: '/prove',
    icon: '🧑',
    role: 'Citizen',
    title: 'Prove your attributes',
    body: 'Prove your age and location in your browser, revealing neither, then submit it.',
  },
  {
    to: '/restricted',
    icon: '🏪',
    role: 'Business',
    title: 'Gated content',
    body: 'See a gated resource that trusts the chain, not the interface.',
  },
];

export default function HomePage() {
  const { isConnected, connect, status, error, hasWallet } = useWallet();

  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <div className="card-header">
          <h1 className="logo">Veritas</h1>
          <p className="tagline">Privacy-Preserving Attribute Verification</p>
          <p className="description">
            Prove you are old enough, and that you are somewhere a service operates — without
            revealing when you were born or where you live. A zero-knowledge proof, generated on
            your device and checked by a smart contract.
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
              <p>
                Your birth year and region never leave the browser — not encrypted, simply never
                sent.
              </p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon" aria-hidden="true">
              ⚡
            </span>
            <div>
              <strong>Fast</strong>
              <p>A 965-constraint circuit proves two attributes in about a second.</p>
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
