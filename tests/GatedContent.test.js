/**
 * GatedContent — proves the access gate is enforced by the EVM, not the UI.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { skipUnlessBuilt, prove, contextFor, maskOfBits } = require('./helpers/zk');

const EPOCH_SECONDS = 30 * 24 * 3600;
const YEAR = 2026;

// Region bits from circuits/regions.json.
const FR = 10;
const DE = 11;
const IT = 15;
const REGION = DE;
const MASK = maskOfBits([FR, DE, IT]);

describe('GatedContent (a relying party)', function () {
  before(function () {
    skipUnlessBuilt(this);
  });

  async function deploy() {
    const [admin, issuer, holder] = await ethers.getSigners();

    const verifier = await (await ethers.getContractFactory('Groth16Verifier')).deploy();
    const registry = await (
      await ethers.getContractFactory('CredentialRegistry')
    ).deploy(admin.address, issuer.address);
    const core = await (
      await ethers.getContractFactory('VeritasCore')
    ).deploy(await verifier.getAddress(), await registry.getAddress(), admin.address, {
      minAge: 18,
      epochSeconds: EPOCH_SECONDS,
      maxYearLag: 1,
      yearOverride: YEAR,
      paused: false,
      allowedRegions: MASK,
    });

    // An 18+ resource deployed by a third party that knows nothing about ZK.
    const gated = await (
      await ethers.getContractFactory('GatedContent')
    ).deploy(await core.getAddress(), 18, MASK);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const proof = await prove({
      birthYear: 2000,
      regionCode: REGION,
      secret: 555666777888n,
      subject: holder.address,
      currentYear: YEAR,
      threshold: 18,
      regionMask: MASK,
      context: contextFor(ethers, chainId, await core.getAddress(), await core.currentEpoch()),
    });
    await registry.connect(issuer).registerCommitment(proof.commitment, 0n);

    return { core, gated, holder, proof };
  }

  it('blocks a caller who has not verified', async function () {
    const { gated, holder } = await loadFixture(deploy);
    expect(await gated.canAccess(holder.address)).to.equal(false);
    await expect(gated.connect(holder).accessContent())
      .to.be.revertedWithCustomError(gated, 'NotAgeVerified')
      .withArgs(holder.address, 18);
  });

  it('admits the caller once they have verified on-chain', async function () {
    const { core, gated, holder, proof } = await loadFixture(deploy);
    await core.connect(holder).verifyAge(
      proof.calldata.a, proof.calldata.b, proof.calldata.c, proof.calldata.pub,
    );

    expect(await gated.canAccess(holder.address)).to.equal(true);
    await expect(gated.connect(holder).accessContent())
      .to.emit(gated, 'ContentAccessed')
      .withArgs(holder.address, 1n);
  });

  it('blocks the caller again once the attestation expires', async function () {
    const { core, gated, holder, proof } = await loadFixture(deploy);
    await core.connect(holder).verifyAge(
      proof.calldata.a, proof.calldata.b, proof.calldata.c, proof.calldata.pub,
    );

    const att = await core.attestationOf(holder.address);
    await time.increaseTo(Number(att.validUntil) + 1);

    expect(await gated.canAccess(holder.address)).to.equal(false);
    await expect(gated.connect(holder).accessContent()).to.be.revertedWithCustomError(
      gated, 'NotAgeVerified',
    );
  });

  it('blocks a caller whose proven age is below what the resource demands', async function () {
    const { core, gated, holder, proof } = await loadFixture(deploy);
    await core.connect(holder).verifyAge(
      proof.calldata.a, proof.calldata.b, proof.calldata.c, proof.calldata.pub,
    );

    // A stricter resource on the same attestor.
    const gated21 = await (
      await ethers.getContractFactory('GatedContent')
    ).deploy(await core.getAddress(), 21, MASK);

    expect(await gated.canAccess(holder.address)).to.equal(true);
    expect(await gated21.canAccess(holder.address)).to.equal(false);
  });
});
