/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  tests/helpers/zk.js — shared proving helpers for the Hardhat test suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Generating a Groth16 proof takes a second or two, so tests generate ONE
 *  valid proof in a `before` hook and derive the negative cases by mutating
 *  its public signals. That is both faster and a better test: it exercises the
 *  exact tamper-resistance property we care about.
 */

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');

const ROOT = path.join(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'build');

const WASM = path.join(BUILD, 'attribute_check_js', 'attribute_check.wasm');
const ZKEY = path.join(BUILD, 'attribute_check_final.zkey');
const VKEY = path.join(BUILD, 'verification_key.json');
const MANIFEST = path.join(ROOT, 'circuits', 'public_signals.json');

/** Whether the circuit has been built. Tests skip (loudly) when it has not. */
const artifactsExist = () =>
  fs.existsSync(WASM) && fs.existsSync(ZKEY) && fs.existsSync(VKEY);

const SKIP_MESSAGE =
  '\n  ⚠  Circuit artifacts not found in build/.\n' +
  '     Run:  npm run zk:build\n' +
  '     then re-run the tests.\n';

/**
 * Skip the enclosing suite when the circuit has not been built.
 * Call from a `before` hook with `this` bound to the mocha context.
 */
function skipUnlessBuilt(ctx) {
  if (!artifactsExist()) {
    console.log(SKIP_MESSAGE);
    ctx.skip();
  }
}

const readManifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const readVkey = () => JSON.parse(fs.readFileSync(VKEY, 'utf8'));

/*
 * ── Why this file keeps its OWN implementation ──────────────────────────────
 *
 * scripts/demo.js and scripts/zk/verify-browser-path.mjs were both changed to
 * import the canonical helpers from scripts/zk/credential.mjs, because a second
 * copy in a *script* buys nothing and can silently drift.
 *
 * This file is different, and deliberately still has its own. A test oracle
 * that merely re-exports the code under test cannot detect a bug in that code —
 * it would agree with it by construction. Keeping an independent
 * reimplementation here, and pinning the two together in tests/parity.test.js,
 * is what turns "they agree" into evidence rather than a tautology.
 *
 * Three implementations exist in total, all pinned by parity.test.js:
 *   1. scripts/zk/credential.mjs   canonical, Node
 *   2. frontend/src/zk/field.js    browser mirror (keeps the bundle at 683 KB)
 *   3. this file                   independent test oracle
 */

// ── Field arithmetic ────────────────────────────────────────────────────────
const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const toField = (x) => {
  const v = BigInt(x) % FIELD_ORDER;
  return v < 0n ? v + FIELD_ORDER : v;
};

let _poseidon;
async function poseidonN(inputs) {
  if (!_poseidon) {
    const { buildPoseidon } = require('circomlibjs');
    _poseidon = await buildPoseidon();
  }
  return _poseidon.F.toString(_poseidon(inputs.map(toField)));
}

const poseidon2 = (a, b) => poseidonN([a, b]);
const poseidon3 = (a, b, c) => poseidonN([a, b, c]);

const commitmentOf = (birthYear, regionCode, secret) =>
  poseidon3(birthYear, regionCode, secret);
const nullifierOf = (secret, context) => poseidon2(secret, context);

/** Where the region allowlist starts inside the packed word. */
const MASK_OFFSET = 192n;

/** regionMask<<192 | subject<<32 | currentYear<<16 | threshold */
function pack(subject, currentYear, threshold, regionMask = 0n) {
  return (
    (BigInt(regionMask) << MASK_OFFSET) |
    (BigInt(subject) << 32n) |
    (BigInt(currentYear) << 16n) |
    BigInt(threshold)
  );
}

/** Inverse of pack(). */
function unpack(packed) {
  const p = BigInt(packed);
  return {
    threshold: Number(p & 0xffffn),
    currentYear: Number((p >> 16n) & 0xffffn),
    subject: '0x' + ((p >> 32n) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'),
    regionMask: p >> MASK_OFFSET,
  };
}

/** Build an allowlist mask from region bit indices. */
const maskOfBits = (bits) => bits.reduce((m, b) => m | (1n << BigInt(b)), 0n);

/**
 * Recompute VeritasCore.contextFor(epoch) off-chain.
 * keccak256(TAG, chainId, core, epoch) >> 8
 */
function contextFor(ethers, chainId, coreAddress, epoch) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256', 'address', 'uint64'],
    [ethers.id('Veritas-zk/AttributeAttestation/v2'), chainId, coreAddress, epoch],
  );
  return BigInt(ethers.keccak256(encoded)) >> 8n;
}

/**
 * Generate a real proof.
 * @returns {{proof, publicSignals, calldata, commitment, nullifier}}
 */
async function prove({
  birthYear,
  regionCode,
  secret,
  subject,
  currentYear,
  threshold,
  context,
  regionMask,
}) {
  const input = {
    context: toField(context).toString(),
    packed: pack(subject, currentYear, threshold, regionMask).toString(),
    birthYear: String(birthYear),
    regionCode: String(regionCode),
    secret: toField(secret).toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return {
    proof,
    publicSignals,
    calldata: await toCalldata(proof, publicSignals),
    commitment: publicSignals[0],
    nullifier: publicSignals[1],
    input,
  };
}

/**
 * Format a proof for the Solidity verifier.
 * snarkjs already applies the G2 coordinate swap the pairing precompile
 * expects, so the parsed output can be passed straight through.
 */
async function toCalldata(proof, publicSignals) {
  const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c, pub] = JSON.parse('[' + raw + ']');
  return { a, b, c, pub };
}

/** Verify locally, without touching a chain. */
async function verifyLocally(publicSignals, proof) {
  return snarkjs.groth16.verify(readVkey(), publicSignals, proof);
}

/**
 * Attempt to build a witness, returning whether the constraints were
 * satisfiable. Used by the circuit tests for negative cases.
 */
async function witnessSucceeds(input) {
  try {
    await snarkjs.wtns.calculate(input, WASM, path.join(BUILD, 'test_witness.wtns'));
    return true;
  } catch {
    return false;
  }
}

/**
 * snarkjs (via ffjavascript) spins up a worker pool and caches it on
 * `globalThis.curve_bn128`. Mocha finishes but the process never exits unless
 * that pool is torn down — this is the fix for a test run that appears to hang
 * forever after printing all its results.
 */
async function terminateCurve() {
  if (globalThis.curve_bn128) {
    await globalThis.curve_bn128.terminate();
    globalThis.curve_bn128 = null;
  }
}

module.exports = {
  WASM,
  ZKEY,
  VKEY,
  FIELD_ORDER,
  artifactsExist,
  skipUnlessBuilt,
  readManifest,
  readVkey,
  toField,
  poseidon2,
  poseidon3,
  commitmentOf,
  nullifierOf,
  pack,
  unpack,
  maskOfBits,
  MASK_OFFSET,
  contextFor,
  prove,
  toCalldata,
  verifyLocally,
  witnessSucceeds,
  terminateCurve,
};
