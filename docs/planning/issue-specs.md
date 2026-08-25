Issue #2 delivered a **compilable range-check circuit** that proves a user's age is above a threshold. However, it has a critical privacy gap:

> *There is nothing linking the private `birthYear` input to a specific real-world user. A malicious prover could supply any `birthYear` they want and still generate a valid proof.*

Issue #3 closes this gap by introducing a **cryptographic commitment**:

```
commitment = Poseidon(birthYear, secret)
```

The `commitment` is computed off-chain by a **trusted issuer** (e.g., a government ID authority) and registered on-chain in `CredentialRegistry`. At proof time, the circuit enforces that the prover's private `birthYear` and `secret` hash to the exact same `commitment` that was registered — without revealing either value.

This is the **final form of the ZK circuit** that all subsequent issues (Solidity verifier, frontend, on-chain integration) will be built upon.

**Why Poseidon and not SHA-256?**
Poseidon is an arithmetic-friendly hash function designed specifically for ZK circuits. SHA-256 generates tens of thousands of R1CS constraints, making gas costs prohibitive. Poseidon generates ~200 constraints for 2 inputs and costs a fraction of the gas.

---

### 🧠 How the Full Circuit Logic Works

```
Private inputs:  birthYear, secret
Public inputs:   currentYear, threshold, commitment

Constraint 1 — Commitment binding:
  Poseidon(birthYear, secret) == commitment
  (proves the prover knows the preimage of the registered commitment)

Constraint 2 — Age range check:
  age = currentYear - birthYear
  age >= threshold
  (proves the age is sufficient without revealing birthYear)
```

Both constraints must be satisfied simultaneously. Faking either one makes the proof invalid.

---

### ✅ Tasks

