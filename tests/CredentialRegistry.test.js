/**
 * Unit tests for CredentialRegistry — the issuance authority.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

const FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const COMMITMENT = 111222333444555666777n;
const NEVER = 0n;

describe('CredentialRegistry', function () {
  async function deploy() {
    const [admin, issuer, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('CredentialRegistry');
    const registry = await Registry.deploy(admin.address, issuer.address);
    await registry.waitForDeployment();
    return { registry, admin, issuer, stranger };
  }

  // ═══════════════════════════════════════════════════════════════════════
  describe('roles', function () {
    it('grants DEFAULT_ADMIN_ROLE to the admin', async function () {
      const { registry, admin } = await loadFixture(deploy);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(
        true,
      );
    });

    it('grants ISSUER_ROLE and REVOKER_ROLE to the issuer', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      expect(await registry.hasRole(await registry.ISSUER_ROLE(), issuer.address)).to.equal(true);
      expect(await registry.hasRole(await registry.REVOKER_ROLE(), issuer.address)).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('registration', function () {
    it('lets the issuer register a commitment and emits the event', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await expect(registry.connect(issuer).registerCommitment(COMMITMENT, NEVER))
        .to.emit(registry, 'CommitmentRegistered')
        .withArgs(COMMITMENT, issuer.address, NEVER);

      expect(await registry.isRegistered(COMMITMENT)).to.equal(true);
      expect(await registry.isValid(COMMITMENT)).to.equal(true);
      expect(await registry.totalRegistered()).to.equal(1n);
    });

    it('rejects registration from a non-issuer', async function () {
      // OpenZeppelin v5 reverts with a typed error, not a require string.
      const { registry, stranger } = await loadFixture(deploy);
      await expect(registry.connect(stranger).registerCommitment(COMMITMENT, NEVER))
        .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
        .withArgs(stranger.address, await registry.ISSUER_ROLE());
    });

    it('rejects a zero commitment', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await expect(registry.connect(issuer).registerCommitment(0n, NEVER))
        .to.be.revertedWithCustomError(registry, 'InvalidCommitment')
        .withArgs(0n);
    });

    it('rejects a commitment at or above the scalar field order', async function () {
      // No such value could ever come out of the circuit.
      const { registry, issuer } = await loadFixture(deploy);
      await expect(registry.connect(issuer).registerCommitment(FIELD_ORDER, NEVER))
        .to.be.revertedWithCustomError(registry, 'InvalidCommitment')
        .withArgs(FIELD_ORDER);
    });

    it('rejects a duplicate registration', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);
      await expect(registry.connect(issuer).registerCommitment(COMMITMENT, NEVER))
        .to.be.revertedWithCustomError(registry, 'AlreadyRegistered')
        .withArgs(COMMITMENT);
    });

    it('returns false for an unknown commitment', async function () {
      const { registry } = await loadFixture(deploy);
      expect(await registry.isRegistered(999n)).to.equal(false);
      expect(await registry.isValid(999n)).to.equal(false);
    });

    it('registers a batch in one transaction', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await registry.connect(issuer).registerBatch([1n, 2n, 3n], NEVER);
      expect(await registry.totalRegistered()).to.equal(3n);
      expect(await registry.isValid(2n)).to.equal(true);
    });

    it('rejects an empty batch', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await expect(
        registry.connect(issuer).registerBatch([], NEVER),
      ).to.be.revertedWithCustomError(registry, 'EmptyBatch');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('revocation', function () {
    it('lets the revoker revoke, after which the credential is invalid but still known', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);

      await expect(registry.connect(issuer).revokeCommitment(COMMITMENT))
        .to.emit(registry, 'CommitmentRevoked')
        .withArgs(COMMITMENT, issuer.address);

      expect(await registry.isValid(COMMITMENT)).to.equal(false);
      expect(await registry.isRevoked(COMMITMENT)).to.equal(true);
      // Still registered — so re-registering the same commitment is impossible.
      expect(await registry.isRegistered(COMMITMENT)).to.equal(true);
    });

    it('rejects revocation from a non-revoker', async function () {
      const { registry, issuer, stranger } = await loadFixture(deploy);
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);
      await expect(
        registry.connect(stranger).revokeCommitment(COMMITMENT),
      ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');
    });

    it('rejects revoking something that was never registered', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await expect(registry.connect(issuer).revokeCommitment(COMMITMENT))
        .to.be.revertedWithCustomError(registry, 'UnknownCommitment')
        .withArgs(COMMITMENT);
    });

    it('rejects a double revocation', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);
      await registry.connect(issuer).revokeCommitment(COMMITMENT);
      await expect(registry.connect(issuer).revokeCommitment(COMMITMENT))
        .to.be.revertedWithCustomError(registry, 'AlreadyRevoked')
        .withArgs(COMMITMENT);
    });

    it('cannot be undone', async function () {
      // There is deliberately no un-revoke path: a compromised issuer key
      // must not be able to quietly restore a withdrawn credential.
      const { registry } = await loadFixture(deploy);
      expect(registry.interface.fragments.some((f) => f.name === 'unrevokeCommitment')).to.equal(
        false,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('expiry', function () {
    it('treats expiresAt = 0 as never expiring', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);
      await time.increase(365 * 24 * 3600 * 50);
      expect(await registry.isValid(COMMITMENT)).to.equal(true);
    });

    it('treats a credential past its expiry as invalid', async function () {
      const { registry, issuer } = await loadFixture(deploy);
      const expiresAt = (await time.latest()) + 3600;
      await registry.connect(issuer).registerCommitment(COMMITMENT, expiresAt);

      expect(await registry.isValid(COMMITMENT)).to.equal(true);
      await time.increaseTo(expiresAt + 1);
      expect(await registry.isValid(COMMITMENT)).to.equal(false);
      // …but it is still on the record.
      expect(await registry.isRegistered(COMMITMENT)).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('pausing', function () {
    it('blocks registration while paused and resumes after unpause', async function () {
      const { registry, admin, issuer } = await loadFixture(deploy);
      await registry.connect(admin).pause();
      await expect(
        registry.connect(issuer).registerCommitment(COMMITMENT, NEVER),
      ).to.be.revertedWithCustomError(registry, 'EnforcedPause');

      await registry.connect(admin).unpause();
      await registry.connect(issuer).registerCommitment(COMMITMENT, NEVER);
      expect(await registry.isValid(COMMITMENT)).to.equal(true);
    });

    it('only lets the admin pause', async function () {
      const { registry, stranger } = await loadFixture(deploy);
      await expect(registry.connect(stranger).pause()).to.be.revertedWithCustomError(
        registry,
        'AccessControlUnauthorizedAccount',
      );
    });
  });
});
