/**
 * Main-thread client for the proving worker.
 *
 * Wraps the worker's message protocol in a promise API with progress
 * reporting and cancellation.
 */

import signals from './signals.generated.json';

/**
 * A classic worker, deliberately — see the header of public/prover.worker.js
 * for why snarkjs is loaded via importScripts rather than through the bundler.
 */
const WORKER_URL = '/prover.worker.js';

class ProverClient {
  #worker = null;
  #jobs = new Map();
  #seq = 0;

  #ensure() {
    if (this.#worker) return this.#worker;
    const w = new Worker(WORKER_URL, { name: 'veritas-prover' });
    w.onmessage = (e) => this.#dispatch(e.data);
    w.onerror = (e) =>
      this.#failAll(new Error(`Prover worker failed to start: ${e.message || 'unknown error'}`));
    this.#worker = w;
    return w;
  }

  /** Pre-download the circuit artifacts so the first proof starts immediately. */
  warm() {
    try {
      this.#ensure().postMessage({ type: 'warm' });
    } catch {
      /* warming is best-effort */
    }
  }

  /**
   * @param {object} input   the circuit input object
   * @param {object} opts    { onProgress, signal }
   */
  prove(input, { onProgress, signal } = {}) {
    const jobId = ++this.#seq;
    const worker = this.#ensure();

    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.#jobs.delete(jobId)) return;
        // WASM execution is not interruptible, so terminating the worker is
        // the only real cancel. The artifacts sit in the browser's HTTP cache,
        // so the next attempt re-downloads them near-instantly.
        this.terminate();
        reject(Object.assign(new Error('Proof generation cancelled.'), { code: 'CANCELLED' }));
      };

      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });

      this.#jobs.set(jobId, { resolve, reject, onProgress });
      worker.postMessage({ type: 'prove', jobId, payload: { input } });
    });
  }

  #dispatch(msg) {
    if (msg?.type === 'warm:done' || msg?.type === 'warm:error') return;

    const job = this.#jobs.get(msg?.jobId);
    if (!job) return; // stale message from a superseded job

    switch (msg.type) {
      case 'progress':
        job.onProgress?.(msg);
        break;
      case 'log':
        if (msg.level === 'error') console.error('[prover]', msg.line);
        break;
      case 'done':
        this.#jobs.delete(msg.jobId);
        job.resolve(msg.result);
        break;
      case 'error': {
        this.#jobs.delete(msg.jobId);
        const err = new Error(msg.error.message);
        err.name = msg.error.name;
        job.reject(err);
        break;
      }
      default:
        break;
    }
  }

  #failAll(err) {
    for (const [id, job] of this.#jobs) {
      this.#jobs.delete(id);
      job.reject(err);
    }
    this.terminate();
  }

  terminate() {
    this.#worker?.terminate();
    this.#worker = null;
  }
}

export const prover = new ProverClient();

/** Index of each public signal, from the generated manifest. */
export const SIGNAL = signals.index;

/**
 * Guard against the circuit being rebuilt with a different signal layout while
 * the frontend still holds the old indices — which would fail as a confusing
 * on-chain revert rather than an obvious error.
 */
export function assertSignalShape(publicSignals) {
  if (publicSignals.length !== signals.nPublic) {
    throw new Error(
      `Expected ${signals.nPublic} public signals but the proof produced ` +
        `${publicSignals.length}. The circuit and this build are out of sync — ` +
        `re-run \`npm run zk:build\`.`,
    );
  }
}
