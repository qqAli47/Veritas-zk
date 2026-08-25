
# 🛡️ Project Veritas: Internal Development Roadmap
**Version:** 1.0 (Internal)  
**Status:** Active  
**Timeline:** 16 Weeks (Development) + 2 Weeks (Buffer/Documentation)  
**Stack:** Circom v2, Solidity, Hardhat, React, SnarkJS  

---

## 🎯 Core Objectives
1.  **Privacy:** Verify attributes (e.g., Age ≥ 18) without revealing raw data.
2.  **Security:** Use Zero-Knowledge Proofs (zk-SNARKs) to prevent data leakage.
3.  **Simplicity:** Single trusted issuer, fixed threshold, minimal circuit complexity.
4.  **Demo:** Fully functional DApp (Issue → Prove → Verify → Access).

---

## 📅 Phase 1: Foundation & Blockchain Basics (Weeks 1-3)
**Goal:** Setup environment and understand Solidity/Hardhat basics.
| Week | Tasks | Deliverables |
|------|-------|--------------|
| **1** | - Install Node.js, VS Code, Git.<br>- Install MetaMask & fund Sepolia Testnet.<br>- Initialize Hardhat project. | ✅ `hardhat.config.js` ready.<br>✅ MetaMask connected. |
| **2** | - Learn Solidity basics (variables, functions, mappings).<br>- Deploy `HelloWorld` contract locally. | ✅ Local deployment script.<br>✅ Understanding of Gas. |
| **3** | - Build `AgeStorage` contract (public mapping).<br>- **Realization:** Understand why public storage is bad for privacy. | ✅ `AgeStorage.sol` deployed.<br>✅ Motivation for ZK documented. |

---

## 📅 Phase 2: Zero-Knowledge Circuit Development (Weeks 4-7)
**Goal:** Build and test the Circom circuit (The Core Innovation).
| Week | Tasks | Deliverables |
|------|-------|--------------|
| **4** | - Install Circom v2 & SnarkJS.<br>- Build `SquareProof` circuit (tutorial).<br>- Generate witness & proof locally. | ✅ `square.circom` working.<br>✅ Local proof generation. |
| **5** | - Build `AttributeCheck` circuit (Age ≥ 18).<br>- Logic: `(currentYear - birthYear) >= threshold`.<br>- **No hashing yet** (keep it simple). | ✅ `attribute_check.circom` (v1).<br>✅ Range check logic verified. |
| **6** | - Integrate **Poseidon Hash** for commitment.<br>- Logic: `hash(birthYear + secret) == commitment`.<br>- Test constraint satisfaction. | ✅ `attribute_check.circom` (v2).<br>✅ Commitment logic working. |
| **7** | - Compile circuit to `.zkey` and `.wasm`.<br>- Generate Solidity Verifier contract using SnarkJS. | ✅ `verifier.sol` generated.<br>✅ `.zkey` files secured. |

---

## 📅 Phase 3: Smart Contract Integration (Weeks 8-10)
**Goal:** Connect ZK proofs to the Blockchain.
| Week | Tasks | Deliverables |
|------|-------|--------------|
| **8** | - Deploy `Verifier.sol` to Sepolia Testnet.<br>- Write Hardhat script to verify a proof on-chain. | ✅ Contract on Sepolia.<br>✅ Verification script passes. |
| **9** | - Build `CredentialRegistry` contract.<br>- Logic: `mapping(bytes32 => bool) public commitments`.<br>- Prevent replay attacks (nullifiers). | ✅ Registry contract deployed.<br>✅ Replay protection logic. |
| **10** | - **Gas Optimization:** Measure gas cost of `verifyProof`.<br>- Simplify circuit if gas > 300k units. | ✅ Gas report generated.<br>✅ Optimization notes documented. |

---

## 📅 Phase 4: Frontend & User Flow (Weeks 11-13)
**Goal:** Build the React DApp for the Demo.
| Week | Tasks | Deliverables |
|------|-------|--------------|
| **11** | - Setup React + Ethers.js + Tailwind CSS.<br>- Connect Wallet (MetaMask).<br>- UI: "Connect Wallet" button. | ✅ React app running.<br>✅ Wallet connection working. |
| **12** | - Integrate Proof Generation in Browser (using `.wasm`).<br>- UI: Input fields for secret attributes (mock issuer). | ✅ Client-side proof generation.<br>✅ "Generate Proof" button works. |
| **13** | - Integrate Verification Call.<br>- UI: Show "Verified ✅" or "Failed ❌".<br>- Protect a "Restricted Page". | ✅ Full flow: Issue → Prove → Verify.<br>✅ Restricted content hidden/shown. |

---

## 📅 Phase 5: Testing, Polish & Documentation (Weeks 14-16)
**Goal:** Ensure stability and prepare for SVU submission.
| Week | Tasks | Deliverables |
|------|-------|--------------|
| **14** | - **Negative Testing:** Try wrong birthYear, forged proof, replay attack.<br>- Fix bugs. | ✅ Test report (Pass/Fail).<br>✅ Bug fixes applied. |
| **15** | - Record Demo Video (3-5 mins).<br>- Create Architecture Diagram (Draw.io).<br>- Clean Code (comments, README). | ✅ Demo Video.<br>✅ Architecture Diagram.<br>✅ Clean GitHub Repo. |
| **16** | - Write Final Report (SVU Template).<br>- Prepare Presentation Slides.<br>- **Buffer Week** for unexpected delays. | ✅ Final Report Draft.<br>✅ Presentation Ready. |

---

## ⚠️ Risk Mitigation Plan (From `ideas.md`)
| Risk | Mitigation Strategy | Owner |
|------|---------------------|-------|
| **High Gas Costs** | Use **Poseidon** hash (not SHA256). Keep circuit constraints < 10,000. | Dev Team |
| **Circuit Bugs** | Start with minimal circuit (Week 5). Add unit tests for every constraint. | Dev Team |
| **Secret Leakage** | **NEVER** log `birthYear` or `secret` to console. Keep secrets in browser memory only. | Dev Team |
| **Centralization** | Document clearly: **Issuer is Trusted**. This is a known limitation for PR1. | Report |
| **Time Overrun** | If Week 10 is too hard, skip Frontend (Week 11-13) and use Hardhat scripts for Demo. | Supervisor |

---

## 📂 Repository Structure

veritas-zk/
├── circuits/            # Circom files (attribute_check.circom)
├── contracts/           # Solidity files (Verifier.sol, Registry.sol)
├── frontend/            # React App (src/, public/)
├── scripts/             # Hardhat scripts (deploy.js, verify.js)
├── tests/               # Circuit & Contract tests
├── docs/                # Diagrams, Reports, Demo Video
├── .gitignore
├── HARDHAT.config.js
├── package.json
└── INTERNAL_ROADMAP.md  # This file


---

## ✅ Definition of Done (DoD)
- [ ] Circuit compiles without warnings.
- [ ] Verifier contract deployed on Sepolia.
- [ ] Frontend can generate proof locally.
- [ ] Frontend can verify proof on-chain.
- [ ] Gas cost < 300,000 units per verification.
- [ ] Code commented in English.
- [ ] README explains how to run the project.
