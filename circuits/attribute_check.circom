pragma circom 2.0.0;

/*
 * AttributeCheck v1 — Range Check Only (Issue #2)
 *
 * Proves that a user's age (currentYear - birthYear) is at or above
 * a required threshold, WITHOUT revealing the actual birthYear.
 *
 * Constraint 1 — Age arithmetic:
 *   age = currentYear - birthYear
 *
 * Constraint 2 — Range enforcement:
 *   GreaterEqThan(8)(age, threshold) === 1
 *   (8-bit comparator supports ages 0–255)
 *
 * Note: `secret` is reserved for the Poseidon commitment in Issue #3.
 *       It is kept as a signal here to preserve the circuit interface,
 *       but is not yet constrained.
 *
 * Public inputs:  currentYear, threshold
 * Private inputs: birthYear, secret
 */
include "circomlib/circuits/comparators.circom";

template AttributeCheck(n) {
    // ── Private inputs (never revealed) ──────────────────────────────────────
    signal input birthYear;
    signal input secret;      // reserved: used in v2 (Issue #3) for Poseidon hash

    // ── Public inputs (visible to verifier) ──────────────────────────────────
    signal input currentYear;
    signal input threshold;   // e.g. 18 for age verification

    // ── Constraint 1: Age arithmetic ──────────────────────────────────────────
    signal age;
    age <== currentYear - birthYear;

    // ── Constraint 2: Range check — age >= threshold ───────────────────────────
    // GreaterEqThan(n) takes two n-bit numbers and outputs 1 if in[0] >= in[1]
    component gte = GreaterEqThan(n);
    gte.in[0] <== age;
    gte.in[1] <== threshold;
    gte.out === 1;
}

// n=8: comparator supports values 0–255 (sufficient for ages)
// Public signals declared explicitly for snarkjs proof generation
component main { public [currentYear, threshold] } = AttributeCheck(8);
