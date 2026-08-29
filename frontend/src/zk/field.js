/**
 * BN254 field arithmetic and value packing.
 *
 * This is the browser mirror of scripts/zk/credential.mjs. The two must agree
 * exactly — a golden-vector test pins them together.
 */

/** The BN254 (alt_bn128) scalar field order. Every circuit signal is below it. */
export const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce any integer-ish value into the scalar field. */
export function toField(x) {
  const v = BigInt(x) % FIELD_ORDER;
  return v < 0n ? v + FIELD_ORDER : v;
}

export const toDec = (x) => toField(x).toString(10);

export const toHex32 = (x) => '0x' + toField(x).toString(16).padStart(64, '0');

/**
 * Generate a credential secret.
 *
 * `crypto.getRandomValues` — never `Math.random()`, which is not a CSPRNG and
 * would make every commitment in the system guessable.
 *
 * 64 bytes reduced mod r: sampling 512 bits for a ~254-bit field makes the
 * modulo bias smaller than 2^-256. Sampling exactly 32 bytes would introduce a
 * small but real bias toward low field elements.
 */
export function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return toField(v);
}

/** Where the region allowlist starts inside the packed word. */
export const MASK_OFFSET = 192n;

/** Width of the region allowlist. Must match N_REGIONS in the circuit. */
export const REGION_CAPACITY = 61;

/**
 * Pack every policy-bound value into a single field element.
 *
 *   bits [  0.. 15]  threshold    uint16
 *   bits [ 16.. 31]  currentYear  uint16
 *   bits [ 32..191]  subject      uint160
 *   bits [192..252]  regionMask   the allowlist
 *
 * Groth16 costs ~6,800 gas per public signal and the budget has under 3,000
 * gas of headroom, so carrying these separately is not affordable. Packing
 * them is what lets the location attribute cost zero extra public signals.
 */
export function pack(subject, currentYear, threshold, regionMask = 0n) {
  const s = BigInt(subject);
  const y = BigInt(currentYear);
  const t = BigInt(threshold);
  const m = BigInt(regionMask);

  if (s >= 1n << 160n) throw new RangeError('subject exceeds 160 bits');
  if (y >= 1n << 16n) throw new RangeError('currentYear exceeds 16 bits');
  if (t >= 1n << 16n) throw new RangeError('threshold exceeds 16 bits');
  if (m >= 1n << BigInt(REGION_CAPACITY)) {
    throw new RangeError(`regionMask exceeds ${REGION_CAPACITY} bits`);
  }

  return (m << MASK_OFFSET) | (s << 32n) | (y << 16n) | t;
}

export function unpack(packed) {
  const p = BigInt(packed);
  return {
    threshold: Number(p & 0xffffn),
    currentYear: Number((p >> 16n) & 0xffffn),
    subject: '0x' + ((p >> 32n) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'),
    regionMask: p >> MASK_OFFSET,
  };
}

/** Shorten a long hex or decimal value for display. */
export function shorten(value, lead = 8, tail = 6) {
  const s = String(value ?? '');
  return s.length > lead + tail + 3 ? `${s.slice(0, lead)}…${s.slice(-tail)}` : s;
}
