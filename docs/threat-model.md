# Veritas-zk — Threat Model

This document is the security argument for the project. It states what the
system defends against, how, and — equally important — what it does not defend
against.

Every mitigation below has a named regression test. The test file and case are
cited so a reader can check the claim rather than take it on trust.

---

## 1. Trust assumptions

The system is only as strong as these. They are assumptions, not guarantees.

| # | Assumption | Consequence if violated |
|---|---|---|
| A1 | The issuer honestly verifies identity before registering a commitment | False credentials enter the system. Veritas removes the need to *show* identity, not the need to *establish* it once. |
| A2 | The holder generates `secret` themselves and never discloses it | An issuer who knows `secret` can compute every nullifier the holder will produce, linking all their verifications, and can impersonate them. |
| A3 | At least one participant in each trusted-setup phase destroyed their randomness | Forged proofs become possible. See §4. |
| A4 | The holder's browser is not compromised | XSS or a malicious extension can read `birthYear` and `secret` from memory. |
| A5 | The chain does not reorg past finality | An attestation could be rolled back. |

---

## 2. Attacks defended against

### T1 — Replay of a valid proof
**Vector.** Capture a successful transaction's calldata and resubmit it, or
share it with someone else.
**Mitigation.** The circuit derives `nullifier = Poseidon(secret, context)` and
`VeritasCore` records every spent nullifier, rejecting any repeat.
**Test.** `tests/VeritasCore.test.js` → *rejects the same proof submitted twice*.
**Residual.** None within a context. Across epochs the credential is reusable by
design — see §3.

### T2 — Proof theft / front-running
**Vector.** Watch the mempool, copy a pending proof, and submit it first.
**Mitigation.** The subject address is packed into a public signal and bound
into the R1CS by `Num2Bits(253)`. `VeritasCore` credits the attestation to the
subject named *inside the proof*, never to `msg.sender`. A thief can only pay
gas to deliver the victim their own attestation.
**Tests.** *credits the attestation to the proof subject, not to the submitter*;
*cannot be redirected by editing the subject in the public signals*.
**Side benefit.** The same property makes relaying safe: a third party can
sponsor gas for a holder who has no ETH.

### T3 — Threshold forgery
**Vector.** `threshold` is a public input the prover chooses. Submit
`threshold = 0` and any age satisfies the comparison.
**Mitigation.** `VeritasCore` rejects any proof whose threshold is below
`policy.minAge`. A *higher* threshold is accepted, being a strictly stronger
claim.
**Test.** *rejects a proof that claims a threshold below policy*.
**Note.** This was exploitable in the original specification.

### T4 — Reference-year forgery
**Vector.** `currentYear` is also prover-chosen. Submit `currentYear = 3000` and
a newborn clears any threshold.
**Mitigation.** The contract derives the year from `block.timestamp` and rejects
any future year. A year in the *past* only makes the prover appear younger, so a
one-year lag is tolerated to avoid a race at the new-year boundary.
**Tests.** *rejects a proof built for a year in the future*; *rejects a proof
whose year lags beyond maxYearLag*.
**Note.** Also exploitable in the original specification.

### T5 — Field-element overflow (circuit soundness)
**Vector.** Circuit signals are BN254 field elements, not integers. Choose
`birthYear = p − k` so `currentYear − birthYear` wraps around the field modulus
and yields any age desired.
**Mitigation.** `Num2Bits(16)` on `birthYear`, on `age`, and via the packed word
on `currentYear` and `threshold`. A value that does not genuinely fit in 16 bits
has no satisfying witness.
**Test.** `tests/circuit.test.js` → *rejects a birth year supplied as a large
field element (the p−k attack)*.
**Note.** The earlier analysis framed this as "age ≥ 256 wraps the 8-bit
comparator". That framing is wrong: the comparator rejects 274 correctly. The
real hole was the unconstrained input, and widening the comparator would not
have closed it.

### T6 — Forged credential
**Vector.** Invent a `birthYear` and `secret` and prove against them.
**Mitigation.** The circuit enforces
`Poseidon(birthYear, regionCode, secret) == commitment`,
and the contract requires that commitment to be registered and unrevoked.
**Test.** *rejects a proof whose commitment was never registered*.
**Residual.** Bounded by A1.