- [ ] **Confirm `circomlib` is installed** (from Issue #2's `npm install circomlib`):
  ```bash
  ls node_modules/circomlib/circuits/poseidon.circom
  ```

- [ ] **Upgrade `circuits/attribute_check.circom` to v2** by integrating the Poseidon component alongside the existing range check:
  ```circom
  pragma circom 2.0.0;
  include "circomlib/circuits/poseidon.circom";
  include "circomlib/circuits/comparators.circom";

  template AttributeCheck(n) {
      // Private inputs
      signal input birthYear;
      signal input secret;

      // Public inputs
      signal input currentYear;
      signal input threshold;
      signal input commitment;   // Poseidon(birthYear, secret) registered on-chain

      // --- Constraint 1: Commitment binding ---
      component hasher = Poseidon(2);
      hasher.inputs[0] <== birthYear;
      hasher.inputs[1] <== secret;
      hasher.out === commitment;

      // --- Constraint 2: Age range check ---
      signal age;
      age <== currentYear - birthYear;

      component gte = GreaterEqThan(n);
      gte.in[0] <== age;
      gte.in[1] <== threshold;
      gte.out === 1;
  }

  component main { public [currentYear, threshold, commitment] } = AttributeCheck(8);
  ```

- [ ] **Compile the v2 circuit** and confirm zero errors:
  ```bash
  circom circuits/attribute_check.circom --r1cs --wasm --sym -o build/
  ```

- [ ] **Write a helper script `scripts/generate_commitment.js`** so the trusted issuer can compute the off-chain commitment easily:
  ```javascript
  // scripts/generate_commitment.js
  // Usage: node scripts/generate_commitment.js <birthYear> <secret>
  const { buildPoseidon } = require("circomlibjs");

  async function main() {
    const [birthYear, secret] = process.argv.slice(2).map(BigInt);
    const poseidon = await buildPoseidon();
    const hash = poseidon([birthYear, secret]);
    const commitment = poseidon.F.toString(hash);
    console.log("Commitment (decimal):", commitment);
  }

  main();
  ```
  Install `circomlibjs` to support this:
  ```bash
  npm install circomlibjs
  ```

- [ ] **Update `input.json`** to include the `commitment` field computed from the helper script:
  ```json
  {
    "birthYear": "2000",
    "secret":    "12345",
    "currentYear": "2024",
    "threshold":   "18",
    "commitment":  "<output of generate_commitment.js 2000 12345>"
  }
  ```

- [ ] **Regenerate witness and local proof** against the v2 circuit:
  ```bash
  node build/attribute_check_js/generate_witness.js \
    build/attribute_check_js/attribute_check.wasm \
    input.json \
    build/witness.wtns

  snarkjs groth16 prove build/circuit_final.zkey build/witness.wtns \
    build/proof.json build/public.json

  snarkjs groth16 verify build/verification_key.json \
    build/public.json build/proof.json
  ```

- [ ] **Run negative tests** and document results in `Playground/SCAFFOLD_SUMMARY.md`:

  | Test Case | Expected Result |
  |-----------|----------------|
  | Valid `birthYear` + correct `secret` + correct `commitment` | `OK` ✅ |
  | Valid age but **wrong `secret`** (commitment mismatch) | Proof fails ❌ |
  | Valid secret but **underage `birthYear`** | Proof fails ❌ |
  | **Tampered `commitment`** in public inputs | Verification fails ❌ |

- [ ] **Write a JavaScript test `tests/circuit-test.js`** to automate the negative tests using `snarkjs` directly in Node:
  ```javascript
  const snarkjs = require("snarkjs");
  const { buildPoseidon } = require("circomlibjs");

  describe("AttributeCheck circuit (v2)", function () {
    it("accepts a valid proof", async () => { ... });
    it("rejects wrong secret (commitment mismatch)", async () => { ... });
    it("rejects underage birthYear", async () => { ... });
  });
  ```

- [ ] **Commit only source files**:
  - `circuits/attribute_check.circom` (updated to v2)
  - `scripts/generate_commitment.js` (new)
  - `tests/circuit-test.js` (new)
  - `package.json` (updated for `circomlibjs`)

---

### 🚫 Out of Scope for This Ticket
- Generating a Solidity `Verifier.sol` from the `.zkey` → Issue #4
- Registering commitments on-chain in `CredentialRegistry` → Issue #4
- Any frontend work → Issue #5 and beyond

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| `circuits/attribute_check.circom` compiles with Poseidon include | Zero compiler errors ✅ |
| Witness generation succeeds with valid `input.json` (including `commitment`) | `witness.wtns` produced ✅ |
| `snarkjs groth16 verify` outputs `OK` for a valid proof | Local proof verifies ✅ |
| Proof **fails** when `secret` is incorrect | Constraint violation detected ✅ |
| Proof **fails** when prover is underage | Range check constraint violated ✅ |
| `scripts/generate_commitment.js` produces a reproducible hash | Same inputs always yield same `commitment` ✅ |
| No `.zkey`, `.wtns`, `.r1cs`, or `build/` files committed | `git status` clean ✅ |

---

### ⚠️ Notes

- The `commitment` value in `public.json` output **must match** exactly what was registered in `CredentialRegistry` on-chain. Keep the field-element representation (decimal string) consistent between the JavaScript helper and the circuit.
- `circomlibjs` is the JavaScript companion library to `circomlib` — it exposes the exact same Poseidon hash function as the Circom circuit, making off-chain and on-chain values byte-for-byte identical.
- After this ticket is merged, the circuit is **feature-complete** and ready to generate the final `.zkey` and Solidity `Verifier.sol` in Issue #4.

**Labels**: `circuit`, `contracts`, `phase-2`
**Branch**: `issue/4-solidity-verifier`
**Depends on**: Issue #3 (Poseidon circuit v2 must be merged first)


---

### 📋 Description

After Issue #3 delivers the finalized `AttributeCheck` circuit (v2 — with Poseidon commitment + range check), the circuit is **feature-complete**. The final step of the ZK circuit phase is to generate a real Solidity verifier contract from the compiled circuit's proving key.

Currently, `contracts/Verifier.sol` is a **placeholder that always returns `false`**:

```solidity
// Placeholder: real verifier logic generated by snarkjs
return false;
```

This issue replaces it with the **auto-generated Groth16 verifier** — a mathematically sound contract that can verify any valid ZK proof on-chain. This is the bridge between the ZK world and the Ethereum world.

**One command does the heavy lifting:**
```bash
npx snarkjs zkey export solidityverifier build/circuit_final.zkey contracts/Verifier.sol
```

However, the generated contract requires adjustments for our Solidity version and integration with `CredentialRegistry`, which is where the real work lies.

---

### 🧠 How the Generated Verifier Works

SnarkJS outputs a contract with a `verifyProof()` function that performs elliptic curve pairing checks. It takes:

```solidity
function verifyProof(
    uint[2] calldata _pA,     // Proof point A
    uint[2][2] calldata _pB,  // Proof point B  
    uint[2] calldata _pC,     // Proof point C
    uint[3] calldata _pubSignals  // [currentYear, threshold, commitment]
) public view returns (bool)
```

The function performs mathematical verification using precompiled Ethereum opcodes (`ecAdd`, `ecMul`, `ecPairing`) and returns `true` if the proof is valid. **No private data is ever seen by the contract.**

---

### ✅ Tasks

- [ ] **Prerequisite check**: Ensure Issue #3 is merged and the v2 circuit is compiled with the finalized `.zkey`:
  ```bash
  ls build/circuit_final.zkey   # must exist
  ```

- [ ] **Generate the Solidity verifier**:
  ```bash
  npx snarkjs zkey export solidityverifier build/circuit_final.zkey contracts/Verifier.sol
  ```
  This overwrites the placeholder `Verifier.sol` with the real Groth16 verifier (~700 lines of auto-generated Solidity).

- [ ] **Adjust the Solidity version pragma** if needed:
  The generated contract may use `pragma solidity >=0.7.0 <0.9.0` — ensure compatibility with our `hardhat.config.js` (`0.8.20`). May need to pin it:
  ```solidity
  pragma solidity ^0.8.20;
  ```

- [ ] **Create a `contracts/VeritasCore.sol`** — a wrapper contract that ties `Verifier` and `CredentialRegistry` together into a single verification entry point:
  ```solidity
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.20;

  import "./Verifier.sol";
  import "./CredentialRegistry.sol";

  contract VeritasCore {
      Verifier public verifier;
      CredentialRegistry public registry;

      constructor(address _verifier, address _registry) {
          verifier = Verifier(_verifier);
          registry = CredentialRegistry(_registry);
      }

      function verifyAge(
          uint[2] calldata a,
          uint[2][2] calldata b,
          uint[2] calldata c,
          uint[3] calldata pubSignals  // [currentYear, threshold, commitment]
      ) public view returns (bool) {
          // 1. Check the commitment is registered
          bytes32 commitmentHash = bytes32(pubSignals[2]);
          require(registry.isRegistered(commitmentHash), "Commitment not registered");

          // 2. Verify the ZK proof
          return verifier.verifyProof(a, b, c, pubSignals);
      }
  }
  ```

- [ ] **Update `scripts/deploy.js`** to deploy all three contracts:
  ```javascript
  // Deploy Verifier (generated)
  // Deploy CredentialRegistry
  // Deploy VeritasCore(verifierAddress, registryAddress)
  ```

- [ ] **Write a verification script `scripts/verify_on_chain.js`**:
  A script that takes `build/proof.json` and `build/public.json`, formats them into the contract's expected calldata, and calls `verifyProof()` on a local Hardhat node:
  ```javascript
  const { generateCalldata } = require("snarkjs").groth16;
  // ... format and call contract
  ```

- [ ] **Update `tests/sample-test.js`** to add verifier tests:

  | Test Case | Expected |
  |-----------|----------|
  | Deploy generated Verifier — should succeed | ✅ |
  | Call `verifyProof()` with a valid proof | Returns `true` ✅ |
  | Call `verifyProof()` with a tampered proof | Returns `false` ❌ |
  | Call `verifyProof()` with wrong public signals | Returns `false` ❌ |
  | Deploy `VeritasCore` — verifyAge with registered commitment | Returns `true` ✅ |
  | `VeritasCore.verifyAge` with unregistered commitment | Reverts ❌ |

- [ ] **Compile and run all tests**:
  ```bash
  npx hardhat compile   # must compile 3 contracts without errors
  npx hardhat test       # all tests green
  ```

- [ ] **Generate a calldata export helper** `scripts/export_calldata.js`:
  ```javascript
  // Reads proof.json + public.json and prints the exact calldata 
  // needed to call verifyProof() — useful for manual testing and frontend integration
  const snarkjs = require("snarkjs");
  // snarkjs.groth16.exportSolidityCallData(proof, publicSignals)
  ```

- [ ] **Commit in 3 logical units**:
  1. `#4: Replace placeholder with snarkjs-generated Verifier.sol`
  2. `#4: Add VeritasCore wrapper contract and updated deploy script`
  3. `#4: Add on-chain verification tests and calldata export helper`

---

### 🚫 Out of Scope

- Deploying to Sepolia → Issue #5
- Nullifier / replay protection → Issue #6
- Gas benchmarking → Issue #7
- Frontend contract integration → Issue #9

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| `contracts/Verifier.sol` is the real generated verifier | Not the placeholder ✅ |
| `npx hardhat compile` succeeds for all 3 contracts | 0 errors ✅ |
| On-chain `verifyProof()` returns `true` for a valid proof | Test passes ✅ |
| On-chain `verifyProof()` returns `false` for a tampered proof | Test passes ✅ |
| `VeritasCore.verifyAge()` reverts for unregistered commitment | Test passes ✅ |
| `scripts/verify_on_chain.js` runs end-to-end on local Hardhat | Script succeeds ✅ |
| No build artifacts committed to Git | `git status` clean ✅ |

---

### ⚠️ Notes

- The generated `Verifier.sol` is **large** (~700 lines) and entirely auto-generated. Do not manually edit it — if the circuit changes, regenerate it.
- The `verifyProof()` function uses Ethereum precompiled contracts at addresses `0x06`, `0x07`, and `0x08` (ecAdd, ecMul, ecPairing). These are available on all EVM chains including Sepolia.
- The number of public signals (`uint[3]`) matches: `[currentYear, threshold, commitment]`. If Issue #3 changes the public signal count, the generated verifier's function signature will update automatically.
- Gas cost for `verifyProof()` is typically ~220k–280k for a Groth16 proof of this size. We'll measure precisely in Issue #7.

**Labels**: `contracts`, `deployment`, `phase-3`
**Branch**: `issue/9-sepolia-deploy`
**Depends on**: Issue #8 (real `Verifier.sol` must be generated and tested locally first)

---

### 📋 Description

Up to this point, all contract testing has been done on the **local Hardhat node** — an in-memory blockchain that resets every time. This issue takes the verified contracts to a real, persistent, public Ethereum testnet: **Sepolia**.

By the end of this ticket:
- All three contracts (`Verifier`, `CredentialRegistry`, `VeritasCore`) will be live on Sepolia
- A commitment will be registered on-chain
- A ZK proof will be verified on-chain — visible to anyone on Etherscan
- The deployed addresses will be documented for the frontend team to use

This is the first time Veritas produces a **publicly visible, on-chain result**.

---

### 🔧 Prerequisites (before starting)

Each team member who deploys needs:
1. **A MetaMask wallet** with a Sepolia private key
2. **Free Sepolia ETH** from a faucet (https://sepoliafaucet.com/ or https://www.alchemy.com/faucets/ethereum-sepolia)
3. **A Sepolia RPC URL** from [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/) (free tier is sufficient)

---

### ✅ Tasks

- [ ] **Create a `.env.example` at the project root** documenting the required environment variables:
  ```env
  # Sepolia Testnet Configuration
  # Get a free RPC URL from https://www.alchemy.com/
  SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

  # Your wallet's private key (NEVER share or commit this)
  # Export from MetaMask: Account Details → Export Private Key
  PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
  ```

- [ ] **Update `scripts/deploy.js`** to:
  - Deploy all 3 contracts in sequence: `Verifier` → `CredentialRegistry` → `VeritasCore`
  - Print all deployed addresses
  - Save addresses to `deployed_addresses.json` for frontend consumption
  ```javascript
  const deployed = {
    network: hre.network.name,
    verifier: verifier.target,
    registry: registry.target,
    core: core.target,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync("deployed_addresses.json", JSON.stringify(deployed, null, 2));
  ```

- [ ] **Add `deployed_addresses.json` to `.gitignore`** — addresses change per deployment and shouldn't be committed.

- [ ] **Test the full deploy locally first**:
  ```bash
  npx hardhat run scripts/deploy.js --network hardhat
  ```
  Confirm all 3 contracts deploy and addresses are printed.

- [ ] **Deploy to Sepolia**:
  ```bash
  # Create .env from template
  cp .env.example .env
  # Fill in SEPOLIA_RPC_URL and PRIVATE_KEY

  # Deploy
  npx hardhat run scripts/deploy.js --network sepolia
  ```

- [ ] **Write `scripts/register_commitment.js`** — registers a test commitment on Sepolia:
  ```javascript
  // 1. Compute commitment = Poseidon(birthYear, secret) using circomlibjs
  // 2. Call registry.addCommitment(commitment) on Sepolia
  // 3. Verify registry.isRegistered(commitment) returns true
  // 4. Print transaction hash for Etherscan verification
  ```

- [ ] **Write `scripts/verify_on_chain.js`** — submits a ZK proof to the deployed Verifier on Sepolia:
  ```javascript
  // 1. Read proof.json and public.json from build/
  // 2. Format calldata using snarkjs.groth16.exportSolidityCallData()
  // 3. Call verifier.verifyProof(a, b, c, pubSignals)
  // 4. Print result + transaction hash
  ```

- [ ] **Run the full on-chain flow on Sepolia**:
  ```bash
  # Step 1: Deploy contracts
  npx hardhat run scripts/deploy.js --network sepolia

  # Step 2: Register a test commitment
  npx hardhat run scripts/register_commitment.js --network sepolia

  # Step 3: Generate proof locally
  node scripts/generate_proof.js

  # Step 4: Submit proof to Sepolia verifier
  npx hardhat run scripts/verify_on_chain.js --network sepolia
  ```

- [ ] **Document the deployed addresses** in the PR description — include Etherscan links:
  ```
  Verifier:           0x... (https://sepolia.etherscan.io/address/0x...)
  CredentialRegistry: 0x... (https://sepolia.etherscan.io/address/0x...)
  VeritasCore:        0x... (https://sepolia.etherscan.io/address/0x...)
  ```

- [ ] **Update `frontend/.env.example`** with the deployed addresses:
  ```env
  VITE_VERIFIER_ADDRESS=0x...
  VITE_REGISTRY_ADDRESS=0x...
  VITE_CORE_ADDRESS=0x...
  VITE_NETWORK=sepolia
  ```

- [ ] **Commit in 3 logical units**:
  1. `#9: Add .env.example, deploy script with address export, and gitignore updates`
  2. `#9: Add on-chain commitment registration and proof verification scripts`
  3. `#9: Deploy to Sepolia and document contract addresses`

---

### 🚫 Out of Scope

- Nullifier / replay protection → Issue #10
- Gas benchmarking → Issue #11
- Frontend calling contracts → Issue #12

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| `.env.example` exists at project root | Documents `SEPOLIA_RPC_URL` and `PRIVATE_KEY` ✅ |
| Local deploy to Hardhat succeeds | All 3 contracts deploy ✅ |
| Sepolia deploy succeeds | 3 contract addresses printed + saved ✅ |
| Commitment registered on Sepolia | `isRegistered()` returns `true` on Etherscan ✅ |
| Proof verified on Sepolia | `verifyProof()` returns `true` in tx receipt ✅ |
| `deployed_addresses.json` generated | Contains all 3 addresses + network ✅ |
| `frontend/.env.example` updated | Frontend team can fill in addresses ✅ |
| No `.env` or private keys committed | `git status` clean ✅ |

---

### ⚠️ Notes

- **Gas costs**: Each `verifyProof()` call costs ~220k–280k gas. On Sepolia this is free but on mainnet it would cost ~$2–5 at typical gas prices. We'll measure precisely in Issue #11.
- **Alchemy vs Infura**: Either works. Alchemy's free tier gives 300M compute units/month which is more than enough for testing.
- **Contract verification on Etherscan** (optional but nice): You can verify the contract source code on Etherscan using `npx hardhat verify --network sepolia <address>`. This lets anyone read the contract source directly on Etherscan.
- **The `.env` file is the #1 security risk in the project.** Triple-check `.gitignore` before every commit. If a private key is ever committed, treat it as compromised immediately.


**Labels**: `contracts`, `security`, `phase-3`
**Branch**: `issue/10-nullifiers`
**Depends on**: Issue #9 (contracts must be deployed and tested on-chain first)

---

### 📋 Description

Right now, the `CredentialRegistry` has a critical security flaw:

> **A valid proof can be submitted unlimited times.** There is nothing stopping a user from taking a single valid `proof.json` and calling `verifyProof()` over and over — or sharing it with someone else to use.

This is called a **replay attack**. In a real-world system (e.g., proving age to buy alcohol), each proof should be usable **exactly once**.

The standard solution in ZK systems is a **nullifier** — a unique value derived from the prover's secret that is revealed during verification and stored on-chain to prevent reuse.

```
nullifier = Poseidon(secret, secret)
```

The nullifier is deterministic (same `secret` always produces the same nullifier) but reveals nothing about `birthYear` or the `secret` itself. It acts like a single-use token.

Additionally, `CredentialRegistry` currently has **no access control** — any address can call `addCommitment()`. Only a trusted issuer should be able to register commitments.

---

### 🧠 How Nullifiers Work

```
BEFORE (current — vulnerable to replay):

  User generates proof → submits to contract → ✅ verified → submits same proof again → ✅ verified again!

AFTER (with nullifier):

  User generates proof (includes nullifier) → submits to contract
    → contract checks: has this nullifier been seen before?
    → NO → ✅ verified, nullifier stored
    → User tries again with same proof → nullifier already stored → ❌ REJECTED
```

---

### ✅ Tasks

#### Circuit Changes

- [ ] **Update `circuits/attribute_check.circom`** to compute and expose a nullifier:
  ```circom
  // Add to the circuit:
  signal input nullifierHash;  // public — exposed for on-chain storage

  // Compute nullifier from secret
  component nullifierHasher = Poseidon(2);
  nullifierHasher.inputs[0] <== secret;
  nullifierHasher.inputs[1] <== secret;
  nullifierHash === nullifierHasher.out;
  ```
  Add `nullifierHash` to the public signals list in `component main`.

- [ ] **Recompile the circuit** and regenerate the verifier:
  ```powershell
  .\scripts\compile_circuit.ps1
  npx snarkjs zkey export solidityverifier build/circuit_final.zkey contracts/Verifier.sol
  ```

- [ ] **Update `circuits/input.json`** to include the `nullifierHash` field (computed from `generate_commitment.js`).

#### Contract Changes

- [ ] **Add nullifier tracking to `CredentialRegistry.sol`**:
  ```solidity
  mapping(bytes32 => bool) public nullifiers;

  event NullifierUsed(bytes32 indexed nullifier);

  modifier notUsedNullifier(bytes32 nullifier) {
      require(!nullifiers[nullifier], "Proof already used");
      _;
  }

  function markNullifierUsed(bytes32 nullifier) external {
      require(!nullifiers[nullifier], "Proof already used");
      nullifiers[nullifier] = true;
      emit NullifierUsed(nullifier);
  }

  function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
      return nullifiers[nullifier];
  }
  ```

- [ ] **Add issuer access control to `CredentialRegistry.sol`**:
  ```solidity
  address public issuer;

  constructor() {
      issuer = msg.sender;
  }

  modifier onlyIssuer() {
      require(msg.sender == issuer, "Only issuer can register commitments");
      _;
  }

  function addCommitment(bytes32 commitment) external onlyIssuer {
      // ... existing logic
  }
  ```

- [ ] **Update `VeritasCore.sol`** to extract and store the nullifier during verification:
  ```solidity
  function verifyAge(
      uint[2] calldata a,
      uint[2][2] calldata b,
      uint[2] calldata c,
      uint[N] calldata pubSignals  // now includes nullifierHash
  ) public returns (bool) {
      // 1. Extract nullifier from public signals
      bytes32 nullifier = bytes32(pubSignals[INDEX_OF_NULLIFIER]);

      // 2. Check nullifier hasn't been used
      require(!registry.isNullifierUsed(nullifier), "Proof already used");

      // 3. Check commitment is registered
      bytes32 commitment = bytes32(pubSignals[INDEX_OF_COMMITMENT]);
      require(registry.isRegistered(commitment), "Commitment not registered");

      // 4. Verify the ZK proof
      bool valid = verifier.verifyProof(a, b, c, pubSignals);

      // 5. If valid, mark nullifier as used
      if (valid) {
          registry.markNullifierUsed(nullifier);
      }

      return valid;
  }
  ```

- [ ] **Update `scripts/generate_commitment.js`** to also compute and print the nullifier:
  ```javascript
  const nullifier = poseidon([secret, secret]);
  console.log("Nullifier (decimal):", poseidon.F.toString(nullifier));
  ```

#### Tests

- [ ] **Add tests to `tests/sample-test.js`**:

  | Test Case | Expected |
  |-----------|----------|
  | `addCommitment` by issuer | ✅ Succeeds |
  | `addCommitment` by non-issuer | ❌ Reverts with "Only issuer" |
  | Duplicate commitment registration | ❌ Reverts with "Already registered" |
  | `verifyAge` with valid proof + fresh nullifier | ✅ Returns true, nullifier marked |
  | `verifyAge` with same proof again (replay) | ❌ Reverts with "Proof already used" |
  | `verifyAge` with unregistered commitment | ❌ Reverts with "Commitment not registered" |
  | `isNullifierUsed` returns false before, true after | ✅ State changes correctly |

- [ ] **Update circuit tests** in `tests/circuit-test.js` to account for the new `nullifierHash` public signal.

- [ ] **Run full test suite**:
  ```bash
  npx hardhat compile
  npx hardhat test
  ```

- [ ] **Commit in 3 logical units**:
  1. `#10: Add nullifier computation to circuit and recompile`
  2. `#10: Add nullifier tracking and issuer access control to contracts`
  3. `#10: Add replay protection and access control tests`

---

### 🚫 Out of Scope

- Re-deploying to Sepolia with nullifier logic → can be done as a follow-up or in Issue #13
- Multi-issuer support → out of scope for the project
- Frontend integration of nullifiers → Issue #12

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| Circuit outputs `nullifierHash` as a public signal | Compiles with 0 errors ✅ |
| `CredentialRegistry` tracks used nullifiers | `isNullifierUsed()` works ✅ |
| Only the issuer can call `addCommitment()` | Non-issuer reverts ✅ |
| First proof submission succeeds | `verifyAge()` returns true ✅ |
| Second submission with same proof reverts | "Proof already used" ✅ |
| All existing tests still pass | No regressions ✅ |

---

### ⚠️ Notes

- **Why `Poseidon(secret, secret)` for the nullifier?** Using the same value twice is a common pattern — it produces a unique hash tied to the secret without introducing a new private input. Some systems use `Poseidon(secret, 1)` or a dedicated nullifier nonce — our approach is simpler and sufficient for this project.
- **The nullifier does NOT reveal the secret.** Poseidon is a one-way hash — you cannot recover `secret` from `nullifierHash`.
- **Adding `nullifierHash` as a public signal changes the verifier's function signature.** The `uint[3]` array becomes `uint[4]` (or however many public signals the updated circuit has). The generated `Verifier.sol` handles this automatically when regenerated.
- **Access control is minimal** (single issuer = deployer). A production system would use a role-based approach (e.g., OpenZeppelin's `AccessControl`), but that's over-engineered for our demo.

**Labels**: `contracts`, `optimization`, `phase-3`
**Branch**: `issue/11-gas-report`
**Depends on**: Issue #10 (nullifier logic must be in contracts — we need to measure the final contract state)

---

### 📋 Description

The project roadmap defines a hard target:

> **Gas cost < 300,000 units per verification**

This issue measures the actual gas cost of every on-chain operation in the Veritas system, documents the results, and applies optimizations if we exceed the target.

This is **not a coding-heavy issue** — it's primarily a measurement and documentation task. But if gas exceeds 300k, circuit simplification or contract refactoring will be needed.

---

### 🧠 Why Gas Matters

Every operation on Ethereum costs gas. Users or a relayer must pay for it. For Veritas:

| Operation | Who pays | Frequency |
|-----------|----------|-----------|
| `addCommitment()` | Issuer | Once per user |
| `verifyAge()` | User (prover) | Once per verification |
| `verifyProof()` (internal) | User | Called by `verifyAge()` |

The `verifyProof()` call is the expensive one — it performs 3 elliptic curve operations using Ethereum precompiles. If this exceeds 300k gas, the system becomes impractical for real-world use.

---

### ✅ Tasks

#### Setup

- [ ] **Install the Hardhat gas reporter plugin**:
  ```bash
  npm install --save-dev hardhat-gas-reporter
  ```

- [ ] **Update `hardhat.config.js`** to enable gas reporting:
  ```javascript
  require("hardhat-gas-reporter");

  module.exports = {
    // ... existing config
    gasReporter: {
      enabled: true,
      currency: "USD",
      token: "ETH",
      gasPriceApi: "https://api.etherscan.io/api?module=proxy&action=eth_gasPrice",
      outputFile: "docs/gas-report.txt",
      noColors: true
    }
  };
  ```

#### Measurement

- [ ] **Run the full test suite with gas reporting enabled**:
  ```bash
  REPORT_GAS=true npx hardhat test
  ```
  This produces a table showing gas consumption per function call across all tests.

- [ ] **Record gas costs** for each operation:

  | Operation | Expected Range | Target |
  |-----------|---------------|--------|
  | `CredentialRegistry.addCommitment()` | ~45k–65k | No hard target |
  | `Verifier.verifyProof()` | ~220k–280k | < 300k |
  | `VeritasCore.verifyAge()` (full flow) | ~250k–320k | < 300k |
  | `CredentialRegistry.isRegistered()` | ~2.5k (view) | Negligible |
  | `CredentialRegistry.markNullifierUsed()` | ~25k–45k | No hard target |
  | Contract deployment (Verifier) | ~1.5M–2.5M | One-time cost |
  | Contract deployment (VeritasCore) | ~300k–500k | One-time cost |

#### Analysis & Documentation

- [ ] **Create `docs/gas-report.md`** with the complete results:
  ```markdown
  # Gas Report — Veritas-zk

  ## Summary
  | Operation | Gas Used | USD (at 30 gwei, ETH=$2000) | Target | Status |
  |-----------|----------|------|--------|--------|
  | verifyAge() | ??? | $?.?? | < 300k | ✅/❌ |
  | ...

  ## Circuit Stats
  - Non-linear constraints: ???
  - Linear constraints: ???
  - Public inputs: ???
  - Private inputs: ???

  ## Analysis
  - Where is gas being spent?
  - Is the 300k target met?
  - What could be optimized?
  ```

- [ ] **If `verifyAge()` exceeds 300k gas**, investigate and apply optimizations:

  | Optimization | Impact | Difficulty |
  |-------------|--------|-----------|
  | Reduce comparator bit-width (32 → 16) | Fewer constraints, less gas | Easy |
  | Remove unnecessary signals | Fewer wires in R1CS | Easy |
  | Use `calldata` instead of `memory` in Solidity | ~2k gas savings | Trivial |
  | Batch commitment checks off-chain | Removes 1 SLOAD (~2.1k) | Medium |
  | Switch from Groth16 to PLONK | Different gas profile | Hard — out of scope |

- [ ] **Save the gas reporter output to `docs/gas-report.txt`** (auto-generated by the plugin).

- [ ] **Run tests again after any optimizations** to confirm gas reduction and no regressions.

- [ ] **Commit in 2 logical units**:
  1. `#11: Add hardhat-gas-reporter and configuration`
  2. `#11: Add gas measurement report and optimizations (if any)`

---

### 🚫 Out of Scope

- Mainnet cost projections beyond simple multiplication → this is a testnet project
- Switching proving systems (PLONK, STARK) → fundamentally different architecture
- L2 deployment (Polygon, Arbitrum) → would reduce gas but changes the deployment target

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| `hardhat-gas-reporter` installed and configured | Reports generated on `npx hardhat test` ✅ |
| `docs/gas-report.md` created with full results | All operations measured ✅ |
| `docs/gas-report.txt` auto-generated output saved | Raw data preserved ✅ |
| `verifyAge()` gas cost documented | Exact number recorded ✅ |
| Gas < 300k per verification OR optimization applied | Target met ✅ |
| All existing tests still pass | No regressions ✅ |

---

### ⚠️ Notes

- **`REPORT_GAS=true`** is an environment variable that enables the reporter. Without it, tests run normally without the gas table (faster).
- **Gas costs are deterministic** on the local Hardhat node — you'll get the same numbers every run for the same contract code.
- **The Groth16 verifier's gas cost is primarily determined by the number of public inputs.** Each additional public signal adds ~3k gas for the pairing check. Our circuit has 3–4 public signals, which is very lean.
- **View functions (`isRegistered`, `isNullifierUsed`) don't cost gas** when called externally (off-chain reads). They only cost gas when called internally by another contract transaction.
- **If we're well under 300k**, document it as a win in the final report — it demonstrates the efficiency of Poseidon over SHA-256 (which would produce 10x more constraints).

---

**Labels**: `frontend`, `zk`, `phase-4`
**Branch**: `issue/12-browser-proofs`
**Depends on**: Issue #8 (real `Verifier.sol` and finalized circuit `.wasm` + `.zkey` must exist)


---

### 📋 Description

Currently, when a user clicks "Generate Proof" in the React frontend, this is what runs:

```javascript
// frontend/src/utils/proofStub.js
export async function generateProofStub(input) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log("[STUB] Would generate ZK proof for input:", input);
  return { proof: "STUB_PROOF", publicSignals: ["2024", "18"] };
}
```

A fake 2-second delay and dummy data. **No actual cryptography happens.**

This issue replaces the stub with **real snarkjs Groth16 proof generation running entirely in the browser** using WebAssembly. After this ticket, the frontend will:

1. Load `attribute_check.wasm` and `circuit_final.zkey` as static assets
2. Compute `commitment = Poseidon(birthYear, secret)` client-side
3. Call `snarkjs.groth16.fullProve()` in-browser — generating a real ZK proof
4. Return a real `proof` + `publicSignals` that can be verified on-chain

**The proof is generated client-side.** Private inputs (`birthYear`, `secret`) never leave the browser. This is the core privacy guarantee of Veritas.

---

### 🧠 How Browser Proof Generation Works

```
┌─────────────────────────────────────────────────┐
│  User's Browser                                  │
│                                                  │
│  1. User enters birthYear + secret               │
│  2. JS computes: commitment = Poseidon(bY, s)    │
│  3. JS computes: nullifier = Poseidon(s, s)      │
│  4. snarkjs.groth16.fullProve() runs in WASM:    │
│     - Loads attribute_check.wasm (witness calc)   │
│     - Loads circuit_final.zkey (proving key)      │
│     - Computes witness from inputs               │
│     - Generates Groth16 proof                    │
│  5. Returns { proof, publicSignals }             │
│     - proof = { pi_a, pi_b, pi_c }              │
│     - publicSignals = [year, threshold,          │
│                        commitment, nullifier]     │
│                                                  │
│  ⚠️ birthYear and secret NEVER leave this box    │
└──────────────────────┬──────────────────────────┘
                       │
                       ↓ only proof + public signals are sent
              ┌────────────────┐
              │  Smart Contract │
              └────────────────┘
```

---

### ✅ Tasks

#### Dependencies

- [ ] **Install `snarkjs` in the frontend**:
  ```bash
  cd frontend
  npm install snarkjs
  ```

- [ ] **Install `circomlibjs`** for client-side Poseidon computation:
  ```bash
  cd frontend
  npm install circomlibjs
  ```

#### Copy Circuit Artifacts

- [ ] **Copy the compiled circuit files into the frontend `public/` directory** so Vite serves them as static assets:
  ```bash
  mkdir -p frontend/public/zk
  cp build/attribute_check_js/attribute_check.wasm frontend/public/zk/
  cp build/circuit_final.zkey frontend/public/zk/
  ```

- [ ] **Add a note in `frontend/README.md`** (or a comment in the proof utility) that these files must be manually copied after each circuit recompilation. Alternatively, create a small script:
  ```bash
  # scripts/copy_artifacts_to_frontend.sh
  cp build/attribute_check_js/attribute_check.wasm frontend/public/zk/
  cp build/circuit_final.zkey frontend/public/zk/
  echo "✅ Circuit artifacts copied to frontend/public/zk/"
  ```

- [ ] **Add `frontend/public/zk/` to `.gitignore`** — these are large binary files regenerated from source:
  ```gitignore
  # Circuit artifacts served to browser (regenerate from build/)
  frontend/public/zk/
  ```

#### Replace the Stub

- [ ] **Create `frontend/src/utils/proof.js`** — the real proof generation module:
  ```javascript
  import * as snarkjs from "snarkjs";
  import { buildPoseidon } from "circomlibjs";

  const WASM_PATH = "/zk/attribute_check.wasm";
  const ZKEY_PATH = "/zk/circuit_final.zkey";

  /**
   * Compute Poseidon hash of two values (matching circuit's Poseidon).
   * Returns the commitment as a decimal string.
   */
  export async function computeCommitment(birthYear, secret) {
    const poseidon = await buildPoseidon();
    const hash = poseidon([BigInt(birthYear), BigInt(secret)]);
    return poseidon.F.toString(hash);
  }

  /**
   * Compute nullifier from secret: Poseidon(secret, secret)
   */
  export async function computeNullifier(secret) {
    const poseidon = await buildPoseidon();
    const hash = poseidon([BigInt(secret), BigInt(secret)]);
    return poseidon.F.toString(hash);
  }

  /**
   * Generate a real Groth16 proof in the browser.
   * Private inputs (birthYear, secret) never leave the browser.
   *
   * @param {Object} input - { birthYear, secret, currentYear, threshold }
   * @returns {{ proof, publicSignals, commitment, nullifier }}
   */
  export async function generateProof({ birthYear, secret, currentYear, threshold }) {
    const commitment = await computeCommitment(birthYear, secret);
    const nullifier = await computeNullifier(secret);

    const circuitInput = {
      birthYear: String(birthYear),
      secret: String(secret),
      currentYear: String(currentYear),
      threshold: String(threshold),
      commitment: commitment,
      nullifierHash: nullifier,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      WASM_PATH,
      ZKEY_PATH
    );

    return { proof, publicSignals, commitment, nullifier };
  }

  /**
   * Format proof for Solidity contract's verifyProof() function.
   * Returns { a, b, c, input } ready for ethers.js contract call.
   */
  export async function formatCalldata(proof, publicSignals) {
    const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, input] = JSON.parse("[" + raw + "]");
    return { a, b, c, input };
  }
  ```

- [ ] **Update `frontend/src/components/ProveForm.jsx`** to import from `proof.js` instead of `proofStub.js`:
  ```javascript
  // BEFORE:
  import { generateProofStub } from "../utils/proofStub.js";

  // AFTER:
  import { generateProof } from "../utils/proof.js";
  ```
  Update the click handler to call `generateProof()` and pass the results to the restricted page via state.

- [ ] **Delete `frontend/src/utils/proofStub.js`** — no longer needed.

#### Vite Configuration

- [ ] **Update `frontend/vite.config.js`** to handle the large `.zkey` file correctly:
  ```javascript
  export default defineConfig({
    // ... existing config
    server: {
      headers: {
        // Required for SharedArrayBuffer (snarkjs uses Web Workers)
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    optimizeDeps: {
      exclude: ["snarkjs"],  // snarkjs uses dynamic requires
    },
  });
  ```

- [ ] **Test WASM loading**: The `.wasm` and `.zkey` files are fetched via HTTP at runtime by snarkjs. Ensure Vite serves them correctly (check browser Network tab — both should load with `200 OK`).

#### UI Updates

- [ ] **Add a progress indicator** to `ProveForm.jsx` — real proof generation takes 3–10 seconds depending on hardware:
  ```
  Generating proof... (this may take 5-10 seconds)
  [============>          ] 60%
  ```

- [ ] **Show the commitment and nullifier** on the success/restricted page so the user understands what was produced:
  ```
  Commitment:  0x7a8f...3c21 (registered on-chain by issuer)
  Nullifier:   0x4b2e...91f0 (single-use token, prevents replay)
  ```

- [ ] **Handle errors gracefully** — if the user enters an invalid birthYear (e.g., underage), `fullProve()` will throw. Catch it and show a user-friendly message:
  ```
  ❌ Proof generation failed: Age does not meet the required threshold.
  ```

#### Testing

- [ ] **Manual testing checklist**:

  | # | Test | Steps | Expected |
  |---|------|-------|----------|
  | 1 | Valid proof | Enter birthYear=2000, secret=12345, click Generate | Proof generated ✅, commitment + nullifier shown |
  | 2 | Underage rejection | Enter birthYear=2010, secret=12345 | Error: "Age does not meet threshold" |
  | 3 | Network tab check | Open DevTools → Network | `attribute_check.wasm` and `circuit_final.zkey` loaded with 200 |
  | 4 | Console check | Open DevTools → Console | No errors, proof object logged |
  | 5 | Performance | Time the proof generation | Should complete in < 15 seconds |
  | 6 | Private data check | Check Network tab after proof | `birthYear` and `secret` NOT in any network request |

- [ ] **Commit in 3 logical units**:
  1. `#12: Add snarkjs and circomlibjs dependencies and Vite config for WASM`
  2. `#12: Replace proof stub with real browser Groth16 proof generation`
  3. `#12: Add proof details display, error handling, and artifact copy script`

---

### 🚫 Out of Scope

- Submitting the proof to the smart contract → Issue #13
- Optimizing proof generation speed (Web Workers) → nice-to-have, not required
- Generating `.wasm` / `.zkey` from the frontend → they are pre-built and served as static files

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| `proofStub.js` deleted | No more fake proofs ✅ |
| Real `fullProve()` runs in browser | Generates proof in < 15s ✅ |
| `.wasm` and `.zkey` load from `/zk/` | Network tab shows 200 OK ✅ |
| Valid input produces real proof object | `proof.pi_a`, `pi_b`, `pi_c` are arrays of numbers ✅ |
| Invalid input (underage) shows error | User-friendly message ✅ |
| `birthYear` and `secret` never in network requests | Privacy preserved ✅ |
| `frontend/public/zk/` is gitignored | Not committed ✅ |

---

### ⚠️ Notes

- **The `.zkey` file is large** (~2–10 MB depending on circuit complexity). It's fetched once and can be cached by the browser. For production, consider hosting it on a CDN.
- **`snarkjs.groth16.fullProve()` is CPU-intensive.** On a modern laptop it takes 3–8 seconds. On a phone it may take 15–30 seconds. A loading indicator is essential UX.
- **SharedArrayBuffer requirements**: Some snarkjs operations use Web Workers which require COOP/COEP headers. If these headers aren't set, proof generation may fall back to a slower single-threaded mode. The Vite config above handles this for development.
- **The commitment must match what the issuer registered on-chain.** If the user enters a different `birthYear` or `secret` than what was issued to them, the commitment won't match, and even though the proof generates successfully in the browser, `VeritasCore.verifyAge()` will revert with "Commitment not registered."

---

Ready for #13 (Full Frontend Flow — On-chain Verify).

**Labels**: `frontend`, `contracts`, `integration`, `phase-4`
**Branch**: `issue/13-onchain-flow`
**Depends on**: Issue #9 (contracts on Sepolia), Issue #12 (real browser proofs)

---

### 📋 Description

This is the **final integration ticket**. It connects the two halves of the system:

- **Left half** (done): The browser generates a real ZK proof from private inputs
- **Right half** (done): Smart contracts on Sepolia can verify proofs and track nullifiers

This issue wires them together. After this ticket, the complete Veritas user flow works end-to-end:

```
User opens DApp
    → connects MetaMask
    → enters birthYear + secret
    → browser generates ZK proof (private inputs never leave browser)
    → user clicks "Verify On-Chain"
    → MetaMask pops up to sign the transaction
    → VeritasCore.verifyAge() is called on Sepolia
    → contract checks commitment, verifies proof, stores nullifier
    → frontend reads the result
    → ✅ "Age Verified" — restricted content unlocked
```

This is the **Definition of Done moment** — the project fulfills its core promise.

---

### ✅ Tasks

#### Contract ABI & Address Configuration

- [ ] **Create `frontend/src/contracts/` directory** with ABI files and address config:
  ```
  frontend/src/contracts/
  ├── VeritasCore.json     # ABI (copy from artifacts/)
  ├── CredentialRegistry.json
  └── addresses.js         # Reads from .env
  ```

- [ ] **Create `frontend/src/contracts/addresses.js`**:
  ```javascript
  export const CONTRACTS = {
    core: import.meta.env.VITE_CORE_ADDRESS,
    registry: import.meta.env.VITE_REGISTRY_ADDRESS,
    verifier: import.meta.env.VITE_VERIFIER_ADDRESS,
  };

  export const EXPECTED_CHAIN_ID = 11155111; // Sepolia
  ```

- [ ] **Update `frontend/.env.example`** with the deployed addresses from Issue #9:
  ```env
  VITE_CORE_ADDRESS=0x...
  VITE_REGISTRY_ADDRESS=0x...
  VITE_VERIFIER_ADDRESS=0x...
  ```

#### On-chain Verification Module

- [ ] **Create `frontend/src/utils/onchain.js`** — handles all contract interactions:
  ```javascript
  import { BrowserProvider, Contract } from "ethers";
  import { formatCalldata } from "./proof.js";
  import VeritasCoreABI from "../contracts/VeritasCore.json";
  import RegistryABI from "../contracts/CredentialRegistry.json";
  import { CONTRACTS, EXPECTED_CHAIN_ID } from "../contracts/addresses.js";

  /**
   * Get a signer connected to the user's MetaMask wallet.
   */
  async function getSigner() {
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network. Please switch MetaMask to Sepolia (chainId ${EXPECTED_CHAIN_ID})`);
    }
    return provider.getSigner();
  }

  /**
   * Check if a commitment is registered on-chain.
   */
  export async function isCommitmentRegistered(commitment) {
    const signer = await getSigner();
    const registry = new Contract(CONTRACTS.registry, RegistryABI.abi, signer);
    return registry.isRegistered(commitment);
  }

  /**
   * Submit a ZK proof to the VeritasCore contract for on-chain verification.
   * Returns the transaction receipt.
   */
  export async function verifyOnChain(proof, publicSignals) {
    const signer = await getSigner();
    const core = new Contract(CONTRACTS.core, VeritasCoreABI.abi, signer);

    const { a, b, c, input } = await formatCalldata(proof, publicSignals);

    const tx = await core.verifyAge(a, b, c, input);
    const receipt = await tx.wait();

    return {
      verified: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  /**
   * Check if a nullifier has already been used.
   */
  export async function isNullifierUsed(nullifier) {
    const signer = await getSigner();
    const registry = new Contract(CONTRACTS.registry, RegistryABI.abi, signer);
    return registry.isNullifierUsed(nullifier);
  }
  ```

#### Frontend Flow Updates

- [ ] **Update `ProveForm.jsx`** to add a two-step flow:

  **Step 1 — Generate Proof** (already done in Issue #12):
  ```
  [Generate Proof] → spinner → "Proof generated ✅"
  ```

  **Step 2 — Verify On-Chain** (new):
  ```
  [Verify On-Chain] → MetaMask popup → spinner → "Verified on Sepolia ✅"
  ```

  The UI should show both steps clearly:
  ```
  ┌───────────────────────────────────────┐
  │  Step 1: Generate ZK Proof            │
  │  ✅ Proof generated (3.2s)            │
  │                                        │
  │  Step 2: Verify On-Chain               │
  │  [ Verify on Sepolia → ]               │
  │                                        │
  │  ⚡ This will open MetaMask to sign    │
  │     a transaction on Sepolia testnet   │
  └───────────────────────────────────────┘
  ```

- [ ] **Update `RestrictedPage.jsx`** to show the on-chain verification receipt:
  ```
  ┌───────────────────────────────────────┐
  │  🎉 Age Verified On-Chain             │
  │                                        │
  │  Transaction:  0xa3f2...8d01           │  ← clickable Etherscan link
  │  Block:        #18,234,567             │
  │  Gas Used:     267,432                 │
  │  Network:      Sepolia                 │
  │                                        │
  │  Commitment:   0x7a8f...3c21           │
  │  Nullifier:    0x4b2e...91f0           │
  │                                        │
  │  [View on Etherscan ↗]                │
  └───────────────────────────────────────┘
  ```

- [ ] **Add network validation** — if MetaMask is on the wrong network, show a clear error and a "Switch to Sepolia" button:
  ```javascript
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }], // Sepolia chainId in hex
    });
  } catch (err) {
    // If Sepolia not added, prompt to add it
  }
  ```

- [ ] **Handle all error cases** in the UI:

  | Error | Source | User Message |
  |-------|--------|-------------|
  | Wrong network | `onchain.js` | "Please switch MetaMask to Sepolia" + switch button |
  | Commitment not registered | Contract revert | "Your credential has not been registered by an issuer" |
  | Nullifier already used | Contract revert | "This proof has already been used (replay protection)" |
  | User rejected MetaMask | MetaMask | "Transaction cancelled by user" |
  | Insufficient gas | MetaMask | "Insufficient Sepolia ETH — get free ETH from a faucet" |
  | Proof invalid (tampered) | Contract revert | "Proof verification failed — please regenerate" |

- [ ] **Update route guards** — the restricted page should now require BOTH a valid proof AND an on-chain verification receipt (not just the proof stub success).

#### Testing

- [ ] **Manual end-to-end testing checklist**:

  | # | Test | Steps | Expected |
  |---|------|-------|----------|
  | 1 | Happy path | Connect → enter valid input → Generate → Verify → Restricted | Full flow completes, Etherscan link works |
  | 2 | Wrong network | Switch MetaMask to mainnet, click Verify | Error: "Switch to Sepolia" with button |
  | 3 | Unregistered commitment | Use a birthYear/secret not registered by issuer | Error: "Credential not registered" |
  | 4 | Replay attack | Complete flow, reset, submit same proof | Error: "Proof already used" |
  | 5 | User rejects MetaMask | Click Verify, then reject MetaMask popup | Error: "Transaction cancelled" |
  | 6 | Etherscan link | Click "View on Etherscan" on restricted page | Opens correct tx on sepolia.etherscan.io |

- [ ] **Commit in 3 logical units**:
  1. `#13: Add contract ABIs, address config, and on-chain verification module`
  2. `#13: Implement two-step prove + verify flow with MetaMask integration`
  3. `#13: Add verification receipt display, error handling, and network validation`

