# Veritas-zk

**Prove you are old enough, and where you are — without revealing either.**

A privacy-preserving attribute-verification system built on zk-SNARKs. A user
proves to an Ethereum smart contract that their **age** meets a threshold and
that their **location** is one the verifier serves — using a Groth16 proof
generated entirely in their own browser. No birth date, no country, no document
and no identifier ever leaves the device.

The location proof is *private set membership*: the verifier learns "this holder
is in one of the N regions I accept", never which one. N is the holder's
anonymity set, and the app shows it before they commit to proving anything.

```
Issuer                    Holder's browser                  Ethereum
──────                    ────────────────                  ────────
                          secret ← CSPRNG
                          commitment = Poseidon(bY, secret)
  ◄── commitment only ────┘
  registerCommitment() ───────────────────────────────────► CredentialRegistry

                          Groth16 proof (~0.5 s)
                          proof + 4 public signals ───────► VeritasCore
                                                            ├ policy checks
                                                            ├ pairing check
                                                            ├ spend nullifier
                                                            └ write attestation

                                          relying party ──► isVerifiedAtLeast()
                                                            → true
```

---

## Status

| | |
|---|---|
| Circuit | 965 non-linear constraints, 4 public signals, 2 attributes |
| Proving | ~0.5 s in-browser, in a Web Worker |
| On-chain verification | **297,232 gas** (target: < 300,000) ✅ |
| Tests | **111 passing** — circuit, contracts, integration, gas, parity |
| Networks | Local Hardhat and Sepolia |

## What makes this more than a demo

The specification this project started from contained three exploitable design
flaws. Finding and closing them is the substance of the work:

- **Location is proved, not disclosed.** The region rides in the spare bits of
  an existing public signal, so a second attested attribute costs **214 gas** —
  where the obvious implementation would have cost ~6,800 and broken the budget.
- **The threshold was prover-chosen.** Nothing stopped a prover submitting
  `threshold = 0`. The contract now pins it to on-chain policy.
- **The reference year was prover-chosen.** `currentYear = 3000` made a newborn
  an adult. The contract now derives the year from `block.timestamp`.
- **Proofs were bearer tokens.** Anyone watching the mempool could steal a proof
  and front-run its owner. The beneficiary is now bound inside the circuit.

Plus a circuit soundness bug: `birthYear` was an unconstrained field element, so
`birthYear = p − k` made the age arithmetic wrap to any value the prover liked.
`Num2Bits` closes it. Each of these has a named regression test.

Full analysis in [`docs/threat-model.md`](docs/threat-model.md).

## Quick start

**Windows:** double-click **`run.bat`**
**macOS / Linux:** `./run.sh`

That is the whole thing. It checks your toolchain, installs dependencies,
builds the circuit, runs the trusted setup, deploys the contracts, starts a
local blockchain and opens the app — and it is safe to re-run, skipping
whatever is already done.

| Command | What it does |
|---|---|
| `run.bat` / `./run.sh` | Set everything up, then start the node and the app |
| `run.bat setup` | Install and build only |
| `run.bat test` | Run the 85-test suite |
| `run.bat demo` | Narrated end-to-end run, including four attacks being blocked |
| `run.bat clean` | Delete build output and dependencies |

> **New to zero-knowledge proofs?** [`WALKTHROUGH.md`](WALKTHROUGH.md) explains
> the entire system from first principles, with hands-on exercises.

### Doing it by hand

