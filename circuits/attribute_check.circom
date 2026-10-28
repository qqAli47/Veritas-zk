pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  AttributeCheck v4 — Veritas-zk production circuit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Proves, without revealing birthYear, regionCode or secret, that the prover:
 *
 *    1. knows the (birthYear, regionCode, secret) preimage of a commitment
 *       that a trusted issuer registered on-chain,
 *    2. is at least `threshold` years old as of `currentYear`,
 *    3. belongs to one of the regions permitted by the policy's `regionMask`,
 *    4. has not already used this credential in this verification context, and
 *    5. is proving on behalf of one specific beneficiary address.
 *
 *  ── PUBLIC SIGNAL LAYOUT (load-bearing — see note at the bottom) ──────────
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
 *  ── Why `subject`, `currentYear`, `threshold` and `regionMask` are PACKED ─
 *
 *  Groth16 on-chain verification costs one ECMUL (~6,000 gas) per public
 *  signal. Carrying these five as separate signals would cost ~24,500 gas more
 *  than packing them into one 253-bit field element — the difference between
 *  meeting and badly missing the project's <300,000 gas target.
 *
 *  The single Num2Bits(253) below does four jobs at once:
 *    (a) range-checks currentYear and threshold to 16 bits each,
 *    (b) range-checks regionMask to 61 bits (capacity = N_REGIONS),
 *    (c) proves packed < 2^253 so the Solidity-side unpacking cannot truncate,
 *    (d) forces `packed` to participate in real constraints, which is what
 *        makes the proof cryptographically bound to the subject address AND
 *        the region policy. (A public input with no constraint has identity IC
 *        points and Groth16 verification becomes independent of its value.)
 *
 *  ── Why the region check uses a bit-selector and not a comparator ─────────
 *
 *  The policy's regionMask is a 61-bit bitmask where bit i = 1 means "region i
 *  is permitted". Checking membership with a comparator would require sorting
 *  or a Merkle tree. A bit-selector is O(N_REGIONS) constraints and is exact:
 *  we extract bit `regionCode` from `regionMask` and assert it is 1.
 *
 *  ── Why Poseidon and not SHA-256 ─────────────────────────────────────────
 *
 *  Poseidon is arithmetisation-friendly: ~243 R1CS constraints per 2-input
 *  hash against tens of thousands for SHA-256. The entire circuit is ~900
 *  constraints, which keeps in-browser proving under two seconds.
 * ═══════════════════════════════════════════════════════════════════════════
 */

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 *  MIN_BIRTH_YEAR — floor on a plausible birth year (defence in depth).
 *  MAX_AGE        — ceiling on a plausible age; together with Num2Bits(16)
 *                   this bounds the subtraction from both sides.
 *  N_REGIONS      — width of the region bitmask; must match field.js REGION_CAPACITY.
 */