---

### 🚫 Out of Scope

- Issuer UI for registering commitments → could be a future issue
- Multi-network support (mainnet, Polygon, etc.) → Sepolia only
- Transaction gas estimation preview → nice-to-have

---

### ✅ Acceptance Criteria (Definition of Done)

| Criterion | Expected Result |
|-----------|----------------|
| Proof generated in browser | Real snarkjs, no stub ✅ |
| MetaMask transaction submitted to Sepolia | `verifyAge()` called ✅ |
| Contract returns `true` for valid proof | On-chain verified ✅ |
| Transaction hash shown with Etherscan link | Clickable, opens correct page ✅ |
| Replay attempt rejected | "Proof already used" error ✅ |
| Wrong network shows switch prompt | User guided to Sepolia ✅ |
| Restricted page requires on-chain receipt | Route guard enforced ✅ |

---

### ⚠️ Notes

- **This is the most user-facing ticket in the project.** Every error message, loading state, and transition must feel polished. The user sees MetaMask popups for the first time — the UX must guide them clearly.
- **The `verifyAge()` function is a state-changing transaction** (it stores the nullifier), so it costs gas and requires MetaMask approval. It is NOT a `view` function.
- **Gas cost**: Users need Sepolia ETH. Include a faucet link in the error message if they're low on balance.
- **The Etherscan link format is**: `https://sepolia.etherscan.io/tx/{txHash}`