Requires Node 18+ and the [circom **2**
compiler](https://docs.circom.io/getting-started/installation/) on your `PATH`.

> Do **not** run `npm install -g circom` — that installs v0.5.46, the old
> pre-2.0 compiler, which cannot build this circuit. circom 2 is a standalone
> binary from [GitHub releases](https://github.com/iden3/circom/releases/latest).
> `run.bat` / `run.sh` will fetch it for you.

```bash
npm install
npm run zk:build      # compile the circuit, trusted setup, generate the verifier
npm test              # 85 tests

# terminal 1
npx hardhat node
# terminal 2
npm run deploy:local  # deploys 4 contracts, writes frontend/.env.local
npm run demo:local    # narrates the full flow, then 4 attacks failing

cd frontend && npm install && npm run dev
```

`zk:build` downloads the Hermez Powers-of-Tau transcript (~5 MB) on first run
and caches it. If the download fails it falls back to a local ceremony and says
loudly that the result is development-only.

Then open <http://localhost:5173> and import a Hardhat account into MetaMask.
Account #0 is the issuer.

## The demo

`npm run demo:local` walks through issue → prove → verify → access and then
attacks the system four ways, printing which contract error stops each:

```
✓ blocked — REPLAY — resubmitting the same proof            → NullifierAlreadyUsed
✓ blocked — PROOF THEFT — rewriting an unspent proof        → InvalidProof
✓ RELAY   — attacker submitted unchanged; attestation went to the holder
✓ blocked — THRESHOLD FORGERY — claiming threshold = 0      → ThresholdBelowPolicy
✓ blocked — YEAR FORGERY — claiming the year is 2046        → YearInFuture
✓ blocked — REGION FORGERY — claiming an unattested region  → CommitmentNotValid
✓ blocked — ALLOWLIST SUBSTITUTION — narrowing to 1 region  → RegionMaskMismatch
```

The last one is a *privacy* attack rather than an access one. A malicious
relying party would love you to prove membership in a single region, because
that reveals exactly where you are from a flow branded "zero-knowledge". The
contract pins the allowlist by equality, so every prover is forced into the same
maximal anonymity set.

## Deploy to Sepolia

```bash
cp .env.example .env        # fill in SEPOLIA_RPC_URL and PRIVATE_KEY
npm run deploy:sepolia
npm run demo:sepolia
```

Use a throwaway key. The deploy script runs a self-test against a known-good
proof before wiring the verifier in, so a mismatched circuit build cannot
produce a permanently dead deployment.

## Project structure

```
run.bat / run.sh             one-command setup and launch
WALKTHROUGH.md               a from-scratch explanation for new developers
circuits/
  attribute_check.circom     the circuit — 965 constraints, 2 attributes
  regions.json               the region registry — APPEND-ONLY, see the header
  public_signals.json        generated: the frozen public-signal layout
contracts/
  VeritasCore.sol            policy, verification, nullifiers, attestations
  CredentialRegistry.sol     issuer-gated commitment registry with revocation
  Groth16Verifier.sol        generated by snarkjs — never edited by hand
  examples/GatedContent.sol  a relying party, to show the gate is real
  interfaces/IVeritas.sol
scripts/
  zk/build.mjs               the whole circuit pipeline, cross-platform
  zk/credential.mjs          Poseidon, field arithmetic, packing
  deploy.js                  deploy + wire roles + write frontend/.env.local
  demo.js                    narrated end-to-end run
tests/                       85 tests
frontend/
  src/zk/                    browser proving, Poseidon, field helpers
  src/contracts/             ABIs, config, and the revert decoder
  src/providers/             wallet, credential, session, toasts
  src/pages/                 Home · Issuer · Prove · Restricted · Explorer · How it works
  public/prover.worker.js    Groth16 proving, off the main thread
docs/
  architecture.md            diagrams and design decisions
  threat-model.md            the security argument
  gas-report.md              measurements and optimisations
  demo-script.md             a run sheet for a live demonstration
```

## The frontend

Six pages telling one story: an **Issuer** console (a mock authority), a
**Prove** wizard, a **Restricted** area gated by an on-chain read, an
**Explorer** showing exactly what the chain reveals, and a **How it works**
explainer that needs no wallet.

Proving runs in a Web Worker, so the interface stays responsive and shows real
progress. The worker loads snarkjs via `importScripts` rather than through the
bundler — see the comment at the top of `frontend/public/prover.worker.js` for
why that is the robust choice.

## Security notes

- `birthYear` and `secret` live in React state only — never `localStorage`,
  never a URL, never a network request. An ESLint rule enforces this.
- The **holder** generates the secret; the issuer only ever sees the commitment.
  An issuer who knew the secret could link every future verification.
- Never commit `.env`, `*.zkey`, or a private key. All are gitignored.
- The phase-2 trusted setup has a single contributor. Production would need a
  real multi-party ceremony. This is stated, not hidden.

## Commands

| Command | What it does |
|---|---|
| `npm run zk:build` | Compile the circuit, trusted setup, generate the verifier, publish artifacts |
| `npm test` | The full suite |
| `npm run test:gas` | Tests plus the gas table |
| `npm run coverage` | Solidity coverage |
| `npm run deploy:local` / `:sepolia` | Deploy and wire everything |
| `npm run demo:local` / `:sepolia` | The narrated end-to-end run |
| `npm run lint` / `npm run format` | ESLint / Prettier |

## Licence

MIT — see [LICENSE](LICENSE).
