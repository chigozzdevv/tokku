import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { roundsService, type Round } from '@/services/rounds.service'
import { betsService } from '@/services/bets.service'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } from '@solana/spl-token'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { buildRoundOptions, humanizeMarketType } from './round-utils'
import { ProbabilityChart } from '@/components/dashboard/probability-chart'
import { CountdownTimer } from '@/components/dashboard/countdown-timer'
import { config } from '@/config/env'

type SelectionState = Record<string, any>

const DEFAULT_SELECTIONS: Record<string, SelectionState> = {
  PICK_RANGE: { type: 'range', min: 1, max: 25 },
  EVEN_ODD: { type: 'parity', value: 'even' },
  LAST_DIGIT: { type: 'digit', value: 0 },
  MODULO_THREE: { type: 'modulo', value: 0 },
  PATTERN_OF_DAY: { type: 'pattern', patternId: 0 },
  SHAPE_COLOR: { type: 'shape', shape: 0, color: 0, size: 0 },
  JACKPOT: { type: 'single', value: 0 },
  ENTROPY_BATTLE: { type: 'entropy', source: 'tee' },
  STREAK_METER: { type: 'streak', target: 3 },
  COMMUNITY_SEED: { type: 'community', byte: 0 },
}

function getDefaultSelection(marketType: string): SelectionState {
  return { ...(DEFAULT_SELECTIONS[marketType] ?? { type: 'custom' }) }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function cloneSelection(value: SelectionState): SelectionState {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { ...value }
  }
}

function normalizeSelection(marketType: string, selection: SelectionState) {
  switch (marketType) {
    case 'PICK_RANGE':
      if (selection.type === 'single') {
        return { type: 'single', value: Number(selection.value ?? 1) }
      }
      return {
        type: 'range',
        min: Number(selection.min ?? 1),
        max: Number(selection.max ?? Number(selection.min ?? 1)),
      }
    default:
      return selection
  }
}

