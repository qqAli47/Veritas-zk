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
const { poseidon2: poseidonLite } = require('poseidon-lite');
const { skipUnlessBuilt, poseidon2: poseidonJs, prove, pack, toField } = require('./helpers/zk');

// Fixed vectors, including edge cases at both ends of the field.
const VECTORS = [
  [2000n, 12345678901234567890n],
  [1n, 1n],
  [0n, 0n],
  [1900n, 2n ** 200n],
  [2026n, 21888242871839275222246405745257275088548364400416034343698204186575808495616n],
];

describe('Poseidon parity across implementations', function () {
  it('poseidon-lite (browser) agrees with circomlibjs (Node) on every vector', async function () {
    for (const [a, b] of VECTORS) {
      const lite = poseidonLite([toField(a), toField(b)]).toString();
      const js = await poseidonJs(a, b);
      expect(lite, `mismatch for Poseidon(${a}, ${b})`).to.equal(js);
    }
  });

  describe('against the circuit itself', function () {
    before(function () {
      skipUnlessBuilt(this);
    });

    it('both JS implementations match the commitment the circuit computes', async function () {
      const birthYear = 2000;
      const secret = 12345678901234567890n;

      const { publicSignals } = await prove({
        birthYear,
        secret,
        subject: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        currentYear: 2026,
        threshold: 18,
        context: 987654321987654321n,
      });

      const inCircuit = publicSignals[0];
      expect(poseidonLite([toField(birthYear), toField(secret)]).toString()).to.equal(inCircuit);
      expect(await poseidonJs(birthYear, secret)).to.equal(inCircuit);
    });

    it('both JS implementations match the nullifier the circuit computes', async function () {
      const secret = 555666777888999n;
      const context = 424242424242n;

      const { publicSignals } = await prove({
        birthYear: 2000,
        secret,
        subject: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        currentYear: 2026,
        threshold: 18,
        context,
      });

      const inCircuit = publicSignals[1];
      expect(poseidonLite([toField(secret), toField(context)]).toString()).to.equal(inCircuit);
      expect(await poseidonJs(secret, context)).to.equal(inCircuit);
    });

    it('the JS packing matches what the circuit received', async function () {
      const subject = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      const { publicSignals } = await prove({
        birthYear: 2000,
        secret: 42n,
        subject,
        currentYear: 2026,
        threshold: 21,
        context: 7n,
      });
      expect(publicSignals[3]).to.equal(pack(subject, 2026, 21).toString());
    });
  });
});
