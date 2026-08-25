import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useWallet } from './WalletProvider.jsx';

const SessionContext = createContext(null);

/**
 * The current prove-and-verify session.
 *
 * This replaces the original app's `window.__routeState`, which stashed the
 * proof on a global and was lost on any refresh.
 */
export function SessionProvider({ children }) {
  const { address } = useWallet();
  const [proof, setProof] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [proveMs, setProveMs] = useState(null);

  const reset = useCallback(() => {
    setProof(null);
    setReceipt(null);
    setProveMs(null);
  }, []);

  /**
   * A proof commits to the beneficiary address inside the circuit, so it stops
   * being usable the moment the user switches accounts. Dropping it here means
   * the UI cannot offer a stale proof that would revert with InvalidProof.
   */
  useEffect(() => {
    reset();
  }, [address, reset]);

  const value = useMemo(
    () => ({ proof, setProof, receipt, setReceipt, proveMs, setProveMs, reset }),
    [proof, receipt, proveMs, reset],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside a SessionProvider');
  return ctx;
}
