import { Link } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';

const STATS = [
  { value: '1,033', label: 'ZK Constraints' },
  { value: '111', label: 'Tests Passing' },
  { value: '297k', label: 'Gas / Proof' },
  { value: '~0.5s', label: 'Proving Time' },
];

const ROLES = [
  {
    to: '/issuer',
    icon: '🏛',
    role: 'Authority',
    title: 'Issue a credential',
    body: 'Stand in for a government registry — vouch for a birth year and region by publishing a single Poseidon commitment on-chain.',
  },
  {
    to: '/prove',
    icon: '🧑',
    role: 'Citizen',
    title: 'Prove your attributes',
    body: 'Generate a Groth16 proof in your browser — age and location both proven, neither revealed. About half a second.',
  },
  {
    to: '/restricted',
    icon: '🏪',
    role: 'Business',
    title: 'Access gated content',
    body: 'See a resource gated by a live on-chain read of VeritasCore. No client state to forge. No personal data exchanged.',
  },
];

const FEATURES = [
  {
    icon: '🔐',
    title: 'Private by construction',
    body: 'Birth year and region never leave the browser — not encrypted in transit, simply never sent.',
  },
  {
    icon: '🔗',
    title: 'Two attributes, zero extra gas',
    body: 'Region rides in spare bits of an existing signal. The second attribute costs 214 gas — not 6,800.',
  },
  {
    icon: '⚡',
    title: 'Fast in-browser proving',
    body: 'A 1,033-constraint Groth16 circuit over BN254 proves both attributes in about half a second.',
  },
  {
    icon: '⛓',
    title: 'Enforced on-chain',
    body: 'Verification, replay protection and policy live in the contract — not in interface logic you can bypass.',
  },
  {
    icon: '🛡',
    title: 'Four attack surfaces closed',
    body: 'Prover-chosen threshold, prover-chosen year, front-running, and allowlist narrowing — all mitigated.',
  },
  {
    icon: '🌍',
    title: 'Private set membership',
    body: 'The verifier learns "this holder is in one of N regions" — never which one. N is the anonymity set.',
  },
];

export default function HomePage() {
  const { isConnected, connect, status, error, hasWallet } = useWallet();

  return (
    <div className="page page-home">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero fade-in" aria-label="Project overview">
        <div className="hero-badge">Graduation Project · Zero-Knowledge Proofs</div>
        <h1 className="hero-title">
          <span className="hero-brand">Veritas</span>
          <span className="hero-subtitle">Privacy-Preserving Attribute Verification</span>
        </h1>
        <p className="hero-description">
          Prove you are old enough and that you are somewhere a service operates —
          without revealing your birth year, your country, or any other personal data.
          A Groth16 proof generated entirely in your browser, verified by a smart contract.
        </p>

        {/* Stats bar */}
        <div className="hero-stats" role="list">
          {STATS.map((s) => (
            <div key={s.label} className="hero-stat" role="listitem">
              <span className="hero-stat-value">{s.value}</span>
              <span className="hero-stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Wallet connect */}
        <div className="hero-actions">
          {!isConnected ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={connect}
                disabled={!hasWallet || status === 'connecting'}
              >
                {status === 'connecting' ? 'Connecting…' : '🔗 Connect Wallet to Start'}
              </button>
              <Link to="/how-it-works" className="btn btn-ghost btn-lg">
                How it works →
              </Link>
            </>
          ) : (
            <Link to="/prove" className="btn btn-primary btn-lg">
              Prove your attributes →
            </Link>
          )}
          {!hasWallet && (
            <p className="hero-no-wallet">
              No wallet detected. Install MetaMask — or explore{' '}
              <Link to="/how-it-works">How it works</Link>, which needs no wallet.
            </p>
          )}
          {error && <p className="error-msg">{error}</p>}
        </div>
      </section>

      {/* ── Flow diagram ─────────────────────────────────────────────── */}
      <section className="flow-section fade-in" aria-label="How it flows">
        <h2 className="section-heading">How the system works</h2>
        <div className="flow-diagram">
          <div className="flow-actor">
            <span className="flow-icon">🏛</span>
            <strong>Issuer</strong>
            <span className="flow-role">Authority</span>
          </div>
          <div className="flow-arrows">
            <div className="flow-step">
              <span className="flow-step-label">commitment only →</span>
            </div>
            <div className="flow-step flow-step-right">
              <span className="flow-step-label">← registerCommitment()</span>
            </div>
          </div>
          <div className="flow-actor flow-actor-center">
            <span className="flow-icon">🧑</span>
            <strong>Holder's Browser</strong>
            <span className="flow-role">Groth16 proof in ~0.5s</span>
            <code className="flow-code">Poseidon(birthYear, region, secret)</code>
          </div>
          <div className="flow-arrows">
            <div className="flow-step">
              <span className="flow-step-label">proof + 4 public signals →</span>
            </div>
          </div>
          <div className="flow-actor">
            <span className="flow-icon">⛓</span>
            <strong>VeritasCore</strong>
            <span className="flow-role">Ethereum</span>
            <ul className="flow-checks">
              <li>pairing check</li>
              <li>policy pins</li>
              <li>nullifier spent</li>
              <li>attestation written</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Role cards ───────────────────────────────────────────────── */}
      <section className="roles-section fade-in" aria-label="Try each role">
        <h2 className="section-heading">Try the demo</h2>
        <p className="section-subheading">
          Three accounts — one story. Switch MetaMask accounts to play each role.
        </p>
        <div className="role-grid">
          {ROLES.map((r) => (
            <Link key={r.to} to={r.to} className="role-card">
              <span className="role-icon" aria-hidden="true">{r.icon}</span>
              <span className="role-tag">{r.role}</span>
              <strong className="role-title">{r.title}</strong>
              <p className="role-body">{r.body}</p>
              <span className="role-arrow">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Feature grid ─────────────────────────────────────────────── */}
      <section className="features-section fade-in" aria-label="Key properties">
        <h2 className="section-heading">What makes this different</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <span className="feature-card-icon" aria-hidden="true">{f.icon}</span>
              <strong className="feature-card-title">{f.title}</strong>
              <p className="feature-card-body">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────── */}
      <section className="cta-section fade-in">
        <Link to="/how-it-works" className="btn btn-outline btn-lg">
          📖 Deep dive — How it works
        </Link>
        <Link to="/explorer" className="btn btn-ghost btn-lg">
          🔍 Explorer — see what's on chain
        </Link>
      </section>
    </div>
  );
}