template AttributeCheck(MIN_BIRTH_YEAR, MAX_AGE, N_REGIONS) {

    // ── Public outputs — occupy publicSignals[0] and [1] ──────────────────
    signal output commitment;
    signal output nullifier;

    // ── Public inputs — occupy publicSignals[2] and [3] ───────────────────
    signal input context;
    signal input packed;

    // ── Private inputs — never leave the prover's machine ─────────────────
    signal input birthYear;
    signal input regionCode; // the holder's region bit index (0..N_REGIONS-1)
    signal input secret;

    // ══════════════════════════════════════════════════════════════════════
    //  1. Unpack, range-check, and bind `packed`
    //
    //     bits [  0.. 15]  threshold    uint16
    //     bits [ 16.. 31]  currentYear  uint16
    //     bits [ 32..191]  subject      uint160  (constrained, not re-read
    //                                             in-circuit — Solidity unpacks)
    //     bits [192..252]  regionMask   uint61   (N_REGIONS bits)
    // ══════════════════════════════════════════════════════════════════════
    var PACKED_BITS = 32 + N_REGIONS + 160; // 192 + N_REGIONS = 253

    component packedBits = Num2Bits(PACKED_BITS);
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

    // Extract the regionMask (bits [192..192+N_REGIONS-1] of packed).
    component regionMaskNum = Bits2Num(N_REGIONS);
    for (var i = 0; i < N_REGIONS; i++) {
        regionMaskNum.in[i] <== packedBits.out[192 + i];
    }
    signal regionMask;
    regionMask <== regionMaskNum.out;

    // ══════════════════════════════════════════════════════════════════════
    //  2. Range-check regionCode
    //
    //     regionCode must be a valid bit index into the mask (0..N_REGIONS-1).
    //     Num2Bits(7) proves it fits in 7 bits (< 128), so no wrap-around
    //     can reach a "wrong" bit during the selector below.
    // ══════════════════════════════════════════════════════════════════════
    component regionCodeBits = Num2Bits(7); // 2^7 = 128 > N_REGIONS
    regionCodeBits.in <== regionCode;

    // ── Region membership: bit `regionCode` of `regionMask` must be 1 ────
    //
    //  Build a one-hot selector: selector[i] = 1 iff regionCode == i.
    //  Multiply selector[i] by packedBits.out[192+i] to extract the bit.
    //  Sum all products; the result is exactly the bit at position regionCode.
    //
    //  Soundness: if regionCode = k, exactly one selector[k] = 1. The others
    //  are 0. So the sum = packedBits.out[192+k]. Asserting sum === 1 proves
    //  the holder's region is permitted.
    //
    //  Note: building a full equality comparator for each i costs 2*N_REGIONS
    //  IsZero components; a cheaper approach is possible but this is clear.

    signal selectors[N_REGIONS];
    signal products[N_REGIONS];

    component eqs[N_REGIONS];
    for (var i = 0; i < N_REGIONS; i++) {
        eqs[i] = IsEqual();
        eqs[i].in[0] <== regionCode;
        eqs[i].in[1] <== i;
        selectors[i] <== eqs[i].out;
        products[i]  <== selectors[i] * packedBits.out[192 + i];
    }

    // Sum up all products. The sum equals the mask bit at regionCode.
    signal regionBit;
    var acc = 0;
    for (var i = 0; i < N_REGIONS; i++) {
        acc = acc + products[i];
    }
    regionBit <== acc;
    regionBit === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  3. Range-check birthYear
    //
    //     Circuit signals are BN254 field elements, not integers. Without
    //     this, a prover could submit birthYear = p - X so that
    //     currentYear - birthYear wraps to any age they like.
    // ══════════════════════════════════════════════════════════════════════
    component birthYearBits = Num2Bits(16);
    birthYearBits.in <== birthYear;

    component birthYearFloor = GreaterEqThan(16);
    birthYearFloor.in[0] <== birthYear;
    birthYearFloor.in[1] <== MIN_BIRTH_YEAR;
    birthYearFloor.out === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  4. Age, bounded from both sides
    //
    //     If birthYear > currentYear then age = p - k, which is astronomically
    //     larger than 2^16, so Num2Bits(16) has no satisfying witness.
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
    //  5. The age claim: age >= threshold
    // ══════════════════════════════════════════════════════════════════════
    component isOldEnough = GreaterEqThan(16);
    isOldEnough.in[0] <== age;
    isOldEnough.in[1] <== threshold;
    isOldEnough.out === 1;

    // ══════════════════════════════════════════════════════════════════════
    //  6. Commitment opening — Poseidon(birthYear, regionCode, secret)
    //
    //     Three-input: adding regionCode to the preimage means an issuer
    //     can never register a commitment that works for a region different
    //     from the one they vouched for during issuance.
    // ══════════════════════════════════════════════════════════════════════
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== birthYear;
    commitmentHasher.inputs[1] <== regionCode;
    commitmentHasher.inputs[2] <== secret;
    commitment <== commitmentHasher.out;

    // ══════════════════════════════════════════════════════════════════════
    //  7. Context-scoped nullifier — Poseidon(secret, context)
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
 *  circuits/public_signals.json and the test suite asserts against it.
 *
 *  N_REGIONS = 61 matches field.js REGION_CAPACITY and the regions.json count.
 */
component main { public [context, packed] } = AttributeCheck(1900, 130, 61);
