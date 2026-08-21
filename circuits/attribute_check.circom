pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template AttributeCheck(n) {
    // Private inputs: these remain hidden from the verifier.
    signal input birthYear;
    signal input secret;

    // Public inputs: these are visible to the verifier.
    signal input currentYear;
    signal input threshold;
    signal input commitment;

    // Constraint 1: bind the private values to the public commitment.
    component hasher = Poseidon(2);
    hasher.inputs[0] <== birthYear;
    hasher.inputs[1] <== secret;
    hasher.out === commitment;

    // Constraint 2: prove that the hidden birth year satisfies the age threshold.
    signal age;
    age <== currentYear - birthYear;

    component gte = GreaterEqThan(n);
    gte.in[0] <== age;
    gte.in[1] <== threshold;
    gte.out === 1;
}

component main { public [currentYear, threshold, commitment] } = AttributeCheck(8);
