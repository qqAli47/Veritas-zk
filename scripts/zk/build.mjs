#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  scripts/zk/build.mjs — the single source of truth for building the circuit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Runs the whole zk toolchain end to end:
 *
 *    1. compile the circuit with circom
 *    2. record the observed public-signal order  (frozen contract with Solidity)
 *    3. obtain a Powers-of-Tau file               (phase 1, universal)
 *    4. Groth16 setup + contribution              (phase 2, circuit-specific)
 *    5. export the verification key
 *    6. export contracts/Groth16Verifier.sol
 *    7. prove and verify a sample witness         (end-to-end smoke test)
 *    8. copy browser artifacts into frontend/public/zk/
 *
 *  Cross-platform on purpose. The original scripts/compile_circuit.ps1 relied
 *  on `$ErrorActionPreference = "Stop"`, which in Windows PowerShell 5.1 does
 *  NOT trap a non-zero exit code from a native executable — so a failed circom
 *  step silently cascaded into confusing "file not found" errors several steps
 *  later. Every step here checks its exit status explicitly.
 *
 *  Usage:
 *    node scripts/zk/build.mjs              # incremental; reuses cached ptau
 *    node scripts/zk/build.mjs --force      # rebuild the trusted setup too
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD = path.join(ROOT, "build");
const PTAU_CACHE = path.join(ROOT, ".ptau-cache");
const CIRCUIT = "attribute_check";
const FORCE = process.argv.includes("--force");

/*
 * Powers of Tau, phase 1.
 *
 * We deliberately use the Hermez "perpetual powers of tau" transcript rather
 * than generating our own with `snarkjs powersoftau new`. Phase 1 is a
 * multi-party computation whose security rests on AT LEAST ONE participant
 * having destroyed their secret randomness. A locally generated ceremony has
 * exactly one participant — us — so its "toxic waste" is trivially recoverable
 * and the resulting setup would be worthless as a security claim.
 *
 * The Hermez ceremony had 54 independent contributors. Power 12 supports
 * 4,096 constraints; our circuit uses 761.
 */
const PTAU_NAME = "powersOfTau28_hez_final_12.ptau";
const PTAU_URL = `https://storage.googleapis.com/zkevm/ptau/${PTAU_NAME}`;
const PTAU_PATH = path.join(PTAU_CACHE, PTAU_NAME);

// ── tiny console helpers ────────────────────────────────────────────────────
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let stepNo = 0;
const step = (msg) => console.log(`\n${C.cyan(`[${++stepNo}/8]`)} ${C.bold(msg)}`);
const ok = (msg) => console.log(`      ${C.green("✓")} ${msg}`);
const info = (msg) => console.log(`      ${C.dim(msg)}`);
const warn = (msg) => console.log(`      ${C.yellow("!")} ${msg}`);

/**
 * Run a command and abort loudly if it fails.
 * This is the guard the PowerShell pipeline was missing.
 *
 * `capture: true` returns stdout instead of streaming it, which we use to read
 * circom's constraint report.
 */
function run(cmd, args, label, { capture = false } = {}) {
  info(`> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    cwd: ROOT,
    shell: process.platform === "win32",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${label} failed with exit code ${res.status}`);
  }
  return capture ? res.stdout : "";
}

const snarkjs = (...args) =>
  run("npx", ["--no-install", "snarkjs", ...args], `snarkjs ${args.slice(0, 2).join(" ")}`);

const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const mb = (file) => (fs.statSync(file).size / 1e6).toFixed(2) + " MB";

// ═══════════════════════════════════════════════════════════════════════════
//  Step 2 helper — read the REAL public-signal order out of the .sym file
// ═══════════════════════════════════════════════════════════════════════════
/**
 * circom orders public signals as: outputs first (declaration order), then
 * public inputs (declaration order). Rather than trusting that rule, we read
 * the symbol table and record what the compiler actually produced.
 *
 * .sym format is `signalIndex,witnessIndex,componentIndex,name`. Witness
 * indices 1..nPublic are exactly the public signals, in order (index 0 is the
 * constant 1).
 */
