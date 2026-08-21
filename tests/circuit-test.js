const assert = require("assert");
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const wasmPath = path.join(
  __dirname,
  "..",
  "build",
  "attribute_check_js",
  "attribute_check.wasm"
);

const zkeyPath = path.join(
  __dirname,
  "..",
  "build",
  "attribute_check_final.zkey"
);

const verificationKeyPath = path.join(
  __dirname,
  "..",
  "build",
  "verification_key.json"
);

async function commitmentFor(birthYear, secret) {
  const poseidon = await buildPoseidon();
  const hash = poseidon([BigInt(birthYear), BigInt(secret)]);
  return poseidon.F.toString(hash);
}

async function prove(input) {
  return snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
}

describe("AttributeCheck circuit (v2)", function () {
  this.timeout(120000);

  let validInput;

  before(async function () {
    const commitment = await commitmentFor(2000, 12345);

    validInput = {
      birthYear: "2000",
      secret: "12345",
      currentYear: "2024",
      threshold: "18",
      commitment
    };
  });

  it("accepts a valid proof", async function () {
    const { proof, publicSignals } = await prove(validInput);
    const verificationKey = require(verificationKeyPath);
    const verified = await snarkjs.groth16.verify(
      verificationKey,
      publicSignals,
      proof
    );

    assert.strictEqual(verified, true);
  });

  it("rejects a wrong secret with the original commitment", async function () {
    const wrongSecretInput = {
      ...validInput,
      secret: "99999"
    };

    await assert.rejects(async function () {
      await prove(wrongSecretInput);
    });
  });

  it("rejects an underage birth year", async function () {
    const underageBirthYear = "2010";
    const underageSecret = "12345";
    const underageCommitment = await commitmentFor(
      underageBirthYear,
      underageSecret
    );

    const underageInput = {
      birthYear: underageBirthYear,
      secret: underageSecret,
      currentYear: "2024",
      threshold: "18",
      commitment: underageCommitment
    };

    await assert.rejects(async function () {
      await prove(underageInput);
    });
  });

  it("rejects a tampered public commitment", async function () {
    const { proof, publicSignals } = await prove(validInput);
    const verificationKey = require(verificationKeyPath);
    const tamperedSignals = publicSignals.slice();

    // Public inputs are ordered as currentYear, threshold, commitment.
    tamperedSignals[2] = (BigInt(tamperedSignals[2]) + 1n).toString();

    const verified = await snarkjs.groth16.verify(
      verificationKey,
      tamperedSignals,
      proof
    );

    assert.strictEqual(verified, false);
  });
});
