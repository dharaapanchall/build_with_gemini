import { useState, useRef } from 'react'
import './App.css'

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

  // Wait for Gemini to finish processing the video
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
                text: `You are an expert professional tennis coach with decades of experience. Carefully watch this tennis video and provide a detailed, structured coaching analysis.

Please analyze and give specific, actionable tips covering:

**1. Stance & Footwork**
- Foot positioning and balance
- Movement patterns and court positioning

**2. Grip & Racket Preparation**
- Grip type and correctness
- Early racket preparation and backswing

**3. Swing Mechanics**
- Contact point
- Swing path and wrist action

**4. Follow-Through & Body Rotation**
- Hip and shoulder rotation
- Follow-through completion

**5. Key Improvements**
- Top 3 most impactful changes the player should make immediately

Be specific about what you observe in the video. If the video shows a particular shot (serve, forehand, backhand, etc.), tailor your feedback accordingly.`,
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No analysis returned from Gemini')
  return text
}

function formatTips(text) {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <br key={i} />

    const boldLine = line.replace(/\*\*(.*?)\*\*/g, (_, m) => `<strong>${m}</strong>`)
    const cleanLine = boldLine.replace(/^\*+\s*/, '').replace(/^#+\s*/, '')

    if (line.startsWith('**') && line.endsWith('**')) {
      return (
        <h3 key={i} className="tip-heading" dangerouslySetInnerHTML={{ __html: cleanLine }} />
      )
    }
    if (line.match(/^\*\*\d+\./)) {
      return (
        <h3 key={i} className="tip-heading" dangerouslySetInnerHTML={{ __html: cleanLine }} />
      )
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <li key={i} className="tip-item" dangerouslySetInnerHTML={{ __html: cleanLine }} />
      )
    }
    return (
      <p key={i} className="tip-line" dangerouslySetInnerHTML={{ __html: boldLine }} />
    )
  })
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

export default function App() {
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [status, setStatus] = useState('')
  const [tips, setTips] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)

  const handleVideoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setTips('')
    setStatus('')
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
    setTips('')
    setStatus('')

    try {
      const uploadedFile = await uploadVideoToGemini(videoFile, GEMINI_API_KEY, setStatus)
      const result = await analyzeVideoWithGemini(
        uploadedFile.uri,
        videoFile.type,
        GEMINI_API_KEY,
        setStatus
      )
      setTips(result)
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
        <p className="subtitle">Upload a video and get AI-powered coaching tips from Gemini</p>
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
          <video className="video-player" src={videoUrl} controls playsInline />
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

      {tips && (
        <div className="card tips-card">
          <h2 className="tips-title">Coaching Analysis</h2>
          <div className="tips-body">{formatTips(tips)}</div>
        </div>
      )}
    </div>
  )
}
