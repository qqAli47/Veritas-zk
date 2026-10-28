# Veritas-zk — Demonstration Run Sheet

A run sheet for a live demonstration or a recorded walkthrough. Target length
**3 minutes**. The two moments that carry the most weight are marked ★.

---

## Before you start

- [ ] `npm run zk:build` has completed (artifacts present in `build/`)
- [ ] `npx hardhat node` running in a terminal
- [ ] `npm run deploy:local` done — note the addresses it prints
- [ ] `cd frontend && npm run dev` running
- [ ] MetaMask has **two** Hardhat accounts imported:
      account #0 as the **issuer**, account #2 as the **holder**
- [ ] MetaMask is on the Localhost 8545 network
- [ ] The app has been opened once already, so the browser has cached the
      `.zkey` — otherwise the first proof spends a few seconds downloading
- [ ] A second terminal ready with `npm run demo:local` typed but not run
- [ ] Browser zoom at ~125% so the audience can read it

**Fallback:** if anything misbehaves, the `/how-it-works` page needs no wallet,
no contracts and no network. Have it open in a second tab.

---

## The script

### 0:00 — The problem (20 s)

> "To buy something age-restricted online you upload a passport. The site now
> holds your full birth date, your name and your document number — forever — to
> answer one yes/no question. Veritas answers that question without handing over
> anything at all."

Open the app on **Home**.

### 0:20 — Issue a credential (35 s)

> "Note the region field. Attesting where someone lives is a heavier obligation
> than attesting their birth year — it needs proof of address, not a passport."


Navigate to **Issuer**, connected as account #0.

> "This stands in for a government registry. Enter a birth year — 2000 — and
> click *Generate secure secret*."

Point at the live commitment preview.

> "That's Poseidon of the birth year and the secret. Watch what the issuer
> actually publishes: only this hash. The birth year and the secret never leave
> this browser. That direction matters — an issuer who learned the secret could
> recognise every future verification this person makes."

Click **Register commitment on-chain**, confirm in MetaMask.

Click **Download credential** — a JSON file with the secret in it.

### 0:55 — Generate a proof (40 s)

Switch MetaMask to account #2. Navigate to **Prove**.

> "Now I'm the citizen. I import the credential file I was issued."

Import it. Point at *Registered: ✓ valid on-chain*.

> "It checks the registry before doing any work — instant and free."

Point at the privacy ledger, then click **Generate proof**.

> "That's a real Groth16 proof, generated in a Web Worker so the page stays
> responsive. About half a second for 965 constraints, proving two attributes."

When it completes, point at the four public signals.

> ★ "Look at what's about to be published: a commitment hash, a nullifier hash,
> a context, and my address. No birth year. No region. No secret. The contract
> will learn that *someone* holding a registered credential is over 18 and
> somewhere in the permitted set — and nothing else."

Point at the anonymity-set panel.

> "And it tells you exactly how much you're revealing: one of N regions. If a
> verifier narrowed that to one, the panel turns amber — because at N=1 a
> membership proof reveals your country exactly. That's inherent to set
> membership, so we disclose it rather than pretend otherwise."

### 1:35 — Verify on-chain (25 s)

Click **Verify on-chain**, confirm in MetaMask.

> "The contract checks the threshold against its own policy, checks the year
> against the chain clock, checks the credential is registered and unrevoked,
> checks the nullifier is unspent, then runs the pairing check. 297,000 gas —
> under the 300,000 target the project set itself."

The app lands on **Restricted**.

### 2:00 — The gate is real (20 s)

> "This page isn't hidden by a React flag. It calls `isVerified` on the
> contract. Refresh it — still works. Open it in a different browser — still
> works, because the truth lives on-chain, not in this tab."

Refresh to show it holds.

### 2:20 — Break it ★ (30 s)

Scroll to **Try to break it** and click **Attempt a replay attack**.

> ★ "That's the same proof that just succeeded, resubmitted. Rejected — the
> nullifier is spent. Replay protection is invisible unless you can watch it
> fail, so here it is failing."

Optionally open DevTools → Network and filter for the birth year.

> "And here's the strongest claim: search every request this page made for the
> birth year. It isn't there. Not encrypted — never sent."

### 2:50 — Close (10 s)

Switch to the second terminal and run `npm run demo:local`.

> "The same flow from the command line, and then six attacks — replay, proof
> theft, threshold forgery, year forgery, region forgery and allowlist
> substitution — each stopped by a different check, each with a regression
> test."

Let the output scroll. End on the green summary.

---

## If you have more time

**The Explorer page (+30 s).** Show the registry and nullifier tables.

> "This is everything Veritas puts on-chain. Look for a birth date. There isn't
> one — just salted hashes and spent tokens."

**The How-it-works page (+45 s).** Walk the constraint list, especially:

> "This line — `birthYear < 2^16` — looks pedantic and is the most important
> one. Circuit values are field elements, not integers. Without it a prover
> could pick a birth year near the field modulus so the subtraction wraps and
> produces any age they want. That was a real hole in the first version."

**The gas story (+30 s).** Open `docs/gas-report.md`.

> "We started at 321,000 gas, over target. Packing three public signals into one
> saved 12,000. Deleting a statistics counter that could be reconstructed from
> event logs saved 22,000. Moving the pause flag into a slot we already load
> saved 2,000. 297,000 — and a test asserts it so it can't regress."

> "Then we added a whole second attribute for **214 gas**, because the region
> allowlist went into 61 spare bits of a signal we were already paying for.
> Giving it its own public signal would have cost 6,800 and broken the target."

**Questions about location (+30 s).**

> "Why 61 regions and not all 249 countries? Because 61 is what fits for free,
> and coarser buckets are *better* for privacy — a bigger anonymity set. The
> alternative costs 6,800 gas and breaks the budget. That trade-off is measured
> in the gas report, not asserted."

---

## Questions to expect

**"What stops someone using a credential that isn't theirs?"**
Nothing, and that is stated in the threat model. Whoever holds the secret can
prove that age. Binding a credential to a person needs biometrics or secure
hardware — that is a different problem, and it would not be zero-knowledge.

**"Isn't the issuer a single point of failure?"**
Yes. Veritas removes the need to *show* your identity repeatedly; it does not
remove the need to *establish* it once. Multi-issuer support is the obvious
extension.

**"Could the same proof be used on two different sites?"**
No. The context binds chain id, contract address and epoch, and the nullifier is
derived from it. A proof for one site is invalid on another — and the two uses
are not linkable to each other.

**"Is the trusted setup safe?"**
Phase 1 uses the Hermez ceremony with 54 independent contributors, secure if any
one was honest. Phase 2 was done by us alone, which is a real limitation and is
documented rather than glossed over. Production would need a multi-party
ceremony.

**"Why is verification so expensive?"**
79% of the 297,000 gas is the elliptic-curve pairing, which is irreducible for
Groth16. The remaining 21% is two storage writes — replay protection and the
attestation — and a handful of reads. On an L2 the whole thing costs a fraction
of a cent.
