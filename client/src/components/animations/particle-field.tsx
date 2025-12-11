import { useEffect, useRef, useState } from 'react'

type Particle = {
  lane: number
  u: number
  baseY: number
  amp: number
  speed: number
  size: number
  phase: number
}

const TAU = Math.PI * 2

function createRng(seed = 0xa5f12e31) {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0xffffffff
  }
}

export function ParticleField() {
  const [enabled, setEnabled] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  const rngRef = useRef(createRng(0x517cc1))
  const colorRef = useRef('#b9f6c9')
  const hiddenRef = useRef(false)
  const pausedRef = useRef(false)
  const lastTsRef = useRef(0)
  const fpsIntervalRef = useRef(1000 / 45)
  const prefersReducedRef = useRef(false)
  const isMobileRef = useRef(false)
  const particlesRef = useRef<Particle[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mqMobile = window.matchMedia('(max-width: 640px)')
    const mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setEnabled(!(mqMobile.matches || mqReduced.matches))
    update()
    mqMobile.addEventListener?.('change', update)
    mqReduced.addEventListener?.('change', update)
    return () => {
      mqMobile.removeEventListener?.('change', update)
      mqReduced.removeEventListener?.('change', update)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const setReduced = () => { prefersReducedRef.current = !!mql.matches }
    setReduced()
    mql.addEventListener?.('change', setReduced)

    try {
      if (window.crypto && 'getRandomValues' in window.crypto) {
        const buf = new Uint32Array(1)
        window.crypto.getRandomValues(buf)
        rngRef.current = createRng(buf[0] || 0x517cc1)
      } else {
        const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
        rngRef.current = createRng(seed || 0x517cc1)
      }
    } catch {
      const seed = (Date.now() ^ 0x517cc1) >>> 0
      rngRef.current = createRng(seed)
    }

    const initParticles = (w: number, h: number) => {
      const lanes = prefersReducedRef.current || isMobileRef.current ? 3 : 4
      const particles: Particle[] = []
      const minDim = Math.min(w, h)
      const centerY = h * 0.55
      const bandHeight = minDim * 0.18

      for (let lane = 0; lane < lanes; lane++) {
        const laneNorm = lanes > 1 ? lane / (lanes - 1) : 0.5
        const baseY = centerY - bandHeight * 0.7 + laneNorm * bandHeight * 1.4
        const ampBase = minDim * 0.04 + laneNorm * minDim * 0.03
        const amp = ampBase * (0.7 + rngRef.current() * 0.6)
        const countBase = prefersReducedRef.current ? 18 : 26
        const count = countBase + lane * 4

        for (let i = 0; i < count; i++) {
          const u = (i + rngRef.current() * 0.9) / count
          const speed = 0.08 + rngRef.current() * 0.22
          const size = 0.8 + rngRef.current() * 1.4
          const phase = rngRef.current() * TAU
          particles.push({ lane, u, baseY, amp, speed, size, phase })
        }
      }

      particlesRef.current = particles
    }

    const onResize = () => {
      const realDpr = window.devicePixelRatio || 1
      const rect = canvas.parentElement?.getBoundingClientRect()
      const w = Math.floor(rect?.width || window.innerWidth)
      const h = Math.floor(rect?.height || window.innerHeight)
      let dpr = Math.min(1.5, realDpr)
      if (w <= 480 || w * h > 1_400_000) dpr = 1
      isMobileRef.current = w <= 768
      fpsIntervalRef.current = prefersReducedRef.current || isMobileRef.current ? 1000 / 30 : 1000 / 45
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      centerRef.current = { x: w / 2, y: h * 0.55 }
      colorRef.current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b9f6c9'
      initParticles(w, h)
    }

    const tick = (ts?: number) => {
      if (hiddenRef.current || pausedRef.current) {
        rafRef.current = null
        return
      }
      const now = ts ?? performance.now()
      const interval = fpsIntervalRef.current
      if (now - lastTsRef.current < interval) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const dtMs = now - lastTsRef.current || interval
      lastTsRef.current = now
      const dt = Math.min(0.05, dtMs / 1000)
      const t = now * 0.001
      const { x: cx, y: cy } = centerRef.current
      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)

      ctx.clearRect(0, 0, w, h)

      const mint = colorRef.current
      ctx.fillStyle = mint
      ctx.shadowColor = mint
      ctx.shadowBlur = prefersReducedRef.current || isMobileRef.current ? 1 : 3

      const particles = particlesRef.current
      const sizeAmp = prefersReducedRef.current ? 0.22 : 0.32
      const travelFactor = prefersReducedRef.current ? 0.55 : 0.8

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        p.u += p.speed * travelFactor * dt
        if (p.u > 1) p.u -= 1
        const pathX = p.u * (w + 220) - 110

        const laneTilt = (p.lane % 2 === 0 ? 1 : -1) * 0.06
        const baseY = p.baseY + laneTilt * (pathX - cx) * 0.015

        const waveArg = pathX * 0.018 + t * 1.4 + p.phase
        const wave = Math.sin(waveArg)
        const y = baseY + p.amp * wave

        const band = Math.sin((y - cy) * 0.018 - t * 0.8 + p.phase * 0.5)
        const flicker = Math.sin(t * 1.4 + p.phase + i * 0.11)
        const pulse = 0.6 + sizeAmp * (band * 0.7 + flicker * 0.3)
        const r = Math.max(0.4, p.size * pulse * (isMobileRef.current ? 0.85 : 1))

        ctx.beginPath()
        ctx.arc(pathX, y, r, 0, TAU)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    const onVisibility = () => {
      hiddenRef.current = document.hidden
      if (!hiddenRef.current && !rafRef.current) rafRef.current = requestAnimationFrame(tick)
      if (hiddenRef.current && rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
    const onIntersect: IntersectionObserverCallback = ([entry]) => {
      pausedRef.current = !entry.isIntersecting
      if (!pausedRef.current && !rafRef.current && !hiddenRef.current) rafRef.current = requestAnimationFrame(tick)
      if (pausedRef.current && rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
    const io = new IntersectionObserver(onIntersect, { threshold: 0.01 })
    io.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onResize)
    onResize()
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      mql.removeEventListener?.('change', setReduced)
    }
  }, [enabled])

  if (!enabled) return null
  return <canvas ref={canvasRef} aria-hidden className="particle-wrap" />
}

