# Veritas-zk

<div align="center">

**A Privacy-Preserving Attribute Verification System Built on Zero-Knowledge Proofs**

*Prove you are old enough, and where you are — without revealing either.*

![Tests](https://img.shields.io/badge/tests-111%20passing-brightgreen)
![Gas](https://img.shields.io/badge/gas-297%2C280%20%3C%20300k-blue)
![Constraints](https://img.shields.io/badge/circuit-1033%20constraints-purple)
![License](https://img.shields.io/badge/license-MIT-orange)
![Solidity](https://img.shields.io/badge/solidity-0.8.20-red)
![Network](https://img.shields.io/badge/network-Sepolia%20%7C%20Localhost-lightgrey)

</div>

---

## 🧩 The Problem

Online platforms increasingly require users to verify personal attributes — such as being over a certain legal age or residing in a permitted region — to comply with regulatory frameworks. Traditional verification models force users to expose highly sensitive personal data: exact dates of birth, government-issued IDs, and home addresses.

This creates **a fundamental conflict**: regulatory compliance requires verification, but verification requires data exposure — and data exposure creates risk.

**Veritas-zk resolves this conflict entirely.**

---

## 💡 The Solution

Veritas-zk uses **Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge (zk-SNARKs)** to allow a user to prove:

- ✅ Their **age** meets a required threshold
- ✅ Their **region** is one the verifier accepts

...to an Ethereum smart contract — **without revealing their birth year, their exact region, or any other private data.** The proof is generated entirely inside the user's browser. Private inputs never leave the device.

The location proof is **private set membership**: the verifier learns only *"this holder is in one of the N regions I accept"* — never which one. N is the holder's **anonymity set**, and the app shows it before they commit to proving anything.

---

## 🏗️ System Architecture

```
╔══════════════════╗     ╔══════════════════════════════╗     ╔═══════════════════════════════╗
║   🏛  Issuer     ║     ║     🧑 Holder's Browser      ║     ║       ⛓  Ethereum             ║
║                  ║     ║                              ║     ║                               ║
║  Verifies        ║     ║  secret ← CSPRNG             ║     ║                               ║
║  identity once,  ║     ║  commitment =                ║     ║                               ║
║  off-chain       ║     ║   Poseidon(bY, region, s)    ║     ║                               ║
╚══════════════════╝     ╚══════════════════════════════╝     ╚═══════════════════════════════╝
         │                            │                                      │
         │◄─── commitment only ───────┘                                      │
         │                                                                   │
         │── registerCommitment() ───────────────────────────────────────►  CredentialRegistry
         │                            │                                      │
         │                            │  Groth16 proof (~0.5 s)              │
         │                            │  proof + 4 public signals ────────►  VeritasCore
         │                            │                                      │  ├ policy checks
         │                            │                                      │  ├ pairing check
         │                            │                                      │  ├ spend nullifier
         │                            │                                      │  └ write attestation
         │                            │                                      │
         │                            │             relying party ─────────►  isVerifiedAtLeast()
         │                            │                                      │  → true ✅
```

### Three Layers, One Story

| Layer | Technology | Role |
|-------|-----------|------|
| **ZK Circuit** | Circom v2 + Groth16 | Proves age ≥ threshold and region ∈ allowlist, without revealing either |
| **Smart Contracts** | Solidity 0.8.20 + Hardhat | Enforces policy, records attestations, prevents replay attacks |
| **Frontend DApp** | React 18 + Vite 5 + Ethers v6 | Browser-based proof generation in a Web Worker, wallet integration |

---

## 📊 Project Status

| Metric | Value |
|--------|-------|
| **Circuit** | 1,033 non-linear constraints — age + region in a single proof |
| **Public Signals** | 4 signals: `commitment`, `nullifier`, `context`, `packed` |
| **Proving Time** | ~0.5 seconds in-browser, inside a Web Worker |
| **On-chain Gas** | **297,280 gas** per verification (target: < 300,000) ✅ |
| **Gas Headroom** | 2,720 gas (< 1%) — regression-tested in CI |
| **Test Suite** | **111 tests passing** — circuit, contracts, integration, gas, parity |
| **Networks** | Local Hardhat node and Sepolia testnet |
| **Proof System** | Groth16 over BN254 (alt_bn128) |
| **Hash Function** | Poseidon — arithmetisation-friendly, ~243 constraints per call |
| **Trusted Setup** | Hermez Powers of Tau (54 contributors, phase 1) |

---

## 🔐 Security Findings & Mitigations

This project is not just an implementation — it is a **security analysis**. The original specification contained **four exploitable design flaws** and **one circuit soundness bug**, all of which were found, documented, and closed. Each has a named regression test.

### Finding 1 — Threshold Was Prover-Chosen
**Attack:** A prover submits `threshold = 0`. Every age satisfies the comparison. The system grants access to anyone.

**Mitigation:** `VeritasCore` reads the minimum age from its own on-chain policy and rejects any proof where the proven threshold is below it. The prover cannot influence the policy value.

**Regression test:** `rejects a proof that claims a threshold below policy` → `ThresholdBelowPolicy`

---

### Finding 2 — Reference Year Was Prover-Chosen
**Attack:** A prover submits `currentYear = 3000`. A newborn appears to be 975 years old. The system grants access to anyone.

**Mitigation:** `VeritasCore` derives the current year from `block.timestamp` using the mean Gregorian year (365.2425 days). The prover-supplied year is cross-checked against the chain's own clock — rejecting any claim more than `maxYearLag` years in the past or any year in the future.

**Regression tests:** `rejects a proof built for a year in the future` → `YearInFuture` / `rejects a proof whose year lags beyond maxYearLag` → `YearStale`

---

### Finding 3 — Proofs Were Bearer Tokens (Front-Running)
**Attack:** An observer watches the mempool, copies a valid pending proof, and submits it first. The attacker gains the victim's attestation.

**Mitigation:** The beneficiary's Ethereum address is packed directly into the circuit's public signal and cryptographically bound into the R1CS via `Num2Bits(253)`. `VeritasCore` credits the attestation to the address **named inside the proof** — not to `msg.sender`. A thief can only pay gas to deliver the victim their own attestation.

**Side benefit:** This makes **gas relaying safe** — a third party can sponsor the transaction for a holder who has no ETH.

**Regression tests:** `credits the attestation to the proof subject, not to the submitter` / `lets a relayer sponsor the transaction for the holder`

---

### Finding 4 — Region Allowlist Was Prover-Chosen (Privacy Attack)
**Attack:** A malicious relying party narrows the allowlist to a single region. The holder's "zero-knowledge" proof now reveals their exact location.

**Mitigation:** `VeritasCore` checks the proven region mask against its policy by **equality, not subset**. Every prover is forced into the same maximal anonymity set. A relying party cannot selectively shrink the set to deanonymise holders.

**Regression test:** `rejects a proof built against a different allowlist` → `RegionMaskMismatch`

---

### Soundness Bug — Unconstrained Birth Year (Field Wrap Attack)
**Attack:** Circuit signals are BN254 field elements — integers modulo a 254-bit prime `p`. Without explicit range-checking, a prover can submit `birthYear = p − k`, which makes `currentYear − birthYear` wrap around to a large positive value that satisfies any age comparison.

**Mitigation:** `Num2Bits(16)` is applied to both `birthYear` and `age`. If either exceeds 16 bits, there is no satisfying witness — the WASM computation simply fails. Negative ages become unrepresentable rather than merely discouraged.

**Regression test:** `rejects a birth year supplied as a large field element (the p−k attack)`

---

### Full Attack Surface — What the Demo Blocks

```
✓ blocked — REPLAY              resubmitting the same proof      → NullifierAlreadyUsed
✓ blocked — PROOF THEFT         rewriting an unspent proof        → InvalidProof
✓ RELAY                         attacker submits unchanged proof  → attestation goes to holder
✓ blocked — THRESHOLD FORGERY   claiming threshold = 0            → ThresholdBelowPolicy
✓ blocked — YEAR FORGERY        claiming the year is 2046         → YearInFuture
✓ blocked — REGION FORGERY      claiming an unattested region     → CommitmentNotValid
✓ blocked — ALLOWLIST NARROWING narrowing to a single region      → RegionMaskMismatch
```

---

## ⚙️ Circuit Design

The `AttributeCheck` circuit (v4) proves, in a single Groth16 proof, that:

1. The prover knows the preimage `(birthYear, regionCode, secret)` of a commitment the issuer registered on-chain.
2. The prover's age `(currentYear − birthYear)` is at least `threshold`.
3. The prover's `regionCode` bit is set in the policy's `regionMask`.
4. The credential has not been used in this verification context.
5. The proof is bound to a specific beneficiary address.

### Public Signal Layout

| Index | Signal | Type | Description |
|-------|--------|------|-------------|
| `[0]` | `commitment` | **output** | `Poseidon(birthYear, regionCode, secret)` |
| `[1]` | `nullifier` | **output** | `Poseidon(secret, context)` |
| `[2]` | `context` | input | `keccak256(TAG, chainId, contract, epoch) >> 8` |
| `[3]` | `packed` | input | `regionMask<<192 \| subject<<32 \| year<<16 \| threshold` |

### Private Inputs

| Signal | Description |
|--------|-------------|
| `birthYear` | The holder's year of birth — **never published** |
| `regionCode` | The holder's region bit index — **never published** |
| `secret` | A CSPRNG-generated field element — **never published** |

### Why Outputs, Not Inputs?

Circom lays the witness as `[1, outputs..., public inputs..., private...]`. Declaring `commitment` and `nullifier` as **outputs** pins them to indices 0 and 1 by construction — eliminating an entire class of bug where a "supplied" commitment could disagree with the computed one.

### Why Everything Is Packed Into One Signal

Groth16 verification costs approximately **6,800 gas per public signal** (one elliptic curve scalar multiplication). Carrying `subject`, `currentYear`, `threshold`, and `regionMask` as four separate signals would add ~23,000 gas — the difference between meeting and missing the 300,000 gas target. Packing them into a single 253-bit field element makes the second attribute cost **exactly 0 extra gas**.

The `Num2Bits(253)` decomposition does four jobs at once:
- Range-checks `currentYear` and `threshold` to 16 bits each
- Range-checks `regionMask` to 61 bits (region capacity)
- Proves `packed < 2^253`, preventing Solidity-side truncation
- Forces `packed` to participate in real constraints — without this, the binding to the subject address would be cryptographically vacuous

---

## 🚀 Quick Start

**Windows:** double-click **`run.bat`**
**macOS / Linux:** `./run.sh`

That is the whole thing. It checks your toolchain, installs dependencies, builds the circuit, runs the trusted setup, deploys the contracts, starts a local blockchain and opens the app — and it is safe to re-run, skipping whatever is already done.

| Command | What it does |
|---------|-------------|
| `run.bat` / `./run.sh` | Full setup, then start the node and app |
| `run.bat setup` | Install and build only |
| `run.bat test` | Run the 111-test suite |
| `run.bat demo` | Narrated end-to-end run, with 7 attacks being blocked |
| `run.bat clean` | Delete build output and dependencies |

> **New to zero-knowledge proofs?** [`WALKTHROUGH.md`](WALKTHROUGH.md) explains the entire system from first principles, with hands-on exercises.

### Manual Setup

Requires **Node 18+** and the **circom 2** compiler.

> ⚠️ Do **not** run `npm install -g circom` — that installs v0.5.46, the old pre-2.0 compiler, which cannot build this circuit. circom 2 is a standalone binary. `run.bat` / `run.sh` fetch it automatically.

```bash
npm install
npm run zk:build      # compile circuit → trusted setup → generate Groth16Verifier.sol

npm test              # 111 tests

# Terminal 1 — start local blockchain
npx hardhat node

# Terminal 2 — deploy and run
npm run deploy:local  # deploys 4 contracts, writes frontend/.env.local
npm run demo:local    # narrated end-to-end run + 7 attacks blocked

# Terminal 3 — start the frontend
cd frontend && npm install && npm run dev
```

Then open <http://localhost:5173> and import Hardhat Account #0 (issuer) and Account #2 (holder) into MetaMask.

`zk:build` downloads the Hermez Powers-of-Tau transcript (~5 MB) on first run and caches it in `.ptau-cache/`.

### Deploy to Sepolia

```bash
cp .env.example .env       # fill in SEPOLIA_RPC_URL and PRIVATE_KEY
npm run deploy:sepolia
npm run demo:sepolia
```

Use a throwaway key. The deploy script runs a self-test against a known-good proof before wiring the verifier in, so a mismatched circuit build cannot produce a permanently broken deployment.

---

## 🖥️ The Frontend

Six pages telling one story:

| Page | Purpose |
|------|---------|
| **Home** | Connect wallet, project overview |
| **Issuer** | Mock issuing authority — register Poseidon commitments on-chain |
| **Prove** | 3-step wizard — load credential → generate proof → verify on-chain |
| **Restricted** | Content gated by an on-chain read of `isVerifiedAtLeast()` |
| **Explorer** | Live view of commitments, nullifiers and attestations on the chain |
| **How It Works** | Interactive explainer — no wallet required |

Proving runs inside a **Web Worker**, so the main thread stays responsive and shows real progress through download, witness generation, and proof steps. Private inputs (`birthYear`, `regionCode`, `secret`) live only in React state — never in `localStorage`, never in a URL, never in a network request.

Before submitting a proof on-chain, the app calls `staticVerify()` — a read-only preflight that surfaces any policy failure with a precise error message, **without spending any gas**.

---

## 🗂️ Project Structure

```
veritas-zk/
│
├── run.bat / run.sh              One-command setup and launch
├── WALKTHROUGH.md                From-scratch explanation for new developers
│
├── circuits/
│   ├── attribute_check.circom    The circuit — 1,033 constraints (v4)
│   ├── regions.json              Region registry — append-only
│   └── public_signals.json       Generated: frozen public-signal layout
│
├── contracts/
│   ├── VeritasCore.sol           Policy, verification, nullifiers, attestations
│   ├── CredentialRegistry.sol    Issuer-gated commitment registry with revocation
│   ├── Groth16Verifier.sol       Generated by snarkjs — never edited by hand
│   ├── examples/GatedContent.sol A relying party, to show the gate is real
│   └── interfaces/IVeritas.sol   Contract interfaces
│
├── scripts/
│   ├── zk/build.mjs              Full circuit pipeline — cross-platform
│   ├── zk/credential.mjs         Poseidon, field arithmetic, packing
│   ├── deploy.js                 Deploy + wire roles + write frontend/.env.local
│   └── demo.js                   Narrated end-to-end run with attack demos
│
├── tests/                        111 tests across 6 files
│   ├── circuit.test.js            28 tests — age, region, soundness
│   ├── VeritasCore.test.js        52 tests — all attack mitigations
│   ├── CredentialRegistry.test.js 19 tests — roles, expiry, revocation
│   ├── Gas.test.js                Gas budget assertions (CI regression guard)
│   ├── GatedContent.test.js       Relying party integration
│   └── parity.test.js             Field, Poseidon, and signal layout consistency
│
├── frontend/
│   ├── src/zk/                   Browser proving, Poseidon, field helpers, regions
│   ├── src/contracts/            ABIs, config, and the revert decoder
│   ├── src/providers/            Wallet, credential, session, toast providers
│   ├── src/pages/                Six application pages
│   └── public/prover.worker.js   Groth16 proving — off the main thread
│
└── docs/
    ├── architecture.md           System diagrams and design decisions
    ├── threat-model.md           The full security argument
    ├── gas-report.md             Gas measurements and optimisation notes
    └── demo-script.md            Run sheet for a live demonstration
```

---

## ⛽ Gas Breakdown

The 300,000 gas budget is deliberately tight — it is what separates a proof-of-concept from a system that can run affordably on a public blockchain.

| Component | Gas | Share |
|-----------|----:|------:|
| **`VeritasCore.verifyAge` — worst case** | **297,280** | **100%** |
| └ Groth16 pairing check (`verifyProof`) | 236,098 | 79.5% |
| └ Nullifier `SSTORE` (cold write) | 22,100 | 7.4% |
| └ Attestation `SSTORE` (cold write) | 22,100 | 7.4% |
| └ Registry `SLOAD` (cold read) | 4,700 | 1.6% |
| └ Policy `SLOAD` + context + events | ~5,250 | 1.8% |
| └ Calldata overhead | ~7,032 | 2.4% |

79.5% of the cost is the cryptographic pairing check — irreducible without changing the proof system. The remaining 20.5% pays for replay protection, attestation storage, and policy enforcement.

The gas budget is **regression-tested**: `Gas.test.js` asserts `verifyAge < 300,000` on every test run, so a budget-breaking change fails CI before it reaches a demonstration.

---

## 🔒 Security Notes

- Private inputs (`birthYear`, `regionCode`, `secret`) live **only in React state** — never `localStorage`, never a URL, never a network request.
- The **holder generates the secret** locally. The issuer receives only the commitment. An issuer who knew the secret could compute every nullifier the holder will ever produce and link all their verifications.
- The **phase-2 trusted setup** in this repository has a single contributor. A production deployment would require a real multi-party ceremony. This is stated explicitly — not hidden.
- Never commit `.env`, `*.zkey`, or a private key. All are gitignored.
- See [`docs/threat-model.md`](docs/threat-model.md) for the complete security argument.

---

## 📚 Commands Reference

| Command | Description |
|---------|-------------|
| `npm run zk:build` | Compile circuit, trusted setup, generate verifier, publish WASM |
| `npm run zk:rebuild` | Same, but forces regeneration even if artifacts exist |
| `npm test` | The full 111-test suite |
| `npm run test:gas` | Tests + gas usage table |
| `npm run coverage` | Solidity branch coverage |
| `npm run deploy:local` | Deploy to local Hardhat node |
| `npm run deploy:sepolia` | Deploy to Sepolia testnet |
| `npm run demo:local` | Narrated end-to-end run + attacks |
| `npm run demo:sepolia` | Same, against Sepolia |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

---

## 📖 Documentation

| Document | Contents |
|----------|----------|
| [`WALKTHROUGH.md`](WALKTHROUGH.md) | A from-scratch explanation of zk-SNARKs and this system, with hands-on exercises |
| [`docs/architecture.md`](docs/architecture.md) | System diagrams, component interactions, and design decisions |
| [`docs/threat-model.md`](docs/threat-model.md) | Full security argument with named tests for every mitigation |
| [`docs/gas-report.md`](docs/gas-report.md) | Gas measurements, breakdown by component, and optimisation rationale |
| [`docs/demo-script.md`](docs/demo-script.md) | Run sheet for a live demonstration |

---

## 📄 Licence

MIT — see [LICENSE](LICENSE).
