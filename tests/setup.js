/**
 * Mocha root hooks.
 *
 * Mocha loads every file under `tests/`, so a top-level `after` here runs once
 * at the very end of the whole run.
 */

const { terminateCurve } = require('./helpers/zk');

after(async function () {
  // Without this the process hangs indefinitely after the last test: snarkjs
  // leaves a ffjavascript worker pool alive on globalThis.curve_bn128.
  this.timeout(20000);
  await terminateCurve();
});
