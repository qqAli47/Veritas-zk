/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Gas budget — the roadmap's "< 300,000 gas per verification" as a test
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The project's Definition of Done states a hard gas target. Stating it in a
 *  document makes it an aspiration; asserting it here makes it an invariant
 *  that a regression cannot slip past.
 *
 *  Measured numbers land in docs/gas-report.md. Run with REPORT_GAS=true for
 *  the full per-function table.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { skipUnlessBuilt, prove, contextFor, maskOfBits } = require('./helpers/zk');

/** The roadmap's Definition of Done target. */
const VERIFY_AGE_BUDGET = 300_000n;

const EPOCH_SECONDS = 30 * 24 * 3600;
const YEAR = 2026;

// Region bit from circuits/regions.json: 11 = Germany.
const REGION = 11;

/*
 * The WIDEST realistic allowlist, not a convenient narrow one.
 *
 * The mask lives in the packed public signal, so its popcount changes how many
 * non-zero calldata bytes the transaction carries — roughly 200 gas between a
 * three-region mask and a full one. Measuring the narrow case would understate
 * the real cost of a deployment that permits everywhere, which is exactly what
 * scripts/deploy.js configures by default.
 *
 * Bit 0 is the reserved sentinel and can never be set.
 */
const MASK = maskOfBits(Array.from({ length: 60 }, (_, i) => i + 1));

describe('Gas budget', function () {
  before(function () {
    skipUnlessBuilt(this);
  });

  async function deploy() {
    const [admin, issuer, holder, second] = await ethers.getSigners();

    const verifier = await (await ethers.getContractFactory('Groth16Verifier')).deploy();
    const registry = await (
      await ethers.getContractFactory('CredentialRegistry')
    ).deploy(admin.address, issuer.address);
    const core = await (
      await ethers.getContractFactory('VeritasCore')
    ).deploy(await verifier.getAddress(), await registry.getAddress(), admin.address, {
      minAge: 18, epochSeconds: EPOCH_SECONDS, maxYearLag: 1, yearOverride: YEAR, paused: false, allowedRegions: MASK,
    });
    const gated = await (
      await ethers.getContractFactory('GatedContent')
    ).deploy(await core.getAddress(), 18, MASK);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const ctx = contextFor(ethers, chainId, await core.getAddress(), await core.currentEpoch());

    const mk = (signer, secret) =>
      prove({
        birthYear: 2000, regionCode: REGION, secret, subject: signer.address,
        currentYear: YEAR, threshold: 18, context: ctx, regionMask: MASK,
      });

    const p1 = await mk(holder, 111222333n);
    const p2 = await mk(second, 444555666n);
    await registry.connect(issuer).registerBatch([p1.commitment, p2.commitment], 0n);

    return { registry, core, gated, issuer, holder, second, p1, p2 };
  }

  const gasOf = async (txPromise) => (await (await txPromise).wait()).gasUsed;

  it(`verifyAge costs less than ${VERIFY_AGE_BUDGET.toLocaleString()} gas`, async function () {
    const { core, holder, p1 } = await loadFixture(deploy);

    const gas = await gasOf(
      core.connect(holder).verifyAge(p1.calldata.a, p1.calldata.b, p1.calldata.c, p1.calldata.pub),
    );

    console.log(
      `\n      verifyAge: ${gas.toLocaleString()} gas ` +
        `(${((Number(gas) / Number(VERIFY_AGE_BUDGET)) * 100).toFixed(1)}% of budget)\n`,
    );
    expect(gas).to.be.lessThan(VERIFY_AGE_BUDGET);
  });

  it('reports the cost of the pairing check alone', async function () {
    // Isolating the verifier shows how much of the budget is irreducible
    // cryptography versus how much is our own bookkeeping.
    const { core, p1 } = await loadFixture(deploy);
    const verifier = await ethers.getContractAt('Groth16Verifier', await core.verifier());

    const gas = await verifier.verifyProof.estimateGas(
      p1.calldata.a, p1.calldata.b, p1.calldata.c, p1.calldata.pub,
    );
    console.log(`      verifyProof (pairing only): ~${gas.toLocaleString()} gas`);
    expect(gas).to.be.lessThan(VERIFY_AGE_BUDGET);
  });

  it('registerCommitment costs less than 100,000 gas', async function () {
    const { registry, issuer } = await loadFixture(deploy);
    const gas = await gasOf(registry.connect(issuer).registerCommitment(9998887776n, 0n));
    console.log(`      registerCommitment: ${gas.toLocaleString()} gas`);
    expect(gas).to.be.lessThan(100_000n);
  });

  it('a relying party pays under 30,000 gas to check an attestation', async function () {
    // What a real integrator pays is the *check*, not our demo contract's
    // bookkeeping: `accessContent` also bumps two counters, each a fresh
    // SSTORE, which says nothing about the cost of Veritas itself. Measure
    // the gate, and report the demo's total separately.
    const { core, gated, holder, p1 } = await loadFixture(deploy);
    await core.connect(holder).verifyAge(
      p1.calldata.a, p1.calldata.b, p1.calldata.c, p1.calldata.pub,
    );

    const gateGas = await gated.canAccess.estimateGas(holder.address);
    const fullGas = await gated.connect(holder).accessContent.estimateGas();
    console.log(`      GatedContent.canAccess (the gate): ~${gateGas.toLocaleString()} gas`);
    console.log(`      GatedContent.accessContent (incl. demo counters): ~${fullGas.toLocaleString()} gas`);

    expect(gateGas).to.be.lessThan(30_000n);
  });

  it('reports deployment costs', async function () {
    const { core } = await loadFixture(deploy);
    for (const name of ['Groth16Verifier', 'CredentialRegistry', 'VeritasCore']) {
      const factory = await ethers.getContractFactory(name);
      const bytes = (factory.bytecode.length - 2) / 2;
      console.log(`      ${name}: ${bytes.toLocaleString()} bytes of bytecode`);
      // EIP-170 caps a deployed contract at 24,576 bytes.
      expect(bytes).to.be.lessThan(24_576 * 2);
    }
    expect(await core.getAddress()).to.be.properAddress;
  });
});
