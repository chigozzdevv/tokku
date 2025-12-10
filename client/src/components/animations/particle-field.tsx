import { useEffect, useRef, useState } from 'react'

type Phase = 'field' | 'gather' | 'scatter'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  tx: number
  ty: number
}

const TAU = Math.PI * 2

function createRng(seed = 0xA5F12E31) {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 0xffffffff)
  }
}

export function ParticleField() {
  const [enabled, setEnabled] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const phaseRef = useRef<Phase>('gather')
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  const rng = useRef(createRng(0x517cc1))
  const tRef = useRef(0)
  const colorRef = useRef<string>('#b9f6c9')
  const hiddenRef = useRef<boolean>(false)
  const frameRef = useRef<number>(0)
  const pausedRef = useRef<boolean>(false)
  const lastTsRef = useRef<number>(0)
  const isMobileRef = useRef<boolean>(false)
  const fpsIntervalRef = useRef<number>(1000 / 45)
  const prefersReducedRef = useRef<boolean>(false)

  // Disable particles on small screens and when user prefers reduced motion
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
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: true })!
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const setReduced = () => { prefersReducedRef.current = !!mql.matches }
    setReduced()
    mql.addEventListener?.('change', setReduced)

    const onResize = () => {
      const realDpr = window.devicePixelRatio || 1
      const rect = canvas.parentElement?.getBoundingClientRect()
      const w = Math.floor((rect?.width || window.innerWidth))
      const h = Math.floor((rect?.height || window.innerHeight))
      let dpr = Math.min(1.5, realDpr)
      if (w <= 480 || (w * h) > 1_400_000) dpr = 1
      isMobileRef.current = w <= 640
      fpsIntervalRef.current = prefersReducedRef.current || isMobileRef.current ? (1000 / 30) : (1000 / 45)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      centerRef.current = { x: w / 2, y: h / 2 }
      colorRef.current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b9f6c9'
      if (particlesRef.current.length === 0) initParticles(w, h)
      updateTargets()
    }

    const initParticles = (w: number, h: number) => {
      const base = Math.floor((w * h) / 14000)
      const cap = 300
      let count = Math.min(cap, base)
      if (w <= 480) count = Math.floor(count * 0.4)
      else if (w <= 768) count = Math.floor(count * 0.65)
      if (prefersReducedRef.current) count = Math.floor(count * 0.5)
      const arr: Particle[] = []
      for (let i = 0; i < count; i++) {
        arr.push({
          x: rng.current() * w,
          y: rng.current() * h,
          vx: (rng.current() - 0.5) * 0.25,
          vy: (rng.current() - 0.5) * 0.25,
          r: rng.current() * (isMobileRef.current ? 0.9 : 1.0) + 0.4,
          tx: 0,
          ty: 0,
        })
      }
      particlesRef.current = arr
    }

    const updateTargets = () => {
      const { x: cx, y: cy } = centerRef.current
      const n = particlesRef.current.length
      const radius = Math.min(canvas.width, canvas.height) / (window.devicePixelRatio || 1) * 0.34
      const rings = Math.max(2, Math.round(Math.sqrt(n) * 0.9))
      const totalWeight = (rings * (rings + 1)) / 2
      let idx = 0
      let placed = 0
      for (let k = 1; k <= rings; k++) {
        let count = Math.max(1, Math.round((n * k) / totalWeight))
        if (k === rings) count = n - placed
        const r = (radius * k) / rings
        for (let j = 0; j < count && idx < n; j++) {
          const theta = (2 * Math.PI * j) / count
          particlesRef.current[idx].tx = cx + r * Math.cos(theta)
          particlesRef.current[idx].ty = cy + r * Math.sin(theta)
          idx++
        }
        placed = idx
      }
    }

    const vectorField = (x: number, y: number, t: number) => {
      const s = Math.sin, c = Math.cos
      const k1 = 0.0009, k2 = 0.0013
      const a = s(x * k1 + t * 0.6) + c(y * k2 - t * 0.4)
      const b = c(x * k2 - t * 0.25) - s(y * k1 + t * 0.5)
      return { x: a, y: b }
    }

    const tick = (ts?: number) => {
      if (hiddenRef.current || pausedRef.current) { rafRef.current = null; return }
      const now = ts ?? performance.now()
      const fpsInterval = fpsIntervalRef.current
      if (now - lastTsRef.current < fpsInterval) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastTsRef.current = now
      const { x: cx, y: cy } = centerRef.current
      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)

      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, w, h)

      const mint = colorRef.current
      ctx.fillStyle = mint
      ctx.shadowColor = mint
      ctx.shadowBlur = isMobileRef.current || prefersReducedRef.current ? 1 : 2

      tRef.current += 0.016
      ctx.beginPath()
      for (const p of particlesRef.current) {
        if (phaseRef.current === 'gather') {
          const dx = p.tx - p.x
          const dy = p.ty - p.y
          const dist = Math.hypot(dx, dy) + 1e-4
          const force = Math.min(0.014, 18 / (dist * dist))
          p.vx += dx * force
          p.vy += dy * force
          p.vx *= 0.90
          p.vy *= 0.90
        } else if (phaseRef.current === 'field') {
          const f = vectorField(p.x - cx, p.y - cy, tRef.current)
          p.vx += f.x * 0.10
          p.vy += f.y * 0.10
          p.vx *= 0.978
          p.vy *= 0.978
        } else { // scatter
          const dx = p.x - cx
          const dy = p.y - cy
          const dist = Math.hypot(dx, dy) + 1e-4
          const push = Math.min(0.017, 12 / (dist * 12))
          p.vx += (dx / dist) * push + (rng.current() - 0.5) * 0.05
          p.vy += (dy / dist) * push + (rng.current() - 0.5) * 0.05
          p.vx *= 0.985
          p.vy *= 0.985
        }

        p.x += p.vx
        p.y += p.vy

        if (p.x < -5) p.x = w + 5
        if (p.x > w + 5) p.x = -5
        if (p.y < -5) p.y = h + 5
        if (p.y > h + 5) p.y = -5

        ctx.moveTo(p.x + p.r, p.y)
        ctx.arc(p.x, p.y, p.r, 0, TAU)
      }
      ctx.fill()

      frameRef.current++
      if (!isMobileRef.current && !prefersReducedRef.current && (frameRef.current & 1) === 0) {
        ctx.shadowBlur = 0
        ctx.globalAlpha = 0.18
        ctx.strokeStyle = mint
        ctx.lineWidth = 0.5
        for (let i = 0; i < particlesRef.current.length; i += 10) {
          const a = particlesRef.current[i]
          const b = particlesRef.current[(i + 1) % particlesRef.current.length]
          const c = particlesRef.current[(i + 5) % particlesRef.current.length]
          if (a && b) {
            const dx = a.x - b.x, dy = a.y - b.y
            const d2 = dx*dx + dy*dy
            if (d2 < 3600) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
          }
          if (a && c) {
            const dx2 = a.x - c.x, dy2 = a.y - c.y
            const d2b = dx2*dx2 + dy2*dy2
            if (d2b < 3600) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke() }
          }
        }
        ctx.globalAlpha = 1
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    const cycle = () => {
      const order: Phase[] = ['gather', 'field', 'scatter']
      const next = order[(order.indexOf(phaseRef.current) + 1) % order.length]
      phaseRef.current = next
      if (next === 'gather') updateTargets()
    }

    const interval = window.setInterval(cycle, 3800)
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
      window.clearInterval(interval)
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
    }
  }, [enabled])

  if (!enabled) return null
  return <canvas ref={canvasRef} aria-hidden className="particle-wrap" />
}
