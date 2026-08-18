/**
 * generate_proof.js
 *
 * Programmatically generates a Groth16 witness + proof for the
 * AttributeCheck circuit using snarkjs.
 *
 * Requires the circuit to have been compiled and the trusted setup
 * to have been run first (see scripts/compile_circuit.ps1).
 *
 * Usage:
 *   node scripts/generate_proof.js
 *
 * Output:
 *   build/proof.json   — the zk-SNARK proof
 *   build/public.json  — the public signals
 */
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

async function generateProof(input, wasmPath, zkeyPath) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );
  return { proof, publicSignals };
}

async function verifyProof(vkeyPath, publicSignals, proof) {
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  return await snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// Run standalone if called directly
if (require.main === module) {
  const BUILD = path.join(__dirname, "../build");
  const input = {
    birthYear: "2000",
    secret:    "0",
    currentYear: "2024",
    threshold:   "18",
  };

  (async () => {
    console.log("Generating witness and proof...");
    const { proof, publicSignals } = await generateProof(
      input,
      path.join(BUILD, "attribute_check_js/attribute_check.wasm"),
      path.join(BUILD, "circuit_final.zkey")
    );

    fs.writeFileSync(path.join(BUILD, "proof.json"),  JSON.stringify(proof, null, 2));
    fs.writeFileSync(path.join(BUILD, "public.json"), JSON.stringify(publicSignals, null, 2));
    console.log("proof.json and public.json written to build/");

    const isValid = await verifyProof(
      path.join(BUILD, "verification_key.json"),
      publicSignals,
      proof
    );
    console.log("Proof valid:", isValid ? "✅ OK" : "❌ FAILED");
    process.exit(isValid ? 0 : 1);
  })();
}

module.exports = { generateProof, verifyProof };
