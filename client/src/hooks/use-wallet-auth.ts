import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { authService } from '@/services/auth.service'
import { useAuth } from '@/providers/auth-provider'
import { useWalletModal } from '@/providers/wallet-provider'

export function useWalletAuth() {
  const navigate = useNavigate()
  const wallet = useWallet()
  const { setShowWalletModal } = useWalletModal()
  const { signIn } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const shouldSignRef = useRef(false)

  const performSignIn = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage) {
      return null
    }

    try {
      const publicKey = wallet.publicKey.toBase58()
      console.log('Requesting nonce for', publicKey)
      const nonce = await authService.requestNonce(publicKey)
      console.log('Got nonce, signing message...')
      const encodedMessage = new TextEncoder().encode(nonce.message)
      const signatureBytes = await wallet.signMessage(encodedMessage)
      const signature = bs58.encode(signatureBytes)
      console.log('Signing in...')
      await signIn({
        message: nonce.message,
        signature,
        publicKey,
      })
      console.log('Successfully authenticated!')
      return publicKey
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : 'Failed to connect wallet'
      setError(msg)
      console.error('Wallet auth error:', err)
      return null
    }
  }, [wallet, signIn])

  useEffect(() => {
    if (shouldSignRef.current && wallet.connected && wallet.publicKey) {
      shouldSignRef.current = false
      setLoading(true)
      performSignIn()
        .then((publicKey) => {
          if (publicKey) {
            navigate('/app')
          }
        })
        .finally(() => {
          setLoading(false)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.publicKey])

  const connect = useCallback(async () => {
    setError('')
    
    // Always show modal first unless already signing
    if (!loading) {
      shouldSignRef.current = true
      setShowWalletModal(true)
      return null
    }

    return null
  }, [loading, setShowWalletModal])

  return {
    connect,
    loading,
    error,
    clearError: () => setError(''),
  }
}
