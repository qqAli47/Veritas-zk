pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  AttributeCheck v3 — Veritas-zk production circuit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Proves, without revealing birthYear or secret, that the prover:
 *
 *    1. knows the (birthYear, secret) preimage of a commitment that a trusted
 *       issuer registered on-chain,
 *    2. is at least `threshold` years old as of `currentYear`,
 *    3. has not already used this credential in this verification context, and
 *    4. is proving on behalf of one specific beneficiary address.
 *
 *  ── PUBLIC SIGNAL LAYOUT (load-bearing — see the note at the bottom) ──────
 *
 *    [0] commitment   output   Poseidon(birthYear, secret)
 *    [1] nullifier    output   Poseidon(secret, context)
 *    [2] context      input    keccak256(TAG, chainId, core, epoch) >> 8
 *    [3] packed       input    subject<<32 | currentYear<<16 | threshold
 *
 *  VeritasCore.sol declares matching PUB_* index constants, and the test
 *  suite asserts the two agree.
 *
 *  ── Why `commitment` and `nullifier` are OUTPUTS, not inputs ─────────────
 *
 *  circom lays the witness out as [1, outputs..., public inputs..., private...],
 *  so declaring these as outputs pins them to indices 0 and 1 by construction.
 *  It also removes a whole class of bug: there is no "supplied" commitment that
 *  could disagree with the computed one, because the circuit only ever computes.
 *
 *  ── Why `subject`, `currentYear` and `threshold` are PACKED ──────────────
 *
 *  Groth16 on-chain verification costs one ECMUL (~6,000 gas) per public
 *  signal. Carrying these three as separate signals costs ~12,300 gas more
 *  than packing them into one 192-bit field element — which is the difference
 *  between missing and meeting the project's <300,000 gas target.
 *
 *  The single Num2Bits(192) below does three jobs at once:
 *    (a) range-checks currentYear and threshold to 16 bits each,
 *    (b) proves packed < 2^192 so the Solidity-side unpacking cannot truncate,
 *    (c) forces `packed` to participate in real constraints, which is what
 *        makes the proof cryptographically bound to the subject address.
 *
 *  Point (c) is not incidental. A public input that appears in NO constraint
 *  has A_i = B_i = C_i = 0, hence an identity IC point, and Groth16
 *  verification becomes completely independent of its value — the binding
 *  would be silently vacuous. (With separate signals you would need the
 *  classic `sq <== subject * subject` trick for exactly this reason.)
 *
 *  A 160-bit Ethereum address sits ~94 bits below the BN254 scalar field
 *  modulus, so no reduction, splitting or aliasing concern arises.
 *
 *  ── Why Poseidon and not SHA-256 ─────────────────────────────────────────
 *
 *  Poseidon is arithmetisation-friendly: ~243 R1CS constraints per 2-input
 *  hash against tens of thousands for SHA-256. The entire circuit is ~770
 *  constraints, which keeps in-browser proving near a second.
 * ═══════════════════════════════════════════════════════════════════════════
 */

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 *  MIN_BIRTH_YEAR — floor on a plausible birth year (defence in depth).
 *  MAX_AGE        — ceiling on a plausible age; together with the Num2Bits
 *                   on `age` this bounds the subtraction from both sides.
 */
