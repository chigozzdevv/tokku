import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import type { Wallet } from '@solana/wallet-adapter-react'
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base'
import { useWalletModal } from '@/providers/wallet-provider'

export function WalletModal() {
  const { wallets, select, connect, connected } = useWallet()
  const { setShowWalletModal } = useWalletModal()
  const [showMoreWallets, setShowMoreWallets] = useState(false)
  const [pendingWallet, setPendingWallet] = useState<WalletName<string> | null>(null)

  const { primaryWallets, secondaryWallets } = useMemo(() => {
    const installed: Wallet[] = []
    const additional: Wallet[] = []

    wallets.forEach((entry) => {
      if (entry.readyState === WalletReadyState.Installed) {
        installed.push(entry)
        return
      }
      if (entry.readyState !== WalletReadyState.Unsupported) {
        additional.push(entry)
      }
    })

    if (installed.length) {
      return { primaryWallets: installed, secondaryWallets: additional }
    }

    return { primaryWallets: additional, secondaryWallets: [] }
  }, [wallets])

  const handleSelectWallet = useCallback(
    async (name: WalletName<string>) => {
      const nextWallet = wallets.find((entry) => entry.adapter.name === name)
      if (!nextWallet) {
        return
      }

      const { adapter, readyState } = nextWallet
      if (!(readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable)) {
        if (adapter.url && typeof window !== 'undefined') {
          window.open(adapter.url, '_blank')
        }
        return
      }

      setPendingWallet(name)
      try {
        select(name)
        await connect()
      } catch (err) {
        console.error('Wallet connection failed:', err)
        setPendingWallet(null)
      }
    },
    [select, connect, wallets]
  )

  const renderWalletButton = useCallback(
    (entry: Wallet) => (
      <button
        key={entry.adapter.name}
        className={`wallet-option${pendingWallet === entry.adapter.name ? ' wallet-option--pending' : ''}`}
        onClick={() => handleSelectWallet(entry.adapter.name as WalletName<string>)}
        disabled={pendingWallet === entry.adapter.name}
      >
        {entry.adapter.icon && (
          <img src={entry.adapter.icon} alt={entry.adapter.name} className="wallet-option-icon" />
        )}
        <span className="wallet-option-name">{entry.adapter.name}</span>
        {entry.readyState === WalletReadyState.Installed ? (
          <span className="wallet-option-tag">Detected</span>
        ) : null}
      </button>
    ),
    [handleSelectWallet, pendingWallet]
  )

  useEffect(() => {
    if (connected) {
      setPendingWallet(null)
      setShowWalletModal(false)
    }
  }, [connected, setShowWalletModal])

  const handleClose = useCallback(() => {
    setShowWalletModal(false)
  }, [setShowWalletModal])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose()
      }
    },
    [handleClose]
  )

  return (
    <div className="wallet-modal-overlay" onClick={handleOverlayClick}>
      <div className="wallet-modal-content">
        <div className="wallet-modal-header">
          <h2>Select a Wallet</h2>
          <button className="wallet-modal-close" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div className="wallet-modal-section">
          {primaryWallets.length ? (
            <div className="wallet-modal-list">{primaryWallets.map(renderWalletButton)}</div>
          ) : (
            <div className="wallet-modal-empty">No wallets available</div>
          )}
        </div>
        {secondaryWallets.length ? (
          <div className="wallet-modal-section wallet-modal-section--secondary">
            <button
              className="wallet-modal-toggle"
              onClick={() => setShowMoreWallets((prev) => !prev)}
            >
              {showMoreWallets
                ? 'Hide additional wallets'
                : `Show ${secondaryWallets.length} more wallet${secondaryWallets.length > 1 ? 's' : ''}`}
            </button>
            {showMoreWallets ? (
              <div className="wallet-modal-list wallet-modal-list--secondary">
                {secondaryWallets.map(renderWalletButton)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
