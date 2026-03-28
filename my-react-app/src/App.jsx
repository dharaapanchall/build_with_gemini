import { useState, useRef } from 'react'
import './App.css'
import { useLiveCoach } from './useLiveCoach'
import LiveCoachChat from './LiveCoachChat'

// ── MediaPipe pose extraction ────────────────────────────────────────────────

const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13,    R_ELBOW: 14,
  L_WRIST: 15,    R_WRIST: 16,
  L_HIP: 23,      R_HIP: 24,
  L_KNEE: 25,     R_KNEE: 26,
  L_ANKLE: 27,    R_ANKLE: 28,
}

async function extractPoseFrames(videoFile, onProgress) {
  onProgress('veo', 'Loading MediaPipe pose model...')
  const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  )
  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numPoses: 1,
  })

  const videoEl = document.createElement('video')
  videoEl.src = URL.createObjectURL(videoFile)
  videoEl.muted = true
  await new Promise((r) => { videoEl.onloadedmetadata = r })

  const duration = videoEl.duration
  const frameCount = Math.min(30, Math.ceil(duration * 8))
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const frames = []

  for (let i = 0; i < frameCount; i++) {
    videoEl.currentTime = (i / (frameCount - 1)) * duration
    await new Promise((r) => { videoEl.onseeked = r })
    canvas.width = videoEl.videoWidth
    canvas.height = videoEl.videoHeight
    ctx.drawImage(videoEl, 0, 0)
    const result = landmarker.detect(canvas)
    if (result.landmarks?.length > 0) {
      frames.push({ time: videoEl.currentTime, lm: result.landmarks[0] })
    }
    if (i % 5 === 0) onProgress('veo', `Analyzing pose (${Math.round((i / frameCount) * 100)}%)...`)
  }

  landmarker.close()
  URL.revokeObjectURL(videoEl.src)
  return frames
}

function formatPoseForGemini(frames) {
  if (!frames.length) return ''

  // Which wrist moves more = dominant / racket hand
  let rMove = 0, lMove = 0
  for (let i = 1; i < frames.length; i++) {
    rMove += Math.hypot(frames[i].lm[LM.R_WRIST].x - frames[i-1].lm[LM.R_WRIST].x, frames[i].lm[LM.R_WRIST].y - frames[i-1].lm[LM.R_WRIST].y)
    lMove += Math.hypot(frames[i].lm[LM.L_WRIST].x - frames[i-1].lm[LM.L_WRIST].x, frames[i].lm[LM.L_WRIST].y - frames[i-1].lm[LM.L_WRIST].y)
  }
  const domIdx = rMove >= lMove ? LM.R_WRIST : LM.L_WRIST
  const domSide = rMove >= lMove ? 'right' : 'left'

  // Two-handed? Check avg wrist proximity across all frames
  const avgWristDist = frames.reduce((s, f) =>
    s + Math.hypot(f.lm[LM.R_WRIST].x - f.lm[LM.L_WRIST].x, f.lm[LM.R_WRIST].y - f.lm[LM.L_WRIST].y), 0
  ) / frames.length
  const twoHanded = avgWristDist < 0.18

  // Wrist (racket) path
  const wristPath = frames.map((f) => ({ t: f.time, x: f.lm[domIdx].x, y: f.lm[domIdx].y }))
  const lowest  = wristPath.reduce((a, b) => b.y > a.y ? b : a)  // highest y = lowest position
  const highest = wristPath.reduce((a, b) => b.y < a.y ? b : a)  // lowest y  = highest position
  const start   = wristPath[0]
  const end     = wristPath[wristPath.length - 1]

  const pos = (x, y) => {
    const vx = x < 0.33 ? 'left' : x < 0.67 ? 'center' : 'right'
    const vy = y < 0.25 ? 'above head' : y < 0.45 ? 'shoulder height' : y < 0.6 ? 'waist height' : y < 0.75 ? 'hip height' : 'below hip'
    return `${vx}, ${vy}`
  }

  // Shoulder tilt angle per frame → find max coil
  const shoulderAngles = frames.map((f) => ({
    t: f.time,
    deg: Math.atan2(f.lm[LM.R_SHOULDER].y - f.lm[LM.L_SHOULDER].y, f.lm[LM.R_SHOULDER].x - f.lm[LM.L_SHOULDER].x) * 180 / Math.PI,
  }))
  const maxShoulderCoil = shoulderAngles.reduce((a, b) => Math.abs(b.deg) > Math.abs(a.deg) ? b : a)

  // Hip tilt angle per frame → find max rotation
  const hipAngles = frames.map((f) => ({
    t: f.time,
    deg: Math.atan2(f.lm[LM.R_HIP].y - f.lm[LM.L_HIP].y, f.lm[LM.R_HIP].x - f.lm[LM.L_HIP].x) * 180 / Math.PI,
  }))
  const maxHipRotation = hipAngles.reduce((a, b) => Math.abs(b.deg) > Math.abs(a.deg) ? b : a)

  return `
MEDIAPIPE POSE DATA (use this for precise motion description):
Grip: ${twoHanded ? 'TWO-HANDED — both wrists stay close together throughout the swing' : `ONE-HANDED — ${domSide} hand only on racket`}
Racket-hand (${domSide} wrist) trajectory:
  • Start: ${pos(start.x, start.y)} (x=${start.x.toFixed(2)}, y=${start.y.toFixed(2)}, t=${start.t.toFixed(2)}s)
  • Lowest drop: ${pos(lowest.x, lowest.y)} (y=${lowest.y.toFixed(2)}, t=${lowest.t.toFixed(2)}s)
  • Highest point: ${pos(highest.x, highest.y)} (y=${highest.y.toFixed(2)}, t=${highest.t.toFixed(2)}s)
  • End/follow-through: ${pos(end.x, end.y)} (x=${end.x.toFixed(2)}, y=${end.y.toFixed(2)}, t=${end.t.toFixed(2)}s)
Shoulder coil: max tilt ${maxShoulderCoil.deg.toFixed(1)}° at t=${maxShoulderCoil.t.toFixed(2)}s
Hip rotation:  max tilt ${maxHipRotation.deg.toFixed(1)}° at t=${maxHipRotation.t.toFixed(2)}s
`.trim()
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

const SAFETY = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
]

