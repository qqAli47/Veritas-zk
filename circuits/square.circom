pragma circom 2.0.0;

/*
 * Square — warm-up circuit for Issue #2
 *
 * Proves knowledge of a private value x such that x * x == y,
 * where y is a public input. Used to verify the Circom toolchain
 * works end-to-end before touching the main AttributeCheck circuit.
 *
 * Usage:
 *   input.json = { "x": "5", "y": "25" }
 */
template Square() {
    signal input x;       // private: the value we know
    signal input y;       // public:  the square we claim to know the root of

    signal x_squared;
    x_squared <== x * x;
    x_squared === y;
}

component main { public [y] } = Square();
