/**
 * The region registry, browser side.
 *
 * `regions.generated.json` is copied out of circuits/regions.json by
 * scripts/zk/build.mjs — the same mechanism that publishes the public-signal
 * manifest. Never edit the generated file; edit the source and rebuild.
 */

import registry from './regions.generated.json';

export const REGION_CAPACITY = registry.capacity;
export const REGIONS = registry.regions;

/** Bit 0 is a reserved invalid sentinel; no valid policy may set it. */
export const SENTINEL_BIT = 0;

/** Every region a holder can legitimately be issued for. */
export const SELECTABLE_REGIONS = REGIONS.filter((r) => r.bit !== SENTINEL_BIT);

const byBit = new Map(REGIONS.map((r) => [r.bit, r]));
const byCode = new Map(REGIONS.map((r) => [r.code, r]));

export const regionByBit = (bit) => byBit.get(Number(bit)) ?? null;
export const regionByCode = (code) => byCode.get(String(code).toUpperCase()) ?? null;

/** Whether a mask permits a given region bit. */
export const maskAllows = (mask, bit) => ((BigInt(mask) >> BigInt(bit)) & 1n) === 1n;

/** The registry entries a mask permits. */
export const regionsInMask = (mask) => REGIONS.filter((r) => maskAllows(mask, r.bit));

/**
 * How many regions a mask permits.
 *
 * This is the holder's anonymity set. A proof asserts "I am in one of these",
 * so at 1 it reveals the region exactly. The Prove page shows this number
 * before the user commits to proving anything.
 */
export const anonymitySetSize = (mask) => regionsInMask(mask).length;

/** A readable list of permitted regions, for the UI and error messages. */
export function describeMask(mask, limit = 6) {
  const names = regionsInMask(mask).map((r) => r.name);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/** Group regions for a <select>, so the picker is navigable at 60 entries. */
export function groupedRegions() {
  const groups = new Map();
  for (const r of SELECTABLE_REGIONS) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }
  return [...groups.entries()];
}
