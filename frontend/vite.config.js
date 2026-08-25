import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * NOTE ON snarkjs AND CROSS-ORIGIN ISOLATION
 *
 * snarkjs is deliberately NOT bundled. It is loaded by the proving worker via
 * importScripts from public/zk/snarkjs.min.js — see the header of
 * public/prover.worker.js for the reasoning. That keeps its Node-oriented
 * dependency graph (process, Buffer, os.cpus, dynamic requires) out of the
 * bundler entirely, so no polyfill plugins are needed here.
 *
 * We also deliberately do NOT set COOP/COEP headers. They would unlock
 * SharedArrayBuffer and let snarkjs prove multi-threaded, but:
 *
 *   - this circuit is 761 constraints and proves in about a second
 *     single-threaded, so there is nothing to gain;
 *   - `Cross-Origin-Embedder-Policy: require-corp` blocks every cross-origin
 *     subresource that does not send CORP, which includes the Google Fonts
 *     stylesheet in index.html — the page would silently lose its typeface;
 *   - static hosts such as GitHub Pages cannot set response headers at all,
 *     so a build that depended on them would work locally and break when
 *     deployed.
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    open: true,
  },

  preview: {
    port: 4173,
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022', // circomlibjs uses BigInt literals
    chunkSizeWarningLimit: 1200, // ethers is legitimately large
    rollupOptions: {
      output: {
        manualChunks: {
          ethers: ['ethers'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },

  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
});
