/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Cross-boundary parity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Three independent implementations of the same hash have to agree exactly,
 *  or the system fails in a way that is very hard to diagnose:
 *
 *    1. the circuit          (circomlib Poseidon, inside the R1CS)
 *    2. the Node tooling     (circomlibjs — scripts/, tests/)
 *    3. the browser          (poseidon-lite — frontend/src/zk/poseidon.js)
 *
 *  If (3) drifted from (1), the frontend would compute a commitment the issuer
 *  registers, then generate a proof whose in-circuit commitment differs, and
 *  the transaction would revert with `CommitmentNotValid` — pointing at the
 *  registry rather than at the hash function. This test makes that a build
 *  failure instead.
 */

const { expect } = require('chai');
const { poseidon2: poseidonLite, poseidon3: poseidonLite3 } = require('poseidon-lite');
const {
  skipUnlessBuilt,
  poseidon2: poseidonJs,
  poseidon3: poseidon3Js,
  prove,
  pack,
  maskOfBits,
  toField,
} = require('./helpers/zk');

// Fixed vectors, including edge cases at both ends of the field.
const VECTORS = [
  [2000n, 12345678901234567890n],
  [1n, 1n],
  [0n, 0n],
  [1900n, 2n ** 200n],
  [2026n, 21888242871839275222246405745257275088548364400416034343698204186575808495616n],
];

describe('Field packing parity across implementations', function () {
  // The packed word carries the subject address, the reference year, the age
  // threshold — and, from v4, the region allowlist. Three implementations build
  // it: the canonical Node module, the browser mirror, and this suite's test
  // oracle. If any two disagree the proof silently encodes something other than
  // what the contract will unpack, so pin them.
  const CASES = [
    ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 2026, 18, maskOfBits([10, 11, 15])],
    ['0x0000000000000000000000000000000000000001', 1900, 0, 0n],
    ['0xffffffffffffffffffffffffffffffffffffffff', 65535, 65535, 0n],
    // Boundary: bit 60 is the topmost region, landing at packed bit 252 — the
    // very top of Num2Bits(253). Catches an off-by-one in the decomposition.
    ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 2026, 18, 1n << 60n],
    // Boundary: bit 0 lands at packed bit 192 — the bottom of the mask.
    // Catches a >> 192 vs >> 193 slice error.
    ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 2026, 18, 1n],
  ];

  it('the canonical Node module and the test oracle agree', async function () {
    const node = await import('../scripts/zk/credential.mjs');
    for (const [subject, year, threshold, mask] of CASES) {
      expect(node.pack(subject, year, threshold, mask).toString()).to.equal(
        pack(subject, year, threshold, mask).toString(),
        `pack mismatch for ${subject}, ${year}, ${threshold}, mask ${mask}`,
      );
    }
  });

  it('the browser mirror agrees with the canonical Node module', async function () {
    const node = await import('../scripts/zk/credential.mjs');
    const browser = await import('../frontend/src/zk/field.js');
    for (const [subject, year, threshold, mask] of CASES) {
      expect(browser.pack(subject, year, threshold, mask).toString()).to.equal(
        node.pack(subject, year, threshold, mask).toString(),
      );
    }
  });

  it('unpack inverts pack in both implementations', async function () {
    const node = await import('../scripts/zk/credential.mjs');
    const browser = await import('../frontend/src/zk/field.js');
    for (const [subject, year, threshold, mask] of CASES) {
      const packed = node.pack(subject, year, threshold, mask);
      for (const [name, impl] of [
        ['node', node],
        ['browser', browser],
      ]) {
        const back = impl.unpack(packed);
        expect(back.subject.toLowerCase(), name).to.equal(subject.toLowerCase());
        expect(back.currentYear, name).to.equal(year);
        expect(back.threshold, name).to.equal(threshold);
        expect(back.regionMask, name).to.equal(mask);
      }
    }
  });
});

describe('Poseidon parity across implementations', function () {
  it('poseidon-lite (browser) agrees with circomlibjs (Node) on every vector', async function () {
    for (const [a, b] of VECTORS) {
      const lite = poseidonLite([toField(a), toField(b)]).toString();
      const js = await poseidonJs(a, b);
      expect(lite, `mismatch for Poseidon(${a}, ${b})`).to.equal(js);
    }
  });

  it('the two implementations agree on the THREE-input hash too', async function () {
    // The commitment moved to Poseidon(3) when location was added. A drift
    // here surfaces as CommitmentNotValid, which points at the registry
    // rather than at the hash function — so pin it explicitly.
    const TRIPLES = [
      [2000n, 11n, 12345678901234567890n],
      [1900n, 0n, 0n],
      [2026n, 60n, 2n ** 200n],
    ];
    for (const [a, b, c] of TRIPLES) {
      const lite = poseidonLite3([toField(a), toField(b), toField(c)]).toString();
      const js = await poseidon3Js(a, b, c);
      expect(lite, `mismatch for Poseidon(${a}, ${b}, ${c})`).to.equal(js);
    }
  });

  describe('against the circuit itself', function () {
    before(function () {
      skipUnlessBuilt(this);
    });

    it('both JS implementations match the commitment the circuit computes', async function () {
      const birthYear = 2000;
      const regionCode = 11;
      const secret = 12345678901234567890n;
      const mask = maskOfBits([10, 11, 15]);

      const { publicSignals } = await prove({
        birthYear,
        regionCode,
        secret,
        subject: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        currentYear: 2026,
        threshold: 18,
        context: 987654321987654321n,
        regionMask: mask,
      });

      const inCircuit = publicSignals[0];
      expect(
        poseidonLite3([toField(birthYear), toField(regionCode), toField(secret)]).toString(),
      ).to.equal(inCircuit);
      expect(await poseidon3Js(birthYear, regionCode, secret)).to.equal(inCircuit);
    });

    it('both JS implementations match the nullifier the circuit computes', async function () {
      const secret = 555666777888999n;
      const context = 424242424242n;

      const { publicSignals } = await prove({
        birthYear: 2000,
        regionCode: 11,
        secret,
        subject: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        currentYear: 2026,
        threshold: 18,
        context,
        regionMask: maskOfBits([10, 11, 15]),
      });

      const inCircuit = publicSignals[1];
      expect(poseidonLite([toField(secret), toField(context)]).toString()).to.equal(inCircuit);
      expect(await poseidonJs(secret, context)).to.equal(inCircuit);
    });

    it('the JS packing matches what the circuit received', async function () {
      const subject = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      const mask = maskOfBits([10, 11, 15]);
      const { publicSignals } = await prove({
        birthYear: 2000,
        regionCode: 11,
        secret: 42n,
        subject,
        currentYear: 2026,
        threshold: 21,
        context: 7n,
        regionMask: mask,
      });
      expect(publicSignals[3]).to.equal(pack(subject, 2026, 21, mask).toString());
    });
  });
});
