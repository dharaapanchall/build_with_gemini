import { useEffect, useRef } from 'react'
import './landing.css'
import courtImg from './assets/Court.jpg'

const COURT_IMG = courtImg

export default function Landing({ children }) {
  const ballCanvasRef = useRef(null)
  const radarCanvasRef = useRef(null)
  const courtBgRef = useRef(null)

  // Set court background on mount
  useEffect(() => {
    const courtBg = courtBgRef.current
    if (courtBg && COURT_IMG) {
      courtBg.style.backgroundImage = `url(${COURT_IMG})`
      setTimeout(() => { courtBg.style.opacity = '1' }, 100)
    }
  }, [])

  // ── REALISTIC TENNIS BALL + ARC PHYSICS ──
  useEffect(() => {
    const ballCanvas = ballCanvasRef.current
    if (!ballCanvas) return
    const bctx = ballCanvas.getContext('2d')
    const R = 26
    const D = R * 2 + 16
    ballCanvas.width = D
    ballCanvas.height = D

    // Pre-bake fuzz dots so they don't shimmer each frame
    const fuzzDots = Array.from({ length: 180 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: Math.random() * R * 0.95,
      size: Math.random() * 1.6 + 0.2,
      alpha: Math.random() * 0.07 + 0.01
    }))

    function drawTennisBall(rotation) {
      bctx.clearRect(0, 0, D, D)
      const cx = D / 2, cy = D / 2

      // Drop shadow
      bctx.save()
      bctx.shadowColor = 'rgba(0,0,0,0.55)'
      bctx.shadowBlur = 14
      bctx.shadowOffsetY = 6
      bctx.shadowOffsetX = 2

      // Base gradient — yellow-green felt
      const grad = bctx.createRadialGradient(cx - R * 0.28, cy - R * 0.28, R * 0.05, cx, cy, R)
      grad.addColorStop(0, '#e8ff52')
      grad.addColorStop(0.3, '#ccf030')
      grad.addColorStop(0.7, '#a8cc18')
      grad.addColorStop(1, '#7a9a08')
      bctx.beginPath()
      bctx.arc(cx, cy, R, 0, Math.PI * 2)
      bctx.fillStyle = grad
      bctx.fill()
      bctx.restore()

      // Clip for interior details
      bctx.save()
      bctx.beginPath()
      bctx.arc(cx, cy, R, 0, Math.PI * 2)
      bctx.clip()

      // Felt fuzz (pre-baked positions, stable)
      for (const d of fuzzDots) {
        const fx = cx + Math.cos(d.angle) * d.dist
        const fy = cy + Math.sin(d.angle) * d.dist
        bctx.beginPath()
        bctx.arc(fx, fy, d.size, 0, Math.PI * 2)
        bctx.fillStyle = `rgba(255,255,255,${d.alpha})`
        bctx.fill()
      }

      // Seams — rotate with ball spin
      bctx.save()
      bctx.translate(cx, cy)
      bctx.rotate(rotation)

      const seamColor = 'rgba(255,255,255,0.78)'
      const seamWidth = 2.2

      // Seam 1 — top curve
      bctx.beginPath()
      bctx.moveTo(-R * 0.88, -R * 0.12)
      bctx.bezierCurveTo(-R * 0.38, -R * 0.7, R * 0.38, -R * 0.7, R * 0.88, -R * 0.12)
      bctx.strokeStyle = seamColor
      bctx.lineWidth = seamWidth
      bctx.lineCap = 'round'
      bctx.stroke()

      // Seam 1 — bottom curve
      bctx.beginPath()
      bctx.moveTo(-R * 0.88, R * 0.12)
      bctx.bezierCurveTo(-R * 0.38, R * 0.7, R * 0.38, R * 0.7, R * 0.88, R * 0.12)
      bctx.stroke()

      // Seam 2 (perpendicular)
      bctx.rotate(Math.PI / 2)
      bctx.beginPath()
      bctx.moveTo(-R * 0.88, -R * 0.12)
      bctx.bezierCurveTo(-R * 0.38, -R * 0.7, R * 0.38, -R * 0.7, R * 0.88, -R * 0.12)
      bctx.stroke()
      bctx.beginPath()
      bctx.moveTo(-R * 0.88, R * 0.12)
      bctx.bezierCurveTo(-R * 0.38, R * 0.7, R * 0.38, R * 0.7, R * 0.88, R * 0.12)
      bctx.stroke()

      bctx.restore()

      // Specular — soft highlight top-left
      const spec = bctx.createRadialGradient(cx - R * 0.32, cy - R * 0.34, 1, cx - R * 0.15, cy - R * 0.15, R * 0.6)
      spec.addColorStop(0, 'rgba(255,255,255,0.32)')
      spec.addColorStop(0.5, 'rgba(255,255,255,0.06)')
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      bctx.fillStyle = spec
      bctx.fillRect(-R, -R, R * 2, R * 2)

      bctx.restore()
    }

    // ── TENNIS RALLY PHYSICS — TOP ↕ BOTTOM ──
    const W = () => window.innerWidth
    const H = () => window.innerHeight

    const topBaseline    = () => H() * 0.06
    const bottomBaseline = () => H() * 0.94
    const netY           = () => H() * 0.50
    const centerX        = () => W() * 0.5

    let bx = centerX()
    let by = bottomBaseline()
    let bRot = 0

    let preT = 0, postT = 0
    let currentPhase = 'pre'
    let goingUp = true

    let sx, sy, ex, ey, bncX, bncY, apexX, apexY
    let postApexX, postApexY

    function bezier2(p0, p1, p2, t) {
      return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2
    }

    let pauseTimer = null

    function startShot(fromBottom) {
      const xVariance  = (Math.random() - 0.5) * W() * 0.35
      const xVariance2 = (Math.random() - 0.5) * W() * 0.35

      if (fromBottom) {
        sx   = centerX() + xVariance
        sy   = bottomBaseline()
        ex   = centerX() + xVariance2
        ey   = topBaseline()
        bncX = centerX() + (xVariance + xVariance2) * 0.5 + (Math.random() - 0.5) * W() * 0.1
        bncY = netY() - H() * 0.04
        apexX = sx + (bncX - sx) * 0.4
        apexY = netY() - H() * 0.28
        postApexX = bncX + (ex - bncX) * 0.5
        postApexY = bncY - H() * 0.14
      } else {
        sx   = centerX() + xVariance
        sy   = topBaseline()
        ex   = centerX() + xVariance2
        ey   = bottomBaseline()
        bncX = centerX() + (xVariance + xVariance2) * 0.5 + (Math.random() - 0.5) * W() * 0.1
        bncY = netY() + H() * 0.04
        apexX = sx + (bncX - sx) * 0.4
        apexY = netY() - H() * 0.28
        postApexX = bncX + (ex - bncX) * 0.5
        postApexY = bncY - H() * 0.14
      }

      preT = 0; postT = 0
      currentPhase = 'pre'
      goingUp = fromBottom
    }

    startShot(true)

    const PRE_SPEED  = 0.020
    const POST_SPEED = 0.017

    let rafId

    function ballLoop() {
      if (currentPhase === 'pre') {
        preT = Math.min(preT + PRE_SPEED, 1)
        bx = bezier2(sx, apexX, bncX, preT)
        by = bezier2(sy, apexY, bncY, preT)
        if (preT >= 1) {
          currentPhase = 'post'
          bx = bncX; by = bncY
          bRot += (30 + Math.random() * 40) * Math.PI / 180
        }
      } else if (currentPhase === 'post') {
        postT = Math.min(postT + POST_SPEED, 1)
        bx = bezier2(bncX, postApexX, ex, postT)
        by = bezier2(bncY, postApexY, ey, postT)
        if (postT >= 1) {
          bx = ex; by = ey
          currentPhase = 'pause'
          bRot += (30 + Math.random() * 40) * Math.PI / 180
          pauseTimer = setTimeout(() => startShot(!goingUp), 80 + Math.random() * 140)
        }
      }

      const distFromNet = Math.abs(by - netY())
      const maxDist = H() * 0.5
      const scale = 0.65 + (distFromNet / maxDist) * 0.5
      const displaySize = D * scale

      const clampedBx = Math.max(displaySize, Math.min(W() - displaySize, bx))

      ballCanvas.style.left    = (clampedBx - displaySize / 2) + 'px'
      ballCanvas.style.top     = (by - displaySize / 2) + 'px'
      ballCanvas.style.width   = displaySize + 'px'
      ballCanvas.style.height  = displaySize + 'px'
      ballCanvas.style.opacity = currentPhase === 'pause' ? '0' : '0.85'

      drawTennisBall(bRot)
      rafId = requestAnimationFrame(ballLoop)
    }

    ballLoop()

    return () => {
      cancelAnimationFrame(rafId)
      if (pauseTimer) clearTimeout(pauseTimer)
    }
  }, [])

  // ── RADAR CHART ──
  useEffect(() => {
    const canvas = radarCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cx = 140, cy = 140, r = 110
    const labels = ['Power', 'Accuracy', 'Spin', 'Footwork', 'Form', 'Mental']
    const data = [0.85, 0.74, 0.63, 0.72, 0.82, 0.68]
    const n = labels.length

    function getPoint(i, ratio) {
      const angle = (i * 2 * Math.PI / n) - Math.PI / 2
      return { x: cx + ratio * r * Math.cos(angle), y: cy + ratio * r * Math.sin(angle) }
    }

    // Grid rings
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const p = getPoint(i, ring / 4)
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Axes
    for (let i = 0; i < n; i++) {
      const p = getPoint(i, 1)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.stroke()
    }

    // Data fill
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const p = getPoint(i, data[i])
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(200,241,53,0.12)'
    ctx.fill()
    ctx.strokeStyle = '#c8f135'
    ctx.lineWidth = 2
    ctx.stroke()

    // Points
    for (let i = 0; i < n; i++) {
      const p = getPoint(i, data[i])
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#c8f135'
      ctx.fill()
    }

    // Labels
    ctx.fillStyle = 'rgba(240,239,232,0.5)'
    ctx.font = '10px DM Mono, monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i < n; i++) {
      const p = getPoint(i, 1.2)
      ctx.fillText(labels[i], p.x, p.y + 4)
    }
  }, [])

  return (
    <>
      {/* Court photo background */}
      <div id="court-bg" ref={courtBgRef}></div>

      {/* Cursor elements (hidden via CSS) */}
      <div className="cursor" id="cursor"></div>
      <div className="cursor-ring" id="cursorRing"></div>

      {/* Realistic tennis ball canvas — behind all content */}
      <canvas
        ref={ballCanvasRef}
        id="scrollBall"
        width="56"
        height="56"
        style={{ position: 'fixed', zIndex: 1, pointerEvents: 'none', willChange: 'transform' }}
      ></canvas>

      {/* NAV */}
      <nav>
        <a href="#" className="nav-logo">ACE<span>.</span></a>
        <ul className="nav-links">
          <li><a href="#analyze">Analyze</a></li>
          <li><a href="#shots">Shots</a></li>
          <li><a href="#injury">Recovery</a></li>
          <li><a href="#tech">Tech</a></li>
          <li><a href="#upload" className="nav-cta">Upload Clip</a></li>
        </ul>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-bg"></div>
        <div className="court-lines"></div>

        <div className="hero-left">
          <div className="hero-tag">AI-Powered · Real-time Analysis</div>
          <h1 className="hero-title">
            PLAY<br />
            <span className="italic-title">smarter,</span><br />
            WIN <span className="accent">MORE</span>
          </h1>
          <p className="hero-sub">
            Upload your match footage. Gemini AI analyzes every shot, position,
            and movement in real-time — with Veo-generated multi-angle views and
            voice coaching synced frame-by-frame.
          </p>

          <div className="hero-stats">
            <div className="stat-item">
              <div className="stat-num">340+</div>
              <div className="stat-label">Data points / frame</div>
            </div>
            <div className="stat-item">
              <div className="stat-num">0.03s</div>
              <div className="stat-label">Reaction latency</div>
            </div>
          </div>
        </div>

        <div className="hero-right"></div>
      </section>

      {/* FEATURES */}
      <section className="features-section" id="analyze">
        <div className="section-label">Core Features</div>
        <h2 className="section-title">EVERY DETAIL.<br />EVERY FRAME.</h2>
        <p className="section-desc">From grip angle to footwork, ACE dissects your game at the sub-frame level using Google's most advanced AI models.</p>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon lime">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="4" r="2"/><line x1="12" y1="6" x2="12" y2="12"/>
                <line x1="9" y1="9" x2="15" y2="9"/><line x1="12" y1="12" x2="9" y2="18"/>
                <line x1="12" y1="12" x2="15" y2="18"/>
              </svg>
            </div>
            <div className="feature-name">Form Analysis</div>
            <div className="feature-desc">Posture, grip, swing path, and foot positioning evaluated against pro benchmarks. Real-time overlay shows correction zones.</div>
            <div className="feature-tags">
              <span className="tag">Gemini Vision</span>
              <span className="tag">Skeleton Tracking</span>
              <span className="tag">Live Overlay</span>
            </div>
          </div>

          <div className="feature-card clay">
            <div className="feature-icon clay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="6" width="18" height="12" rx="2"/>
                <path d="M9 12h6M9 15h6M9 9h6"/>
              </svg>
            </div>
            <div className="feature-name">Shot Mechanics</div>
            <div className="feature-desc">Power, direction, spin, and contact point analysis. See exactly where on the racket you struck — and where you should have.</div>
            <div className="feature-tags">
              <span className="tag">Ball Tracking</span>
              <span className="tag">Physics Model</span>
              <span className="tag">Racket Contact</span>
            </div>
          </div>

          <div className="feature-card teal-card">
            <div className="feature-icon teal">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
              </svg>
            </div>
            <div className="feature-name">Multi-Angle Views</div>
            <div className="feature-desc">Veo and Nano generate alternate camera perspectives from your single clip — birds-eye, side-court, and slow-motion replay.</div>
            <div className="feature-tags">
              <span className="tag">Veo Generation</span>
              <span className="tag">Nano Model</span>
              <span className="tag">12 Views</span>
            </div>
          </div>

          <div className="feature-card red-card">
            <div className="feature-icon red">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M2 12h20"/>
              </svg>
            </div>
            <div className="feature-name">Injury Risk Report</div>
            <div className="feature-desc">Biomechanical stress detection on wrists, shoulders, knees, and ankles. Catch overuse patterns before they become injuries.</div>
            <div className="feature-tags">
              <span className="tag">Stress Detection</span>
              <span className="tag">Recovery Plan</span>
              <span className="tag">Risk Score</span>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-icon purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            </div>
            <div className="feature-name">TTS Voice Coaching</div>
            <div className="feature-desc">Google TTS delivers frame-synced audio coaching. Hear feedback at exactly the moment it matters — no reading required.</div>
            <div className="feature-tags">
              <span className="tag">Google TTS</span>
              <span className="tag">Frame-Synced</span>
              <span className="tag">Custom Voice</span>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-icon orange">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="6"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
            </div>
            <div className="feature-name">Shot Alternatives</div>
            <div className="feature-desc">AI suggests the optimal shot you could have played — cross-court winner, drop shot, lob — visualized with trajectory overlays.</div>
            <div className="feature-tags">
              <span className="tag">Decision AI</span>
              <span className="tag">Trajectory Viz</span>
              <span className="tag">Strategy</span>
            </div>
          </div>
        </div>
      </section>

      {/* UPLOAD CTA — children (App analyzer) injected here */}
      <section className="upload-section" id="upload">
        <div className="section-label">Get Started</div>
        <h2 className="section-title">ANALYZE YOUR<br />NEXT MATCH</h2>
        {children}
      </section>

      {/* SHOT ANALYSIS */}
      <section id="shots" style={{ padding: '100px 48px' }}>
        <div className="analysis-section">
          <div>
            <div className="section-label">Shot Intelligence</div>
            <h2 className="section-title">DISSECT<br />EVERY<br />SWING</h2>
            <p className="section-desc">Six dimensions of shot quality, measured on every single stroke. Your personal radar chart evolves as you play more matches.</p>

            <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="mini-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                  <span>Racket Contact Precision</span><span style={{ color: 'var(--lime)' }}>88%</span>
                </div>
                <div className="bar-track" style={{ height: '4px' }}><div className="bar-fill" style={{ '--w': '88%' }}></div></div>
              </div>
              <div className="mini-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                  <span>Ball Direction Control</span><span style={{ color: 'var(--clay)' }}>71%</span>
                </div>
                <div className="bar-track" style={{ height: '4px' }}><div className="bar-fill" style={{ '--w': '71%', background: 'var(--clay)' }}></div></div>
              </div>
              <div className="mini-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                  <span>Spin Generation</span><span style={{ color: 'var(--teal)' }}>63%</span>
                </div>
                <div className="bar-track" style={{ height: '4px' }}><div className="bar-fill" style={{ '--w': '63%', background: 'var(--teal)' }}></div></div>
              </div>
              <div className="mini-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                  <span>Follow-Through</span><span style={{ color: 'var(--lime)' }}>79%</span>
                </div>
                <div className="bar-track" style={{ height: '4px' }}><div className="bar-fill" style={{ '--w': '79%' }}></div></div>
              </div>
            </div>
          </div>

          <div className="analysis-visual">
            <div className="radar-wrap">
              <canvas ref={radarCanvasRef} id="radarChart" width="280" height="280"></canvas>
            </div>
          </div>
        </div>
      </section>

      {/* INJURY TRACKER */}
      <section className="injury-section" id="injury">
        <div className="section-label">Recovery Intelligence</div>
        <h2 className="section-title">PROTECT<br />YOUR BODY</h2>
        <p className="section-desc">Movement pattern analysis detects biomechanical stress before pain sets in. Your personal injury prevention coach.</p>

        <div className="injury-layout">
          <div className="body-map-wrap">
            <p style={{ fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '24px' }}>Body Stress Map</p>
            <div className="body-svg-container">
              <svg width="180" height="340" viewBox="0 0 180 340" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* head */}
                <circle cx="90" cy="32" r="26" stroke="rgba(240,239,232,0.2)" strokeWidth="1.5"/>
                {/* torso */}
                <rect x="58" y="64" width="64" height="100" rx="8" stroke="rgba(240,239,232,0.15)" strokeWidth="1.5"/>
                {/* left arm */}
                <path d="M58 70 L28 140 L32 170" stroke="rgba(240,239,232,0.15)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
                {/* right arm (dominant - highlighted) */}
                <path d="M122 70 L152 130 L156 158" stroke="rgba(232,124,62,0.4)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
                {/* left leg */}
                <path d="M76 164 L68 240 L64 310" stroke="rgba(240,239,232,0.15)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
                {/* right leg */}
                <path d="M104 164 L112 240 L116 310" stroke="rgba(240,239,232,0.15)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>

              {/* Hotspots */}
              <div className="injury-hot high" style={{ top: '108px', right: '10px' }} title="Right Wrist - High Risk"></div>
              <div className="injury-hot medium" style={{ top: '64px', right: '25px' }} title="Right Shoulder - Medium Risk"></div>
              <div className="injury-hot low" style={{ top: '230px', right: '35px' }} title="Right Knee - Low Risk"></div>
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--muted)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--red)' }}></div> High
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--muted)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--clay)' }}></div> Medium
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--muted)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--lime)' }}></div> Low
              </div>
            </div>
          </div>

          <div className="injury-cards">
            <div className="injury-card">
              <div className="injury-card-header">
                <div className="injury-name">Right Wrist Strain</div>
                <div className="risk-badge high">High Risk</div>
              </div>
              <div className="injury-detail">Excessive ulnar deviation detected on backhand strokes. Reduce wrist snap frequency and strengthen flexor tendons. Rest recommended 48h.</div>
              <div className="injury-bar"><div className="injury-fill high"></div></div>
            </div>
            <div className="injury-card">
              <div className="injury-card-header">
                <div className="injury-name">Rotator Cuff Stress</div>
                <div className="risk-badge medium">Medium Risk</div>
              </div>
              <div className="injury-detail">Serve motion analysis shows elevated shoulder elevation angle. Focus on scapular stability exercises and reduce overhead volume by 20%.</div>
              <div className="injury-bar"><div className="injury-fill medium"></div></div>
            </div>
            <div className="injury-card">
              <div className="injury-card-header">
                <div className="injury-name">Lateral Knee Pressure</div>
                <div className="risk-badge low">Low Risk</div>
              </div>
              <div className="injury-detail">Minor IT band tension from lateral movement patterns. Preventive stretching and foam rolling routine suggested post-match.</div>
              <div className="injury-bar"><div className="injury-fill low"></div></div>
            </div>
          </div>
        </div>
      </section>

      {/* TTS COACHING BAR */}
      <section className="tts-section" style={{ padding: '60px 48px', background: 'var(--black)' }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div className="section-label" style={{ justifyContent: 'center' }}>Voice Coaching</div>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Frame-synced audio feedback</h3>
          <p style={{ fontSize: '12px', color: 'var(--muted)' }}>Google TTS delivers coaching at exactly the right moment in your playback</p>
        </div>
        <div className="tts-bar">
          <div className="tts-play">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
          <div className="tts-waveform">
            <div className="wave-bar" style={{ height: '8px' }}></div>
            <div className="wave-bar" style={{ height: '16px' }}></div>
            <div className="wave-bar" style={{ height: '24px' }}></div>
            <div className="wave-bar" style={{ height: '12px' }}></div>
            <div className="wave-bar" style={{ height: '20px' }}></div>
            <div className="wave-bar" style={{ height: '8px' }}></div>
            <div className="wave-bar" style={{ height: '18px' }}></div>
            <div className="wave-bar" style={{ height: '24px' }}></div>
            <div className="wave-bar" style={{ height: '14px' }}></div>
            <div className="wave-bar" style={{ height: '10px' }}></div>
            <div className="wave-bar" style={{ height: '22px' }}></div>
            <div className="wave-bar" style={{ height: '6px' }}></div>
          </div>
          <div className="tts-label">
            <div style={{ color: 'var(--white)', fontSize: '12px', marginBottom: '2px' }}>"Bend your knees before contact — your stance is too upright on this return."</div>
            <div>Frame 00:01:24 · Form Feedback · Backhand</div>
          </div>
        </div>
      </section>

      {/* TECH STACK */}
      <section className="tech-section" id="tech">
        <div className="section-label">Google AI Stack</div>
        <h2 className="section-title">BUILT ON<br />GOOGLE</h2>
        <p className="section-desc">ACE uses Google's most powerful AI infrastructure to deliver professional-grade analysis that was previously only available to elite teams.</p>

        <div className="tech-grid">
          <div className="tech-card">
            <span className="tech-logo">✦</span>
            <div className="tech-name">Gemini API</div>
            <div className="tech-desc">Multimodal video understanding for form, shot, and movement analysis at every frame.</div>
          </div>
          <div className="tech-card">
            <span className="tech-logo">◈</span>
            <div className="tech-name">Veo</div>
            <div className="tech-desc">Generates alternate camera angles and slow-motion replays from your single source clip.</div>
          </div>
          <div className="tech-card">
            <span className="tech-logo">◉</span>
            <div className="tech-name">Gemini Nano</div>
            <div className="tech-desc">On-device processing for ultra-low latency analysis and real-time overlay generation.</div>
          </div>
          <div className="tech-card">
            <span className="tech-logo">◎</span>
            <div className="tech-name">Google TTS</div>
            <div className="tech-desc">Natural-sounding voice coaching synchronized to video playback timestamps.</div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">ACE<span>.</span></div>
        <div className="footer-copy">© 2025 ACE Tennis Intelligence. Powered by Google AI.</div>
        <div className="google-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
          </svg>
          Built with Google AI
        </div>
      </footer>
    </>
  )
}
