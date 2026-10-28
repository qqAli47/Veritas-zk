/**
 * Deterministic sample witness used by the build script's smoke test and as
 * the committed circuits/input.json fixture.
 *
 * The values are fixed (not random) so that circuits/input.json is stable
 * across builds and shows up as unchanged in `git status`.
 */

import { buildCircuitInput } from "./credential.mjs";
import { maskOf, regionBit } from "./regions.mjs";

/** A fixed, well-known development credential. Never use these values for real. */
export const SAMPLE = {
  birthYear: 2000,
  // Germany. See circuits/regions.json — the bit index, not the ISO code, is
  // what the circuit sees.
  regionCode: regionBit("DE"),
  secret: 12345678901234567890n,
  subject: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Hardhat account #1
  currentYear: 2026,
  threshold: 18,
  // The verifier permits three regions, so a proof narrows the holder to one
  // of three — it does not reveal Germany.
  regionMask: maskOf(["DE", "FR", "IT"]),
  // A stand-in context. Real proofs read this from VeritasCore.contextFor().
  context: 987654321987654321n,
};

export async function buildSampleInput() {
  return buildCircuitInput(SAMPLE);
}