### T7 — Self-issuance
**Vector.** Register your own commitment for a flattering birth year.
**Mitigation.** `registerCommitment` is gated by `ISSUER_ROLE`
(OpenZeppelin `AccessControl`).
**Test.** `tests/CredentialRegistry.test.js` → *rejects registration from a
non-issuer*.

### T8 — Cross-deployment and cross-chain replay
**Vector.** Take a proof valid on one deployment and submit it to another —
plausible where the same bytecode lands at the same address on two chains.
**Mitigation.** `context = keccak256(TAG, chainid, address(this), epoch) >> 8`,
checked exactly.
**Tests.** *rejects a proof built for a different contract address*; *rejects a
proof built for a different chain*.

### T9 — Use of a compromised credential
**Vector.** A credential is leaked or stolen.
**Mitigation.** `revokeCommitment` invalidates it permanently; revocation cannot
be undone.
**Tests.** *rejects a proof after the issuer revokes the credential*; *cannot be
undone*.
**Residual.** Revocation latency — see §3.

### T10 — Client-side gate bypass
**Vector.** Open developer tools and flip whatever flag hides the restricted
page.
**Mitigation.** The gate is `VeritasCore.isVerifiedAtLeast()` read from chain,
and a real relying party enforces it in a `require`. There is no client flag to
flip.
**Test.** `tests/GatedContent.test.js` → *blocks a caller who has not verified*.

### T11 — Malformed public inputs
**Vector.** Hand-craft calldata with out-of-range values to reach an unintended
branch or a silent truncation.
**Mitigation.** `packed >> 253 != 0` is rejected before any cast; commitments at
or above the field order are rejected at registration.
**Tests.** *rejects a packed word with bits above 2^253*; *rejects a zero
subject*; *rejects a commitment at or above the scalar field order*.

### T12 — Location forgery
**Vector.** Claim a region the issuer never attested, to reach a geo-restricted
resource.
**Mitigation.** `regionCode` is a preimage of the commitment
(`Poseidon(birthYear, regionCode, secret)`), so changing it produces a
commitment no issuer registered.
**Test.** `tests/circuit.test.js` → *produces a different commitment for a
different region*; demo step 6.

### T13 — Allowlist substitution (a privacy attack, not an access one)
**Vector.** A malicious relying party asks the holder to prove membership in a
*single* region. The proof is perfectly valid — and reveals the holder's country
exactly, from a flow branded "zero-knowledge".
**Mitigation.** `VeritasCore` pins the mask by **equality**, not subset, so
every prover at a deployment is forced into the same, maximal anonymity set. A
narrowed mask is rejected before the pairing even runs.
**Test.** *rejects a proof built against a different allowlist*.
**Note.** This is the strongest argument for equality-pinning, and it is a
privacy property rather than a soundness one.

### T14 — Bricking a deployment through policy
**Vector.** An operator sets a mask bit at or above the circuit's 61-bit width.
No prover could ever match it, so every verification reverts — with a message
that gives no hint why.
**Mitigation.** `_setPolicy` rejects an empty mask, a mask setting the reserved
bit-0 sentinel, and any mask wider than `N_REGIONS`.
**Tests.** *rejects a policy with a bit above the circuit width*; *rejects a
policy that sets the reserved bit-0 sentinel*.

### T15 — Implementation divergence
**Vector.** Not an attack, but a failure with security consequences: the
browser's Poseidon drifts from the circuit's, so commitments silently stop
matching.
**Mitigation.** `tests/parity.test.js` pins poseidon-lite (browser), circomlibjs
(Node) and the circuit's own output against each other on fixed vectors,
including field-boundary cases.

---

## 3. Accepted residual risks

Stated plainly, because a threat model that claims to close everything is not
credible.

