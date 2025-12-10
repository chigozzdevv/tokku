import { createContext, useContext, useMemo, useState } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import {
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { WalletModal } from '@/components/wallet/wallet-modal'
import { config } from '@/config/env'
import '@/components/wallet/wallet-modal.css'

type WalletModalContextType = {
  showWalletModal: boolean
  setShowWalletModal: (show: boolean) => void
}

const WalletModalContext = createContext<WalletModalContextType | null>(null)

export function useWalletModal() {
  const ctx = useContext(WalletModalContext)
  if (!ctx) {
    throw new Error('useWalletModal must be used within SolanaWalletProviders')
  }
  return ctx
}

export function SolanaWalletProviders({ children }: { children: React.ReactNode }) {
  const [showWalletModal, setShowWalletModal] = useState(false)
  const endpoint = useMemo(() => config.SOLANA_RPC_URL, [])
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
      new LedgerWalletAdapter(),
      new CoinbaseWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    ],
    []
  )

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalContext.Provider value={{ showWalletModal, setShowWalletModal }}>
          {showWalletModal && <WalletModal />}
          {children}
        </WalletModalContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
