// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IGroth16Verifier, ICredentialRegistry, IVeritasAttestor} from "./interfaces/IVeritas.sol";

/**
 * @title VeritasCore
 * @author Veritas-zk
 * @notice The verification entry point and the policy authority.
 *
 * @dev THE CENTRAL IDEA
 *
 *      A zk-SNARK proves that a computation was performed correctly on inputs
 *      the prover chose. It does NOT, by itself, prove that those inputs were
 *      the *right* ones. Every public signal is therefore something the prover
 *      selected and this contract must independently check against state the
 *      prover does not control.
 *
 *      Concretely, without the checks in `verifyAge`:
 *
 *        - a prover submits `threshold = 0` and every proof passes;
 *        - a prover submits `currentYear = 3000` and a newborn is an adult;
 *        - an observer copies a valid proof out of the mempool and front-runs
 *          the real holder with it.
 *
 *      All three are closed below. This is the substance of the system: the
 *      circuit proves knowledge, the contract enforces policy.
 *
 * @dev PUBLIC SIGNAL LAYOUT — mirrors circuits/attribute_check.circom.
 *      Asserted against circuits/public_signals.json by the test suite.
 */
contract VeritasCore is AccessControl, IVeritasAttestor {
    // ─────────────────────────────────────────────────────────────────────
    //  Public-signal indices
    // ─────────────────────────────────────────────────────────────────────
    uint256 private constant PUB_COMMITMENT = 0;
    uint256 private constant PUB_NULLIFIER = 1;
    uint256 private constant PUB_CONTEXT = 2;
    uint256 private constant PUB_PACKED = 3;

    bytes32 public constant POLICY_ROLE = keccak256("VERITAS_POLICY_ROLE");

    /**
     * @notice Domain separation tag baked into every context id.
     * @dev Also an emergency lever: were this ever changed, every outstanding
     *      proof would stop verifying at once.
     */
    bytes32 public constant CONTEXT_TAG = keccak256("Veritas-zk/AgeAttestation/v1");

    /**
     * @dev Mean Gregorian year in seconds (365.2425 days). Anchored at the
     *      Unix epoch this tracks the true 1 January boundary to within about
     *      half a day through 2100 — far inside the tolerance we need, since
     *      `maxYearLag` already permits the proof's year to trail the chain's.
     *      `Policy.yearOverride` is the escape hatch if that ever matters.
     */
    uint256 private constant AVG_YEAR_SECONDS = 31_556_952;

    // ─────────────────────────────────────────────────────────────────────
    //  Wiring — immutable, so the hot path pays no SLOAD to reach them
    // ─────────────────────────────────────────────────────────────────────
    IGroth16Verifier public immutable verifier;
    ICredentialRegistry public immutable registry;

    /**
     * @dev 16 + 32 + 16 + 16 + 8 = 88 bits => one slot, one SLOAD per verification.
     *
     *      `paused` lives here rather than in OpenZeppelin's Pausable for a
     *      concrete reason: Pausable keeps its flag in a slot of its own, so
     *      `whenNotPaused` would add a second cold SLOAD (2,100 gas) to every
     *      verification. Carrying the bit in a slot we already have to load
     *      makes the emergency stop effectively free. The behaviour is
     *      identical; only the storage layout differs.
     */
    struct Policy {
        uint16 minAge; //         the lowest threshold this deployment accepts
        uint32 epochSeconds; //   how long a verification context (and attestation) lasts
        uint16 maxYearLag; //     how many years a proof's `currentYear` may trail the chain's
        uint16 yearOverride; //   0 = derive the year from block.timestamp
        bool paused; //           emergency stop
    }
    Policy public policy;

    mapping(address subject => Attestation) private _attestations;
    mapping(uint256 nullifier => bool) public nullifierUsed;

    // NOTE: there is deliberately no `totalVerifications` counter here.
    // Incrementing one would cost 22,100 gas on a first write — over 7% of the
    // entire 300,000 gas budget — to store a number that can be reconstructed
    // exactly by counting `AgeVerified` logs. The explorer UI does that
    // instead. Storage is for state that must be read on-chain; statistics
    // belong in the event log.

    // ─────────────────────────────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────────────────────────────
    error MalformedPublicInput();
    error ZeroSubject();
    error ThresholdBelowPolicy(uint16 proven, uint16 required);
    error YearInFuture(uint16 proven, uint16 chainYear);
    error YearStale(uint16 proven, uint16 chainYear);
    error BadContext(uint256 provided, uint256 expected);
    error CommitmentNotValid(uint256 commitment);
    error NullifierAlreadyUsed(uint256 nullifier);
    error InvalidProof();
    error BadPolicy();
    error EnforcedPause();

    event AgeVerified(
        address indexed subject,
        address indexed submitter,
        uint16 minAge,
        uint64 validUntil,
        uint256 nullifier,
        uint64 epoch
    );
    event AttestationRevoked(address indexed subject, address indexed admin);
    event PausedSet(bool paused);
    event PolicyUpdated(uint16 minAge, uint32 epochSeconds, uint16 maxYearLag, uint16 yearOverride);

    // ─────────────────────────────────────────────────────────────────────
    constructor(
        address verifier_,
        address registry_,
        address admin,
        Policy memory initialPolicy
    ) {
        verifier = IGroth16Verifier(verifier_);
        registry = ICredentialRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ROLE, admin);
        _setPolicy(initialPolicy);
    }

    // ═════════════════════════════════════════════════════════════════════
    //  Verification context
    // ═════════════════════════════════════════════════════════════════════

    function currentEpoch() public view returns (uint64) {
        return uint64(block.timestamp / policy.epochSeconds);
    }

    /**
     * @notice The context id a proof must be built against.
     *
     * @dev Binding chainId and address(this) is what stops a proof minted for
     *      one deployment being replayed against another — including the same
     *      bytecode deployed to the same address on a different chain.
     *
     *      The `>> 8` truncates keccak's 256 bits to 248, which guarantees the
     *      result is below the BN254 scalar field order. Note that a plain
     *      `% SNARK_SCALAR_FIELD` would NOT be equivalent: it would very
     *      slightly over-represent small field elements. Truncation is unbiased.
     */
    function contextFor(uint64 epoch) public view returns (uint256) {
        return
            uint256(keccak256(abi.encode(CONTEXT_TAG, block.chainid, address(this), epoch))) >> 8;
    }

    /**
     * @notice Everything a prover needs before generating a proof.
     * @dev One call instead of four, so the frontend cannot assemble a
     *      half-stale parameter set across several round trips.
     */
    function proverParams()
        external
        view
        returns (uint256 context, uint64 epoch, uint16 year, uint16 minAge)
    {
        Policy memory p = policy;
        epoch = uint64(block.timestamp / p.epochSeconds);
        context = contextFor(epoch);
        year = _currentYear(p);
        minAge = p.minAge;
    }

    function currentYear() external view returns (uint16) {
        return _currentYear(policy);
    }

    function _currentYear(Policy memory p) private view returns (uint16) {
        if (p.yearOverride != 0) return p.yearOverride;
        return uint16(1970 + block.timestamp / AVG_YEAR_SECONDS);
    }

    // ═════════════════════════════════════════════════════════════════════
    //  The hot path
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify an age proof and record an on-chain attestation.
     *
     * @dev Reverts on every failure rather than returning false. A `bool`
     *      returned from a state-changing transaction is invisible to an
     *      off-chain caller — it is not in the receipt — so returning one
     *      would give the frontend no way to distinguish success from a
     *      silently rejected proof. Callers that want a non-reverting probe
     *      should use `staticVerify`.
     *
     * @param pubSignals [commitment, nullifier, context, packed]
     * @return subject    the address credited with the attestation
     * @return validUntil when that attestation expires
     */
    function verifyAge(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external returns (address subject, uint64 validUntil) {
        // NOTE ON THE BLOCK SCOPING BELOW
        //
        // Four calldata arrays plus the unpacked policy values exceed the
        // EVM's 16-slot stack reach, so intermediate values are confined to
        // inner blocks and released before `verifier.verifyProof` is reached.
        // The alternative — compiling the whole project through the IR
        // pipeline — would work but slows every build substantially for the
        // sake of one function.

        // ── Unpack and shape-check ───────────────────────────────────────
        // The circuit already proved `packed < 2^192` via Num2Bits(192);
        // re-checking here means the casts below cannot silently truncate
        // even if a future circuit revision relaxed that bound.
        uint16 provenMinAge;
        uint64 epoch;
        {
            uint256 packed = pubSignals[PUB_PACKED];
            if (packed >> 192 != 0) revert MalformedPublicInput();

            subject = address(uint160(packed >> 32));
            if (subject == address(0)) revert ZeroSubject();
            provenMinAge = uint16(packed);

            Policy memory p = policy;
            if (p.paused) revert EnforcedPause();

            // Pin the threshold. `>=` rather than `==`: proving you are over
            // 21 is a strictly stronger claim than proving you are over 18,
            // and a deployment whose policy is 18 should accept it.
            if (provenMinAge < p.minAge) revert ThresholdBelowPolicy(provenMinAge, p.minAge);

            // Pin the reference year. A year in the future is always an
            // attack; a year in the past only ever makes the prover look
            // YOUNGER than they are, so a small lag is harmless and avoids a
            // race at the new-year boundary.
            {
                uint16 provenYear = uint16(packed >> 16);
                uint16 chainYear = _currentYear(p);
                if (provenYear > chainYear) revert YearInFuture(provenYear, chainYear);
                if (chainYear - provenYear > p.maxYearLag) {
                    revert YearStale(provenYear, chainYear);
                }
            }

            epoch = uint64(block.timestamp / p.epochSeconds);
            validUntil = uint64((uint256(epoch) + 1) * uint256(p.epochSeconds));
        }

        // ── Pin the context (chain + contract + epoch) ───────────────────
        {
            uint256 expectedContext = contextFor(epoch);
            if (pubSignals[PUB_CONTEXT] != expectedContext) {
                revert BadContext(pubSignals[PUB_CONTEXT], expectedContext);
            }
        }

        // ── The credential must be live ──────────────────────────────────
        if (!registry.isValid(pubSignals[PUB_COMMITMENT])) {
            revert CommitmentNotValid(pubSignals[PUB_COMMITMENT]);
        }

        // ── Replay protection ────────────────────────────────────────────
        if (nullifierUsed[pubSignals[PUB_NULLIFIER]]) {
            revert NullifierAlreadyUsed(pubSignals[PUB_NULLIFIER]);
        }

        // ── The proof itself ─────────────────────────────────────────────
        // The generated verifier RETURNS false on a bad proof (its checkField
        // path returns rather than reverting), so this must be branched on
        // explicitly — an unchecked call would accept every invalid proof.
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();

        // ── Effects ──────────────────────────────────────────────────────
        nullifierUsed[pubSignals[PUB_NULLIFIER]] = true;
        _attestations[subject] = Attestation({
            validUntil: validUntil,
            minAge: provenMinAge,
            epoch: epoch
        });
        // The attestation is credited to the subject named INSIDE the proof,
        // never to msg.sender. That is what makes a stolen proof worthless: a
        // front-runner who copies calldata out of the mempool can do nothing
        // but pay gas to deliver the victim's own attestation to the victim.
        // It also means a relayer can sponsor the transaction for a user who
        // holds no ETH.
        emit AgeVerified(subject, msg.sender, provenMinAge, validUntil, pubSignals[PUB_NULLIFIER], epoch);
    }

    /**
     * @notice Non-reverting dry run of `verifyAge`.
     * @dev The frontend calls this before opening the wallet, so a doomed
     *      transaction never costs gas and the user sees a precise reason.
     * @return ok     whether `verifyAge` would succeed right now
     * @return reason a short machine-readable tag, empty when `ok`
     */
    function staticVerify(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool ok, string memory reason) {
        // The policy checks live in a helper purely to keep this function's
        // stack shallow: four calldata arrays plus the unpacked locals
        // otherwise exceed the EVM's 16-slot reach ("stack too deep").
        reason = _preflight(pubSignals);
        if (bytes(reason).length != 0) return (false, reason);
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) return (false, "INVALID_PROOF");
        return (true, "");
    }

    /**
     * @dev Every check `verifyAge` performs except the pairing itself.
     * @return A short tag naming the first failed check, or "" if all pass.
     */
    function _preflight(uint256[4] calldata pubSignals) private view returns (string memory) {
        Policy memory p = policy;
        if (p.paused) return "PAUSED";

        uint256 packed = pubSignals[PUB_PACKED];
        if (packed >> 192 != 0) return "MALFORMED_PACKED";

        if (address(uint160(packed >> 32)) == address(0)) return "ZERO_SUBJECT";

        uint16 provenMinAge = uint16(packed);
        if (provenMinAge < p.minAge) return "THRESHOLD_BELOW_POLICY";

        uint16 provenYear = uint16(packed >> 16);
        uint16 chainYear = _currentYear(p);
        if (provenYear > chainYear) return "YEAR_IN_FUTURE";
        if (chainYear - provenYear > p.maxYearLag) return "YEAR_STALE";

        if (pubSignals[PUB_CONTEXT] != contextFor(uint64(block.timestamp / p.epochSeconds))) {
            return "BAD_CONTEXT";
        }
        if (!registry.isValid(pubSignals[PUB_COMMITMENT])) return "COMMITMENT_NOT_VALID";
        if (nullifierUsed[pubSignals[PUB_NULLIFIER]]) return "NULLIFIER_USED";

        return "";
    }

    // ═════════════════════════════════════════════════════════════════════
    //  Attestation reads — IVeritasAttestor
    // ═════════════════════════════════════════════════════════════════════

    function isVerified(address user) external view returns (bool) {
        return _attestations[user].validUntil > block.timestamp;
    }

    function isVerifiedAtLeast(address user, uint16 minAge) external view returns (bool) {
        Attestation memory at = _attestations[user];
        return at.validUntil > block.timestamp && at.minAge >= minAge;
    }

    function attestationOf(address user) external view returns (Attestation memory) {
        return _attestations[user];
    }

    // ═════════════════════════════════════════════════════════════════════
    //  Administration
    // ═════════════════════════════════════════════════════════════════════

    function setPolicy(Policy calldata p) external onlyRole(POLICY_ROLE) {
        _setPolicy(p);
    }

    function _setPolicy(Policy memory p) private {
        // An epoch shorter than an hour would make proofs expire mid-flow;
        // a maxYearLag above 2 would let genuinely stale proofs through.
        if (p.minAge == 0 || p.epochSeconds < 1 hours || p.maxYearLag > 2) revert BadPolicy();
        // Preserve the emergency stop across a policy update: an operator
        // editing the minimum age must not accidentally un-pause the system.
        p.paused = policy.paused;
        policy = p;
        emit PolicyUpdated(p.minAge, p.epochSeconds, p.maxYearLag, p.yearOverride);
    }

    /// @notice Emergency withdrawal of a single attestation.
    /// @dev Revoking a *commitment* does not retroactively invalidate an
    ///      attestation already granted from it; this is the manual override
    ///      for that window. See docs/threat-model.md.
    function revokeAttestation(address subject) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete _attestations[subject];
        emit AttestationRevoked(subject, msg.sender);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        policy.paused = true;
        emit PausedSet(true);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        policy.paused = false;
        emit PausedSet(false);
    }

    function paused() external view returns (bool) {
        return policy.paused;
    }
}
