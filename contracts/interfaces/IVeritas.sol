// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGroth16Verifier
 * @notice The auto-generated verifier's surface.
 * @dev The array is FIXED-SIZE (`uint256[4]`), matching the circuit's four
 *      public signals. snarkjs emits `uint[4] calldata`, not `uint[] memory` —
 *      declaring the dynamic form here would compile but never link, and the
 *      call would silently hit the fallback function.
 *
 *      If the circuit's public-signal count ever changes, this arity and
 *      VeritasCore's `uint256[4]` parameters must change with it. The test
 *      suite asserts both against circuits/public_signals.json.
 */
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}

/**
 * @title ICredentialRegistry
 * @notice The issuance authority, as seen by VeritasCore.
 */
interface ICredentialRegistry {
    /// @return True when the commitment is registered, unrevoked and unexpired.
    function isValid(uint256 commitment) external view returns (bool);

    function isRegistered(uint256 commitment) external view returns (bool);

    function isRevoked(uint256 commitment) external view returns (bool);
}

/**
 * @title IVeritasAttestor
 * @notice The read-only surface a gated application depends on.
 * @dev A relying party only ever needs this. It deliberately exposes no way to
 *      learn *why* an address is verified beyond the asserted minimum age —
 *      no birth year, no commitment, no link to an identity.
 */
interface IVeritasAttestor {
    struct Attestation {
        uint64 validUntil; // unix seconds; 0 = never attested
        uint16 minAge; // the threshold that was actually proven
        uint64 epoch; // the verification epoch it was issued in
    }

    /// @notice True when `user` holds an unexpired attestation.
    function isVerified(address user) external view returns (bool);

    /// @notice True when `user` holds an unexpired attestation for at least `minAge`.
    function isVerifiedAtLeast(address user, uint16 minAge) external view returns (bool);

    function attestationOf(address user) external view returns (Attestation memory);
}
