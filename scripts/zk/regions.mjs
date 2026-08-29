/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  scripts/zk/regions.mjs — the region registry, and the mask helpers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The data lives in circuits/regions.json so that the circuit, the Node
 *  tooling, the browser and the documentation all read the same file. This
 *  module is the Node view of it.
 *
 *  The registry is APPEND-ONLY. A region's bit index is baked into every
 *  credential ever issued, because `regionCode` is one of the three preimages
 *  of the commitment the issuer registered on-chain. Reordering the array
 *  would silently re-label every existing credential.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const REGISTRY_PATH = path.join(ROOT, "circuits", "regions.json");

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

/** How many bits the allowlist mask has. Must match N_REGIONS in the circuit. */
export const REGION_CAPACITY = registry.capacity;

export const REGIONS = registry.regions;

/**
 * Bit 0 is a deliberately invalid sentinel, so a credential whose regionCode
 * defaulted to zero — a missing JSON field, a zeroed struct — can never prove
 * anything. VeritasCore rejects any policy that sets it.
 */
export const SENTINEL_BIT = 0;

// ── Integrity checks, run at import so a broken registry fails loudly ───────
if (REGIONS.length > REGION_CAPACITY) {
  throw new Error(
    `circuits/regions.json has ${REGIONS.length} entries but capacity is ${REGION_CAPACITY}. ` +
      `The packed public signal has only ${REGION_CAPACITY} spare bits — see docs/gas-report.md.`,
  );
}
REGIONS.forEach((r, i) => {
  if (r.bit !== i) {
    throw new Error(
      `circuits/regions.json is not append-only: entry ${i} declares bit ${r.bit}. ` +
        `Bit indices are baked into issued credentials and must never be reordered.`,
    );
  }
});

// ── Lookups ─────────────────────────────────────────────────────────────────

const byCode = new Map(REGIONS.map((r) => [r.code, r]));

/** Look up a region by its ISO alpha-2 code, e.g. "DE". */
export function regionByCode(code) {
  const r = byCode.get(String(code).toUpperCase());
  if (!r) throw new Error(`Unknown region code "${code}". See circuits/regions.json.`);
  return r;
}

/** The bit index the circuit uses for a region, e.g. "DE" -> 11. */
export const regionBit = (code) => regionByCode(code).bit;

// ── Mask arithmetic ─────────────────────────────────────────────────────────

/**
 * Build an allowlist mask from region codes.
 * @example maskOf(["DE", "FR", "IT"])
 */
export function maskOf(codes) {
  let mask = 0n;
  for (const code of codes) mask |= 1n << BigInt(regionBit(code));
  return mask;
}

/** Every valid region — i.e. "location is not restricted". */
export function maskAll() {
  let mask = 0n;
  for (const r of REGIONS) {
    if (r.bit !== SENTINEL_BIT) mask |= 1n << BigInt(r.bit);
  }
  return mask;
}

/** Whether a mask permits a given bit index. */
export const maskAllows = (mask, bit) => ((BigInt(mask) >> BigInt(bit)) & 1n) === 1n;

/** The regions a mask permits, as registry entries — used for UI and messages. */
export const regionsInMask = (mask) => REGIONS.filter((r) => maskAllows(mask, r.bit));

/**
 * How many regions a mask permits.
 *
 * This is the holder's anonymity set: a proof asserts "I am in one of these".
 * At 1 the proof reveals the region exactly. The UI surfaces this number
 * before the user commits to proving.
 */
export const anonymitySetSize = (mask) => regionsInMask(mask).length;

/** Human-readable list, for error messages and the UI. */
export const describeMask = (mask) =>
  regionsInMask(mask)
    .map((r) => r.name)
    .join(", ");

/**
 * Reject a mask the contract would also reject, so tooling fails early with a
 * useful message instead of an opaque revert. Mirrors _setPolicy.
 */
export function assertValidMask(mask) {
  const m = BigInt(mask);
  if (m === 0n) throw new Error("Region mask is empty — no proof could ever satisfy it.");
  if ((m & 1n) !== 0n) {
    throw new Error("Region mask sets bit 0, which is the reserved invalid sentinel.");
  }
  if (m >> BigInt(REGION_CAPACITY) !== 0n) {
    throw new Error(
      `Region mask sets a bit at or above ${REGION_CAPACITY}. The circuit can never ` +
        `produce such a mask, so the deployment would reject every proof.`,
    );
  }
  return m;
}