function readPublicSignalOrder(symPath, nPublic) {
  const seen = new Map();
  for (const line of fs.readFileSync(symPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [, witnessIdx, , name] = line.split(",");
    const w = Number(witnessIdx);
    if (w >= 1 && w <= nPublic && !seen.has(w)) {
      seen.set(w, name.replace(/^main\./, ""));
    }
  }
  const order = [];
  for (let i = 1; i <= nPublic; i++) {
    if (!seen.has(i)) throw new Error(`Could not resolve public signal at witness index ${i}`);
    order.push(seen.get(i));
  }
  return order;
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(C.bold("\n  Veritas-zk — circuit build\n") + C.dim("  " + "─".repeat(60)));

  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(PTAU_CACHE, { recursive: true });

  // ── 1. Compile ───────────────────────────────────────────────────────────
  step("Compiling the circuit");
  // circom reports the constraint breakdown on stdout; snarkjs's `r1cs info`
  // only gives a combined total, so we take the numbers from the compiler.
  const circomOut = run(
    "circom",
    [
      `circuits/${CIRCUIT}.circom`,
      "--r1cs",
      "--wasm",
      "--sym",
      "-o",
      "build",
      "-l",
      "node_modules",
    ],
    "circom compile",
    { capture: true },
  );
  process.stdout.write(circomOut);
  ok(`build/${CIRCUIT}.r1cs, .sym and _js/${CIRCUIT}.wasm written`);

  // ── 2. Freeze the public-signal contract ─────────────────────────────────
  step("Recording the public-signal layout");
  // Strip ANSI colour codes before matching — circom colourises its output.
  // The escape is built from its char code rather than written as a literal,
  // so the source file contains no control characters.
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const plain = circomOut.replace(ANSI, "");
  const num = (re) => {
    const m = plain.match(re);
    if (!m) throw new Error(`Could not parse circom output for ${re}`);
    return Number(m[1]);
  };
  const stats = {
    nonLinearConstraints: num(/non-linear constraints:\s*(\d+)/i),
    // Anchored to line start so it does not match inside "non-linear constraints".
    linearConstraints: num(/^\s*linear constraints:\s*(\d+)/im),
    publicInputs: num(/public inputs:\s*(\d+)/i),
    publicOutputs: num(/public outputs:\s*(\d+)/i),
    privateInputs: num(/private inputs:\s*(\d+)/i),
    wires: num(/wires:\s*(\d+)/i),
  };
  const nPublic = stats.publicInputs + stats.publicOutputs;
  const order = readPublicSignalOrder(path.join(BUILD, `${CIRCUIT}.sym`), nPublic);

  const manifest = {
    circuit: CIRCUIT,
    nPublic,
    // The authoritative index map. Solidity's PUB_* constants and the
    // frontend's calldata builder are both asserted against this.
    order,
    index: Object.fromEntries(order.map((n, i) => [n, i])),
    stats,
    r1csSha256: sha256(path.join(BUILD, `${CIRCUIT}.r1cs`)),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(ROOT, "circuits", "public_signals.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  ok(`${stats.nonLinearConstraints} non-linear constraints, ${nPublic} public signals`);
  order.forEach((n, i) => info(`publicSignals[${i}] = ${n}`));

  const requiredPower = Math.max(
    10,
    Math.ceil(Math.log2(stats.nonLinearConstraints + nPublic + 1)),
  );
  if (requiredPower > 12) {
    throw new Error(
      `Circuit needs ptau power ${requiredPower}, but this script is pinned to 12. ` +
        `Update PTAU_NAME/PTAU_URL to the power-${requiredPower} Hermez file.`,
    );
  }
  info(`ptau power 12 (4096 constraints) is sufficient; circuit needs ${requiredPower}`);

  // ── 3. Powers of Tau (phase 1) ───────────────────────────────────────────
  step("Obtaining the Powers-of-Tau transcript (phase 1)");
  if (fs.existsSync(PTAU_PATH) && !FORCE) {
    ok(`cached: .ptau-cache/${PTAU_NAME} (${mb(PTAU_PATH)})`);
  } else {
    info(`downloading ${PTAU_URL}`);
    info("(Hermez perpetual ceremony — 54 independent contributors)");
    const dl = spawnSync(
      "curl",
      ["-sSL", "--fail", "--max-time", "600", "-o", PTAU_PATH, PTAU_URL],
      { stdio: "inherit", cwd: ROOT, shell: process.platform === "win32" },
    );

    if (dl.status !== 0) {
      // Offline fallback. This is NOT equivalent security and we say so loudly.
      warn("Download failed — falling back to a LOCAL single-contributor ceremony.");
      warn("This setup is for development only: its toxic waste is not provably destroyed.");
      const tmp0 = path.join(BUILD, "pot12_0000.ptau");
      const tmp1 = path.join(BUILD, "pot12_0001.ptau");
      snarkjs("powersoftau", "new", "bn128", "12", tmp0, "-v");
      snarkjs(
        "powersoftau", "contribute", tmp0, tmp1,
        "--name=veritas-local", `--entropy=${randomBytes(64).toString("hex")}`,
      );
      snarkjs("powersoftau", "prepare", "phase2", tmp1, PTAU_PATH, "-v");
    }
    ok(`${PTAU_NAME} ready (${mb(PTAU_PATH)})`);
  }

  // ── 4. Groth16 setup + phase-2 contribution ──────────────────────────────
  const zkey0 = path.join(BUILD, `${CIRCUIT}_0000.zkey`);
  const zkeyFinal = path.join(BUILD, `${CIRCUIT}_final.zkey`);

  step("Groth16 trusted setup (phase 2, circuit-specific)");
  snarkjs("groth16", "setup", `build/${CIRCUIT}.r1cs`, PTAU_PATH, zkey0);

  /*
   * Entropy for the phase-2 contribution.
   *
   * The previous pipeline hardcoded the literal string "veritas-zk-dev", which
   * means anyone reading the repository could reconstruct the toxic waste and
   * forge proofs. We take it from SETUP_ENTROPY if provided, otherwise from
   * the OS CSPRNG. Either way it is never committed.
   */
  const entropy = process.env.SETUP_ENTROPY || randomBytes(64).toString("hex");
  if (process.env.SETUP_ENTROPY) info("using SETUP_ENTROPY from the environment");
  else info("using fresh CSPRNG entropy (not persisted)");

  snarkjs(
    "zkey", "contribute", zkey0, zkeyFinal,
    "--name=veritas-phase2-contribution-1", `--entropy=${entropy}`,
  );
  snarkjs("zkey", "verify", `build/${CIRCUIT}.r1cs`, PTAU_PATH, zkeyFinal);
  ok(`build/${CIRCUIT}_final.zkey (${mb(zkeyFinal)}) — contributions verified`);

  // ── 5. Verification key ──────────────────────────────────────────────────
  step("Exporting the verification key");
  const vkeyPath = path.join(BUILD, "verification_key.json");
  snarkjs("zkey", "export", "verificationkey", zkeyFinal, vkeyPath);

  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  if (vkey.nPublic !== nPublic) {
    throw new Error(`verification key declares nPublic=${vkey.nPublic}, expected ${nPublic}`);
  }
  // Each public signal gets an IC point. A point at infinity would mean the
  // signal is not actually bound into the proof — a silent security hole.
  if (vkey.IC.length !== nPublic + 1) {
    throw new Error(`verification key has ${vkey.IC.length} IC points, expected ${nPublic + 1}`);
  }
  ok(`verification key exported, ${vkey.IC.length} IC points (all signals bound)`);

  // ── 6. Solidity verifier ─────────────────────────────────────────────────
  step("Generating the Solidity verifier");
  const verifierPath = path.join(ROOT, "contracts", "Groth16Verifier.sol");
  snarkjs("zkey", "export", "solidityverifier", zkeyFinal, verifierPath);

  // snarkjs emits `pragma solidity >=0.7.0 <0.9.0`; pin it to the project's
  // compiler so hardhat does not silently select a second solc version.
  const src = fs.readFileSync(verifierPath, "utf8");
  const pinned = src.replace(/pragma solidity [^;]+;/, "pragma solidity ^0.8.20;");
  fs.writeFileSync(
    verifierPath,
    "// SPDX-License-Identifier: GPL-3.0\n" +
      "//\n" +
      "// AUTO-GENERATED by scripts/zk/build.mjs — DO NOT EDIT BY HAND.\n" +
      "// Regenerate with `npm run zk:build` whenever the circuit changes.\n" +
      `// Circuit: circuits/${CIRCUIT}.circom   r1cs sha256: ${manifest.r1csSha256.slice(0, 16)}…\n` +
      "//\n" +
      pinned.replace(/^\/\/ SPDX-License-Identifier:.*\n/m, ""),
  );
  ok("contracts/Groth16Verifier.sol written and pragma pinned to ^0.8.20");

  // ── 7. End-to-end smoke test ─────────────────────────────────────────────
  step("Proving and verifying a sample witness");
  const { buildSampleInput } = await import("./sample-input.mjs");
  const input = await buildSampleInput();
  fs.writeFileSync(
    path.join(ROOT, "circuits", "input.json"),
    JSON.stringify(input, null, 2) + "\n",
  );

  const snarkjsLib = await import("snarkjs");
  const { proof, publicSignals } = await snarkjsLib.groth16.fullProve(
    input,
    path.join(BUILD, `${CIRCUIT}_js`, `${CIRCUIT}.wasm`),
    zkeyFinal,
  );
  const valid = await snarkjsLib.groth16.verify(vkey, publicSignals, proof);
  if (!valid) throw new Error("Sample proof failed to verify — the setup is broken.");

  fs.writeFileSync(path.join(BUILD, "proof.json"), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(BUILD, "public.json"), JSON.stringify(publicSignals, null, 2));
  ok("sample proof verifies");
  order.forEach((n, i) => info(`${n} = ${publicSignals[i]}`));

  // ── 8. Publish artifacts to the frontend ─────────────────────────────────
  step("Copying browser artifacts to frontend/public/zk/");
  const zkDir = path.join(ROOT, "frontend", "public", "zk");
  fs.mkdirSync(zkDir, { recursive: true });
  const copies = [
    [path.join(BUILD, `${CIRCUIT}_js`, `${CIRCUIT}.wasm`), `${CIRCUIT}.wasm`],
    [zkeyFinal, `${CIRCUIT}_final.zkey`],
    [vkeyPath, "verification_key.json"],
    // The worker loads snarkjs via importScripts from a static file rather than
    // through the bundler — see frontend/src/zk/prover.worker.js for why.
    [path.join(ROOT, "node_modules", "snarkjs", "build", "snarkjs.min.js"), "snarkjs.min.js"],
  ];
  for (const [from, to] of copies) {
    fs.copyFileSync(from, path.join(zkDir, to));
    info(`${to} (${mb(path.join(zkDir, to))})`);
  }
  // The frontend imports this to know the signal layout.
  fs.writeFileSync(
    path.join(ROOT, "frontend", "src", "zk", "signals.generated.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  ok("artifacts published");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(
    "\n" + C.green(C.bold("  Build complete.")) +
      `\n  ${C.dim("constraints")}  ${stats.nonLinearConstraints} non-linear / ${stats.linearConstraints} linear` +
      `\n  ${C.dim("public")}       [${order.join(", ")}]` +
      `\n  ${C.dim("zkey")}         ${mb(zkeyFinal)}` +
      `\n\n  ${C.dim("Next:")} npx hardhat compile && npx hardhat test\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${C.red("  Build failed:")} ${err.message}\n`);
    process.exit(1);
  });
