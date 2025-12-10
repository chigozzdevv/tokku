import { StrictMode } from 'react'
import { Buffer } from 'buffer'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app.tsx'
import { AuthProvider } from './providers/auth-provider.tsx'
import { SolanaWalletProviders } from './providers/wallet-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaWalletProviders>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SolanaWalletProviders>
  </StrictMode>,
)

if (!(window as any).Buffer) {
  ;(window as any).Buffer = Buffer
}
