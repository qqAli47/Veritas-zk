pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  AttributeCheck v3 — Veritas-zk production circuit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Proves, without revealing birthYear, region or secret, that the prover:
 *
 *    1. knows the (birthYear, regionCode, secret) preimage of a commitment
 *       that a trusted issuer registered on-chain,
 *    2. is at least `threshold` years old as of `currentYear`,
 *    3. is located in one of the regions the verifier permits — WITHOUT
 *       revealing which one,
 *    4. has not already used this credential in this verification context, and
 *    5. is proving on behalf of one specific beneficiary address.
 *
 *  ── PUBLIC SIGNAL LAYOUT (load-bearing — see the note at the bottom) ──────
 *
 *    [0] commitment   output   Poseidon(birthYear, regionCode, secret)
 *    [1] nullifier    output   Poseidon(secret, context)
 *    [2] context      input    keccak256(TAG, chainId, core, epoch) >> 8
 *    [3] packed       input    regionMask<<192 | subject<<32 | currentYear<<16 | threshold
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
 *  ── Why everything is PACKED into one signal ─────────────────────────────
 *
 *  Groth16 on-chain verification costs ~6,800 gas per public signal. The
 *  budget has under 3,000 gas of headroom, so a FIFTH public signal for the
 *  region allowlist would break the project's <300,000 target.
 *
 *  Instead the allowlist rides in the spare bits of `packed`. The field is
 *  ~2^254 and 2^253 < p, so 253 bits are usable; subject(160) + year(16) +
 *  threshold(16) leaves exactly 61 for the region mask. Location therefore
 *  costs zero additional public signals.
 *
 *  The single Num2Bits(253) below does three jobs at once:
 *    (a) range-checks currentYear and threshold to 16 bits each,
 *    (b) proves packed < 2^253 so the Solidity-side unpacking cannot truncate,
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
include "circomlib/circuits/multiplexer.circom";

/*
 *  MIN_BIRTH_YEAR — floor on a plausible birth year (defence in depth).
 *  MAX_AGE        — ceiling on a plausible age; together with the Num2Bits
 *                   on `age` this bounds the subtraction from both sides.
 *  N_REGIONS      — width of the allowlist mask. Must equal `capacity` in
 *                   circuits/regions.json, which the build script asserts.
 */
template AttributeCheck(MIN_BIRTH_YEAR, MAX_AGE, N_REGIONS) {

    // Where the region mask starts inside `packed`, just above
    // subject(160) + currentYear(16) + threshold(16).
    var MASK_OFFSET = 192;

    // ── Public outputs — occupy publicSignals[0] and [1] ──────────────────
    signal output commitment;
    signal output nullifier;

    // ── Public inputs — occupy publicSignals[2] and [3] ───────────────────
    signal input context;
    signal input packed;

    // ── Private inputs — never leave the prover's machine ─────────────────
    signal input birthYear;
    signal input regionCode;
    signal input secret;

    // ══════════════════════════════════════════════════════════════════════
    //  1. Unpack, range-check, and bind `packed`
    //
    //     bits [  0.. 15]  threshold    uint16
    //     bits [ 16.. 31]  currentYear  uint16
    //     bits [ 32..191]  subject      uint160  (constrained, deliberately
    //                                             not re-read in-circuit —
    //                                             Solidity unpacks it)
    //     bits [192..252]  regionMask   the allowlist, read below
    //
    //     253 is the widest safe Num2Bits: 2^253 < p < 2^254, so the map from
    //     bit-strings to field elements stays injective. (This is exactly why
    //     circomlib bolts an AliasCheck onto Num2Bits_strict at 254 and not
    //     at 253.)
    // ══════════════════════════════════════════════════════════════════════
    component packedBits = Num2Bits(253);
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
    //  5. The location claim: regionCode is in the verifier's allowlist
    //
    //     This is private set membership. The verifier learns "the holder is
    //     in one of the permitted regions" and NOT which one — exactly as it
    //     learns "at least 18" and not the birth year.
    //
    //     Decoder gives a one-hot vector over regionCode. For each i it emits
    //     `out[i] * (inp - i) === 0`, so every out[i] with i != regionCode is
    //     forced to zero, while out[regionCode] is left free; `success` is
    //     their sum, constrained boolean. Pinning success to 1 therefore pins
    //     out[regionCode] to 1 and the vector is exactly one-hot.
    //
    //     If regionCode were out of range, EVERY out[i] would be forced to
    //     zero and success would be 0 — so the range check comes for free.
    //     `success === 1` below is defence in depth: the membership constraint
    //     alone would already reject it, because the dot product would be 0.
    // ══════════════════════════════════════════════════════════════════════
    component regionDecoder = Decoder(N_REGIONS);
    regionDecoder.inp <== regionCode;
    regionDecoder.success === 1;

    /*
     *  The intermediate `hit` signals are not stylistic. An R1CS constraint is
     *  (linear) x (linear) = (linear), so a bare
     *      sum_i( out[i] * maskBit[i] ) === 1
     *  is a sum of 61 distinct products and will not compile — circom rejects
     *  it as a non-quadratic constraint. Each product needs its own signal.
     */
    signal hit[N_REGIONS];
    var allowed = 0;
    for (var i = 0; i < N_REGIONS; i++) {
        hit[i] <== regionDecoder.out[i] * packedBits.out[MASK_OFFSET + i];
        allowed += hit[i];
    }

    // One-hot times booleans collapses to exactly maskBit[regionCode].
    allowed === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  6. Commitment opening
    //
    //     Ties the proof to a credential the issuer actually issued. Without
    //     it the range checks prove nothing about a *real* person: a prover
    //     could simply invent a convenient birthYear and region.
    //
    //     The region is INSIDE the commitment, which is what stops a holder
    //     self-asserting their location. Poseidon(3) costs 264 constraints
    //     against Poseidon(2)'s 243 — 21 more for a whole extra attribute.
    // ══════════════════════════════════════════════════════════════════════
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== birthYear;
    commitmentHasher.inputs[1] <== regionCode;
    commitmentHasher.inputs[2] <== secret;
    commitment <== commitmentHasher.out;

    // ══════════════════════════════════════════════════════════════════════
    //  7. Context-scoped nullifier
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
component main { public [context, packed] } = AttributeCheck(1900, 130, 61);
