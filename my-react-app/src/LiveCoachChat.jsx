import { useState, useEffect, useRef } from 'react'

export default function LiveCoachChat({ mistakes, liveCoach }) {
  const { init, sendText, startRecording, stopRecording, messages, isRecording, isResponding, isReady, connectError } = liveCoach
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    init(mistakes)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isResponding])

  const handleSend = () => {
    if (!input.trim() || !isReady) return
    sendText(input.trim())
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  console.log('CHAT RENDER messages:', messages)
  return (
    <div className="card chat-card">
      <h2 className="tips-title">Ask Your AI Coach</h2>

      {!isReady && !connectError && (
        <div className="chat-connecting">
          <span className="spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border)' }} />
          Connecting to coach...
        </div>
      )}
      {connectError && (
        <div className="status-msg status-error">⚠ Live API error: {connectError}</div>
      )}

      {messages.length === 0 && isReady && (
        <p className="chat-hint">
          Ask about your form mistakes — type or hold the mic button to speak.
        </p>
      )}

      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
            <span className="chat-role">{m.role === 'coach' ? 'Coach' : 'You'}</span>
            <p className="chat-text">{m.text}</p>
          </div>
        ))}
        {isResponding && (
          <div className="chat-bubble chat-bubble-coach">
            <span className="chat-role">Coach</span>
            <p className="chat-typing">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          placeholder={isReady ? 'Ask about your form...' : 'Connecting...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isReady}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!isReady || !input.trim()}
        >
          Send
        </button>
        <button
          className={`chat-mic-btn ${isRecording ? 'chat-mic-active' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          disabled={!isReady}
          title="Hold to speak"
        >
          {isRecording ? '🔴' : '🎤'}
        </button>
      </div>
    </div>
  )
}
