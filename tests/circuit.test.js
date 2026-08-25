/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Circuit tests — circuits/attribute_check.circom
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  These exercise the circuit directly through snarkjs, with no chain
 *  involved. They fall into three groups:
 *
 *    1. Layout   — the public-signal order downstream code depends on
 *    2. Semantics— the commitment and nullifier match their JS counterparts
 *    3. Soundness— an attacker cannot satisfy the constraints by cheating
 *
 *  Group 3 is the interesting one, and includes a regression test for the
 *  field-element attack that the original v1 circuit was vulnerable to.
 */

const { expect } = require('chai');
const {
  skipUnlessBuilt,
  readManifest,
  readVkey,
  commitmentOf,
  nullifierOf,
  pack,
  prove,
  verifyLocally,
  witnessSucceeds,
  toField,
  FIELD_ORDER,
} = require('./helpers/zk');

// A fixed development credential.
const BIRTH_YEAR = 2000;
const SECRET = 12345678901234567890n;
const SUBJECT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const YEAR = 2026;
const THRESHOLD = 18;
const CONTEXT = 987654321987654321n;

const base = (over = {}) => ({
  birthYear: BIRTH_YEAR,
  secret: SECRET,
  subject: SUBJECT,
  currentYear: YEAR,
  threshold: THRESHOLD,
  context: CONTEXT,
  ...over,
});

/** Build a raw circuit input object without proving (for negative cases). */
const rawInput = (o) => ({
  context: toField(o.context).toString(),
  packed: pack(o.subject, o.currentYear, o.threshold).toString(),
  birthYear: String(o.birthYear),
  secret: toField(o.secret).toString(),
});

