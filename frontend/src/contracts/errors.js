/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Turning a revert into something a human can act on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Four things make this harder than it looks:
 *
 *  1. ethers v6 auto-decodes a custom error into `err.revert` — but only when
 *     the error is declared in the ABI of the contract you called. A revert
 *     raised inside CredentialRegistry while VeritasCore is executing arrives
 *     as raw bytes with `err.revert === null`, so we must retry the decode
 *     against every ABI we know.
 *
 *  2. The revert bytes hide at wildly different depths depending on the
 *     provider: err.data, err.info.error.data, err.error.data, and so on.
 *
 *  3. A CALL_EXCEPTION whose data is exactly '0x' almost never means "the
 *     contract reverted without a reason". It nearly always means there is no
 *     contract at that address, or the wallet is on the wrong chain. Reporting
 *     it as a revert sends the reader down a long blind alley.
 *
 *  4. Panic(uint256) and legacy Error(string) need their own handling.
 */

import { Interface, isError } from 'ethers';
import coreAbi from './abis/VeritasCore.json';
import registryAbi from './abis/CredentialRegistry.json';
import gatedAbi from './abis/GatedContent.json';
import { CHAIN } from './config.js';

const INTERFACES = [
  new Interface(coreAbi.abi),
  new Interface(registryAbi.abi),
  new Interface(gatedAbi.abi),
];

const ERROR_STRING_SELECTOR = '0x08c379a0'; // Error(string)
const PANIC_SELECTOR = '0x4e487b71'; // Panic(uint256)
const HEX = /^0x([0-9a-fA-F]{2})*$/;

const short = (v) => {
  const s = String(v);
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
};

