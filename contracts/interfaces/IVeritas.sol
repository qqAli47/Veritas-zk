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
    /// @dev 64 + 16 + 64 + 64 = 208 bits => still one storage slot.
    struct Attestation {
        uint64 validUntil; // unix seconds; 0 = never attested
        uint16 minAge; // the threshold that was actually proven
        uint64 epoch; // the verification epoch it was issued in
        uint64 regions; // the region allowlist the holder proved membership in
    }

    /// @notice True when `user` holds an unexpired attestation.
    function isVerified(address user) external view returns (bool);

    /// @notice True when `user` holds an unexpired attestation for at least `minAge`.
    function isVerifiedAtLeast(address user, uint16 minAge) external view returns (bool);

    function attestationOf(address user) external view returns (Attestation memory);

    /**
     * @notice True when `user` holds an unexpired attestation whose proven
     *         region set is a SUBSET of `required`.
     *
     * @dev Read the semantics carefully, because the name is easy to
     *      misinterpret. The holder proved membership in some set S. A relying
     *      party demanding T is satisfied only when S is a subset of T: if the
     *      holder is somewhere in S, and every element of S lies in T, then the
     *      holder is in T. When S is not a subset of T this returns false even
     *      though the holder MIGHT be in T — a false negative, never a false
     *      positive. Failing closed is the only safe direction.
     *
     *      Because VeritasCore pins the mask by equality, S is always the
     *      deployment's policy at the time of verification. So this really
     *      answers "was this user verified under a region policy at least as
     *      tight as mine", not "is this user in France".
     *
     *      A resource demanding a single region is therefore satisfied only by
     *      a proof made against that same single-region policy — proving
     *      membership in 27 EU states does not establish presence in France.
     */
    function isVerifiedInRegions(address user, uint64 required) external view returns (bool);

    /// @notice `isVerifiedAtLeast` and `isVerifiedInRegions` in one call.
    function isVerifiedAtLeastInRegions(
        address user,
        uint16 minAge,
        uint64 required
    ) external view returns (bool);
}
