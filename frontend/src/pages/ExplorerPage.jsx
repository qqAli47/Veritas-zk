import { useCallback, useEffect, useState } from 'react';
import { readCore, readProvider, readRegistry } from '../contracts/clients.js';
import { CONTRACTS, DEPLOY_BLOCK, NETWORK_NAME, addressUrl, txUrl } from '../contracts/config.js';
import { EmptyState, Hash, Panel, Skeleton } from '../components/primitives.jsx';
import { anonymitySetSize, describeMask } from '../zk/regions.js';

/**
 * A public view of everything Veritas puts on-chain.
 *
 * This page is the transparency argument made concrete: the registry is a
 * public list of hashes and the nullifier set is a public list of spent
 * tokens, and neither reveals a birth date, a name, or a document. It reads
 * through a plain RPC provider, so it works with no wallet connected at all.
 */
export default function ExplorerPage() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(async () => {
    setState({ loading: true });
    try {
      const registry = readRegistry();
      const core = readCore();
      const provider = readProvider();
      const latest = await provider.getBlockNumber();

      // Public RPC endpoints cap eth_getLogs ranges, so walk in windows.
      const logs = await queryInChunks(
        registry,
        registry.filters.CommitmentRegistered(),
        DEPLOY_BLOCK,
        latest,
      );
      const verifications = await queryInChunks(
        core,
        core.filters.AgeVerified(),
        DEPLOY_BLOCK,
        latest,
      );
      const revocations = await queryInChunks(
        registry,
        registry.filters.CommitmentRevoked(),
        DEPLOY_BLOCK,
        latest,
      );

      const revoked = new Set(revocations.map((l) => String(l.args.commitment)));
      const [totalRegistered, policy] = await Promise.all([
        registry.totalRegistered(),
        core.policy(),
      ]);

      setState({
        loading: false,
        latest,
        totalRegistered: Number(totalRegistered),
        policy,
        commitments: logs.map((l) => ({
          commitment: String(l.args.commitment),
          issuer: l.args.issuer,
          block: l.blockNumber,
          tx: l.transactionHash,
          revoked: revoked.has(String(l.args.commitment)),
        })),
        verifications: verifications.map((l) => ({
          subject: l.args.subject,
          submitter: l.args.submitter,
          minAge: Number(l.args.minAge),
          nullifier: String(l.args.nullifier),
          block: l.blockNumber,
          tx: l.transactionHash,
        })),
      });
    } catch (err) {
      setState({ loading: false, error: err.message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) {
    return (
      <div className="page page-wide">
        <div className="card card-wide">
          <Skeleton lines={6} />
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="page page-wide">
        <div className="card card-wide">
          <h2>Explorer</h2>
          <div className="notice notice-error" role="alert">
            <strong className="notice-title">Could not read the chain</strong>
            <p className="notice-message">{state.error}</p>
          </div>
          <button type="button" className="btn btn-outline btn-full" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in">
        <h2>
          <span className="page-title-icon" aria-hidden="true">
            🔍
          </span>
          Explorer
        </h2>
        <p className="page-subtitle">
          Everything Veritas writes to the blockchain — and nothing else. Look for a birth date;
          there isn&apos;t one.
        </p>

        <div className="stat-grid">
          <Stat label="Network" value={NETWORK_NAME} />
          <Stat label="Credentials issued" value={state.totalRegistered} />
          <Stat label="Verifications" value={state.verifications.length} />
          <Stat label="Minimum age" value={`${state.policy.minAge}+`} />
          <Stat
            label="Regions served"
            value={anonymitySetSize(state.policy.allowedRegions)}
          />
        </div>

        <Panel title="Region policy">
          <p className="text-dim">
            Every proof asserts membership in exactly this set, so its size is the anonymity set
            each holder hides in. The verifier learns a holder is somewhere in it, never where.
          </p>
          <p>{describeMask(state.policy.allowedRegions, 100)}</p>
        </Panel>

        <Panel title="Contracts">
          <dl className="proof-dl">
            {Object.entries(CONTRACTS).map(([name, addr]) => (
              <div className="proof-dl-row" key={name}>
                <dt style={{ textTransform: 'capitalize' }}>{name}</dt>
                <dd>
                  <Hash value={addr} label={`${name} address`} href={addressUrl(addr)} />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={`Registered commitments (${state.commitments.length})`}>
          {state.commitments.length === 0 ? (
            <EmptyState icon="○" title="Nothing registered yet">
              Issue the first credential from the Issuer console.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Commitment</th>
                    <th>Issuer</th>
                    <th>Block</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {state.commitments.map((c) => (
                    <tr key={c.commitment}>
                      <td>
                        <Hash value={c.commitment} label="commitment" />
                      </td>
                      <td>
                        <Hash value={c.issuer} label="issuer" lead={6} tail={4} />
                      </td>
                      <td className="mono">{c.block}</td>
                      <td>
                        <span className={`badge ${c.revoked ? 'badge-red' : 'badge-green'}`}>
                          {c.revoked ? 'Revoked' : 'Valid'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={`Verifications (${state.verifications.length})`}>
          {state.verifications.length === 0 ? (
            <EmptyState icon="○" title="No verifications yet">
              Generate and submit a proof from the Prove page.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Proved</th>
                    <th>Nullifier (spent)</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {state.verifications.map((v) => (
                    <tr key={v.nullifier}>
                      <td>
                        <Hash value={v.subject} label="subject" lead={6} tail={4} />
                      </td>
                      <td>{v.minAge}+</td>
                      <td>
                        <Hash value={v.nullifier} label="nullifier" />
                      </td>
                      <td>
                        <Hash value={v.tx} label="transaction" href={txUrl(v.tx)} lead={6} tail={4} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="notice notice-info">
          <strong className="notice-title">What you cannot find here</strong>
          <p className="notice-message">
            No birth years, no regions, no names, no documents, no ages — only that{' '}
            <em>someone</em> holding a registered credential proved they met a threshold and were
            somewhere in the permitted set. A commitment is a Poseidon hash salted with ~254 bits
            of entropy, so it cannot be brute-forced back to a birth year or a country.
          </p>
        </div>

        <button type="button" className="btn btn-outline btn-full" onClick={load}>
          Refresh
        </button>
      </div>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div className="stat">
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </div>
);

/**
 * Walk a block range in windows.
 *
 * Most public RPC providers reject an eth_getLogs spanning more than a few
 * thousand blocks, so a naive `queryFilter(filter, 0, 'latest')` works against
 * a local node and then fails the moment the app is pointed at Sepolia.
 */
async function queryInChunks(contract, filter, fromBlock, toBlock, span = 9000) {
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += span) {
    const end = Math.min(start + span - 1, toBlock);
    try {
      out.push(...(await contract.queryFilter(filter, start, end)));
    } catch {
      // One bad window should not blank the whole page.
    }
  }
  return out;
}
