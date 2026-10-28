import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../providers/WalletProvider.jsx';
import { useCredential } from '../providers/CredentialProvider.jsx';
import { useSession } from '../providers/SessionProvider.jsx';
import { useToast } from '../providers/ToastProvider.jsx';
import { prover, assertSignalShape } from '../zk/proverClient.js';
import { computeCommitment } from '../zk/poseidon.js';
import { pack, toDec, shorten } from '../zk/field.js';
import {
  SELECTABLE_REGIONS,
  anonymitySetSize,
  describeMask,
  groupedRegions,
  maskAllows,
  regionByBit,
} from '../zk/regions.js';
import { readCore, readRegistry, writeCore } from '../contracts/clients.js';
import { decodeContractError, decodeProofError } from '../contracts/errors.js';
import {
  DataRow,
  Dropzone,
  ErrorPanel,
  Hash,
  Panel,
  ProgressBar,
  Select,
  Stepper,
} from '../components/primitives.jsx';

const STEPS = ['Credential', 'Generate proof', 'Verify on-chain'];

export default function ProvePage() {
  const navigate = useNavigate();
  const { address, ethereum } = useWallet();
  const { credential, importFromJson, error: credError, load, clear } = useCredential();
  const { proof, setProof, setReceipt, proveMs, setProveMs } = useSession();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [params, setParams] = useState(null);
  const [registered, setRegistered] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // Manual-entry fields
  const [manualYear, setManualYear] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [manualRegion, setManualRegion] = useState(String(SELECTABLE_REGIONS[0].bit));

  // Start downloading the circuit artifacts immediately, so pressing
  // "Generate" begins proving rather than begins fetching 2 MB.
  useEffect(() => {
    prover.warm();
    return () => abortRef.current?.abort();
  }, []);

  // Fetch the policy parameters in one call, so the proof cannot be built
  // against a half-stale mixture of values.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [context, epoch, year, minAge, allowedRegions] =
          await readCore().proverParams();
        if (!cancelled) {
          setParams({
            context,
            epoch,
            year: Number(year),
            minAge: Number(minAge),
            allowedRegions: BigInt(allowedRegions),
          });
        }
      } catch (err) {
        if (!cancelled) setError(decodeContractError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Check registration as soon as a credential is loaded — a free, instant
  // check that saves a 1-second proof and a reverted transaction.
  useEffect(() => {
    let cancelled = false;
    if (!credential) {
      setRegistered(null);
      return undefined;
    }
    (async () => {
      try {
        const valid = await readRegistry().isValid(credential.commitment);
        if (!cancelled) setRegistered(valid);
      } catch {
        if (!cancelled) setRegistered(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credential]);

  const onFile = useCallback(
    async (file) => {
      if (!file) return;
      const text = await file.text();
      const cred = importFromJson(text);
      if (cred) {
        setStep(1);
        toast.success('Credential loaded', `Commitment ${shorten(cred.commitment, 8, 6)}`);
      }
    },
    [importFromJson, toast],
  );

  const onManualSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        const commitment = await computeCommitment(manualYear, manualRegion, manualSecret);
        const r = regionByBit(manualRegion);
        load({
          birthYear: Number(manualYear),
          region: { bit: Number(manualRegion), code: r?.code, name: r?.name },
          secret: manualSecret,
          commitment,
          issuer: null,
        });
        setStep(1);
      } catch (err) {
        setError(decodeProofError(err));
      }
    },
    [manualYear, manualRegion, manualSecret, load],
  );

  // ── Step 2: generate the proof ──────────────────────────────────────────
  const generate = useCallback(async () => {
    setError(null);

    /*
     * Check eligibility BEFORE proving. Without this the holder waits a second
     * for witness generation to fail with `Assert Failed. Error in template
     * Decoder_...`, which says nothing useful. The allowlist is public policy
     * and the region never leaves this device, so the check leaks nothing.
     */
    if (!maskAllows(params.allowedRegions, credential.region.bit)) {
      setError({
        code: 'REGION_NOT_ELIGIBLE',
        tone: 'error',
        title: 'This verifier does not accept your region',
        message:
          `Your credential was issued for ${credential.region.name}. This verifier accepts: ` +
          `${describeMask(params.allowedRegions)}.`,
        hint: 'Nothing was sent and no gas was spent.',
      });
      return;
    }

    setBusy(true);
    setProgress({ label: 'Preparing', ratio: 0 });

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const input = {
        context: toDec(params.context),
        packed: pack(address, params.year, params.minAge, params.allowedRegions).toString(),
        birthYear: String(credential.birthYear), // private
        regionCode: String(credential.region.bit), // private
        secret: toDec(credential.secret), // private
      };

      const result = await prover.prove(input, {
        signal: ac.signal,
        onProgress: (p) => {
          if (p.stage === 'download') {
            setProgress({
              label: p.cached ? `${p.label} (cached)` : `Downloading ${p.label}`,
              // Downloading occupies the first 30% of the bar.
              ratio: p.ratio == null ? null : p.ratio * 0.3,
              detail:
                p.total && !p.cached
                  ? `${(p.loaded / 1e6).toFixed(1)} / ${(p.total / 1e6).toFixed(1)} MB`
                  : null,
            });
          } else if (p.stage === 'witness') {
            setProgress({ label: 'Computing witness', ratio: 0.35 });
          } else if (p.stage === 'verify-local') {
            setProgress({ label: 'Verifying locally', ratio: 0.98 });
          } else {
            setProgress({ label: 'Generating Groth16 proof', ratio: p.ratio ?? null });
          }
        },
      });

      assertSignalShape(result.publicSignals);
      if (!result.locallyValid) {
        throw new Error(
          'The proof failed local verification — the proving key and verification key are out of sync.',
        );
      }

      setProof(result);
      setProveMs(result.proveMs);
      setProgress(null);
      setStep(2);
      toast.success('Proof generated', `Took ${result.proveMs} ms, verified locally.`);
    } catch (err) {
      const decoded = decodeProofError(err);
      setProgress(null);
      if (decoded.code !== 'CANCELLED') {
        setError(decoded);
        toast.error(decoded.title, decoded.message);
      }
    } finally {
      setBusy(false);
    }
  }, [address, credential, params, setProof, setProveMs, toast]);

  // ── Step 3: submit on-chain ─────────────────────────────────────────────
  const verify = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const core = await writeCore(ethereum);
      const { a, b, c, pub } = proof.calldata;

      // Simulate before signing. Any policy failure surfaces here, precisely
      // named, with no gas spent and no wallet warning banner.
      const [ok, reason] = await core.staticVerify(a, b, c, pub);
      if (!ok) {
        const err = new Error(reason);
        err.reason = reason;
        throw Object.assign(err, { revert: { name: mapReason(reason), args: [] } });
      }

      const tx = await core.verifyAge(a, b, c, pub);
      toast.info('Transaction submitted', shorten(tx.hash, 10, 8));
      const receipt = await tx.wait();

      setReceipt({
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });
      toast.success('Verified on-chain', `${receipt.gasUsed.toLocaleString()} gas`);
      navigate('/restricted');
    } catch (err) {
      const decoded = decodeContractError(err);
      setError(decoded);
      toast.error(decoded.title, decoded.message);
    } finally {
      setBusy(false);
    }
  }, [ethereum, proof, navigate, setReceipt, toast]);

  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <h2>
          <span className="page-title-icon" aria-hidden="true">
            🛡
          </span>
          Prove your attributes
        </h2>
        <p className="page-subtitle">
          Your birth year, region and secret never leave this browser. Only a proof and four
          public values are sent anywhere.
        </p>

        <Stepper steps={STEPS} current={step} />
        <div className="divider" />

        {/* ── Step 1 ──────────────────────────────────────────────────── */}
        {step === 0 && (
          <section aria-label="Load your credential">
            <Panel title="Import a credential file">
              <Dropzone
                accept="application/json,.json"
                onFile={onFile}
                title="Drop your credential here, or click to browse"
                hint="The .json file the issuer produced — it holds your birth year, region and secret"
              />
            </Panel>

            <p className="or-divider">or enter the values directly</p>

            <form onSubmit={onManualSubmit} autoComplete="off">
              <div className="form-group">
                <label className="label-private" htmlFor="mYear">
                  <span aria-hidden="true">🔒</span> Birth year
                </label>
                <input
                  id="mYear"
                  type="number"
                  min="1900"
                  value={manualYear}
                  onChange={(e) => setManualYear(e.target.value)}
                  required
                />
              </div>
              <Select
                label="Region"
                value={manualRegion}
                onChange={(e) => setManualRegion(e.target.value)}
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
                <label className="label-private" htmlFor="mSecret">
                  <span aria-hidden="true">🔒</span> Secret
                </label>
                <input
                  id="mSecret"
                  type="password"
                  value={manualSecret}
                  onChange={(e) => setManualSecret(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-full">
                Load credential
              </button>
            </form>

            {credError && <ErrorPanel error={{ title: 'Could not load', message: credError }} />}
          </section>
        )}

        {/* ── Step 2 ──────────────────────────────────────────────────── */}
        {step === 1 && credential && (
          <section aria-label="Generate a proof">
            <Panel title="Credential">
              <dl className="proof-dl">
                <DataRow label="Commitment">
                  <Hash value={credential.commitment} label="commitment" />
                </DataRow>
                <DataRow label="Region">{credential.region?.name ?? '—'}</DataRow>
                <DataRow label="Registered">
                  {registered === null ? (
                    'checking…'
                  ) : registered ? (
                    <span className="proof-status-ok">✓ valid on-chain</span>
                  ) : (
                    <span className="status-bad">✕ not registered</span>
                  )}
                </DataRow>
              </dl>
            </Panel>

            {registered === false && (
              <ErrorPanel
                error={{
                  title: 'This credential is not registered',
                  message:
                    'No issuer has registered this commitment on the current network, or it has been revoked.',
                  hint: 'Issue one from the Issuer console first.',
                  action: 'goto-issuer',
                }}
                onAction={() => navigate('/issuer')}
              />
            )}

            {params && <AnonymitySet mask={params.allowedRegions} />}

            <PrivacyLedger params={params} address={address} />

            {progress && (
              <ProgressBar label={progress.label} ratio={progress.ratio} detail={progress.detail} />
            )}

            <ErrorPanel error={error} />

            <div className="button-row">
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={generate}
                disabled={busy || !params || registered === false}
              >
                {busy ? 'Generating…' : 'Generate proof'}
              </button>
              {busy && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-outline btn-full"
              onClick={() => {
                clear();
                setStep(0);
              }}
              disabled={busy}
            >
              Use a different credential
            </button>
          </section>
        )}

        {/* ── Step 3 ──────────────────────────────────────────────────── */}
        {step === 2 && proof && (
          <section aria-label="Verify on-chain">
            <div className="status-badge status-success">
              <span>Proof generated in {proveMs} ms — verified locally ✓</span>
            </div>

            <Panel title="What will be published">
              <dl className="proof-dl">
                <DataRow label="Commitment">
                  <Hash value={proof.publicSignals[0]} label="commitment" />
                </DataRow>
                <DataRow label="Nullifier">
                  <Hash value={proof.publicSignals[1]} label="nullifier" />
                </DataRow>
                <DataRow label="Context">
                  <Hash value={proof.publicSignals[2]} label="context" />
                </DataRow>
                <DataRow label="Beneficiary">
                  <Hash value={address} label="address" />
                </DataRow>
              </dl>
              <p className="preview-note">
                Notice what is absent: your birth year and your secret. The contract learns only
                that <em>some</em> birth year meeting the threshold opens a registered commitment.
              </p>
            </Panel>

            <details className="disclosure">
              <summary>Inspect the raw proof</summary>
              <pre className="code-block mono">{JSON.stringify(proof.proof, null, 2)}</pre>
            </details>

            <ErrorPanel error={error} onAction={() => setStep(1)} />

            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={verify}
              disabled={busy}
            >
              {busy ? 'Waiting for confirmation…' : 'Verify on-chain'}
            </button>
            <p className="text-dim center">
              This is a state-changing transaction (~297,300 gas) and needs a wallet signature.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/** Map staticVerify's tag onto the corresponding custom error name. */
function mapReason(reason) {
  return (
    {
      PAUSED: 'EnforcedPause',
      MALFORMED_PACKED: 'MalformedPublicInput',
      ZERO_SUBJECT: 'ZeroSubject',
      THRESHOLD_BELOW_POLICY: 'ThresholdBelowPolicy',
      YEAR_IN_FUTURE: 'YearInFuture',
      YEAR_STALE: 'YearStale',
      BAD_CONTEXT: 'BadContext',
      REGION_MASK_STALE: 'RegionMaskMismatch',
      COMMITMENT_NOT_VALID: 'CommitmentNotValid',
      NULLIFIER_USED: 'NullifierAlreadyUsed',
      INVALID_PROOF: 'InvalidProof',
    }[reason] ?? reason
  );
}

/**
 * The honest disclosure.
 *
 * A membership proof reveals "the holder is in one of these N regions", so N
 * IS the anonymity set. At N = 1 the proof reveals the region exactly — which
 * is inherent to set membership, not a bug, and the user deserves to know
 * before they commit to proving anything.
 */
function AnonymitySet({ mask }) {
  const n = anonymitySetSize(mask);
  const weak = n <= 2;

  return (
    <div className={`notice notice-${weak ? 'warn' : 'info'}`} role="status">
      <strong className="notice-title">
        {weak
          ? `This proof narrows you to ${n === 1 ? 'a single region' : `${n} regions`}`
          : `This proof narrows you to 1 of ${n} regions`}
      </strong>
      <p className="notice-message">
        The verifier will learn that you are somewhere in: {describeMask(mask)}. It will not
        learn which.
      </p>
      {weak && (
        <p className="notice-hint">
          With so few permitted regions there is little to hide behind — this verifier learns
          almost exactly where you are.
        </p>
      )}
    </div>
  );
}

function PrivacyLedger({ params, address }) {
  return (
    <div className="privacy-ledger">
      <div className="ledger-col ledger-private">
        <h4>Stays in this browser</h4>
        <ul>
          <li>Your birth year</li>
          <li>Your region</li>
          <li>Your secret</li>
          <li>The witness</li>
        </ul>
      </div>
      <div className="ledger-col ledger-public">
        <h4>Published on-chain</h4>
        <ul>
          <li>Commitment hash</li>
          <li>Nullifier hash</li>
          <li>Context {params ? `(epoch ${params.epoch})` : ''}</li>
          <li>Threshold {params ? `(${params.minAge}+)` : ''} and year {params?.year}</li>
          <li>
            The region allowlist
            {params ? ` (${anonymitySetSize(params.allowedRegions)} regions)` : ''}
          </li>
          <li>Your address {address ? shorten(address, 6, 4) : ''}</li>
        </ul>
      </div>
    </div>
  );
}
