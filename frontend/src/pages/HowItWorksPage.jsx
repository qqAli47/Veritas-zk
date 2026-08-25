/**
 * The explainer.
 *
 * Needs no wallet and no contracts, so it is also the fallback if the network
 * misbehaves during a live demonstration.
 */
export default function HowItWorksPage() {
  return (
    <div className="page page-wide">
      <div className="card card-wide fade-in prose">
        <h2>
          <span className="page-title-icon" aria-hidden="true">
            📖
          </span>
          How Veritas works
        </h2>

        {/* ── The problem ────────────────────────────────────────────── */}
        <section className="section">
          <h3>The problem</h3>
          <div className="split-grid">
            <div className="split-col split-bad">
              <h4>Showing your ID</h4>
              <p>
                You hand over a document containing your full birth date, your name, your photo and
                a document number — to prove a single yes/no fact. The verifier now holds data it
                never needed, for as long as it keeps records.
              </p>
            </div>
            <div className="split-col split-good">
              <h4>Veritas</h4>
              <p>
                You hand over a mathematical proof that the statement <em>&ldquo;my age is at
                least 18&rdquo;</em> is true. The verifier can check it, and learns nothing else —
                not your birth year, not your name, not even which credential you used.
              </p>
            </div>
          </div>
        </section>

        {/* ── The flow ───────────────────────────────────────────────── */}
        <section className="section">
          <h3>The flow</h3>
          <ol className="flow-list">
            <li>
              <strong>Issue.</strong> You generate a random <em>secret</em> on your own device and
              compute <code className="mono">commitment = Poseidon(birthYear, secret)</code>. The
              issuer receives only that commitment and publishes it. It never learns your secret —
              if it did, it could recognise every future verification you make.
            </li>
            <li>
              <strong>Prove.</strong> Your browser builds a Groth16 proof that you know a
              <em> birthYear</em> and <em>secret</em> which both open the published commitment and
              satisfy the age threshold. This takes about a second and happens entirely locally.
            </li>
            <li>
              <strong>Verify.</strong> The contract checks the proof with an elliptic-curve pairing,
              confirms the credential is registered and unrevoked, confirms the nullifier is unspent,
              and records an attestation for you.
            </li>
            <li>
              <strong>Access.</strong> A relying party asks the contract{' '}
              <code className="mono">isVerifiedAtLeast(you, 18)</code>. One boolean, no personal
              data, no integration with Veritas beyond a single interface.
            </li>
          </ol>
        </section>

        {/* ── The circuit ────────────────────────────────────────────── */}
        <section className="section">
          <h3>What the circuit actually proves</h3>
          <p>
            A circuit is a system of algebraic constraints. A proof exists only if every constraint
            is satisfiable, so each line below is a claim the prover cannot avoid making:
          </p>
          <pre className="code-block mono">{`Poseidon(birthYear, secret) === commitment   // you hold a real credential
Poseidon(secret, context)   === nullifier    // single-use, scoped to this context
birthYear                    < 2^16          // a genuine integer, not a wrapped field element
birthYear                   <= currentYear   // no future birthdays
currentYear - birthYear     >= threshold     // the actual claim
packed                       < 2^192         // binds the beneficiary address`}</pre>
          <p>
            The third line looks pedantic and is the most important. Circuit values are elements of
            a finite field, not integers. Without it, a prover could supply{' '}
            <code className="mono">birthYear = p − k</code> so that the subtraction wraps around the
            field and yields whatever age they wanted. Widening the comparator would not have helped;
            constraining the input to 16 real bits does.
          </p>
        </section>

        {/* ── The public/private split ───────────────────────────────── */}
        <section className="section">
          <h3>What is public, and what is not</h3>
          <div className="privacy-ledger">
            <div className="ledger-col ledger-private">
              <h4>Never leaves your device</h4>
              <ul>
                <li>Your birth year</li>
                <li>Your secret</li>
                <li>The witness</li>
              </ul>
            </div>
            <div className="ledger-col ledger-public">
              <h4>Published forever</h4>
              <ul>
                <li>A commitment hash</li>
                <li>A nullifier hash</li>
                <li>The context identifier</li>
                <li>The threshold and reference year</li>
                <li>Your wallet address</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── Design decisions ───────────────────────────────────────── */}
        <section className="section">
          <h3>Three decisions worth explaining</h3>

          <div className="callout callout-info">
            <strong>Why every parameter is a public signal</strong>
            <p>
              A zk-SNARK proves a computation ran correctly on inputs the prover chose — it says
              nothing about whether those were the <em>right</em> inputs. So the threshold, the
              reference year, the context and the beneficiary are all public, which lets the contract
              check each against state the prover does not control. Leave the threshold unchecked and
              a prover submits <code className="mono">threshold = 0</code>; leave the year unchecked
              and they submit <code className="mono">3000</code>.
            </p>
          </div>

          <div className="callout callout-info">
            <strong>Why the nullifier is scoped to a context</strong>
            <p>
              A nullifier of <code className="mono">Poseidon(secret, secret)</code> would be simpler,
              and would burn the credential permanently on first use while acting as a stable
              cross-site tracking handle. Deriving it from{' '}
              <code className="mono">Poseidon(secret, context)</code> instead keeps it single-use
              within one relying party and one time period, while remaining unlinkable across them.
            </p>
          </div>

          <div className="callout callout-info">
            <strong>Why the proof names its beneficiary</strong>
            <p>
              A proof sitting in the mempool is a bearer token: anyone can copy it and submit it
              first. Committing to the beneficiary&rsquo;s address inside the circuit makes a stolen
              proof worthless — a thief can only pay gas to deliver the victim their own attestation.
              The same property lets a relayer sponsor the transaction for someone with no ETH.
            </p>
          </div>
        </section>

        {/* ── Honest limitations ─────────────────────────────────────── */}
        <section className="section">
          <h3>What this does not solve</h3>
          <div className="callout callout-warn">
            <ul>
              <li>
                <strong>The issuer is trusted.</strong> Nothing here stops an authority issuing a
                false credential. Veritas removes the need to <em>show</em> your identity, not the
                need to establish it once.
              </li>
              <li>
                <strong>Credentials are transferable.</strong> Whoever holds the secret can prove
                that age. Binding a credential to a person needs biometrics or a hardware element,
                both out of scope.
              </li>
              <li>
                <strong>Revocation has latency.</strong> Revoking a credential does not cancel an
                attestation already granted from it; that window lasts at most one epoch.
              </li>
              <li>
                <strong>The trusted setup is inherited, not ceremonial.</strong> Phase 1 uses the
                Hermez transcript with 54 independent contributors. Phase 2 was performed by this
                project alone, so a production deployment would need a real multi-party ceremony.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
