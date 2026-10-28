import { RouterProvider } from 'react-router-dom';
import { router } from './routes.jsx';
import { WalletProvider } from './providers/WalletProvider.jsx';
import { CredentialProvider } from './providers/CredentialProvider.jsx';
import { SessionProvider } from './providers/SessionProvider.jsx';
import { ToastProvider } from './providers/ToastProvider.jsx';

export default function App() {
  return (
    <ToastProvider>
      <WalletProvider>
        <CredentialProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </CredentialProvider>
      </WalletProvider>
    </ToastProvider>
  );
}