template AttributeCheck(MIN_BIRTH_YEAR, MAX_AGE) {

    // ── Public outputs — occupy publicSignals[0] and [1] ──────────────────
    signal output commitment;
    signal output nullifier;

    // ── Public inputs — occupy publicSignals[2] and [3] ───────────────────
    signal input context;
    signal input packed;

    // ── Private inputs — never leave the prover's machine ─────────────────
    signal input birthYear;
    signal input secret;

    // ══════════════════════════════════════════════════════════════════════
    //  1. Unpack, range-check, and bind `packed`
    //
    //     bits [  0.. 15]  threshold    uint16
    //     bits [ 16.. 31]  currentYear  uint16
    //     bits [ 32..191]  subject      uint160  (constrained, deliberately
    //                                             not re-read in-circuit —
    //                                             Solidity unpacks it)
    // ══════════════════════════════════════════════════════════════════════
    component packedBits = Num2Bits(192);
    packedBits.in <== packed;

    component thresholdNum = Bits2Num(16);
    component yearNum      = Bits2Num(16);
    for (var i = 0; i < 16; i++) {
        thresholdNum.in[i] <== packedBits.out[i];
        yearNum.in[i]      <== packedBits.out[16 + i];
    }

    signal threshold;
    signal currentYear;
    threshold   <== thresholdNum.out;
    currentYear <== yearNum.out;

    // ══════════════════════════════════════════════════════════════════════
    //  2. Range-check birthYear
    //
    //     Circuit signals are BN254 field elements, not integers. Without
    //     this, a prover could submit birthYear = p - X so that
    //     currentYear - birthYear wraps to any age they like. This is the
    //     real soundness hole in the v1 circuit — a wider comparator alone
    //     would not have fixed it.
    // ══════════════════════════════════════════════════════════════════════
    component birthYearBits = Num2Bits(16);
    birthYearBits.in <== birthYear;

    component birthYearFloor = GreaterEqThan(16);
    birthYearFloor.in[0] <== birthYear;
    birthYearFloor.in[1] <== MIN_BIRTH_YEAR;
    birthYearFloor.out === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  3. Age, bounded from both sides
    //
    //     If birthYear > currentYear then age = p - k, which is astronomically
    //     larger than 2^16, so Num2Bits(16) has no satisfying witness.
    //     Negative ages are therefore unrepresentable rather than merely
    //     discouraged.
    // ══════════════════════════════════════════════════════════════════════
    signal age;
    age <== currentYear - birthYear;

    component ageBits = Num2Bits(16);
    ageBits.in <== age;

    component ageCeiling = LessEqThan(16);
    ageCeiling.in[0] <== age;
    ageCeiling.in[1] <== MAX_AGE;
    ageCeiling.out === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  4. The claim itself: age >= threshold
    //
    //     Both operands are now proven < 2^16, which is exactly
    //     GreaterEqThan's soundness precondition (its internal Num2Bits(17)
    //     then sees at most 131,071 < 2^17).
    // ══════════════════════════════════════════════════════════════════════
    component isOldEnough = GreaterEqThan(16);
    isOldEnough.in[0] <== age;
    isOldEnough.in[1] <== threshold;
    isOldEnough.out === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  5. Commitment opening
    //
    //     Ties the proof to a credential the issuer actually issued. Without
    //     it the age range check proves nothing about a *real* person: a
    //     prover could simply invent a convenient birthYear.
    // ══════════════════════════════════════════════════════════════════════
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== birthYear;
    commitmentHasher.inputs[1] <== secret;
    commitment <== commitmentHasher.out;

    // ══════════════════════════════════════════════════════════════════════
    //  6. Context-scoped nullifier
    //
    //     Poseidon(secret, context) rather than a bare Poseidon(secret, secret):
    //
    //       * Within one context it is deterministic, so the contract can
    //         store it and reject a replay.
    //       * Across contexts — a different relying party, a different chain,
    //         or a later epoch of the same app — it changes, so the credential
    //         stays usable over its lifetime and its uses are not linkable to
    //         one another.
    //
    //     A context-independent nullifier would burn the credential forever on
    //     first use AND act as a permanent cross-site tracking handle, which
    //     would defeat the very privacy property this project exists to build.
    // ══════════════════════════════════════════════════════════════════════
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== context;
    nullifier <== nullifierHasher.out;
}

/*
 *  PUBLIC-SIGNAL ORDER IS FROZEN HERE.
 *  ──────────────────────────────────
 *  Outputs come first (declaration order), then public inputs (declaration
 *  order). Everything downstream — the generated verifier's uint[4] argument,
 *  VeritasCore's PUB_* constants, the frontend's calldata builder — indexes
 *  this layout. scripts/zk/build.mjs records the observed order in
 *  circuits/public_signals.json and the test suite asserts against it, so the
 *  ordering is verified rather than assumed.
 */
component main { public [context, packed] } = AttributeCheck(1900, 130);
