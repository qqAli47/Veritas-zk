import React, { useState, useEffect } from 'react';
import HomePage from './pages/HomePage.jsx';
import ProvePage from './pages/ProvePage.jsx';
import RestrictedPage from './pages/RestrictedPage.jsx';
import { useWallet } from './hooks/useWallet.js';
import { getRoute } from './utils/router.js';

function App() {
  const wallet = useWallet();
  const [route, setRoute] = useState(getRoute(window.location.hash));
  const [routeState, setRouteState] = useState(window.__routeState || null);

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRoute(window.location.hash));
      setRouteState(window.__routeState || null);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (route === 'prove') return <ProvePage wallet={wallet} />;
  if (route === 'restricted') return <RestrictedPage wallet={wallet} locationState={routeState} />;
  return <HomePage wallet={wallet} />;
}

export default App;