const FALLBACK_VEO_PROMPT =
  'This is a tennis forehand. Animate a white untextured 3D human mannequin on a plain neutral gray background, full body visible from the side, smooth slow motion, clean 3D render, fluid natural athletic motion with no stiffness or robotic movement, no tennis ball. Trace the racket tip in one continuous fluid arc: the tip starts high behind the right shoulder, sweeps back in a relaxed loop then drops smoothly below hip level, then accelerates in a rising arc from low to high, the tip driving steeply upward through waist height with increasing speed, wrist pronating fluidly, the tip flowing all the way to finish high above the left shoulder. The body moves as one connected kinetic chain: weight rolls smoothly from right foot to left, hips rotate fluidly pulling the shoulders, arm extends loosely following the hip drive, the entire swing feels like one uninterrupted wave of motion. No background, no clothing, no skin texture, no ball, no object being hit. The animation flows like water — smooth, relaxed, and naturally accelerating.'

async function geminiGenerate(prompt, apiKey, fileData = null) {
  const parts = [{ text: prompt }]
  if (fileData) parts.push({ file_data: fileData })

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        safetySettings: SAFETY,
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Gemini error (${res.status})`)
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function uploadVideoToGemini(file, apiKey, onProgress) {
  onProgress('upload', `Uploading video (${(file.size / 1024 / 1024).toFixed(1)} MB)...`)

  const boundary = 'gemini' + Date.now()
  const metadata = JSON.stringify({ file: { display_name: file.name, mime_type: file.type } })

  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ])

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Upload failed (${res.status})`)
  }

  const uploadedFile = (await res.json()).file
  onProgress('upload', 'Processing video...')

  for (let i = 0; i < 30; i++) {
    const check = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${uploadedFile.name}?key=${apiKey}`
    ).then((r) => r.json())
    const state = check.state ?? check.file?.state
    if (state === 'ACTIVE') return uploadedFile
    if (state === 'FAILED') throw new Error('Gemini failed to process the video')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Video processing timed out — try a shorter clip')
}

async function analyzeTips(fileUri, mimeType, apiKey, onProgress) {
  onProgress('gemini', 'Analyzing tennis form...')
  const text = await geminiGenerate(
    `You are an expert professional tennis coach. Watch this video carefully and give a detailed structured coaching analysis.

**1. Shot Identification**
- Identify the exact shot type (serve, forehand, backhand, volley, overhead, etc.)

**2. Stance & Footwork**
- Foot positioning, balance, court positioning

**3. Grip & Racket Preparation**
- Grip type and correctness, backswing timing and path

**4. Swing Mechanics**
- Contact point, swing path, wrist action

**5. Body Rotation & Follow-Through**
- Hip and shoulder rotation, follow-through completion

**6. Key Improvements**
- Top 3 most impactful corrections the player should make immediately

Be specific about what you observe. Tailor everything to the exact shot shown.`,
    apiKey,
    { mime_type: mimeType, file_uri: fileUri }
  )
  if (!text) throw new Error('No analysis returned from Gemini')
  onProgress('gemini', '')
  return text
}

async function identifyShot(videoFile, fileUri, mimeType, apiKey, onProgress) {
  // Use MediaPipe to extract pose data, then Gemini to name the shot
  let poseContext = ''
  try {
    const poseFrames = await extractPoseFrames(videoFile, onProgress)
    poseContext = formatPoseForGemini(poseFrames)
    console.log('Pose data:\n', poseContext)
  } catch (e) {
    console.warn('MediaPipe failed, continuing without pose data:', e)
  }

  onProgress('veo', 'Identifying shot type...')

  const shotName = await geminiGenerate(
    `Watch this tennis video and identify the exact shot being performed.
${poseContext ? `\nMediaPipe pose data to help:\n${poseContext}\n` : ''}
Reply with ONLY the shot name (e.g. "serve", "forehand", "backhand", "two-handed backhand", "forehand volley", "overhead smash"). Nothing else.`,
    apiKey,
    { mime_type: mimeType, file_uri: fileUri }
  )

  const shot = shotName.trim().toLowerCase() || 'forehand'
  console.log('Identified shot:', shot)
  return shot
}

async function buildVeoPrompt(videoFile, fileUri, mimeType, apiKey, onProgress) {
  const shot = await identifyShot(videoFile, fileUri, mimeType, apiKey, onProgress)
  onProgress('veo', `Shot identified: ${shot} — building Veo prompt...`)

  const prompt = `A white untextured 3D human mannequin on a plain neutral gray background performing a perfect tennis ${shot} with ideal professional form, full body visible from the side, smooth slow motion, clean 3D render, fluid natural athletic motion, no tennis ball, no ball of any kind, shadow swing only, no background details, no clothing, no skin texture.`

  console.log('Veo prompt:', prompt)
  return prompt
}

async function checkFormPerfect(tipsText, apiKey) {
  const answer = await geminiGenerate(
    `Based on this tennis coaching analysis, does the player already have perfect or near-perfect form with no significant corrections needed? Answer only YES or NO.\n\n${tipsText}`,
    apiKey
  )
  return answer.toUpperCase().startsWith('YES')
}

async function runVeoGeneration(prompt, apiKey, onProgress) {
  onProgress('veo', 'Sending to Veo...')

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: '16:9', sampleCount: 1, durationSeconds: 5 },
      }),
    }
  )

  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}))
    const msg = err.error?.message || ''
    if (startRes.status === 400 || msg.toLowerCase().includes('guideline')) {
      onProgress('veo', 'Prompt flagged — retrying with safe fallback...')
      return runVeoGeneration(FALLBACK_VEO_PROMPT, apiKey, onProgress)
    }
    throw new Error(msg || `Veo request failed (${startRes.status})`)
  }

  const { name: operationName } = await startRes.json()
  if (!operationName) throw new Error('No operation ID from Veo')

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pollData = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`
    ).then((r) => r.json())

    if (pollData.error) throw new Error(pollData.error.message || 'Veo generation failed')

    if (pollData.done) {
      console.log('Veo response:', JSON.stringify(pollData, null, 2))
      const samples = pollData.response?.generateVideoResponse?.generatedSamples
      const video = samples?.[0]?.video
      const encoded =
        video?.encodedVideo ??
        video?.bytesBase64Encoded ??
        pollData.response?.videos?.[0]?.bytesBase64Encoded ??
        pollData.response?.videos?.[0]?.encodedVideo
      const videoUri = video?.uri ?? pollData.response?.videos?.[0]?.uri

      if (encoded) {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
        return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      }
      if (videoUri) {
        console.log('Veo video URI:', videoUri)
        let r = await fetch(videoUri)
        if (!r.ok) r = await fetch(`${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`)
        if (!r.ok) throw new Error(`Failed to download Veo video (${r.status})`)
        return URL.createObjectURL(await r.blob())
      }
      throw new Error('No video found in Veo response — check console for details')
    }

    const mins = Math.floor(((i + 1) * 5) / 60)
    const secs = ((i + 1) * 5) % 60
    onProgress('veo', `Generating (~${mins}m ${secs}s elapsed, up to 2 min)...`)
  }
  throw new Error('Veo timed out — try again')
}

