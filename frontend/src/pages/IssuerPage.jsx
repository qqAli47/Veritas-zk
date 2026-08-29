import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../providers/WalletProvider.jsx';
import { useToast } from '../providers/ToastProvider.jsx';
import { toCredentialFile } from '../providers/CredentialProvider.jsx';
import { computeCommitment, warmPoseidon } from '../zk/poseidon.js';
import { randomSecret, shorten } from '../zk/field.js';
import { SELECTABLE_REGIONS, groupedRegions, regionByBit } from '../zk/regions.js';
import { readRegistry, writeRegistry } from '../contracts/clients.js';
import { decodeContractError } from '../contracts/errors.js';
import { CONTRACTS, txUrl } from '../contracts/config.js';
import { DataRow, ErrorPanel, Hash, Panel, Select } from '../components/primitives.jsx';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * The issuer console — a stand-in for a government identity authority.
 *
 * NOTE ON WHERE THE SECRET IS CREATED
 *
 * The secret is generated in this browser and stays here. What goes on-chain,
 * and what an issuer ever sees, is the commitment alone.
 *
 * This is not a detail. An issuer who learned a holder's secret could compute
 * every nullifier that holder will ever produce, and so link all of their
 * future verifications across every relying party — and could impersonate them
 * outright. A design where the issuer picks the secret would look identical on
 * screen and be quietly broken.
 *
 * In a production system this page would be split: the holder's device
 * generates the secret and sends only the commitment. Here both roles share a
 * browser for demonstration, and the flow still respects the direction of
 * information.
 */
