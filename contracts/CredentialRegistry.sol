// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CredentialRegistry
 * @author Veritas-zk
 * @notice The on-chain issuance authority: the public set of credential
 *         commitments that a trusted issuer has vouched for.
 *
 * @dev WHAT THIS CONTRACT STORES, AND WHY IT IS PRIVACY-PRESERVING
 *
 *      The only thing published here is `Poseidon(birthYear, secret)` — a
 *      one-way hash. Recovering `birthYear` from it would require inverting
 *      Poseidon; and even a brute-force over plausible birth years fails,
 *      because `secret` is a uniformly random field element supplying ~254
 *      bits of entropy. The registry is therefore a public list that reveals
 *      nothing about the people in it.
 *
 *      THE ISSUER MUST NEVER LEARN `secret`.
 *
 *      The holder generates `secret` locally and sends the issuer only the
 *      commitment. This matters more than it first appears: an issuer who knew
 *      `secret` could compute every nullifier the holder will ever produce,
 *      and so deanonymise all of their future verifications across every
 *      relying party — and could also impersonate them outright. The issuing
 *      flow in the frontend enforces this direction.
 *
 * @dev ROLES
 *      - DEFAULT_ADMIN_ROLE  manages roles, pausing
 *      - ISSUER_ROLE         may register commitments
 *      - REVOKER_ROLE        may revoke them
 *
 *      Splitting issue from revoke is not ceremony: revocation is the
 *      emergency lever, and it is good practice for the key that can pull it
 *      to be held separately from the one used in day-to-day issuance.
 */
contract CredentialRegistry is AccessControl, Pausable {
    // ─────────────────────────────────────────────────────────────────────
    //  Roles
    // ─────────────────────────────────────────────────────────────────────
    bytes32 public constant ISSUER_ROLE = keccak256("VERITAS_ISSUER_ROLE");
    bytes32 public constant REVOKER_ROLE = keccak256("VERITAS_REVOKER_ROLE");

    /**
     * @notice The BN254 scalar field order.
     * @dev Every value the circuit can produce is strictly below this. Any
     *      "commitment" at or above it could not have come from the circuit,
     *      so we reject it at the door rather than storing junk that could
     *      never be proven against.
     */
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // ─────────────────────────────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @dev 64 + 64 + 8 = 136 bits, so a Credential occupies exactly ONE
     *      storage slot. `isValid()` is consequently a single SLOAD, which
     *      matters because VeritasCore calls it on every verification and the
     *      whole transaction has a 300,000 gas budget.
     *
     *      The issuer's address deliberately lives in the event rather than in
     *      this struct — it is useful for auditing but would push the struct
     *      into a second slot.
     */
    struct Credential {
        uint64 issuedAt; // 0 => never registered
        uint64 expiresAt; // 0 => never expires
        bool revoked;
    }

    mapping(uint256 commitment => Credential) private _credentials;

    /// @notice Running count of registered commitments (for the explorer UI).
    uint256 public totalRegistered;

    // ─────────────────────────────────────────────────────────────────────
    //  Errors & events
    // ─────────────────────────────────────────────────────────────────────
    error InvalidCommitment(uint256 commitment);
    error AlreadyRegistered(uint256 commitment);
    error UnknownCommitment(uint256 commitment);
    error AlreadyRevoked(uint256 commitment);
    error EmptyBatch();

    event CommitmentRegistered(
        uint256 indexed commitment,
        address indexed issuer,
        uint64 expiresAt
    );
    event CommitmentRevoked(uint256 indexed commitment, address indexed revoker);

    // ─────────────────────────────────────────────────────────────────────
    constructor(address admin, address issuer) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
        _grantRole(REVOKER_ROLE, issuer);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Issuance
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a credential commitment.
     * @param commitment Poseidon(birthYear, secret), computed by the HOLDER.
     * @param expiresAt  Unix seconds after which the credential stops being
     *                   valid; 0 means it never expires.
     */
    function registerCommitment(
        uint256 commitment,
        uint64 expiresAt
    ) public onlyRole(ISSUER_ROLE) whenNotPaused {
        if (commitment == 0 || commitment >= SNARK_SCALAR_FIELD) {
            revert InvalidCommitment(commitment);
        }
        if (_credentials[commitment].issuedAt != 0) {
            revert AlreadyRegistered(commitment);
        }

        _credentials[commitment] = Credential({
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });
        unchecked {
            ++totalRegistered;
        }

        emit CommitmentRegistered(commitment, msg.sender, expiresAt);
    }

    /// @notice Register many commitments in one transaction.
    function registerBatch(
        uint256[] calldata commitments,
        uint64 expiresAt
    ) external {
        uint256 n = commitments.length;
        if (n == 0) revert EmptyBatch();
        for (uint256 i; i < n; ) {
            registerCommitment(commitments[i], expiresAt);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Permanently revoke a credential.
     * @dev Revocation is one-way by design. Allowing un-revocation would mean
     *      a compromised issuer key could quietly restore a credential it had
     *      been forced to withdraw.
     */
    function revokeCommitment(uint256 commitment) external onlyRole(REVOKER_ROLE) {
        Credential storage cred = _credentials[commitment];
        if (cred.issuedAt == 0) revert UnknownCommitment(commitment);
        if (cred.revoked) revert AlreadyRevoked(commitment);

        cred.revoked = true;
        emit CommitmentRevoked(commitment, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice The single predicate VeritasCore relies on: registered, not
     *         revoked, and not past its expiry.
     */
    function isValid(uint256 commitment) external view returns (bool) {
        Credential memory cred = _credentials[commitment];
        return
            cred.issuedAt != 0 &&
            !cred.revoked &&
            (cred.expiresAt == 0 || cred.expiresAt > block.timestamp);
    }

    /// @notice Whether the commitment was ever registered, regardless of state.
    function isRegistered(uint256 commitment) external view returns (bool) {
        return _credentials[commitment].issuedAt != 0;
    }

    function isRevoked(uint256 commitment) external view returns (bool) {
        return _credentials[commitment].revoked;
    }

    function credentialOf(uint256 commitment) external view returns (Credential memory) {
        return _credentials[commitment];
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────────────
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
