/**
 * Poseidon hashing in the browser, matching the circuit exactly.
 *
 * WHY poseidon-lite AND NOT circomlibjs
 *
 * circomlibjs is the canonical JS companion to circomlib, and the Node-side
 * tooling uses it. In a browser bundle, though, it drags in readable-stream,
 * safe-buffer and friends, which reach for `assert`, `buffer` and `events`.
 * Vite externalises those to empty stubs, producing a ~2.9 MB bundle that can
 * fail at runtime in ways that only show up on some code paths.
 *
 * poseidon-lite is a dependency-free BigInt implementation of the same
 * permutation with the same circomlib constants. tests/parity.test.js pins its
 * output against both circomlibjs and the circuit's own `commitment` output,
 * so a divergence would fail the build rather than surface as an
 * "unregistered commitment" revert.
 */

import { poseidon2 as poseidonHash } from 'poseidon-lite';
import { toField } from './field.js';

/** Poseidon over two field elements, as a decimal string. */
export function poseidon2(a, b) {
  return poseidonHash([toField(a), toField(b)]).toString();
}

/** commitment = Poseidon(birthYear, secret) — what the issuer registers. */
export async function computeCommitment(birthYear, secret) {
  return poseidon2(birthYear, secret);
}

/** nullifier = Poseidon(secret, context) — the per-context single-use token. */
export async function computeNullifier(secret, context) {
  return poseidon2(secret, context);
}

/** No-op kept for API symmetry; poseidon-lite needs no WASM warm-up. */
export async function warmPoseidon() {}
