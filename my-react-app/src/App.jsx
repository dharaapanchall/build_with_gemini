import { useState, useRef } from 'react'
import './App.css'
import { useLiveCoach } from './useLiveCoach'
import LiveCoachChat from './LiveCoachChat'

async function uploadVideoToGemini(file, apiKey, onProgress) {
  onProgress(`Uploading video (${(file.size / 1024 / 1024).toFixed(1)} MB)...`)

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

  const data = await res.json()
  const uploadedFile = data.file

  onProgress('Processing video...')
  for (let i = 0; i < 30; i++) {
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${uploadedFile.name}?key=${apiKey}`
    )
    const checkData = await checkRes.json()
    const state = checkData.state ?? checkData.file?.state
    if (state === 'ACTIVE') return uploadedFile
    if (state === 'FAILED') throw new Error('Gemini failed to process the video file')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Video processing timed out — try a shorter clip')
}

async function analyzeVideoWithGemini(fileUri, mimeType, apiKey, onProgress) {
  onProgress('Analyzing your tennis form with Gemini AI...')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are a professional tennis coach and sports injury prevention specialist.
Analyze this tennis swing video and return a JSON object with exactly this structure:
{
  "mistakes": [
    {
      "body_part": "wrist/elbow/shoulder/knee/hip/etc",
      "issue": "short description of the problem",
      "detail": "2-3 sentence coaching explanation: what the player should do instead, what it should feel like, and a specific drill or cue to fix it",
      "injury_risk": "what injury this causes",
      "severity": "low/medium/high",
      "timestamp_seconds": 3.5
    }
  ],
  "veo_prompt": "A professional tennis player demonstrating perfect technique correcting the issues seen, slow motion, sports biomechanics style",
  "imagen_prompt": "Close-up of the key body part showing correct position, biomechanics diagram style"
}
For timestamp_seconds, identify the exact second in the video where this mistake is most clearly visible.
Return only valid JSON with no markdown, no code fences, no extra text.`,
              },
              {
                file_data: { mime_type: mimeType, file_uri: fileUri },
              },
            ],
          },
        ],
      }),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Analysis failed (${res.status})`)
  }

  const data = await res.json()
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No analysis returned from Gemini')

  // Strip markdown code fences if Gemini adds them anyway
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  return JSON.parse(text)
}

const SEVERITY_LABEL = { high: 'High Risk', medium: 'Medium Risk', low: 'Low Risk' }

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

export default function App() {
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [status, setStatus] = useState('')
  const [analysis, setAnalysis] = useState(null) // { mistakes, veo_prompt, imagen_prompt }
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)
  const videoRef = useRef(null)

  const liveCoach = useLiveCoach(GEMINI_API_KEY)

  const handleVideoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setAnalysis(null)
    setStatus('')
    liveCoach.reset()
  }

  const handleAnalyze = async () => {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'paste_your_key_here') {
      setStatus('error:No API key found. Add your key to the .env file as VITE_GEMINI_API_KEY.')
      return
    }
    if (!videoFile) {
      setStatus('error:Please upload a video first.')
      return
    }

    setLoading(true)
    setAnalysis(null)
    setStatus('')

    try {
      const uploadedFile = await uploadVideoToGemini(videoFile, GEMINI_API_KEY, setStatus)
      const result = await analyzeVideoWithGemini(
        uploadedFile.uri,
        videoFile.type,
        GEMINI_API_KEY,
        setStatus
      )
      setAnalysis(result)
      setStatus('')
    } catch (err) {
      setStatus(`error:${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const isError = status.startsWith('error:')
  const statusMsg = isError ? status.slice(6) : status

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-icon">🎾</div>
        <h1>Tennis Form Analyzer</h1>
        <p className="subtitle">Upload a video and get AI-powered coaching from Gemini</p>
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
          <video ref={videoRef} className="video-player" src={videoUrl} controls playsInline />
        </div>
      )}

      <button
        className="analyze-btn"
        onClick={handleAnalyze}
        disabled={loading || !videoFile}
      >
        {loading ? (
          <span className="spinner-text">
            <span className="spinner" /> Analyzing...
          </span>
        ) : (
          'Analyze Tennis Form'
        )}
      </button>

      {statusMsg && (
        <div className={`status-msg ${isError ? 'status-error' : 'status-info'}`}>
          {isError ? '⚠ ' : 'ℹ '}
          {statusMsg}
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
