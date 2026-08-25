/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  scripts/zk/credential.mjs — Poseidon, field arithmetic and input packing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The single Node-side implementation of the value derivations that the
 *  circuit performs. Tests assert that these agree with the circuit's own
 *  outputs, so this file and circuits/attribute_check.circom can never drift
 *  apart silently.
 *
 *  The browser has a mirror of this at frontend/src/zk/. Any change here must
 *  be reflected there — the golden-vector test in tests/circuit.test.js is the
 *  tripwire.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { buildPoseidon } from "circomlibjs";
import { randomBytes } from "node:crypto";

/**
 * The BN254 (alt_bn128) scalar field order. Every circuit signal is an element
 * of this field; values at or above it wrap, which is exactly the property the
 * circuit's Num2Bits range checks exist to defeat.
 */
export const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// buildPoseidon() compiles a small WASM module — memoise it.
let _poseidon;
async function poseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/**
 * Poseidon over two field elements, returned as a decimal string.
 *
 * The `F.toString` is not optional: the raw return of `p(...)` is a Montgomery-
 * form byte array. Passing it directly to ethers or into input.json yields a
 * wrong-but-plausible number, which then fails on-chain with a confusing
 * "commitment not registered".
 */
export async function poseidon2(a, b) {
  const p = await poseidon();
  return p.F.toString(p([toField(a), toField(b)]));
}

/** Reduce any integer-ish value into the scalar field. */
export function toField(x) {
  const v = BigInt(x) % FIELD_ORDER;
  return v < 0n ? v + FIELD_ORDER : v;
}

/**
 * A credential's secret salt.
 *
 * 64 random bytes reduced mod r. Sampling 512 bits for a ~254-bit field makes
 * the modulo bias smaller than 2^-256, i.e. irrelevant. Using 32 bytes here
 * would still be fine in practice, but 64 makes the argument trivial.
 */
export function randomSecret() {
  return toField(BigInt("0x" + randomBytes(64).toString("hex")));
}

/** commitment = Poseidon(birthYear, secret) — what the issuer registers. */
export const commitmentOf = (birthYear, secret) => poseidon2(birthYear, secret);

/** nullifier = Poseidon(secret, context) — the per-context single-use token. */
export const nullifierOf = (secret, context) => poseidon2(secret, context);

/**
 * Pack the three policy-bound values into one field element.
 *
 *   bits [  0.. 15]  threshold    uint16
 *   bits [ 16.. 31]  currentYear  uint16
 *   bits [ 32..191]  subject      uint160 (an Ethereum address)
 *
 * Carrying these as one signal instead of three saves roughly 12,300 gas on
 * every verification, because Groth16 costs one elliptic-curve multiplication
 * (~6,000 gas) per public signal. See docs/gas-report.md.
 */
export function pack(subject, currentYear, threshold) {
  const s = BigInt(subject);
  const y = BigInt(currentYear);
  const t = BigInt(threshold);

  if (s >= 1n << 160n) throw new RangeError(`subject ${subject} exceeds 160 bits`);
  if (y >= 1n << 16n) throw new RangeError(`currentYear ${currentYear} exceeds 16 bits`);
  if (t >= 1n << 16n) throw new RangeError(`threshold ${threshold} exceeds 16 bits`);

  return (s << 32n) | (y << 16n) | t;
}

/** Inverse of pack(); used by tests and tooling to read back a packed word. */
export function unpack(packed) {
  const p = BigInt(packed);
  return {
    threshold: Number(p & 0xffffn),
    currentYear: Number((p >> 16n) & 0xffffn),
    subject: "0x" + ((p >> 32n) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0"),
  };
}

/**
 * Build the complete circuit input object.
 *
 * `birthYear` and `secret` are the private signals — everything else is
 * derived and public.
 */
export async function buildCircuitInput({ birthYear, secret, subject, currentYear, threshold, context }) {
  return {
    context: toField(context).toString(),
    packed: pack(subject, currentYear, threshold).toString(),
    birthYear: String(birthYear),
    secret: toField(secret).toString(),
  };
}

/**
 * Recompute the context id the way VeritasCore does.
 *
 * keccak256(TAG, chainId, coreAddress, epoch) >> 8.
 *
 * The right-shift truncates to 248 bits, which guarantees the result is below
 * the field order without introducing modular bias (a plain `% r` on a uniform
 * 256-bit value would very slightly favour small elements).
 *
 * Binding chainId and the contract address is what stops a proof minted for
 * one deployment being replayed against another.
 */
export function contextIdFor({ ethers, chainId, coreAddress, epoch }) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256", "address", "uint64"],
    [ethers.id("Veritas-zk/AgeAttestation/v1"), chainId, coreAddress, epoch],
  );
  return BigInt(ethers.keccak256(encoded)) >> 8n;
}
