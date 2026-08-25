import { createHashRouter } from 'react-router-dom';
import AppShell from './app/AppShell.jsx';
import { RequireWalletAndChain } from './app/guards.jsx';
import HomePage from './pages/HomePage.jsx';
import IssuerPage from './pages/IssuerPage.jsx';
import ProvePage from './pages/ProvePage.jsx';
import RestrictedPage from './pages/RestrictedPage.jsx';
import ExplorerPage from './pages/ExplorerPage.jsx';
import HowItWorksPage from './pages/HowItWorksPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

/*
 * A HASH router, deliberately.
 *
 * It keeps the app deployable as static files anywhere -- GitHub Pages, a
 * plain file server, `vite preview` -- with no server-side rewrite rules, and
 * it preserves the #/prove style links the earlier version already used.
 *
 * Unlike the hand-rolled router it replaces, navigation state lives in history
 * rather than on a window global, so a refresh no longer loses it.
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <NotFoundPage isError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'how-it-works', element: <HowItWorksPage /> },
      { path: 'explorer', element: <ExplorerPage /> },
      {
        path: 'issuer',
        element: (
          <RequireWalletAndChain>
            <IssuerPage />
          </RequireWalletAndChain>
        ),
      },
      {
        path: 'prove',
        element: (
          <RequireWalletAndChain>
            <ProvePage />
          </RequireWalletAndChain>
        ),
      },
      {
        path: 'restricted',
        element: (
          <RequireWalletAndChain>
            <RestrictedPage />
          </RequireWalletAndChain>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