/** Walk the nested provider error looking for the first plausible revert blob. */
export function extractRevertData(err, depth = 0, seen = new Set()) {
  if (!err || typeof err !== 'object' || depth > 8 || seen.has(err)) return null;
  seen.add(err);

  for (const key of ['data', 'error', 'info', 'cause', 'originalError', 'value']) {
    const v = err[key];
    if (typeof v === 'string' && HEX.test(v) && v.length > 2) return v.toLowerCase();
    if (v && typeof v === 'object') {
      const found = extractRevertData(v, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

const PANIC_TEXT = {
  0x01: 'an assert() failed',
  0x11: 'arithmetic overflowed or underflowed',
  0x12: 'division or modulo by zero',
  0x32: 'array index out of bounds',
};

/**
 * Every contract error, mapped to copy a user can act on.
 * Each entry receives the decoded error arguments.
 */
const MESSAGES = {
  // ── VeritasCore ──────────────────────────────────────────────────────────
  NullifierAlreadyUsed: () => ({
    title: 'This proof has already been used',
    message:
      'Replay protection rejected the transaction. Each proof is valid exactly once per ' +
      'verification period.',
    hint: 'This is the system working as designed, not a fault.',
    tone: 'info',
    action: 'regenerate',
  }),
  CommitmentNotValid: ([c]) => ({
    title: 'Credential not registered',
    message: `No issuer has registered the commitment ${short(c)} on this network, or it has been revoked.`,
    hint: 'Ask an issuer to register your credential from the Issuer console.',
    action: 'goto-issuer',
  }),
  ThresholdBelowPolicy: ([proven, required]) => ({
    title: 'Age threshold too low',
    message: `This proof asserts age ≥ ${proven}, but this deployment requires ≥ ${required}.`,
    hint: 'Regenerate the proof against the current policy.',
    action: 'regenerate',
  }),
  YearInFuture: ([proven, chainYear]) => ({
    title: 'Proof claims a future year',
    message: `The proof was built for ${proven}, but the contract's reference year is ${chainYear}.`,
    hint: 'Regenerate the proof.',
    action: 'regenerate',
  }),
  YearStale: ([proven, chainYear]) => ({
    title: 'Proof is out of date',
    message: `The proof was built for ${proven}; the contract is now on ${chainYear}.`,
    hint: 'Regenerate the proof — it only takes a moment.',
    action: 'regenerate',
  }),
  BadContext: () => ({
    title: 'Proof was built for a different context',
    message:
      'The verification period rolled over, or this proof was made for another network or ' +
      'contract.',
    hint: 'Regenerate the proof against the current parameters.',
    action: 'regenerate',
  }),
  RegionMaskMismatch: ([proven, required]) => ({
    title: 'The region policy changed',
    message:
      `This proof was built against allowlist ${proven}, but the verifier now requires ` +
      `${required}.`,
    hint: 'Regenerate the proof — it only takes a moment.',
    action: 'regenerate',
  }),
  RegionNotServed: () => ({
    title: 'Not available in your region',
    message: 'This resource does not serve the region set you verified under.',
    hint: null,
  }),
  InvalidProof: () => ({
    title: 'The verifier rejected this proof',
    message:
      'The Groth16 pairing check failed. Either the proof was altered in transit, or it names ' +
      'a different beneficiary than the account submitting it.',
    hint: 'Regenerate the proof for the connected account.',
    action: 'regenerate',
  }),
  MalformedPublicInput: () => ({
    title: 'Malformed proof data',
    message: 'The packed public signal is out of range.',
    hint: null,
  }),
  ZeroSubject: () => ({
    title: 'No beneficiary in the proof',
    message: 'The proof names the zero address as its subject.',
    hint: null,
  }),
  EnforcedPause: () => ({
    title: 'Verification is paused',
    message: 'The operator has temporarily halted verification on this deployment.',
    tone: 'info',
    hint: null,
  }),
  BadPolicy: () => ({
    title: 'Invalid policy',
    message: 'The proposed policy values are outside the permitted range.',
    hint: null,
  }),

  // ── CredentialRegistry ───────────────────────────────────────────────────
  AlreadyRegistered: ([c]) => ({
    title: 'Already registered',
    message: `Commitment ${short(c)} is already in the registry.`,
    hint: 'Generate a new secret to issue a distinct credential.',
    tone: 'info',
  }),
  InvalidCommitment: () => ({
    title: 'Invalid commitment',
    message: 'That value could not have been produced by the circuit.',
    hint: null,
  }),
  UnknownCommitment: ([c]) => ({
    title: 'Unknown commitment',
    message: `${short(c)} is not in the registry.`,
    hint: null,
  }),
  AlreadyRevoked: () => ({
    title: 'Already revoked',
    message: 'That credential has already been revoked.',
    tone: 'info',
    hint: null,
  }),
  AccessControlUnauthorizedAccount: ([account, role]) => ({
    title: 'Not authorised',
    message: `Account ${short(account)} does not hold the required role (${short(role)}).`,
    hint: 'Only the designated issuer account can register credentials.',
  }),

  // ── GatedContent ─────────────────────────────────────────────────────────
  NotAgeVerified: ([, requiredAge]) => ({
    title: 'Not verified',
    message: `This resource requires a valid on-chain attestation for age ${requiredAge}+.`,
    hint: 'Generate and submit a proof first.',
    action: 'goto-prove',
  }),
};

const wrap = (code, extra) => ({
  code,
  tone: 'error',
  hint: null,
    action: null,
  raw: null,
  ...extra,
});

const fromNamed = (name, args, raw) => {
  const build = MESSAGES[name];
  if (!build) return wrap(name, { title: 'Transaction reverted', message: name, raw });
  return wrap(name, { ...build(Array.from(args ?? []).map(String)), raw });
};

/**
 * Convert any error thrown by ethers, the wallet, or the provider into
 * `{ code, title, message, hint, tone, action }`.
 */
export function decodeContractError(err) {
  // ── 1. Never reached the chain: wallet and provider layer ────────────────
  const rpcCode = err?.code ?? err?.info?.error?.code ?? err?.error?.code;

  if (isError(err, 'ACTION_REJECTED') || rpcCode === 4001) {
    return wrap('REJECTED', {
      title: 'Transaction cancelled',
      message: 'You rejected the request in your wallet.',
      tone: 'info',
    });
  }
  if (rpcCode === -32002) {
    return wrap('POPUP_PENDING', {
      title: 'Wallet request already open',
      message: 'A request is already waiting in your wallet.',
      hint: 'Open the wallet extension and approve or dismiss it.',
      tone: 'info',
    });
  }
  if (err?.code === 'WRONG_CHAIN') {
    return wrap('WRONG_CHAIN', {
      title: 'Wrong network',
      message: err.message,
      hint: `Switch your wallet to ${CHAIN.name}.`,
      action: 'switch-chain',
    });
  }
  if (isError(err, 'INSUFFICIENT_FUNDS') || /insufficient funds/i.test(err?.message ?? '')) {
    return wrap('NO_FUNDS', {
      title: 'Not enough ETH for gas',
      message: `This account cannot cover the transaction fee on ${CHAIN.name}.`,
      hint: 'Get free test ETH from a faucet.',
      action: 'faucet',
    });
  }
  if (isError(err, 'NETWORK_ERROR') || isError(err, 'TIMEOUT') || isError(err, 'SERVER_ERROR')) {
    return wrap('NETWORK', {
      title: 'Network problem',
      message: `Could not reach the ${CHAIN.name} RPC endpoint.`,
      hint: 'Check your connection and try again.',
      action: 'retry',
    });
  }

  // ── 2. ethers already decoded it ─────────────────────────────────────────
  if (err?.revert?.name) return fromNamed(err.revert.name, err.revert.args, null);

  // ── 3. Decode manually against every ABI we know ─────────────────────────
  const data = extractRevertData(err);
  if (data && data !== '0x') {
    const selector = data.slice(0, 10);

    if (selector === ERROR_STRING_SELECTOR) {
      try {
        const [reason] = INTERFACES[0].decodeErrorResult('Error(string)', data);
        return wrap('REQUIRE', { title: 'Transaction reverted', message: reason, raw: data });
      } catch {
        /* fall through */
      }
    }

    if (selector === PANIC_SELECTOR) {
      try {
        const [code] = INTERFACES[0].decodeErrorResult('Panic(uint256)', data);
        return wrap(`PANIC_${code}`, {
          title: 'Contract panicked',
          message: `Solidity panic 0x${Number(code).toString(16)}: ${
            PANIC_TEXT[Number(code)] ?? 'unknown cause'
          }.`,
          hint: 'This indicates a contract bug — please report it.',
          raw: data,
        });
      } catch {
        /* fall through */
      }
    }

    for (const iface of INTERFACES) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) return fromNamed(parsed.name, parsed.args, data);
      } catch {
        /* wrong ABI — keep looking */
      }
    }

    return wrap('UNKNOWN_SELECTOR', {
      title: 'Unrecognised contract error',
      message: 'The contract reverted with an error this build does not recognise.',
      hint: `Selector ${selector}. The deployed contract may be newer than this frontend.`,
      raw: data,
    });
  }

  // ── 4. Empty revert data: almost always a misconfiguration ───────────────
  if (isError(err, 'CALL_EXCEPTION') || isError(err, 'BAD_DATA')) {
    return wrap('EMPTY_REVERT', {
      title: 'Call failed with no reason',
      message: 'The contract call returned no data.',
      hint:
        'Usually this means there is no contract at the configured address, or your wallet ' +
        `is on a different network than ${CHAIN.name}.`,
    });
  }

  // ── 5. Mined, then reverted ──────────────────────────────────────────────
  if (err?.receipt?.status === 0) {
    return wrap('MINED_REVERTED', {
      title: 'Transaction reverted on-chain',
      message: `Transaction ${short(err.receipt.hash)} was mined but reverted.`,
      action: 'etherscan',
      raw: err.receipt.hash,
    });
  }

  return wrap('UNKNOWN', {
    title: 'Something went wrong',
    message: err?.shortMessage ?? err?.message ?? String(err),
  });
}

/** Translate a snarkjs/circom failure into something meaningful. */
export function decodeProofError(err) {
  const m = err?.message ?? '';

  if (err?.name === 'ArtifactError') {
    return wrap('ARTIFACTS_MISSING', {
      title: 'Circuit files not found',
      message: m,
      hint: 'Run `npm run zk:build` from the repository root, then reload.',
    });
  }
  if (/assert failed|error in template/i.test(m)) {
    return wrap('CONSTRAINT_UNSATISFIED', {
      title: 'Your details do not satisfy the circuit',
      message:
        'Either the age is below the required threshold, your region is not one the verifier ' +
        'accepts, or the birth year, region and secret do not match the commitment that was ' +
        'registered.',
      hint: 'Check your credential and try again.',
    });
  }
  if (/scalar size does not match|cannot convert|not a valid/i.test(m)) {
    return wrap('BAD_INPUT', {
      title: 'Invalid input value',
      message: 'One of the values is outside the valid field range.',
    });
  }
  if (/out of memory|memory access out of bounds/i.test(m)) {
    return wrap('OOM', {
      title: 'Out of memory',
      message: 'The browser ran out of memory while generating the proof.',
      hint: 'Close other tabs and try again.',
    });
  }
  if (err?.code === 'CANCELLED') {
    return wrap('CANCELLED', {
      title: 'Cancelled',
      message: 'Proof generation was cancelled.',
      tone: 'info',
    });
  }

  return wrap('PROVE_FAILED', {
    title: 'Proof generation failed',
    message: m || 'Unknown error',
  });
}
