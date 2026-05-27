// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CredentialRegistry {
    mapping(bytes32 => bool) public commitments;

    event CommitmentAdded(bytes32 indexed commitment);

    function addCommitment(bytes32 commitment) external {
        require(!commitments[commitment], "Already registered");
        commitments[commitment] = true;
        emit CommitmentAdded(commitment);
    }

    function isRegistered(bytes32 commitment) external view returns (bool) {
        return commitments[commitment];
    }
}