describe('AttributeCheck circuit', function () {
  before(function () {
    skipUnlessBuilt(this);
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('public signal layout', function () {
    it('exposes exactly 4 public signals', function () {
      expect(readManifest().nPublic).to.equal(4);
    });

    it('orders them as [commitment, nullifier, context, packed]', function () {
      expect(readManifest().order).to.deep.equal([
        'commitment',
        'nullifier',
        'context',
        'packed',
      ]);
    });

    it('binds every public signal into the proof (no IC point at infinity)', function () {
      // Groth16 derives one IC point per public signal, plus one constant. A
      // point at infinity would mean verification ignores that signal entirely
      // — a silent, total break of whatever it was supposed to pin down.
      const vkey = readVkey();
      expect(vkey.IC).to.have.lengthOf(vkey.nPublic + 1);
      for (const [i, point] of vkey.IC.entries()) {
        expect(point[2], `IC[${i}] is the point at infinity`).to.not.equal('0');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('value derivation', function () {
    it('computes commitment = Poseidon(birthYear, secret)', async function () {
      const { publicSignals } = await prove(base());
      expect(publicSignals[0]).to.equal(await commitmentOf(BIRTH_YEAR, SECRET));
    });

    it('computes nullifier = Poseidon(secret, context)', async function () {
      const { publicSignals } = await prove(base());
      expect(publicSignals[1]).to.equal(await nullifierOf(SECRET, CONTEXT));
    });

    it('gives the same nullifier for the same (secret, context)', async function () {
      const a = await prove(base());
      const b = await prove(base());
      expect(a.nullifier).to.equal(b.nullifier);
    });

    it('gives a DIFFERENT nullifier in a different context', async function () {
      // This is the unlinkability property: two relying parties, or two
      // epochs, cannot correlate the same credential's uses.
      const a = await prove(base());
      const b = await prove(base({ context: CONTEXT + 1n }));
      expect(a.nullifier).to.not.equal(b.nullifier);
      expect(a.commitment).to.equal(b.commitment); // same credential, though
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('age assertion — accepted cases', function () {
    it('accepts an age comfortably above the threshold', async function () {
      const { proof, publicSignals } = await prove(base());
      expect(await verifyLocally(publicSignals, proof)).to.equal(true);
    });

    it('accepts an age exactly equal to the threshold', async function () {
      const { proof, publicSignals } = await prove(base({ birthYear: 2008 })); // 2026-2008 = 18
      expect(await verifyLocally(publicSignals, proof)).to.equal(true);
    });

    it('accepts a threshold higher than 18 when the holder is old enough', async function () {
      const { proof, publicSignals } = await prove(base({ threshold: 21 }));
      expect(await verifyLocally(publicSignals, proof)).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('age assertion — rejected cases', function () {
    it('rejects an age one year below the threshold', async function () {
      expect(await witnessSucceeds(rawInput(base({ birthYear: 2009 })))).to.equal(false);
    });

    it('rejects a birth year in the future', async function () {
      expect(await witnessSucceeds(rawInput(base({ birthYear: 2030 })))).to.equal(false);
    });

    it('rejects a birth year below the plausible floor (1900)', async function () {
      expect(await witnessSucceeds(rawInput(base({ birthYear: 1899 })))).to.equal(false);
    });

    it('rejects an implausible age above the ceiling (130)', async function () {
      // The two bounds must be probed independently. At currentYear = 2026 the
      // 1900 floor already caps the age at 126, so the ceiling is unreachable
      // and a naive "birthYear = 1890" case would actually be testing the
      // floor while claiming to test the ceiling. Move the reference year out
      // so that MAX_AGE is genuinely the binding constraint: 2050 - 1900 = 150.
      const input = rawInput(base({ birthYear: 1900, currentYear: 2050 }));
      expect(await witnessSucceeds(input)).to.equal(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('soundness', function () {
    /**
     * THE REGRESSION TEST THAT MATTERS MOST.
     *
     * Circuit signals are BN254 field elements, not integers. The original v1
     * circuit computed `age = currentYear - birthYear` and compared it with an
     * 8-bit comparator, but never constrained `birthYear` itself. An attacker
     * could therefore choose `birthYear = p - k`, making the subtraction wrap
     * so that `age` came out as any value they wanted — including a perfectly
     * respectable 18 — while the "birth year" was an astronomically large
     * number that no honest input could produce.
     *
     * Num2Bits(16) on birthYear is what closes this: there is simply no
     * satisfying witness for a value that does not fit in 16 bits.
     */
    it('rejects a birth year supplied as a large field element (the p−k attack)', async function () {
      const k = 100n;
      const wrapping = FIELD_ORDER - k; // "age" would wrap to 2026 + 100
      expect(await witnessSucceeds(rawInput(base({ birthYear: wrapping })))).to.equal(false);
    });

    it('rejects a packed word with bits set above 2^192', async function () {
      const input = rawInput(base());
      input.packed = (BigInt(input.packed) | (1n << 200n)).toString();
      expect(await witnessSucceeds(input)).to.equal(false);
    });

    it('rejects a proof whose public signals were altered after generation', async function () {
      const { proof, publicSignals } = await prove(base());
      const tampered = [...publicSignals];
      tampered[3] = pack(
        '0x000000000000000000000000000000000000dEaD', // an attacker's address
        YEAR,
        THRESHOLD,
      ).toString();
      expect(await verifyLocally(tampered, proof)).to.equal(false);
    });

    it('rejects a proof whose context was altered after generation', async function () {
      const { proof, publicSignals } = await prove(base());
      const tampered = [...publicSignals];
      tampered[2] = (BigInt(tampered[2]) + 1n).toString();
      expect(await verifyLocally(tampered, proof)).to.equal(false);
    });

    it('rejects a tampered proof point', async function () {
      const { proof, publicSignals } = await prove(base());
      const broken = JSON.parse(JSON.stringify(proof));
      broken.pi_a[0] = (BigInt(broken.pi_a[0]) + 1n).toString();
      expect(await verifyLocally(publicSignals, broken)).to.equal(false);
    });

    it('produces a different commitment for a different secret', async function () {
      // i.e. you cannot open someone else's commitment with your own secret
      const a = await prove(base());
      const b = await prove(base({ secret: SECRET + 1n }));
      expect(a.commitment).to.not.equal(b.commitment);
    });
  });
});