function formatTips(text) {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <br key={i} />
    const bold = line.replace(/\*\*(.*?)\*\*/g, (_, m) => `<strong>${m}</strong>`)
    const clean = bold.replace(/^\*+\s*/, '').replace(/^#+\s*/, '')
    if (line.match(/^\*\*/) || line.match(/^#+\s/))
      return <h3 key={i} className="tip-heading" dangerouslySetInnerHTML={{ __html: clean }} />
    if (line.startsWith('- ') || line.startsWith('* '))
      return <li key={i} className="tip-item" dangerouslySetInnerHTML={{ __html: clean }} />
    return <p key={i} className="tip-line" dangerouslySetInnerHTML={{ __html: bold }} />
  })
}

export default function App() {
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [running, setRunning] = useState(false)

  const [uploadStatus, setUploadStatus] = useState('')
  const [geminiStatus, setGeminiStatus] = useState('')
  const [veoStatus, setVeoStatus] = useState('')

  const [tips, setTips] = useState('')
  const [veoUrl, setVeoUrl] = useState(null)
  const [veoPrompt, setVeoPrompt] = useState('')

  const fileInputRef = useRef(null)
  const videoRef = useRef(null)

  const liveCoach = useLiveCoach(GEMINI_API_KEY)

  const onProgress = (track, msg) => {
    if (track === 'upload') setUploadStatus(msg)
    if (track === 'gemini') setGeminiStatus(msg)
    if (track === 'veo') setVeoStatus(msg)
  }

  const handleVideoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    if (veoUrl) URL.revokeObjectURL(veoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setTips('')
    setUploadStatus('')
    setGeminiStatus('')
    setVeoStatus('')
    setVeoUrl(null)
    setVeoPrompt('')
    setFormPerfect(false)
  }

  const handleRun = async () => {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'paste_your_key_here') {
      setUploadStatus('error:No API key — add it to .env as VITE_GEMINI_API_KEY')
      return
    }
    if (!videoFile) {
      setUploadStatus('error:Upload a video first')
      return
    }

    setRunning(true)
    setTips('')
    setVeoUrl(null)
    setVeoPrompt('')
    setUploadStatus('')
    setGeminiStatus('')
    setVeoStatus('')

    try {
      // Step 1: upload once, shared by both tracks
      const geminiFile = await uploadVideoToGemini(videoFile, GEMINI_API_KEY, onProgress)
      const { uri, name: _ } = geminiFile
      const mimeType = videoFile.type
      setUploadStatus('')

      // Step 2: analyze tips first (Veo prompt needs corrections from it)
      onProgress('gemini', 'Analyzing tennis form...')
      onProgress('veo', 'Waiting for analysis...')
      const tipsText = await analyzeTips(uri, mimeType, GEMINI_API_KEY, onProgress)
      setTips(tipsText)

      // Step 3: build Veo prompt and check perfection in parallel (both need tips)
      onProgress('veo', 'Building Veo prompt from video + corrections...')
      const [veoPromptText, perfect] = await Promise.all([
        buildVeoPrompt(videoFile, uri, mimeType, GEMINI_API_KEY, onProgress),
        checkFormPerfect(tipsText, GEMINI_API_KEY),
      ])

      if (perfect) {
        onProgress('veo', 'info:Form is already perfect — no recreation needed!')
      } else {
        // Step 4: generate Veo video with the detailed prompt
        setVeoPrompt(veoPromptText)
        const url = await runVeoGeneration(veoPromptText, GEMINI_API_KEY, onProgress)
        setVeoUrl(url)
        onProgress('veo', '')
      }
    } catch (err) {
      const track = err.message.toLowerCase().includes('upload') ? 'upload' : 'gemini'
      onProgress(track, `error:${err.message}`)
    } finally {
      setRunning(false)
    }
  }

  const isErr = (s) => s.startsWith('error:')
  const isInfo = (s) => s.startsWith('info:')
  const msg = (s) => (isErr(s) || isInfo(s) ? s.slice(6) : s)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-icon">🎾</div>
        <h1>Tennis Form Analyzer</h1>
        <p className="subtitle">Upload a video — Gemini analyzes your form and Veo recreates it simultaneously</p>
      </header>

      <div className="card upload-card">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoChange}
          style={{ display: 'none' }}
        />
        <button className="upload-btn" onClick={() => fileInputRef.current.click()}>
          {videoFile ? '↺ Change Video' : '+ Upload Tennis Video'}
        </button>
        {videoFile && (
          <p className="file-name">
            {videoFile.name}{' '}
            <span className="file-size">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
          </p>
        )}
      </div>

      {videoUrl && (
        <div className="card video-card">
          <p className="video-label">Your Video</p>
          <video className="video-player" src={videoUrl} controls playsInline />
        </div>
      )}

      <button className="analyze-btn" onClick={handleRun} disabled={running || !videoFile}>
        {running ? (
          <span className="spinner-text"><span className="spinner" /> Running...</span>
        ) : (
          'Analyze & Recreate'
        )}
      </button>

      {/* Upload status */}
      {uploadStatus && (
        <div className={`status-msg ${isErr(uploadStatus) ? 'status-error' : 'status-info'}`}>
          {isErr(uploadStatus) ? '⚠ ' : 'ℹ '}{msg(uploadStatus)}
        </div>
      )}

      {/* Two-column live progress */}
      {running && (geminiStatus || veoStatus) && (
        <div className="parallel-status">
          <div className={`track ${geminiStatus ? 'track-active' : ''}`}>
            <span className="track-label">Gemini Analysis</span>
            {geminiStatus && (
              <span className="track-msg">
                <span className="spinner sm" /> {msg(geminiStatus)}
              </span>
            )}
          </div>
          <div className={`track ${veoStatus ? 'track-active' : ''}`}>
            <span className="track-label">Veo Recreation</span>
            {veoStatus && (
              <span className="track-msg">
                <span className="spinner sm" /> {msg(veoStatus)}
              </span>
            )}
          </div>
        </div>
      )}

      {!running && veoStatus && (
        <div className={`status-msg ${isErr(veoStatus) ? 'status-error' : 'status-info'}`}>
          {isErr(veoStatus) ? '⚠ ' : 'ℹ '}{msg(veoStatus)}
        </div>
      )}

      {veoUrl && (
        <div className="card video-card">
          <p className="video-label">Veo Recreation — Perfect Form</p>
          <video className="video-player" src={veoUrl} controls playsInline autoPlay loop />
          {veoPrompt && (
            <p className="veo-prompt-used"><strong>Prompt:</strong> {veoPrompt}</p>
          )}
        </div>
      )}

      {analysis && (
        <div className="card tips-card">
          <h2 className="tips-title">Form Analysis</h2>

          <div className="mistakes-list">
            {analysis.mistakes.map((m, i) => (
              <div key={i} className={`mistake-card severity-${m.severity}`}>
                <div className="mistake-header">
                  <span className="mistake-body-part">{m.body_part}</span>
                  <div className="mistake-header-right">
                    {m.timestamp_seconds != null && (
                      <button
                        className="timestamp-btn"
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = m.timestamp_seconds
                            videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }
                        }}
                      >
                        ▶ {new Date(m.timestamp_seconds * 1000).toISOString().slice(14, 19)}
                      </button>
                    )}
                    <span className={`severity-badge severity-badge-${m.severity}`}>
                      {SEVERITY_LABEL[m.severity] ?? m.severity}
                    </span>
                  </div>
                </div>
                <p className="mistake-issue">{m.issue}</p>
                {m.detail && <p className="mistake-detail">{m.detail}</p>}
                <p className="mistake-risk">Injury risk: {m.injury_risk}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis && (
        <LiveCoachChat mistakes={analysis.mistakes} liveCoach={liveCoach} />
      )}
    </div>
  )
}