export function RoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const location = useLocation()
  const preload = (location.state as { selection?: SelectionState; highlight?: string } | null) ?? null
  const [round, setRound] = useState<Round | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stake, setStake] = useState('1')
  const [selection, setSelection] = useState<SelectionState>({})
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showAllOptions, setShowAllOptions] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmedSig, setConfirmedSig] = useState<string>('')
  type ProbabilitySnapshot = { timestamp: string; probabilities: { selection: any; probability: number; bets: number }[] }
  type ApiSuccess<T> = { success: boolean; data: T }
  const [probabilityHistory, setProbabilityHistory] = useState<ProbabilitySnapshot[]>([])
  const wallet = useWallet()
  const { connection } = useConnection()
  const lastConfirmedSigRef = useRef<string>('')
  const confirmingRef = useRef<boolean>(false)
  const getExplorerCluster = useCallback(() => {
    const url = config.SOLANA_RPC_URL || ''
    if (/testnet/i.test(url)) return 'testnet'
    if (/mainnet/i.test(url)) return 'mainnet'
    return 'devnet'
  }, [])
  const explorerTxUrl = useMemo(() => {
    if (!confirmedSig) return '#'
    const cluster = getExplorerCluster()
    const base = 'https://explorer.solana.com/tx/'
    return `${base}${confirmedSig}?cluster=${encodeURIComponent(cluster)}`
  }, [confirmedSig, getExplorerCluster])

  useEffect(() => {
    async function load() {
      if (!roundId) return
      try {
        const roundData = await roundsService.getRound(roundId)
        setRound(roundData)
        const historyRes = await api.get<ApiSuccess<ProbabilitySnapshot[]>>(`/rounds/${roundId}/probability-history`).catch(() => ({ success: true, data: [] } as ApiSuccess<ProbabilitySnapshot[]>))
        setProbabilityHistory((historyRes as ApiSuccess<ProbabilitySnapshot[]>).data)
      } catch (err) {
        console.error(err)
        setError('Unable to load round')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [roundId])

  const options = useMemo(() => (round ? buildRoundOptions(round) : []), [round])

  useEffect(() => {
    if (!round) return
    if (options.length === 0) {
      setSelection(getDefaultSelection(round.market.type))
      setSelectedOptionId('')
      return
    }
    const bySelection = preload?.selection
    if (bySelection) {
      const match = options.find((option) => JSON.stringify(option.selection) === JSON.stringify(bySelection))
      if (match) {
        setSelection(cloneSelection(match.selection))
        setSelectedOptionId(match.id)
        return
      }
    }
    const highlight = preload?.highlight
    if (highlight) {
      const match = options.find((option) => `${round.id}-${option.id}` === highlight)
      if (match) {
        setSelection(cloneSelection(match.selection))
        setSelectedOptionId(match.id)
        return
      }
    }
    const first = options[0]
    setSelection(cloneSelection(first.selection))
    setSelectedOptionId(first.id)
  }, [options, preload, round])

  const selectedOption = useMemo(() => options.find((option) => option.id === selectedOptionId) ?? null, [options, selectedOptionId])

  const ROUND_DURATION_SECONDS = Number(import.meta.env.VITE_ROUND_DURATION_SECONDS ?? 600)
  const ROUND_DURATION_MS = ROUND_DURATION_SECONDS * 1000

  const endsAt = useMemo(() => {
    if (!round) return new Date()
    const base = round.scheduledReleaseAt || round.openedAt
    if (!base) return new Date()
    const start = new Date(base).getTime()
    return new Date(start + ROUND_DURATION_MS)
  }, [round, ROUND_DURATION_MS])

  const probabilityData = useMemo(() => {
    if (!selectedOption || !round) return []

    if (probabilityHistory.length > 0) {
      const key = JSON.stringify(selectedOption.selection)
      return probabilityHistory.map((snap) => {
        const match = snap.probabilities.find(p => p.selection === key || JSON.stringify(p.selection) === key)
        return {
          time: new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          percentage: Math.round(((match?.probability ?? 0) + Number.EPSILON) * 100) / 100,
        }
      })
    }

    const now = Date.now()
    const openedAt = round.openedAt ? new Date(round.openedAt).getTime() : now
    const duration = now - openedAt
    const points = Math.min(12, Math.max(6, Math.floor(duration / 60000)))

    const data = []
    const currentPercentage = selectedOption ? (selectedOption.odds > 0 ? Math.min(95, (1 / selectedOption.odds) * 100) : 50) : 50

    for (let i = 0; i < points; i++) {
      const timeOffset = (duration / points) * i
      const minutes = Math.floor(timeOffset / 60000)

      const variance = Math.sin(i * 0.8) * 5
      const percentage = Math.max(5, Math.min(95, currentPercentage + variance - (points - i) * 2))

      data.push({
        time: minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`,
        percentage: Math.round(percentage * 100) / 100
      })
    }

    return data
  }, [probabilityHistory, selectedOption, round])

  const totalVolume = useMemo(() => {
    if (!round?.bets) return 0
    return round.bets.reduce((sum, bet) => sum + Number(bet.stake || 0), 0) / 1_000_000_000
  }, [round])



  const showByteInput = selectedOption?.selection?.type === 'community'
  const showEntropySelect = selectedOption?.selection?.type === 'entropy'
  const showRangeAdjust = selectedOption?.selection?.type === 'range'
  const showDigitInput = selectedOption?.selection?.type === 'digit'
  const showSingleInput = selectedOption?.selection?.type === 'single'
  const showModuloInput = selectedOption?.selection?.type === 'modulo'
  const showPatternSelect = selectedOption?.selection?.type === 'pattern'

  const handleBet = useCallback(async () => {
    if (submitting || confirmingRef.current) return
    if (!round || !roundId) return
    if (!wallet.connected || !wallet.publicKey) {
      setStatus('Connect your wallet first')
      return
    }
    const stakeValue = Number(stake)
    if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
      setStatus('Enter a valid stake amount in SOL')
      return
    }
    setSubmitting(true)
    setStatus('')
    try {
      const lamports = Math.round(stakeValue * 1_000_000_000)
      const payloadSelection = normalizeSelection(round.market.type, selection)
      const transactionPayload = await betsService.createTransaction({
        roundId,
        selection: payloadSelection,
        stake: lamports,
      })

      // If round is delegated to ER and mint is WSOL, ensure user's WSOL ATA is funded on base before bet
      const wsolMint = 'So11111111111111111111111111111111111111112'
      const mintAddr = (round.market as any)?.config?.mintAddress as string | undefined
      if (round.delegateTxHash && !round.undelegateTxHash && mintAddr === wsolMint) {
        const wsol = new PublicKey(wsolMint)
        const ata = await getAssociatedTokenAddress(wsol, wallet.publicKey!, false)
        const ataInfo = await connection.getAccountInfo(ata)
        const prep = new Transaction()
        if (!ataInfo) {
          prep.add(createAssociatedTokenAccountInstruction(wallet.publicKey!, ata, wallet.publicKey!, wsol))
        }
        prep.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey!, toPubkey: ata, lamports: lamports }))
        prep.add(createSyncNativeInstruction(ata))
        await wallet.sendTransaction(prep, connection, { skipPreflight: true, preflightCommitment: 'confirmed' })
      }

      // If server indicates vault ATA missing, create it on base before ER bet
      if (round.delegateTxHash && !round.undelegateTxHash && (transactionPayload as any)?.needsVaultAta && (transactionPayload as any)?.vaultPda && mintAddr) {
        try {
          const mintPk = new PublicKey(mintAddr)
          const vaultPda = new PublicKey((transactionPayload as any).vaultPda)
          const vaultAta = await getAssociatedTokenAddress(mintPk, vaultPda, true)
          const info = await connection.getAccountInfo(vaultAta)
          if (!info) {
            const tx = new Transaction().add(
              createAssociatedTokenAccountInstruction(wallet.publicKey!, vaultAta, vaultPda, mintPk)
            )
            await wallet.sendTransaction(tx, connection, { skipPreflight: true, preflightCommitment: 'confirmed' })
          }
        } catch (e) {
          console.warn('Vault ATA prep failed (will rely on existing account):', e)
        }
      }

      const txBytes = base64ToBytes(transactionPayload.transaction)
      let sig: string

      const isRoundDelegated = round.delegateTxHash && !round.undelegateTxHash
      const submitRpcUrl = (transactionPayload as any)?.submitRpcUrl as string | undefined

      const sendConn = submitRpcUrl
        ? new Connection(submitRpcUrl, { commitment: 'confirmed' })
        : (isRoundDelegated ? new Connection(config.EPHEMERAL_RPC_URL, { commitment: 'confirmed' }) : connection)
      try {
        const tx = Transaction.from(txBytes)
        try {
          const { blockhash, lastValidBlockHeight } = await sendConn.getLatestBlockhash()
          tx.recentBlockhash = blockhash
          ;(tx as any).lastValidBlockHeight = lastValidBlockHeight
          tx.feePayer = wallet.publicKey!
        } catch {}
        sig = await wallet.sendTransaction(tx, sendConn, { skipPreflight: true, preflightCommitment: 'confirmed' })
      } catch {
        const vtx = VersionedTransaction.deserialize(txBytes)
        sig = await wallet.sendTransaction(vtx, sendConn, { skipPreflight: true, preflightCommitment: 'confirmed' })
      }
      
      confirmingRef.current = true
      lastConfirmedSigRef.current = sig

      await betsService.confirmBet({
        roundId,
        selection: payloadSelection,
        stake: lamports,
        txSignature: sig,
        betPda: transactionPayload.betPda,
      })
      setConfirmedSig(sig)
      setShowConfirmModal(true)
      setStatus('')
    } catch (err: any) {
      console.error('Bet placement error:', err)
      console.error('Error details:', {
        message: err?.message,
        name: err?.name,
        logs: err?.logs,
        code: err?.code
      })
      const msg = typeof err?.message === 'string' ? err.message : 'Failed to place bet'
      setStatus(msg)
    } finally {
      confirmingRef.current = false
      setSubmitting(false)
    }
  }, [connection, round, roundId, selection, stake, submitting, wallet])

  if (loading) {
    return <div className="dashboard-panel">Loading round…</div>
  }

  if (error || !round) {
    return <div className="dashboard-panel">{error || 'Round not found'}</div>
  }

  const getStatusBadgeClass = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower === 'predicting') return 'status-badge predicting'
    if (statusLower === 'locked') return 'status-badge locked'
    if (statusLower === 'revealed') return 'status-badge revealed'
    if (statusLower === 'settled') return 'status-badge settled'
    return 'status-badge'
  }

  return (
    <div className="dashboard-round-layout-new">
      <section className="card dashboard-round-main">
        <div className="dashboard-round-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(185,246,201,0.15), rgba(185,246,201,0.05))', border: '1px solid rgba(185,246,201,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              🎲
            </div>
            <div>
              <h1 className="dashboard-title" style={{ marginBottom: '0.35rem' }}>{round.market.name}</h1>
              <p className="dashboard-subtitle">Round #{round.roundNumber} · {humanizeMarketType(round.market.type)}</p>
            </div>
          </div>
          <div className="dashboard-round-hero-meta">
            <div>
              <span className="dashboard-round-stat-label">Status</span>
              <span className={getStatusBadgeClass(round.status)}>{round.status}</span>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Time Left</span>
              <CountdownTimer endsAt={endsAt} compact={false} />
            </div>
          </div>
        </div>

        {selectedOption && probabilityData.length > 0 && (
          <div className="selection-chart-container">
            <div className="selection-chart-header">
              <div>
                <h3 className="selection-chart-title">{selectedOption.label}</h3>
                <span className="selection-chart-subtitle">Probability trend over time</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#62df98' }}>
                  {selectedOption.odds.toFixed(2)}x
                </div>
                <span className="selection-chart-subtitle">current odds</span>
              </div>
            </div>
            <ProbabilityChart data={probabilityData} height={240} color="#62df98" />

            <div className="outcome-cards-grid">
              <div className="outcome-card">
                <span className="outcome-card-label">Total Volume</span>
                <div className="outcome-card-value" style={{ color: '#62df98' }}>
                  {totalVolume.toFixed(4)} SOL
                </div>
              </div>
              <div className="outcome-card">
                <span className="outcome-card-label">Total Bets</span>
                <div className="outcome-card-value">{round._count?.bets ?? 0}</div>
              </div>
              <div className="outcome-card">
                <span className="outcome-card-label">Avg Bet Size</span>
                <div className="outcome-card-value">
                  {round._count?.bets ? (totalVolume / (round._count.bets)).toFixed(4) : '0.0000'} SOL
                </div>
              </div>
            </div>
          </div>
        )}

      </section>

      <aside className="card dashboard-round-sidebar">
        <h3 className="dashboard-panel-title">Place Bet</h3>

        <div className="dashboard-round-options">
          <span className="dashboard-round-stat-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Select Outcome</span>
          <div className="dashboard-round-option-grid" style={{ maxHeight: showAllOptions || options.length <= 4 ? 'none' : '320px', overflow: 'hidden', position: 'relative' }}>
            {(showAllOptions ? options : options.slice(0, 4)).map((option) => {
              const active = option.id === selectedOptionId
              return (
                <button
                  key={option.id}
                  className={['dashboard-round-option', active ? 'active' : ''].join(' ')}
                  onClick={() => {
                    setSelectedOptionId(option.id)
                    setSelection(cloneSelection(option.selection))
                  }}
                >
                  <div className="dashboard-round-option-body">
                    <strong>{option.label}</strong>
                    {option.coverage ? <span>{option.coverage}</span> : null}
                  </div>
                  <span className="dashboard-round-option-odds">{option.odds.toFixed(option.odds >= 10 ? 1 : 2)}x</span>
                </button>
              )
            })}
          </div>
          {options.length > 4 && (
            <button
              onClick={() => setShowAllOptions(!showAllOptions)}
              style={{
                width: '100%',
                marginTop: '0.75rem',
                padding: '0.65rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(185,246,201,0.08)'
                e.currentTarget.style.borderColor = 'rgba(185,246,201,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              {showAllOptions ? (
                <>Show Less <span style={{ fontSize: '0.7rem' }}>▲</span></>
              ) : (
                <>Show {options.length - 4} More Options <span style={{ fontSize: '0.7rem' }}>▼</span></>
              )}
            </button>
          )}
        </div>
        
        {selectedOption && (
          <div className="dashboard-bet-selection">
            <span className="dashboard-round-stat-label">Selected Option</span>
            <strong style={{ fontSize: '1.15rem', display: 'block', marginTop: '0.35rem', marginBottom: '0.5rem' }}>{selectedOption.label}</strong>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <strong style={{ color: '#62df98', fontSize: '1.4rem', fontWeight: 900 }}>{selectedOption.odds.toFixed(2)}x</strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>odds</span>
            </div>
          </div>
        )}

        {(showEntropySelect || showByteInput || showRangeAdjust || showDigitInput || showSingleInput || showModuloInput || showPatternSelect) && selectedOption ? (
          <div className="dashboard-form" style={{ marginTop: '1rem' }}>
            {showEntropySelect ? (
              <label>
                <span>Entropy source</span>
                <select
                  value={selection.source ?? 'tee'}
                  onChange={(event) => setSelection({ type: 'entropy', source: event.target.value })}
                >
                  <option value="tee">TEE</option>
                  <option value="chain">Chain</option>
                  <option value="sensor">Sensor</option>
                </select>
              </label>
            ) : null}
            {showDigitInput ? (
              <label>
                <span>Digit (0-9)</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={selection.value ?? 0}
                  onChange={(e) => setSelection({ type: 'digit', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showSingleInput ? (
              <label>
                <span>Value (1-100)</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={selection.value ?? 1}
                  onChange={(e) => setSelection({ type: 'single', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showModuloInput ? (
              <label>
                <span>Remainder (0-2)</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  value={selection.value ?? 0}
                  onChange={(e) => setSelection({ type: 'modulo', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showPatternSelect ? (
              <label>
                <span>Pattern</span>
                <select
                  value={selection.patternId ?? 0}
                  onChange={(e) => setSelection({ type: 'pattern', patternId: Number(e.target.value) })}
                >
                  <option value={0}>Prime</option>
                  <option value={1}>Fibonacci</option>
                  <option value={2}>Perfect Square</option>
                  <option value={3}>Ends in 7</option>
                  <option value={4}>Palindrome</option>
                  <option value={5}>Even</option>
                  <option value={6}>Odd</option>
                </select>
              </label>
            ) : null}
            {showByteInput ? (
              <label>
                <span>Target byte</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={selection.byte ?? 0}
                  onChange={(event) =>
                    setSelection({ ...selection, type: 'community', byte: Number(event.target.value) })
                  }
                />
              </label>
            ) : null}
            {showRangeAdjust ? (
              <>
                <label>
                  <span>Min</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={selection.min ?? 1}
                    onChange={(event) =>
                      setSelection({ ...selection, min: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>Max</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={selection.max ?? 10}
                    onChange={(event) =>
                      setSelection({ ...selection, max: Number(event.target.value) })
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="dashboard-form" style={{ marginTop: '1.5rem' }}>
          <label>
            <span>Stake Amount (SOL)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              placeholder="Enter amount"
            />
          </label>
        </div>

        {stake && selectedOption && !isNaN(Number(stake)) && Number(stake) > 0 && (
          <div className="dashboard-bet-calculator" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(185,246,201,0.05)', borderRadius: '12px', border: '1px solid rgba(185,246,201,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span className="dashboard-round-stat-label">Potential Win</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#62df98' }}>
                {(Number(stake) * selectedOption.odds).toFixed(4)} SOL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="dashboard-round-stat-label">Profit</span>
              <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)' }}>
                +{((Number(stake) * selectedOption.odds) - Number(stake)).toFixed(4)} SOL
              </span>
            </div>
          </div>
        )}

        <Button 
          variant="primary" 
          onClick={handleBet} 
          disabled={submitting || !wallet.connected} 
          style={{ width: '100%', marginTop: '1rem' }}
        >
          {submitting ? 'Submitting…' : 'Place Bet'}
        </Button>

        {status ? <div className="dashboard-status" style={{ marginTop: '0.75rem' }}>{status}</div> : null}
        {!wallet.connected ? <div className="dashboard-hint" style={{ marginTop: '0.75rem' }}>Connect your wallet to start betting</div> : null}

        {round.outcome && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <span className="dashboard-round-stat-label">Outcome</span>
            <code className="dashboard-code" style={{ display: 'block', marginTop: '0.5rem' }}>{JSON.stringify(round.outcome)}</code>
          </div>
        )}
      </aside>

      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ width: 'min(720px, 95vw)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.5rem', boxShadow: '0 18px 48px rgba(0,0,0,0.45)' }}>
            <h3 className="dashboard-title" style={{ marginBottom: '0.25rem' }}>Bet Confirmed</h3>
            <p className="dashboard-subtitle">Your bet was submitted successfully. You’ll see the result after the round settles.</p>

            <div style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '1rem', background: 'rgba(185,246,201,0.06)' }}>
                <div>
                  <span className="dashboard-round-stat-label">Market</span>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{round.market.name}</div>
                </div>
                <div>
                  <span className="dashboard-round-stat-label">Round</span>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>#{round.roundNumber}</div>
                </div>
                <div>
                  <span className="dashboard-round-stat-label">Selection</span>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{selectedOption?.label ?? '—'}</div>
                </div>
                <div>
                  <span className="dashboard-round-stat-label">Odds</span>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{(selectedOption?.odds ?? 0).toFixed(2)}x</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '1rem' }}>
                <div>
                  <span className="dashboard-round-stat-label">Stake</span>
                  <div style={{ fontWeight: 800, marginTop: 4 }}>{(Number(stake) || 0).toFixed(4)} SOL</div>
                </div>
                <div>
                  <span className="dashboard-round-stat-label">Potential Win</span>
                  <div style={{ fontWeight: 800, marginTop: 4, color: '#62df98' }}>{(((Number(stake) || 0) * (selectedOption?.odds ?? 0)) || 0).toFixed(4)} SOL</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <span className="dashboard-round-stat-label">Transaction</span>
              <code className="dashboard-code" style={{ display: 'block', marginTop: '0.4rem', wordBreak: 'break-all' }}>{confirmedSig}</code>
              <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <a className="link" href={explorerTxUrl} target="_blank" rel="noreferrer">View on Explorer</a>
                <button
                  aria-label="Copy transaction hash"
                  title="Copy transaction hash"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer'
                  }}
                  onClick={() => { navigator.clipboard.writeText(confirmedSig).catch(() => {}); }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="9" y="9" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                    <rect x="5" y="3" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.25rem', gap: '0.5rem' }}>
              <Button variant="primary" onClick={() => { window.location.href = '/app/bets' }}>View Bets</Button>
              <Button variant="ghost" onClick={() => setShowConfirmModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
