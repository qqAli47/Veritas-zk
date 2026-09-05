# Circuit v4 Fix — Region Support

## The Bug

`Proof generation failed: Signal regionCode not found`

## Root Cause

The contracts and frontend had already been upgraded to a **region-aware v2 system**, but the circuit was never updated to match. The two sides diverged:

### What the frontend was sending to the circuit

```js
// ProvePage.jsx — circuit inputs
{
  context:    "...",      // public
  packed:     "...",      // public — 253-bit word: regionMask<<192 | subject<<32 | year<<16 | threshold
  birthYear:  "1995",    // private
  regionCode: "3",        // private ← CIRCUIT DID NOT HAVE THIS
  secret:     "...",      // private
}
```

### What the circuit (v3) actually had

```circom
signal input context;       // public
signal input packed;        // public — only 192-bit layout, no regionMask
signal input birthYear;     // private
signal input secret;        // private
// regionCode did not exist — WASM rejected it immediately
```

Three specific mismatches:

| | Frontend expects | Circuit had |
|---|---|---|
| Private inputs | `birthYear`, `regionCode`, `secret` | `birthYear`, `secret` |
| Commitment | `Poseidon(birthYear, regionCode, secret)` | `Poseidon(birthYear, secret)` |
| `packed` width | 253 bits (incl. 61-bit `regionMask`) | `Num2Bits(192)` |

## Secondary Issue

`build.mjs` called `circom` by name. On this machine, two circom binaries were on PATH:
- `C:\Users\HP\AppData\Roaming\npm\circom` — **v0.5.46** (npm-installed, came first)
- `C:\circom\circom.exe` — **v2.2.x** (installed by `run.bat`)

The old v0.5 binary failed with a parse error on circom 2 syntax, making it impossible to rebuild the circuit without knowing to use the full path.

## The Fix

### Circuit (v3 → v4)

- Added `regionCode` as a third private input
- Upgraded commitment to `Poseidon(3)` — `Poseidon(birthYear, regionCode, secret)`
- Expanded `Num2Bits(192)` → `Num2Bits(253)` to cover the `regionMask` field
- Extracted `regionMask` from `packed` bits `[192..252]` via `Bits2Num(61)`
- Added **bit-selector region membership check**: asserts that bit `regionCode` of `regionMask` equals `1` — proves the holder's region is permitted by policy without revealing which exact region they are in
- Range-checked `regionCode` to 7 bits to prevent wrap-around in the selector
- Template parameter `N_REGIONS = 61` matches `field.js REGION_CAPACITY`

### build.mjs

- Added `resolveCircom()` which checks known v2 locations (`C:\circom\circom.exe` on Windows, `~/.circom/circom` on Unix) before falling back to PATH
- `run()` now skips `shell: true` for absolute binary paths to avoid Windows quoting issues

## Result

```
111 passing (18s)
Gas: 297,280 / 300,000 ✅
```
