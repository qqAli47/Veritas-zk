import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';
import { useSession } from '../providers/SessionProvider.jsx';
import { readCore, writeCore } from '../contracts/clients.js';
import { decodeContractError } from '../contracts/errors.js';
import { txUrl } from '../contracts/config.js';
import { DataRow, ErrorPanel, Hash, Panel, Skeleton } from '../components/primitives.jsx';

/**
 * The gated area.
 *
 * The gate is an on-chain read — `VeritasCore.isVerified(address)` — not a
 * React boolean. That distinction is the whole point of the attestation layer:
 * this page is correct after a refresh, in a new tab, on another machine, and
 * it cannot be opened by editing client state in developer tools.
 */
export default function RestrictedPage() {
  const navigate = useNavigate();
  const { address, ethereum } = useWallet();
  const { proof, receipt, reset } = useSession();

  const [state, setState] = useState({ loading: true, verified: false, attestation: null });
  const [replayResult, setReplayResult] = useState(null);
  const [replaying, setReplaying] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const core = readCore();
      const [verified, attestation] = await Promise.all([
        core.isVerified(address),
        core.attestationOf(address),
      ]);
      setState({ loading: false, verified, attestation, error: null });
    } catch (err) {
      setState({ loading: false, verified: false, attestation: null, error: decodeContractError(err) });
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Deliberately re-submits the exact proof that already succeeded.
   *
   * Replay protection is invisible unless you can watch it fail, so this
   * button is the most persuasive twenty lines in the app.
   */
  const attemptReplay = useCallback(async () => {
    if (!proof) return;
    setReplaying(true);
    setReplayResult(null);
    try {
      const core = await writeCore(ethereum);
      const { a, b, c, pub } = proof.calldata;
      const [ok, reason] = await core.staticVerify(a, b, c, pub);
      setReplayResult(
        ok
          ? { blocked: false, reason: 'The contract accepted it — replay protection is NOT working.' }
          : { blocked: true, reason },
      );
    } catch (err) {
      setReplayResult({ blocked: true, reason: decodeContractError(err).title });
    } finally {
      setReplaying(false);
    }
  }, [ethereum, proof]);

  if (state.loading) {
    return (
      <div className="page page-wide">
        <div className="card card-wide">
          <Skeleton lines={5} />
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="page page-wide">
        <div className="card card-wide">
          <h2>Could not read the chain</h2>
          <ErrorPanel error={state.error} onAction={refresh} />
        </div>
      </div>
    );
  }

  if (!state.verified) {
    const expired = state.attestation && state.attestation.validUntil > 0n;
    return (
      <div className="page page-wide">
        <div className="card card-wide fade-in">
          <h2>Restricted area</h2>
          <p className="page-subtitle">
            {expired
              ? 'Your attestation has expired. Generate a fresh proof to regain access.'
              : 'This area is gated by an on-chain age attestation, which this account does not hold.'}
          </p>
          <div className="notice notice-info">
            <strong className="notice-title">The gate is on-chain</strong>
            <p className="notice-message">
              Access is decided by <code className="mono">VeritasCore.isVerified()</code>, read
              directly from the blockchain. There is no client-side flag to flip.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-full" onClick={() => navigate('/prove')}>
            Prove your age →
          </button>
        </div>
      </div>
    );
  }

  const validUntil = new Date(Number(state.attestation.validUntil) * 1000);

  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <div className="verified-banner" role="status">
          <span className="verified-icon" aria-hidden="true">
            ✓
          </span>
          <div className="verified-text">
            <h2 className="verified-title">Age verified — welcome</h2>
            <p className="verified-subtitle">
              Confirmed on-chain. Your birth date was never disclosed.
            </p>
          </div>
        </div>

        <Panel title="Attestation">
          <dl className="proof-dl">
            <DataRow label="Account">
              <Hash value={address} label="address" />
            </DataRow>
            <DataRow label="Proven age">{String(state.attestation.minAge)}+</DataRow>
            <DataRow label="Valid until">{validUntil.toLocaleString()}</DataRow>
            <DataRow label="Epoch">{String(state.attestation.epoch)}</DataRow>
            {receipt && (
              <>
                <DataRow label="Transaction">
                  <Hash value={receipt.hash} label="transaction hash" href={txUrl(receipt.hash)} />
                </DataRow>
                <DataRow label="Block">{String(receipt.blockNumber)}</DataRow>
                <DataRow label="Gas used">
                  {Number(receipt.gasUsed).toLocaleString()}{' '}
                  <span className="text-dim">of a 300,000 budget</span>
                </DataRow>
              </>
            )}
          </dl>
        </Panel>

        <div className="platform-content panel">
          <h3 className="platform-content-title">Age-restricted content</h3>
          <p className="platform-content-body">
            You are through the gate. A relying party learned exactly one fact about you — that you
            are old enough — and nothing else. No birth date, no document, no identity.
          </p>
          <div className="platform-features">
            <div className="feature-chip">🔐 Nothing revealed</div>
            <div className="feature-chip">⛓ Verified on-chain</div>
            <div className="feature-chip">🛡 Zero knowledge</div>
          </div>
        </div>

        {proof && (
          <Panel title="Try to break it">
            <p>
              Replay protection only means something if you can watch it work. This resubmits the
              exact proof that just succeeded.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-full"
              onClick={attemptReplay}
              disabled={replaying}
            >
              {replaying ? 'Attempting…' : 'Attempt a replay attack'}
            </button>
            {replayResult && (
              <div
                className={`notice notice-${replayResult.blocked ? 'success' : 'error'}`}
                role="status"
              >
                <strong className="notice-title">
                  {replayResult.blocked ? 'Blocked ✓' : 'NOT BLOCKED'}
                </strong>
                <p className="notice-message">
                  {replayResult.blocked
                    ? `The contract rejected it: ${replayResult.reason}. The nullifier from this proof is already spent.`
                    : replayResult.reason}
                </p>
              </div>
            )}
          </Panel>
        )}

        <button
          type="button"
          className="btn btn-outline btn-full"
          onClick={() => {
            reset();
            navigate('/prove');
          }}
        >
          ↩ Start over
        </button>
      </div>
    </div>
  );
}
