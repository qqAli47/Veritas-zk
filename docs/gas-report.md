# Veritas-zk — Gas Report

Measured on the Hardhat EVM (Paris), solc 0.8.20 with the optimizer enabled at
200 runs. Raw output: [`gas-report.txt`](gas-report.txt), regenerated with:

```bash
REPORT_GAS=true GAS_OUT=docs/gas-report.txt npx hardhat test
```

Gas on the Hardhat EVM is deterministic, so these figures reproduce exactly.

---

## 1. The headline number

The project's Definition of Done sets a hard target:

> **Gas cost < 300,000 units per verification**

| Operation | Gas | Target | Status |
|---|---:|---:|:--:|
| **`VeritasCore.verifyAge` (worst case, first verification)** | **297,018** | 300,000 | ✅ |
| `verifyAge` (average across 29 test calls) | 295,799 | — | |
| `verifyAge` (best case, warm attestation slot) | 279,882 | — | |
| `Groth16Verifier.verifyProof` alone | 236,038 | — | |

The target is met, with about 1% of headroom in the worst case. That margin is
thin enough to be worth defending, which is why
[`tests/Gas.test.js`](../tests/Gas.test.js) asserts it — a regression fails CI
rather than being discovered during a demonstration.

## 2. Where the gas goes

`verifyAge` costs 297,018. Of that, 236,038 — **79%** — is the Groth16 pairing
check, which is irreducible without changing proof system.

| Component | Approx. gas | Share |
|---|---:|---:|
| Groth16 pairing + public-input ECMULs (`verifyProof`) | 236,038 | 79.5% |
| Nullifier `SSTORE` (0 → 1, cold) | 22,100 | 7.4% |
| Attestation `SSTORE` (cold) | 22,100 | 7.4% |
| `registry.isValid` — cold account + cold `SLOAD` | 4,700 | 1.6% |
| `policy` `SLOAD` (single packed slot) | 2,100 | 0.7% |
| `AgeVerified` event | ~2,150 | 0.7% |
| `contextFor` keccak, unpacking, comparisons | ~1,000 | 0.3% |
| Transaction base + calldata (12 words) | ~27,000 | included above |

The two cold `SSTORE`s are 14.8% of the budget and are the price of the two
security properties that most distinguish this design: replay protection and a
verifiable on-chain attestation. Neither can be had for free.

## 3. Optimisations applied

Three changes moved `verifyAge` from **321,173** to **297,018** — a 24,155 gas
reduction, and the difference between missing and meeting the target.

### 3.1 Packing three public signals into one (−12,300)

Groth16 verification performs one elliptic-curve multiplication (~6,000 gas) per
public signal. Carrying `subject`, `currentYear` and `threshold` separately
would mean three signals; packing them into a single 192-bit field element means
one.

```
bits [  0.. 15]  threshold    uint16
bits [ 16.. 31]  currentYear  uint16
bits [ 32..191]  subject      uint160
```

The single `Num2Bits(192)` that unpacks it does three jobs at once: it
range-checks the two 16-bit fields, proves the word fits in 192 bits so the
Solidity casts cannot truncate, and — critically — forces the signal to
participate in real constraints. That last point is not cosmetic: a public input
appearing in *no* constraint has an identity IC point, and Groth16 verification
becomes entirely independent of its value. The binding would be silently
vacuous.

### 3.2 Removing a statistics counter from the hot path (−22,100)

An earlier revision incremented `totalVerifications` on every call. A first
write to a fresh storage slot costs 22,100 gas — over 7% of the whole budget —
to store a number that can be reconstructed exactly by counting `AgeVerified`
logs. The explorer now does that instead.

The general rule: storage is for state that must be read *on-chain*; statistics
belong in the event log.

### 3.3 Folding the pause flag into the policy slot (−2,000)

OpenZeppelin's `Pausable` keeps `_paused` in a slot of its own, so
`whenNotPaused` adds a cold `SLOAD` to every verification. Moving the bit into
the `Policy` struct — which is loaded anyway, and had spare room in its 88 used
bits — makes the emergency stop effectively free. The behaviour is identical;
only the storage layout differs.

## 4. Other operations

| Operation | Gas | Who pays |
|---|---:|---|
| `registerCommitment` (first, warm contract) | 55,808 | Issuer |
| `registerCommitment` (cold) | 73,232 | Issuer |
| `registerBatch` (2 commitments) | 99,746 | Issuer |
| `revokeCommitment` | 30,845 | Issuer |
| `setPolicy` | 32,420 | Admin |
| `revokeAttestation` | 25,976 | Admin |
| `GatedContent.canAccess` (the integration cost) | ~27,661 | Relying party |
| `GatedContent.accessContent` (incl. the demo's own counters) | 73,459 | User |

The number a real integrator cares about is **`canAccess` at ~27,661 gas** —
one external call and one `SLOAD`. `accessContent` is higher only because the
example contract bumps two of its own counters, which says nothing about the
cost of Veritas.

### Deployment

| Contract | Deployment gas | % of a 60M block |
|---|---:|---:|
| `Groth16Verifier` | ~430,000 | 0.7% |
| `CredentialRegistry` | 792,451 | 1.3% |
| `VeritasCore` | 1,570,400 | 2.6% |
| `GatedContent` | 307,398 | 0.5% |

All are one-off costs, and all are far below the EIP-170 24,576-byte contract
size limit (`VeritasCore` is the largest at 7,639 bytes).

## 5. Circuit statistics

| Metric | Value |
|---|---:|
| Non-linear constraints | 761 |
| Linear constraints | 566 |
| Public signals | 4 |
| Private inputs | 2 |
| Wires | 1,323 |
| Proving key size | 0.64 MB |
| Proof generation (browser, single-threaded) | ~0.5 s |

Roughly 486 of the 761 non-linear constraints are the two Poseidon
permutations. SHA-256 would need tens of thousands for the same job — the
circuit would not fit in a power-12 Powers of Tau, proving would take minutes
rather than half a second, and the trusted setup would be far larger. This is
the concrete reason the roadmap specified Poseidon.

## 6. Considered and rejected

**Truncating `context` to fit alongside `packed`.** Squeezing the context into
the spare bits of the packed word would remove a fourth public signal and save
about 6,150 gas. It would also cut the context's collision resistance from 248
bits to roughly 62. A 2% gas saving does not justify weakening a
security parameter by that much.

**Hashing `currentYear` and `threshold` into a policy commitment.** Would
remove them from the packed word but requires the contract to store a
pre-computed Poseidon hash, since Poseidon is prohibitively expensive in the
EVM. The saving is marginal and on-chain policy transparency would be lost.

**Removing the attestation write.** Would save 22,100 gas and eliminate the
feature that makes on-chain gating possible. Not a trade worth making.

**PLONK instead of Groth16.** A universal setup, no per-circuit ceremony — but
a larger proof and materially more expensive on-chain verification. For a fixed
circuit, Groth16 is the right choice.

## 7. Real-world cost

At 30 gwei with ETH at $2,000:

| Operation | Gas | Mainnet cost |
|---|---:|---:|
| `verifyAge` | 297,018 | ~$17.82 |
| `registerCommitment` | 55,808 | ~$3.35 |
| `canAccess` (off-chain read) | 0 | free |

Gas price is fixed at 30 gwei in `hardhat.config.js` rather than fetched live.
The original specification suggested Etherscan's v1 gas oracle, but that
endpoint now requires an API key and will hang or return 403 mid-test-run.

On Sepolia these costs are zero. On an L2 they would be roughly two orders of
magnitude lower, which is where a system like this would realistically deploy.
