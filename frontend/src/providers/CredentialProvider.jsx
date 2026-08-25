import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CHAIN, CONTRACTS } from '../contracts/config.js';

const CredentialContext = createContext(null);

export const CREDENTIAL_SCHEMA = 'veritas.credential/v1';

/**
 * The holder's credential.
 *
 * `birthYear` and `secret` live in React state and NOWHERE else. They are
 * never written to localStorage, sessionStorage, a cookie, or a URL. The whole
 * privacy claim of this project rests on those two values not leaving the
 * device, and persisting them "for convenience" would quietly undermine it.
 *
 * The cost is that a page refresh loses the credential and the holder must
 * re-import their file. That is the correct trade.
 */
export function CredentialProvider({ children }) {
  const [credential, setCredential] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback((cred) => {
    setError(null);
    setCredential(cred);
  }, []);

  const clear = useCallback(() => {
    setCredential(null);
    setError(null);
  }, []);

  /** Parse and validate a credential file, refusing anything from elsewhere. */
  const importFromJson = useCallback((text) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That file is not valid JSON.');
      return null;
    }

    if (parsed.schema !== CREDENTIAL_SCHEMA) {
      setError(`Unrecognised credential format (${parsed.schema ?? 'no schema field'}).`);
      return null;
    }
    if (parsed.birthYear == null || parsed.secret == null || !parsed.commitment) {
      setError('The credential file is missing required fields.');
      return null;
    }
    // A credential is bound to the registry that issued it. Silently accepting
    // one from another network produces an unregistered-commitment revert
    // several steps later, which is a miserable thing to debug.
    if (parsed.chainId != null && BigInt(parsed.chainId) !== CHAIN.id) {
      setError(
        `This credential was issued on chain ${parsed.chainId}, but the app is configured ` +
          `for ${CHAIN.name} (${CHAIN.id}).`,
      );
      return null;
    }
    if (
      parsed.registry &&
      CONTRACTS.registry &&
      parsed.registry.toLowerCase() !== CONTRACTS.registry.toLowerCase()
    ) {
      setError('This credential was issued by a different registry deployment.');
      return null;
    }

    const cred = {
      birthYear: Number(parsed.birthYear),
      secret: String(parsed.secret),
      commitment: String(parsed.commitment),
      issuer: parsed.issuer ?? null,
      registry: parsed.registry ?? null,
      chainId: parsed.chainId ?? null,
      issuedAt: parsed.issuedAt ?? null,
      txHash: parsed.txHash ?? null,
    };
    setError(null);
    setCredential(cred);
    return cred;
  }, []);

  const value = useMemo(
    () => ({ credential, error, load, clear, importFromJson, setError }),
    [credential, error, load, clear, importFromJson],
  );

  return <CredentialContext.Provider value={value}>{children}</CredentialContext.Provider>;
}

export function useCredential() {
  const ctx = useContext(CredentialContext);
  if (!ctx) throw new Error('useCredential must be used inside a CredentialProvider');
  return ctx;
}

/** Serialise a credential to the downloadable file format. */
export function toCredentialFile(cred) {
  return {
    schema: CREDENTIAL_SCHEMA,
    issuer: cred.issuer,
    chainId: Number(CHAIN.id),
    registry: CONTRACTS.registry,
    birthYear: cred.birthYear,
    secret: cred.secret,
    commitment: cred.commitment,
    issuedAt: cred.issuedAt ?? new Date().toISOString(),
    txHash: cred.txHash ?? null,
    warning:
      'This file contains your private secret. Anyone holding it can prove your age as you. ' +
      'Treat it like a password.',
  };
}