export default function IssuerPage() {
  const { address, ethereum } = useWallet();
  const toast = useToast();

  const [birthYear, setBirthYear] = useState('2000');
  const [regionBit, setRegionBit] = useState(String(SELECTABLE_REGIONS[0].bit));
  const [secret, setSecret] = useState('');
  const [revealSecret, setRevealSecret] = useState(false);
  const [commitment, setCommitment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);
  const [isIssuer, setIsIssuer] = useState(null);

  useEffect(() => {
    warmPoseidon();
  }, []);

  // Check the connected account actually holds ISSUER_ROLE, so we can explain
  // a permission failure before the user pays for a reverted transaction.
  useEffect(() => {
    let cancelled = false;
    if (!address || !CONTRACTS.registry) return undefined;
    (async () => {
      try {
        const reg = readRegistry();
        const role = await reg.ISSUER_ROLE();
        const has = await reg.hasRole(role, address);
        if (!cancelled) setIsIssuer(has);
      } catch {
        if (!cancelled) setIsIssuer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Live commitment preview as the operator types.
  useEffect(() => {
    let cancelled = false;
    if (!birthYear || !secret) {
      setCommitment(null);
      return undefined;
    }
    (async () => {
      try {
        const c = await computeCommitment(birthYear, regionBit, secret);
        if (!cancelled) setCommitment(c);
      } catch {
        if (!cancelled) setCommitment(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [birthYear, regionBit, secret]);

  const generateSecret = useCallback(() => {
    setSecret(randomSecret().toString());
    setRevealSecret(false);
  }, []);

  const register = useCallback(
    async (e) => {
      e.preventDefault();
      setError(null);

      const year = Number(birthYear);
      if (!Number.isInteger(year) || year < 1900 || year > CURRENT_YEAR) {
        setError({ title: 'Invalid birth year', message: `Enter a year between 1900 and ${CURRENT_YEAR}.` });
        return;
      }
      if (!secret) {
        setError({ title: 'No secret', message: 'Generate a secret before issuing.' });
        return;
      }

      setBusy(true);
      try {
        const registry = await writeRegistry(ethereum);
        // Simulate first: a revert surfaces here with its exact custom error,
        // costs nothing, and avoids the wallet's alarming "likely to fail"
        // warning.
        await registry.registerCommitment.staticCall(commitment, 0n);

        const tx = await registry.registerCommitment(commitment, 0n);
        const receipt = await tx.wait();

        const credential = {
          birthYear: year,
          region: {
            bit: Number(regionBit),
            code: regionByBit(regionBit).code,
            name: regionByBit(regionBit).name,
          },
          secret,
          commitment,
          issuer: address,
          issuedAt: new Date().toISOString(),
          txHash: receipt.hash,
        };
        setIssued({ credential, receipt });
        toast.success('Credential issued', `Registered in block ${receipt.blockNumber}.`);
      } catch (err) {
        const decoded = decodeContractError(err);
        setError(decoded);
        toast.error(decoded.title, decoded.message);
      } finally {
        setBusy(false);
      }
    },
    [address, birthYear, regionBit, commitment, ethereum, secret, toast],
  );

  const download = useCallback(() => {
    const file = toCredentialFile(issued.credential);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas-credential-${shorten(issued.credential.commitment, 6, 4)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [issued]);

  const reset = () => {
    setIssued(null);
    setSecret('');
    setCommitment(null);
    setError(null);
  };

  // ── Issued view ─────────────────────────────────────────────────────────
  if (issued) {
    return (
      <div className="page page-wide">
        <div className="card card-wide fade-in">
          <h2>
            <span className="page-title-icon" aria-hidden="true">
              ✓
            </span>
            Credential issued
          </h2>
          <p className="page-subtitle">
            The commitment is now on-chain. The holder needs the file below to prove anything.
          </p>

          <Panel title="Credential">
            <dl className="proof-dl">
              <DataRow label="Commitment">
                <Hash value={issued.credential.commitment} label="commitment" />
              </DataRow>
              <DataRow label="Region">{issued.credential.region.name}</DataRow>
              <DataRow label="Transaction">
                <Hash
                  value={issued.receipt.hash}
                  label="transaction hash"
                  href={txUrl(issued.receipt.hash)}
                />
              </DataRow>
              <DataRow label="Block">{String(issued.receipt.blockNumber)}</DataRow>
              <DataRow label="Gas used">{issued.receipt.gasUsed.toLocaleString()}</DataRow>
            </dl>
          </Panel>

          <div className="notice notice-warn">
            <strong className="notice-title">This file is the credential</strong>
            <p className="notice-message">
              It contains the private secret. Anyone who holds it can prove this age as the holder.
              Nothing on-chain can be used to recover it, and nothing here is stored by the app —
              if it is lost, the credential must be reissued.
            </p>
          </div>

          <button type="button" className="btn btn-primary btn-full" onClick={download}>
            Download credential (.json)
          </button>
          <button type="button" className="btn btn-outline btn-full" onClick={reset}>
            Issue another
          </button>
        </div>
      </div>
    );
  }

  // ── Issuing form ────────────────────────────────────────────────────────
  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <h2>
          <span className="page-title-icon" aria-hidden="true">
            🏛
          </span>
          Issuer console
        </h2>
        <p className="page-subtitle">
          Standing in for a government identity authority: register a credential commitment so its
          holder can later prove their age without revealing it.
        </p>

        {isIssuer === false && (
          <div className="notice notice-warn">
            <strong className="notice-title">This account cannot issue</strong>
            <p className="notice-message">
              {shorten(address, 6, 4)} does not hold <code className="mono">ISSUER_ROLE</code> on
              the registry. That restriction is the point: if anyone could register a commitment,
              anyone could mint themselves a credential and the trusted-issuer model would be
              meaningless.
            </p>
          </div>
        )}

        <div className="divider" />

        <form onSubmit={register} autoComplete="off">
          <div className="form-group">
            <label className="label-private" htmlFor="birthYear">
              <span aria-hidden="true">🔒</span> Birth year
            </label>
            <input
              id="birthYear"
              type="number"
              min="1900"
              max={CURRENT_YEAR}
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              disabled={busy}
              required
            />
          </div>

          <Select
            label="Region of residence"
            value={regionBit}
            onChange={(e) => setRegionBit(e.target.value)}
            disabled={busy}
            hint="Attesting this is a heavier obligation than attesting a birth year — it needs proof of address, not just a passport."
          >
            {groupedRegions().map(([group, regions]) => (
              <optgroup key={group} label={group}>
                {regions.map((r) => (
                  <option key={r.bit} value={r.bit}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>

          <div className="form-group">
            <label className="label-private" htmlFor="secret">
              <span aria-hidden="true">🔒</span> Secret
            </label>
            <div className="input-row">
              <input
                id="secret"
                type={revealSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Generate a cryptographically random secret"
                disabled={busy}
                autoComplete="off"
                required
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setRevealSecret((v) => !v)}
                aria-label={revealSecret ? 'Hide the secret' : 'Reveal the secret'}
              >
                {revealSecret ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={generateSecret}
              disabled={busy}
            >
              Generate secure secret
            </button>
          </div>

          <Panel title="Commitment preview" className="commitment-preview">
            <p className="preview-formula mono">Poseidon(birthYear, region, secret)</p>
            {commitment ? (
              <Hash value={commitment} label="commitment" lead={14} tail={10} />
            ) : (
              <p className="text-dim">Enter a birth year and secret to compute the commitment.</p>
            )}
            <p className="preview-note">
              Only this value is published. The birth year, region and secret stay in this
              browser.
            </p>
          </Panel>

          <ErrorPanel error={error} />

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={busy || !commitment || isIssuer === false}
          >
            {busy ? 'Registering…' : 'Register commitment on-chain'}
          </button>
        </form>
      </div>
    </div>
  );
}
