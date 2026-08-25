/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VeritasCore — integration tests against REAL Groth16 proofs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Every attack described in docs/threat-model.md has a named test here.
 *  These are the tests that justify the design, so each one says which
 *  finding it is guarding.
 *
 *  Proving costs ~1s, so proofs are generated once per fixture and reused.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const {
  skipUnlessBuilt,
  readManifest,
  prove,
  pack,
  contextFor,
} = require('./helpers/zk');

const BIRTH_YEAR = 2000;
const SECRET = 98765432109876543210n;
const THRESHOLD = 18;
const EPOCH_SECONDS = 30 * 24 * 3600; // 30 days
const YEAR_OVERRIDE = 2026; // pin the year so tests are not calendar-dependent

describe('VeritasCore', function () {
  before(function () {
    skipUnlessBuilt(this);
  });

  /**
   * Deploys the whole system and produces one valid proof for `holder`.
   */
  async function deployAndProve() {
    const [admin, issuer, holder, relayer, attacker] = await ethers.getSigners();

    const Verifier = await ethers.getContractFactory('Groth16Verifier');
    const verifier = await Verifier.deploy();

    const Registry = await ethers.getContractFactory('CredentialRegistry');
    const registry = await Registry.deploy(admin.address, issuer.address);

    const Core = await ethers.getContractFactory('VeritasCore');
    const core = await Core.deploy(
      await verifier.getAddress(),
      await registry.getAddress(),
      admin.address,
      {
        minAge: 18,
        epochSeconds: EPOCH_SECONDS,
        maxYearLag: 1,
        yearOverride: YEAR_OVERRIDE,
        paused: false,
      },
    );

    const coreAddress = await core.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const epoch = await core.currentEpoch();
    const context = contextFor(ethers, chainId, coreAddress, epoch);

    // The holder generates the proof for themselves.
    const proof = await prove({
      birthYear: BIRTH_YEAR,
      secret: SECRET,
      subject: holder.address,
      currentYear: YEAR_OVERRIDE,
      threshold: THRESHOLD,
      context,
    });

    // The issuer registers the commitment the holder computed.
    await registry.connect(issuer).registerCommitment(proof.commitment, 0n);

    return {
      admin, issuer, holder, relayer, attacker,
      verifier, registry, core, coreAddress, chainId, epoch, context, proof,
    };
  }

  const submit = (core, signer, p) =>
    core.connect(signer).verifyAge(p.calldata.a, p.calldata.b, p.calldata.c, p.calldata.pub);

  // ═══════════════════════════════════════════════════════════════════════
  describe('wiring', function () {
    it('matches the public-signal layout the circuit actually produced', async function () {
      // Guards against the circuit being reordered without updating the
      // PUB_* constants in Solidity — which would fail silently rather than
      // loudly, because every signal is just a uint256.
      expect(readManifest().order).to.deep.equal([
        'commitment',
        'nullifier',
        'context',
        'packed',
      ]);
    });

    it('stores the verifier and registry as immutables', async function () {
      const { core, verifier, registry } = await loadFixture(deployAndProve);
      expect(await core.verifier()).to.equal(await verifier.getAddress());
      expect(await core.registry()).to.equal(await registry.getAddress());
    });

    it('proverParams returns a context that verifyAge accepts', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      const [context, , year, minAge] = await core.proverParams();
      expect(context).to.equal(BigInt(proof.calldata.pub[2]));
      expect(year).to.equal(YEAR_OVERRIDE);
      expect(minAge).to.equal(18);
      await expect(submit(core, holder, proof)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('the happy path', function () {
    it('verifies a valid proof and emits AgeVerified', async function () {
      const { core, holder, proof, epoch } = await loadFixture(deployAndProve);
      await expect(submit(core, holder, proof))
        .to.emit(core, 'AgeVerified')
        .withArgs(
          holder.address,
          holder.address,
          THRESHOLD,
          (BigInt(epoch) + 1n) * BigInt(EPOCH_SECONDS),
          BigInt(proof.nullifier),
          epoch,
        );
    });

    it('records an attestation readable from chain', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      expect(await core.isVerified(holder.address)).to.equal(false);

      await submit(core, holder, proof);

      expect(await core.isVerified(holder.address)).to.equal(true);
      expect(await core.isVerifiedAtLeast(holder.address, 18)).to.equal(true);
    });

    it('does not claim a higher age than was proven', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      await submit(core, holder, proof);
      // The holder proved >= 18, so a resource demanding 21 must refuse them.
      expect(await core.isVerifiedAtLeast(holder.address, 21)).to.equal(false);
    });

    it('expires the attestation at the end of the epoch', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      await submit(core, holder, proof);
      const att = await core.attestationOf(holder.address);

      await time.increaseTo(Number(att.validUntil) + 1);
      expect(await core.isVerified(holder.address)).to.equal(false);
    });

    it('staticVerify agrees with verifyAge', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      const [ok, reason] = await core.staticVerify(
        proof.calldata.a, proof.calldata.b, proof.calldata.c, proof.calldata.pub,
      );
      expect(ok).to.equal(true);
      expect(reason).to.equal('');
      await expect(submit(core, holder, proof)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('replay protection (finding: nullifier reuse)', function () {
    it('rejects the same proof submitted twice', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      await submit(core, holder, proof);

      await expect(submit(core, holder, proof))
        .to.be.revertedWithCustomError(core, 'NullifierAlreadyUsed')
        .withArgs(BigInt(proof.nullifier));
    });

    it('marks the nullifier as spent', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      expect(await core.nullifierUsed(proof.nullifier)).to.equal(false);
      await submit(core, holder, proof);
      expect(await core.nullifierUsed(proof.nullifier)).to.equal(true);
    });

    it('allows the SAME credential to be re-proven in a later epoch', async function () {
      // This is why the nullifier is context-scoped rather than
      // Poseidon(secret, secret): a credential must remain usable over its
      // lifetime, just not twice within one context.
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);

      const first = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });
      await submit(core, holder, first);

      await time.increase(EPOCH_SECONDS + 1);

      const second = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });

      expect(second.nullifier).to.not.equal(first.nullifier);
      await expect(submit(core, holder, second)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('proof theft / front-running (finding: unbound recipient)', function () {
    it('credits the attestation to the proof subject, not to the submitter', async function () {
      // An attacker copies the holder's calldata out of the mempool and
      // submits it first. They spend gas; the holder gets the attestation.
      const { core, holder, attacker, proof } = await loadFixture(deployAndProve);

      await submit(core, attacker, proof);

      expect(await core.isVerified(holder.address)).to.equal(true);
      expect(await core.isVerified(attacker.address)).to.equal(false);
    });

    it('cannot be redirected by editing the subject in the public signals', async function () {
      // Rewriting `packed` to name the attacker breaks the proof, because
      // `packed` is bound into the R1CS by Num2Bits(192).
      const { core, attacker, proof } = await loadFixture(deployAndProve);

      const forged = { ...proof.calldata, pub: [...proof.calldata.pub] };
      forged.pub[3] = pack(attacker.address, YEAR_OVERRIDE, THRESHOLD).toString();

      await expect(
        core.connect(attacker).verifyAge(forged.a, forged.b, forged.c, forged.pub),
      ).to.be.revertedWithCustomError(core, 'InvalidProof');
    });

    it('lets a relayer sponsor the transaction for the holder', async function () {
      // The flip side of the same property: a user with no ETH can have
      // someone else pay, without handing over any secret.
      const { core, holder, relayer, proof } = await loadFixture(deployAndProve);
      await submit(core, relayer, proof);
      expect(await core.isVerified(holder.address)).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('policy pinning (finding: prover-chosen public inputs)', function () {
    it('rejects a proof that claims a threshold below policy', async function () {
      // Without this check the prover simply submits threshold = 0.
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);

      // Same credential as the fixture — the commitment depends only on
      // (birthYear, secret), so it is already registered. Only the claim
      // changes, which is precisely the attack.
      const weak = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: 0,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });

      await expect(submit(core, holder, weak))
        .to.be.revertedWithCustomError(core, 'ThresholdBelowPolicy')
        .withArgs(0, 18);
    });

    it('accepts a threshold ABOVE policy (a stronger claim)', async function () {
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);

      const strong = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: 21,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });
      // Same commitment — the credential is unchanged, only the claim differs.
      await expect(submit(core, holder, strong)).to.not.be.reverted;
      expect(await core.isVerifiedAtLeast(holder.address, 21)).to.equal(true);
    });

    it('rejects a proof built for a year in the future', async function () {
      // Without this check the prover submits currentYear = 3000 and any
      // birth year clears any threshold.
      const { core, coreAddress, holder, issuer, registry, chainId } =
        await loadFixture(deployAndProve);

      const future = await prove({
        birthYear: 2020, secret: SECRET, subject: holder.address,
        currentYear: 2050, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });
      // A different birth year means a different commitment, so this one does
      // need registering before the year check can be reached.
      await registry.connect(issuer).registerCommitment(future.commitment, 0n);

      await expect(submit(core, holder, future))
        .to.be.revertedWithCustomError(core, 'YearInFuture')
        .withArgs(2050, YEAR_OVERRIDE);
    });

    it('rejects a proof whose year lags beyond maxYearLag', async function () {
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);

      // Same credential, so already registered — only the reference year moves.
      const stale = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE - 3, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });

      await expect(submit(core, holder, stale))
        .to.be.revertedWithCustomError(core, 'YearStale')
        .withArgs(YEAR_OVERRIDE - 3, YEAR_OVERRIDE);
    });

    it('tolerates a year lag within maxYearLag', async function () {
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);
      const lagged = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE - 1, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });
      await expect(submit(core, holder, lagged)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('context binding (finding: cross-deployment replay)', function () {
    it('rejects a proof built for a different epoch', async function () {
      const { core, coreAddress, holder, chainId, epoch } = await loadFixture(deployAndProve);

      const wrongEpoch = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, BigInt(epoch) + 5n),
      });

      await expect(submit(core, holder, wrongEpoch)).to.be.revertedWithCustomError(
        core, 'BadContext',
      );
    });

    it('rejects a proof built for a different contract address', async function () {
      // A proof minted for one deployment must not verify against another,
      // even on the same chain with identical bytecode.
      const { core, holder, chainId, epoch } = await loadFixture(deployAndProve);

      const otherDeployment = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(
          ethers, chainId, '0x000000000000000000000000000000000000dEaD', epoch,
        ),
      });

      await expect(submit(core, holder, otherDeployment)).to.be.revertedWithCustomError(
        core, 'BadContext',
      );
    });

    it('rejects a proof built for a different chain', async function () {
      const { core, coreAddress, holder, epoch } = await loadFixture(deployAndProve);

      const otherChain = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(ethers, 1n, coreAddress, epoch), // mainnet
      });

      await expect(submit(core, holder, otherChain)).to.be.revertedWithCustomError(
        core, 'BadContext',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('credential lifecycle', function () {
    it('rejects a proof whose commitment was never registered', async function () {
      const { core, coreAddress, holder, chainId } = await loadFixture(deployAndProve);

      const unregistered = await prove({
        birthYear: BIRTH_YEAR, secret: SECRET + 1n, subject: holder.address,
        currentYear: YEAR_OVERRIDE, threshold: THRESHOLD,
        context: contextFor(ethers, chainId, coreAddress, await core.currentEpoch()),
      });

      await expect(submit(core, holder, unregistered))
        .to.be.revertedWithCustomError(core, 'CommitmentNotValid')
        .withArgs(BigInt(unregistered.commitment));
    });

    it('rejects a proof after the issuer revokes the credential', async function () {
      const { core, registry, issuer, holder, proof } = await loadFixture(deployAndProve);
      await registry.connect(issuer).revokeCommitment(proof.commitment);

      await expect(submit(core, holder, proof)).to.be.revertedWithCustomError(
        core, 'CommitmentNotValid',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('malformed input', function () {
    it('rejects a tampered proof point', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      const broken = { ...proof.calldata, a: [...proof.calldata.a] };
      broken.a[0] = (BigInt(broken.a[0]) + 1n).toString();

      await expect(
        core.connect(holder).verifyAge(broken.a, broken.b, broken.c, broken.pub),
      ).to.be.revertedWithCustomError(core, 'InvalidProof');
    });

    it('rejects a packed word with bits above 2^192', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      const bad = { ...proof.calldata, pub: [...proof.calldata.pub] };
      bad.pub[3] = ((1n << 200n) | BigInt(bad.pub[3])).toString();

      await expect(
        core.connect(holder).verifyAge(bad.a, bad.b, bad.c, bad.pub),
      ).to.be.revertedWithCustomError(core, 'MalformedPublicInput');
    });

    it('rejects a zero subject', async function () {
      const { core, holder, proof } = await loadFixture(deployAndProve);
      const bad = { ...proof.calldata, pub: [...proof.calldata.pub] };
      bad.pub[3] = pack(ethers.ZeroAddress, YEAR_OVERRIDE, THRESHOLD).toString();

      await expect(
        core.connect(holder).verifyAge(bad.a, bad.b, bad.c, bad.pub),
      ).to.be.revertedWithCustomError(core, 'ZeroSubject');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('administration', function () {
    it('blocks verification while paused', async function () {
      const { core, admin, holder, proof } = await loadFixture(deployAndProve);
      await core.connect(admin).pause();
      await expect(submit(core, holder, proof)).to.be.revertedWithCustomError(
        core, 'EnforcedPause',
      );
      await core.connect(admin).unpause();
      await expect(submit(core, holder, proof)).to.not.be.reverted;
    });

    it('lets POLICY_ROLE raise the minimum age and enforces it', async function () {
      const { core, admin, holder, proof } = await loadFixture(deployAndProve);
      await core.connect(admin).setPolicy({
        minAge: 21, epochSeconds: EPOCH_SECONDS, maxYearLag: 1, yearOverride: YEAR_OVERRIDE, paused: false,
      });

      await expect(submit(core, holder, proof))
        .to.be.revertedWithCustomError(core, 'ThresholdBelowPolicy')
        .withArgs(18, 21);
    });

    it('rejects a nonsensical policy', async function () {
      const { core, admin } = await loadFixture(deployAndProve);
      const bad = { minAge: 0, epochSeconds: EPOCH_SECONDS, maxYearLag: 1, yearOverride: 0, paused: false };
      await expect(core.connect(admin).setPolicy(bad)).to.be.revertedWithCustomError(
        core, 'BadPolicy',
      );

      const shortEpoch = { minAge: 18, epochSeconds: 60, maxYearLag: 1, yearOverride: 0, paused: false };
      await expect(core.connect(admin).setPolicy(shortEpoch)).to.be.revertedWithCustomError(
        core, 'BadPolicy',
      );
    });

    it('rejects a policy change from a non-admin', async function () {
      const { core, attacker } = await loadFixture(deployAndProve);
      await expect(
        core.connect(attacker).setPolicy({
          minAge: 1, epochSeconds: EPOCH_SECONDS, maxYearLag: 0, yearOverride: 0, paused: false,
        }),
      ).to.be.revertedWithCustomError(core, 'AccessControlUnauthorizedAccount');
    });

    it('lets the admin revoke an attestation', async function () {
      const { core, admin, holder, proof } = await loadFixture(deployAndProve);
      await submit(core, holder, proof);
      expect(await core.isVerified(holder.address)).to.equal(true);

      await expect(core.connect(admin).revokeAttestation(holder.address))
        .to.emit(core, 'AttestationRevoked')
        .withArgs(holder.address, admin.address);

      expect(await core.isVerified(holder.address)).to.equal(false);
    });

    it('derives the year from block.timestamp when yearOverride is 0', async function () {
      const { core, admin } = await loadFixture(deployAndProve);
      await core.connect(admin).setPolicy({
        minAge: 18, epochSeconds: EPOCH_SECONDS, maxYearLag: 1, yearOverride: 0, paused: false,
      });
      const derived = await core.currentYear();
      const actual = new Date((await time.latest()) * 1000).getUTCFullYear();
      // The mean-year approximation can sit a day either side of 1 January.
      expect(Number(derived)).to.be.closeTo(actual, 1);
    });
  });
});
