// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVeritasAttestor} from "../interfaces/IVeritas.sol";

/**
 * @title GatedContent
 * @notice A minimal relying party: an age-restricted resource that a third
 *         party could deploy without knowing anything about zero-knowledge
 *         proofs.
 *
 * @dev This contract exists to make one point precise. The React app hides the
 *      restricted page behind a check, but a hidden page is not a protected
 *      one — anyone can open developer tools and flip a boolean. Here the gate
 *      is a `require` in the EVM, so the claim "verified users only" is
 *      enforceable rather than decorative.
 *
 *      Note how little this contract needs to know: one interface, one call.
 *      It never sees a proof, a commitment, a birth year, or a nullifier.
 *      That separation is the point of the attestation layer.
 */
contract GatedContent {
    IVeritasAttestor public immutable attestor;

    /// @notice The minimum age this particular resource requires.
    uint16 public immutable requiredAge;

    /**
     * @notice The regions this resource serves, as a bitmask.
     *
     * @dev Set to type(uint64).max to accept any region — a resource that
     *      cares only about age. Otherwise the caller's PROVEN region set must
     *      be a subset of this one; see IVeritasAttestor.isVerifiedInRegions
     *      for why the subset direction is the safe one.
     */
    uint64 public immutable requiredRegions;

    mapping(address => uint256) public accessCount;
    uint256 public totalAccesses;

    error NotAgeVerified(address caller, uint16 requiredAge);
    error RegionNotServed(address caller, uint64 requiredRegions);

    event ContentAccessed(address indexed user, uint256 count);

    constructor(address attestor_, uint16 requiredAge_, uint64 requiredRegions_) {
        attestor = IVeritasAttestor(attestor_);
        requiredAge = requiredAge_;
        requiredRegions = requiredRegions_;
    }

    /**
     * @dev The entire integration surface for a relying party.
     */
    modifier onlyEligible() {
        // Two separate checks so the revert says WHICH gate closed. A single
        // combined call would be marginally cheaper and considerably less
        // helpful to whoever is staring at a failed transaction.
        if (!attestor.isVerifiedAtLeast(msg.sender, requiredAge)) {
            revert NotAgeVerified(msg.sender, requiredAge);
        }
        if (!attestor.isVerifiedInRegions(msg.sender, requiredRegions)) {
            revert RegionNotServed(msg.sender, requiredRegions);
        }
        _;
    }

    /// @notice A stand-in for whatever the gated action actually is.
    function accessContent() external onlyEligible returns (string memory) {
        unchecked {
            ++accessCount[msg.sender];
            ++totalAccesses;
        }
        emit ContentAccessed(msg.sender, accessCount[msg.sender]);
        return "Access granted: you proved your age and location without revealing either.";
    }

    /// @notice Lets a UI grey out the button instead of letting the call revert.
    function canAccess(address user) external view returns (bool) {
        return attestor.isVerifiedAtLeastInRegions(user, requiredAge, requiredRegions);
    }
}
