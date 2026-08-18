/**
 * circuit-test.js
 *
 * Tests for AttributeCheck circuit v1 (range check only).
 *
 * Requires the trusted setup to have been run first:
 *   .\scripts\compile_circuit.ps1
 *
 * These tests call snarkjs directly to generate witnesses and
 * proofs in-process — no external CLI needed at test time.
 */
const { expect } = require("chai");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

const BUILD = path.join(__dirname, "../build");
const WASM = path.join(BUILD, "attribute_check_js/attribute_check.wasm");
const ZKEY = path.join(BUILD, "circuit_final.zkey");
const VKEY = path.join(BUILD, "verification_key.json");

// Skip all circuit tests if build artifacts don't exist yet
// (circom hasn't been run). This keeps npm test green on CI
// before the circuit compilation step.
const artifactsExist = fs.existsSync(WASM) && fs.existsSync(ZKEY);

describe("AttributeCheck circuit (v1 — range check)", function () {
  this.timeout(30000); // proof generation can take a few seconds

  let vkey;

  before(function () {
    if (!artifactsExist) {
      console.log(
        "\n  ⚠️  Circuit build artifacts not found in build/.\n" +
        "     Run: .\\scripts\\compile_circuit.ps1\n" +
        "     Then re-run tests.\n"
      );
      this.skip();
    }
    vkey = JSON.parse(fs.readFileSync(VKEY, "utf8"));
  });

  // ── Positive tests ──────────────────────────────────────────────────────────

  it("accepts a valid adult (age 24 ≥ threshold 18)", async function () {
    const input = { birthYear: "2000", secret: "0", currentYear: "2024", threshold: "18" };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).to.equal(true);
  });

  it("accepts when age equals threshold exactly (age 18 = threshold 18)", async function () {
    const input = { birthYear: "2006", secret: "0", currentYear: "2024", threshold: "18" };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).to.equal(true);
  });

  // ── Negative tests ──────────────────────────────────────────────────────────

  it("rejects underage prover (age 17 < threshold 18)", async function () {
    const input = { birthYear: "2007", secret: "0", currentYear: "2024", threshold: "18" };
    let threw = false;
    try {
      await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    } catch {
      threw = true;
    }
    // Witness generation must fail — the GreaterEqThan constraint is violated
    expect(threw).to.equal(true, "Expected witness generation to fail for underage input");
  });

  it("rejects future birthYear (negative age)", async function () {
    const input = { birthYear: "2030", secret: "0", currentYear: "2024", threshold: "18" };
    let threw = false;
    try {
      await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true, "Expected witness generation to fail for future birthYear");
  });
});
