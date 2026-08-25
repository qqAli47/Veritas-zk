/**
 * scripts/zk/verify-browser-path.mjs
 *
 * Proves that the artifacts served to the browser actually work, without
 * needing a browser.
 *
 * This runs the exact code path frontend/public/prover.worker.js takes:
 * evaluate snarkjs.min.js in global scope (as importScripts does), load the
 * .wasm and .zkey from frontend/public/zk/, generate a proof, verify it, and
 * confirm the commitment poseidon-lite predicts matches the one the circuit
 * computed.
 *
 * Usage: node scripts/zk/verify-browser-path.mjs
 */
import fs from 'node:fs';
import { poseidon2 } from 'poseidon-lite';
import vm from 'node:vm';

const ZK = 'frontend/public/zk';

// Load the SAME UMD bundle the worker pulls in via importScripts.
/*
 * The bundle is a bare IIFE assigning to `var snarkjs`. In a classic worker,
 * importScripts() evaluates it in global scope so that becomes a global.
 * Node's require() would wrap it in a function scope instead, hiding it — so
 * use runInThisContext, which has the same semantics as importScripts.
 */
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(`${ZK}/snarkjs.min.js`, 'utf8'), {
  filename: 'snarkjs.min.js',
});
const snarkjs = globalThis.snarkjs;
if (!snarkjs?.groth16?.fullProve) {
  throw new Error('snarkjs.min.js did not expose groth16 globally — the worker would break.');
}

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const toField = (x) => ((BigInt(x) % FIELD) + FIELD) % FIELD;
const pack = (s, y, t) => (BigInt(s) << 32n) | (BigInt(y) << 16n) | BigInt(t);

const birthYear = 2000;
const secret = toField(BigInt('0x' + 'ab'.repeat(32)));
const subject = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const context = 987654321987654321n;

const input = {
  context: toField(context).toString(),
  packed: pack(subject, 2026, 18).toString(),
  birthYear: String(birthYear),
  secret: toField(secret).toString(),
};

const wasm = new Uint8Array(fs.readFileSync(`${ZK}/attribute_check.wasm`));
const zkey = new Uint8Array(fs.readFileSync(`${ZK}/attribute_check_final.zkey`));
const vkey = JSON.parse(fs.readFileSync(`${ZK}/verification_key.json`, 'utf8'));

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
const ms = Date.now() - t0;

const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
const [a, b, c, pub] = JSON.parse('[' + raw + ']');

// The frontend computes the commitment with poseidon-lite BEFORE proving,
// to check registration. It must equal what the circuit produced.
const predicted = poseidon2([toField(birthYear), toField(secret)]).toString();

console.log('snarkjs UMD bundle loaded :', typeof snarkjs.groth16.fullProve === 'function');
console.log('proof generated in        :', ms, 'ms');
console.log('locally verified          :', ok);
console.log('public signals            :', publicSignals.length);
console.log('calldata shape            :', `a[${a.length}] b[${b.length}][${b[0].length}] c[${c.length}] pub[${pub.length}]`);
console.log('poseidon-lite == circuit  :', predicted === publicSignals[0]);
// Tear down the ffjavascript worker pool, or the process never exits.
// The UMD build sometimes throws here; the verification is already done.
try {
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
} catch {
  /* ignore */
}
process.exit(ok && predicted === publicSignals[0] ? 0 : 1);
