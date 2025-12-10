import { useEffect, useState } from 'react'

type CountdownTimerProps = {
  endsAt: Date | string
  compact?: boolean
  showIcon?: boolean
}

export function CountdownTimer({ endsAt, compact = false }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    const calculateTimeLeft = () => {
      const endTime = typeof endsAt === 'string' ? new Date(endsAt).getTime() : endsAt.getTime()
      const now = Date.now()
      const remaining = Math.max(0, endTime - now)
      setTimeLeft(remaining)
      setUrgent(remaining > 0 && remaining < 60 * 1000)
    }

    calculateTimeLeft()
    const interval = setInterval(calculateTimeLeft, 1000)
    return () => clearInterval(interval)
  }, [endsAt])

  if (timeLeft <= 0) {
    return <span className={`countdown expired ${compact ? 'countdown-compact' : ''}`}>Closing</span>
  }

  const minutes = Math.floor(timeLeft / 1000 / 60)
  const seconds = Math.floor((timeLeft / 1000) % 60)

  const displayText = compact
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}m ${seconds.toString().padStart(2, '0')}s`

  return (
    <span className={`countdown ${urgent ? 'urgent' : 'normal'} ${compact ? 'countdown-compact' : ''}`}>
      {displayText}
    </span>
  )
}
