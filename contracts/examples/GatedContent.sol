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

    mapping(address => uint256) public accessCount;
    uint256 public totalAccesses;

    error NotAgeVerified(address caller, uint16 requiredAge);

    event ContentAccessed(address indexed user, uint256 count);

    constructor(address attestor_, uint16 requiredAge_) {
        attestor = IVeritasAttestor(attestor_);
        requiredAge = requiredAge_;
    }

    /**
     * @dev The entire integration surface for a relying party.
     */
    modifier onlyAgeVerified() {
        if (!attestor.isVerifiedAtLeast(msg.sender, requiredAge)) {
            revert NotAgeVerified(msg.sender, requiredAge);
        }
        _;
    }

    /// @notice A stand-in for whatever the gated action actually is.
    function accessContent() external onlyAgeVerified returns (string memory) {
        unchecked {
            ++accessCount[msg.sender];
            ++totalAccesses;
        }
        emit ContentAccessed(msg.sender, accessCount[msg.sender]);
        return "Access granted: you proved your age without revealing it.";
    }

    /// @notice Lets a UI grey out the button instead of letting the call revert.
    function canAccess(address user) external view returns (bool) {
        return attestor.isVerifiedAtLeast(user, requiredAge);
    }
}