**Labels**: `testing`, `documentation`, `polish`, `phase-5`
**Branch**: `issue/14-final-polish`
**Depends on**: All previous issues merged

---

### 📋 Description

This is the **closing ticket**. Every feature is built. Every contract is deployed. The frontend works end-to-end. Now we:

1. **Harden** — add every missing test case identified in the project report
2. **Document** — create the architecture diagram, update the README, write the final project report
3. **Record** — produce a demo video showing the full flow
4. **Clean** — remove dead code, stale files, and repo clutter

After this ticket, the project is **submission-ready**.

---

### ✅ Tasks

---

#### Part 1: Comprehensive Test Suite

##### Smart Contract Tests — `tests/sample-test.js`

- [ ] Add the missing test cases flagged in the [project report](file:///d:/ALI/CodeSpace/Veritas-zk/docs/veritas_project_report.md) Section 4:

  | # | Test Case | Expected |
  |---|-----------|----------|
  | 1 | Duplicate commitment rejection | Reverts: "Already registered" |
  | 2 | `isRegistered()` returns `false` for unknown hash | Returns `false` |
  | 3 | `CommitmentAdded` event emission with correct data | Event emitted |
  | 4 | Only issuer can call `addCommitment()` | Non-issuer reverts |
  | 5 | `verifyProof()` with valid proof returns `true` | Returns `true` |
  | 6 | `verifyProof()` with tampered proof returns `false` | Returns `false` |
  | 7 | `verifyAge()` with unregistered commitment reverts | Reverts |
  | 8 | `verifyAge()` replay (same nullifier twice) reverts | Reverts: "Proof already used" |
  | 9 | `isNullifierUsed()` returns `false` then `true` | State changes |

##### Circuit Tests — `tests/circuit-test.js`

- [ ] Add the security-critical test cases from the report:

  | # | Test Case | Input | Expected |
  |---|-----------|-------|----------|
  | 1 | Age 0 (same year as currentYear) | birthYear=2024 | ❌ Fails (0 < 18) |
  | 2 | Max age for bit-width | birthYear=1769, year=2024 (age=255) | ✅ Passes |
  | 3 | Overflow attack (age=256) | birthYear=1768 | ❌ Fails (wraps in N-bit comparator) |
  | 4 | Threshold 0 (any age passes) | threshold=0 | ✅ Passes |
  | 5 | Different threshold (21) | threshold=21, age=20 | ❌ Fails |
  | 6 | Wrong secret (commitment mismatch) | Correct birthYear, wrong secret | ❌ Fails |
  | 7 | Wrong commitment (forged) | All correct except commitment | ❌ Fails |

##### Test Coverage Target

- [ ] Run `npx hardhat test` and confirm:
  ```
  CredentialRegistry          — X passing
  AttributeCheck circuit      — X passing
  VeritasCore integration     — X passing

  Total: ~20+ passing
  ```

---

#### Part 2: Architecture Diagram

- [ ] **Create `docs/architecture.md`** with a Mermaid diagram showing the full system:

  ```markdown
  # Veritas-zk Architecture

  ## System Overview
  [Mermaid diagram: Issuer → Registry → User → Browser Proof → Contract → Verified]

  ## Data Flow
  [Mermaid sequence diagram: step-by-step of a verification]

  ## Circuit Internals
  [Diagram: signals, constraints, Poseidon, GreaterEqThan]

  ## Contract Relationships
  [Diagram: Verifier ← VeritasCore → CredentialRegistry]

  ## Security Model
  - What is private (birthYear, secret)
  - What is public (commitment, nullifier, threshold, currentYear)
  - What is on-chain (commitment registry, nullifier set, proof verification)
  - What never leaves the browser (private inputs, witness)
  ```

---

#### Part 3: Final README

- [ ] **Rewrite `README.md`** to be the definitive project landing page:

  ```markdown
  # Veritas-zk

  [One-paragraph description]
  [Architecture diagram image or Mermaid]

  ## Features
  - ZK proof of age ≥ 18 without revealing birth year
  - Poseidon commitment scheme for credential binding
  - Nullifier-based replay protection
  - On-chain Groth16 verification on Sepolia
  - Fully client-side proof generation (private data never leaves browser)

  ## Quick Start
  [Clone → install → compile → test — 4 commands]

  ## Running the Frontend
  [cd frontend → install → dev]

  ## Project Structure
  [Tree with one-line descriptions]

  ## Architecture
  [Link to docs/architecture.md]

  ## Gas Report
  [Link to docs/gas-report.md]

  ## Security
  [What to never commit, privacy guarantees]

  ## Team
  [Contributors table]

  ## License
  MIT
  ```

---

#### Part 4: Demo Video

- [ ] **Record a screen recording** (2–3 minutes) showing the full flow:

  ```
  0:00 — Open terminal, run npx hardhat test (all green)
  0:20 — Open browser, show the DApp home page
  0:30 — Click "Connect Wallet" → MetaMask connects
  0:40 — Navigate to Prove page
  0:50 — Enter birthYear=2000, secret=12345
  1:00 — Click "Generate Proof" → spinner → success
  1:15 — Click "Verify On-Chain" → MetaMask popup → confirm
  1:30 — Wait for tx confirmation → "Verified ✅" with Etherscan link
  1:45 — Click Etherscan link → show tx on Sepolia
  2:00 — Go back, try to submit same proof again → "Already used" error
  2:15 — Show Restricted Page with verification receipt
  2:30 — End
  ```

- [ ] Save as `docs/demo.mp4` or upload to YouTube and link in README.

---

#### Part 5: Repo Cleanup

- [ ] **Remove stale files** from the project root that don't belong:

  | File | Action | Reason |
  |------|--------|--------|
  | `veritas.md` | Move to `docs/roadmap.md` | Roadmap shouldn't be at root |
  | `dapp.config.json` | Delete or move to `docs/` | Remix IDE config, not used |
  | `remix.config.json` | Delete or move to `docs/` | Remix MCP config, not used |

- [ ] **Verify `.gitignore`** covers everything — run `git status` and confirm no build artifacts, `.env`, or binary files appear.

- [ ] **Add `LICENSE` file** (MIT) if not already present.

- [ ] **Final `git status`** — working tree must be clean.

- [ ] **Commit in 4 logical units**:
  1. `#14: Add comprehensive contract and circuit test suite`
  2. `#14: Add architecture diagram and project documentation`
  3. `#14: Rewrite README as project landing page`
  4. `#14: Clean up stale files, add LICENSE, and final polish`

---

### ✅ Acceptance Criteria (Definition of Done — THE Definition of Done)

This is the **project-level** Definition of Done from the roadmap:

| Criterion | Status After This Ticket |
|-----------|------------------------|
| Circuit compiles without warnings | ✅ |
| Verifier contract deployed on Sepolia | ✅ |
| Frontend can generate proof locally | ✅ |
| Frontend can verify proof on-chain | ✅ |
| Gas cost < 300,000 units per verification | ✅ (measured in Issue #11) |
| Code commented in English | ✅ |
| README explains how to run the project | ✅ |
| Architecture diagram exists | ✅ |
| Demo video recorded | ✅ |
| All tests pass (20+) | ✅ |
| No secrets or build artifacts in Git | ✅ |

---

### ⚠️ Notes

- **This ticket is shared work.** All three team members contribute:
  - **Person A** (ZK): writes circuit security tests, reviews architecture diagram accuracy
  - **Person B** (Contracts): writes contract tests, verifies gas report
  - **Person C** (Frontend): records demo video, polishes README
- **The demo video is the most impactful deliverable** for a presentation or portfolio. Prioritize it.
- **Don't skip the overflow test** (`birthYear=1768`). It's the most interesting security finding in the project and demonstrates understanding of ZK circuit limitations.