/* eslint-env worker */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  prover.worker.js — Groth16 proving, off the main thread
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  WHY THIS FILE LIVES IN public/ AND NOT IN src/
 *
 *  snarkjs 0.7.x is published as a Node-first bundle: its dependency graph
 *  reaches for `process`, `Buffer`, `os.cpus()` and dynamic `require`s that a
 *  browser bundler cannot resolve. Feeding it through Vite means polyfilling
 *  all of that AND fighting the dependency pre-bundler into using the browser
 *  build — a fragile arrangement that breaks on minor version bumps.
 *
 *  Loading the pre-built UMD bundle with importScripts() from a classic worker
 *  sidesteps the bundler completely. The file is copied into public/zk/ by
 *  scripts/zk/build.mjs alongside the circuit artifacts, so it is always the
 *  exact version the .zkey was produced with.
 *
 *  WHY A WORKER AT ALL
 *
 *  Proof generation is a synchronous CPU burn. On the main thread it freezes
 *  the tab — no spinner animation, no cancel button, no scrolling — for the
 *  duration. Here the UI stays fully responsive.
 *
 *  PRIVACY NOTE: birthYear and secret arrive in a message, are used to build a
 *  witness, and are never stored on `self` or posted back out.
 * ═══════════════════════════════════════════════════════════════════════════
 */

importScripts('/zk/snarkjs.min.js');

const ARTIFACTS = {
  wasm: '/zk/attribute_check.wasm',
  zkey: '/zk/attribute_check_final.zkey',
  vkey: '/zk/verification_key.json',
};

/** Artifacts are cached for the worker's lifetime, so a second proof is instant. */
const cache = new Map();

const post = (msg) => self.postMessage(msg);

function artifactError(url, status) {
  const err = new Error(
    `Could not load ${url} (HTTP ${status}). These files are generated, not ` +
      `committed — run \`npm run zk:build\` from the repository root.`,
  );
  err.name = 'ArtifactError';
  return err;
}

/** Fetch an artifact, reporting real download progress for the large .zkey. */
async function loadArtifact(url, jobId, label) {
  if (cache.has(url)) {
    post({ type: 'progress', jobId, stage: 'download', label, ratio: 1, cached: true });
    return cache.get(url);
  }

  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw artifactError(url, res.status);

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastTick = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    // Throttle: without this a fast connection floods the main thread with
    // hundreds of messages and the progress bar costs more than the download.
    const now = Date.now();
    if (now - lastTick > 60) {
      lastTick = now;
      post({
        type: 'progress', jobId, stage: 'download', label,
        loaded: received, total, ratio: total ? received / total : null,
      });
    }
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  cache.set(url, buf);
  post({ type: 'progress', jobId, stage: 'download', label, loaded: received, total, ratio: 1 });
  return buf;
}

/**
 * snarkjs reports no percentage, only coarse phase lines through a logger.
 * Map those lines onto weights so the bar advances through the real work
 * rather than sitting at an indeterminate spinner for several seconds.
 */
const PHASES = [
  [/read(ing)?\s+wtns|witness/i, 0.45],
  [/read(ing)?\s+zkey|coeffs|section/i, 0.55],
  [/buildabc|computing a|\bfft\b|\bifft\b/i, 0.7],
  [/multiexp\s*a/i, 0.78],
  [/multiexp\s*b1/i, 0.84],
  [/multiexp\s*b2/i, 0.9],
  [/multiexp\s*c/i, 0.96],
];

function makeLogger(jobId) {
  const handle = (level) => (...args) => {
    const line = args.map(String).join(' ');
    for (const [re, ratio] of PHASES) {
      if (re.test(line)) {
        post({ type: 'progress', jobId, stage: 'prove', ratio, line });
        return;
      }
    }
    if (level === 'error' || level === 'warn') post({ type: 'log', jobId, level, line });
  };
  return {
    debug: handle('debug'),
    info: handle('info'),
    warn: handle('warn'),
    error: handle('error'),
  };
}

const serialise = (err) => ({
  name: err?.name ?? 'Error',
  message: String(err?.message ?? err),
  stack: err?.stack,
});

self.onmessage = async (event) => {
  const { type, jobId, payload } = event.data ?? {};

  // Pre-download on page mount so clicking "Generate" starts proving at once.
  if (type === 'warm') {
    try {
      await loadArtifact(ARTIFACTS.wasm, 0, 'circuit');
      await loadArtifact(ARTIFACTS.zkey, 0, 'proving key');
      post({ type: 'warm:done' });
    } catch (err) {
      post({ type: 'warm:error', error: serialise(err) });
    }
    return;
  }

  if (type !== 'prove') return;

  try {
    const wasm = await loadArtifact(ARTIFACTS.wasm, jobId, 'circuit');
    const zkey = await loadArtifact(ARTIFACTS.zkey, jobId, 'proving key');

    post({ type: 'progress', jobId, stage: 'witness', ratio: 0.35 });

    const started = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      payload.input,
      wasm,
      zkey,
      makeLogger(jobId),
    );
    const proveMs = Date.now() - started;

    // Verify locally before spending any gas. This is free, takes ~10 ms, and
    // catches a proving-key/verification-key mismatch that would otherwise
    // surface as an opaque on-chain revert.
    post({ type: 'progress', jobId, stage: 'verify-local', ratio: 0.98 });
    const vkeyBytes = await loadArtifact(ARTIFACTS.vkey, jobId, 'verification key');
    const vkey = JSON.parse(new TextDecoder().decode(vkeyBytes));
    const locallyValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

    const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [a, b, c, pub] = JSON.parse('[' + raw + ']');

    post({
      type: 'done',
      jobId,
      result: { proof, publicSignals, calldata: { a, b, c, pub }, locallyValid, proveMs },
    });
  } catch (err) {
    post({ type: 'error', jobId, error: serialise(err) });
  }
};
