import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';
import { ToastHost } from '../providers/ToastProvider.jsx';
import { CHAIN, NETWORK_NAME, isConfigured } from '../contracts/config.js';
import { shorten } from '../zk/field.js';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/issuer', label: 'Issuer', role: 'Authority' },
  { to: '/prove', label: 'Prove', role: 'Citizen' },
  { to: '/restricted', label: 'Restricted', role: 'Business' },
  { to: '/explorer', label: 'Explorer', role: 'Public' },
  { to: '/how-it-works', label: 'How it works' },
];

const TITLES = {
  '/': 'Veritas — Privacy-Preserving Age Verification',
  '/issuer': 'Issuer Console — Veritas',
  '/prove': 'Prove Your Age — Veritas',
  '/restricted': 'Restricted Area — Veritas',
  '/explorer': 'Explorer — Veritas',
  '/how-it-works': 'How Veritas Works',
};

/**
 * Moves focus to the page heading on navigation and announces the change.
 *
 * Without this a single-page app is disorienting on a screen reader: the URL
 * changes, the content changes, and focus silently stays wherever it was.
 */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    document.title = TITLES[pathname] ?? 'Veritas';

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const heading = document.querySelector('main h1, main h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
    setMessage(`${(TITLES[pathname] ?? 'Page').split('—')[0].trim()} loaded`);
  }, [pathname]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

function NetworkBadge() {
  const { isConnected, isCorrectChain, chainId, switchChain } = useWallet();
  if (!isConnected) return null;

  if (!isCorrectChain) {
    return (
      <button type="button" className="net-badge net-badge-wrong" onClick={switchChain}>
        Wrong network (chain {String(chainId)}) — switch to {CHAIN.name}
      </button>
    );
  }
  return (
    <span className="net-badge">
      <span className="dot" aria-hidden="true" />
      {NETWORK_NAME}
    </span>
  );
}

export default function AppShell() {
  const { status, address, connect, disconnect, isConnected } = useWallet();

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <RouteAnnouncer />

      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="brand" aria-label="Veritas home">
            <span className="brand-mark" aria-hidden="true">
              🛡
            </span>
            <span className="brand-name">Veritas</span>
          </NavLink>

          <nav className="app-nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
                {item.role && <span className="nav-role">{item.role}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="app-header-right">
            <NetworkBadge />
            {isConnected ? (
              <span className="address-display">
                <span className="address mono">{shorten(address, 6, 4)}</span>
                <button type="button" className="disconnect" onClick={disconnect}>
                  Disconnect
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={connect}
                disabled={status === 'connecting' || status === 'hydrating'}
              >
                {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </header>

      {!isConfigured && (
        <div className="config-warning" role="alert">
          <strong>Demo not configured.</strong> Contract addresses are missing. Run{' '}
          <code className="mono">npm run deploy:local</code> from the repository root, then reload.
        </div>
      )}

      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>
          Veritas-zk — a graduation project in privacy-preserving identity. Groth16 over BN254,
          proofs generated in your browser.
        </p>
      </footer>

      <ToastHost />
    </>
  );
}