| Risk | Why it is accepted |
|---|---|
| **Credentials are transferable.** Whoever holds the secret can prove that age. | Binding a credential to a person needs biometrics or secure hardware. Out of scope, and it would not be zero-knowledge. |
| **Revocation latency.** Revoking a commitment does not cancel an attestation already granted from it. | Bounded by one epoch (30 days by default). `revokeAttestation()` is the manual override. |
| **The issuer is a single point of trust.** | Deliberate for this project. A production system would use multiple issuers or a threshold scheme. |
| **The issuer's KYC burden grew.** Attesting a birth year needs a passport; attesting a region needs proof of address. | A1 is now doing strictly more work. Named here rather than left implicit. |
| **The anonymity set is only as large as the policy.** A deployment permitting one region reveals every holder's location. | Inherent to set membership. Surfaced in the UI before the user proves, rather than banned — a single-region gate is a legitimate deployment. |
| **Epoch-boundary race.** A proof built in epoch *N* and mined in *N+1* reverts with `BadContext`. | A few seconds once a month. Accepting the previous epoch was considered and rejected: the resulting attestation would already have expired. |
| **Year approximation.** `AVG_YEAR_SECONDS` tracks 1 January to within about half a day. | `maxYearLag` already tolerates a year of slack; `yearOverride` is the escape hatch. |
| **Anonymity-set size.** With few registered credentials, timing can narrow down who verified. | Inherent to any such system; it improves as the registry grows. |
| **XSS would defeat everything.** | True of any client-side cryptography. Mitigated by having no third-party scripts and no persistence of secrets. |

---

## 4. The trusted setup

Groth16 needs a circuit-specific structured reference string. Anyone who
retains the randomness used to generate it ("toxic waste") can forge proofs for
that circuit.

**Phase 1 (universal).** We use the Hermez `powersOfTau28_hez_final_12`
transcript — a perpetual ceremony with 54 independent contributors. It is secure
if *any one* of them was honest. We generate nothing ourselves here, which is
the point: a locally generated phase 1 would have exactly one participant, us,
and would be worthless as a security claim.

**Phase 2 (circuit-specific).** Performed by this project, with entropy from the
OS CSPRNG, never a hardcoded string. The earlier pipeline used the literal
`"veritas-zk-dev"`, which meant anyone reading the repository could reconstruct
the toxic waste and forge proofs.

**Honest limitation.** Phase 2 has a single contributor. A production deployment
would need a multi-party ceremony with published attestations. This is stated in
the report rather than glossed over — and if the offline fallback path in
`scripts/zk/build.mjs` is ever taken, it prints a warning saying exactly this.

---

## 5. What an observer actually learns

From the complete public record, an observer can determine:

- how many credentials exist, and when each was registered;
- that a particular address holds an attestation, for what minimum age, and
  against which region allowlist;
- that some credential was used in some context;
- **which commitment was used**, and therefore **that two verifications came
  from the same credential** — see the correction below.

They cannot determine:

- any birth year, or anyone's age beyond "at least the threshold";
- any holder's region beyond "one of the N the policy permits";
- anything linking a commitment to a person, *unless they already know that
  link* — which the issuer does.

### A correction to an earlier version of this document

Earlier revisions claimed an observer could not determine *"which registered
credential produced a given verification"* nor *"whether two verifications in
different contexts came from the same credential"*. **Both were false.**

`commitment` is public signal 0. It sits in the clear in the calldata of every
`verifyAge` transaction, and it is constant across contexts, epochs and chains.
The context-scoped nullifier gives unlinkability *of nullifiers*; the public
commitment defeats it entirely.

This matters for what the location feature can honestly claim:

- **Against a third party who cannot link a commitment to a person:** the
  membership proof reveals only "one of N regions". The claim holds.
- **Against the issuer:** no privacy at all. The issuer registered the
  commitment, knows whose it is, and attested the region itself. It can read the
  chain and see exactly who verified, when, and under which policy. Anonymity
  set = 1.

The honest framing is therefore: *the in-circuit membership proof hides the
region from parties who merely observe the chain; it does not hide it from the
issuer, who already knows it.* That is still a real property — the alternative,
publishing `regionOf(commitment)` in the registry, would leak it to everyone —
but the delta must be stated precisely.
