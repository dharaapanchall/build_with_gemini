import { useState, useRef, useCallback } from 'react'
import { GoogleGenAI, Modality } from '@google/genai'

const OUTPUT_SAMPLE_RATE = 24000
const INPUT_SAMPLE_RATE = 16000

function base64ToPcmFloat32(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
  return float32
}

function float32ToBase64Pcm16(float32) {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768))
  }
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function useLiveCoach(apiKey) {
  const [messages, setMessages] = useState([])
  const [isResponding, setIsResponding] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [connectError, setConnectError] = useState(null)

  const sessionRef = useRef(null)
  const outputCtxRef = useRef(null)
  const nextPlayTimeRef = useRef(0)
  const inputCtxRef = useRef(null)
  const processorRef = useRef(null)
  const streamRef = useRef(null)
  const pendingCoachTranscriptRef = useRef('')
  const pendingUserTranscriptRef = useRef('')

  function scheduleAudioChunk(float32Data) {
    if (!outputCtxRef.current) {
      outputCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
    }
    const ctx = outputCtxRef.current
    const buffer = ctx.createBuffer(1, float32Data.length, OUTPUT_SAMPLE_RATE)
    buffer.getChannelData(0).set(float32Data)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current)
    source.start(startAt)
    nextPlayTimeRef.current = startAt + buffer.duration
  }

  const init = useCallback(async (mistakes) => {
    if (sessionRef.current) return
    setConnectError(null)

    const mistakesSummary = mistakes
      .map((m, i) => `${i + 1}. ${m.body_part}: ${m.issue} (${m.severity} risk — ${m.injury_risk})`)
      .join('\n')

    const ai = new GoogleGenAI({ apiKey })

    try {
      const session = await ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              prefixPaddingMs: 300,
              silenceDurationMs: 1200,
            },
          },
          systemInstruction: {
            parts: [{
              text: `You are an expert tennis coach and sports injury prevention specialist having a real-time voice conversation with a player.
The player just had their tennis form analyzed. Here are their specific mistakes:
${mistakesSummary}

Answer conversationally. Be encouraging, specific, and concise.
When they ask about a mistake, explain the injury risk, what it should feel like to correct it, and give one concrete drill.
Keep each response under 30 seconds of speech.`
            }]
          },
        },
        callbacks: {
          onopen() {
            console.log('Live opened')
          },
          onmessage(msg) {
            const parts = msg.serverContent?.modelTurn?.parts ?? []

            for (const part of parts) {
              if (part.inlineData?.data) {
                try {
                  const float32 = base64ToPcmFloat32(part.inlineData.data)
                  scheduleAudioChunk(float32)
                  setIsResponding(true)
                } catch (e) {
                  console.error('Audio decode error:', e)
                }
              }
            }

            const inputChunk = msg.serverContent?.inputTranscription?.text
            if (inputChunk) {
              pendingUserTranscriptRef.current += inputChunk
            }

            const outputChunk = msg.serverContent?.outputTranscription?.text
            if (outputChunk) {
              pendingCoachTranscriptRef.current += outputChunk
            }

            if (msg.serverContent?.turnComplete) {
              setIsResponding(false)
              const userText = pendingUserTranscriptRef.current.trim()
              const coachText = pendingCoachTranscriptRef.current.trim()

              setMessages((prev) => {
                const next = [...prev]
                if (userText) next.push({ role: 'user', text: userText })
                if (coachText) next.push({ role: 'coach', text: coachText })
                return next
              })

              pendingUserTranscriptRef.current = ''
              pendingCoachTranscriptRef.current = ''
            }
          },
          onerror(e) {
            console.error('Gemini Live onerror:', e)
            setIsResponding(false)
            setIsReady(false)
          },
          onclose(e) {
            console.warn('Gemini Live onclose — code:', e?.code, 'reason:', e?.reason)
            setIsReady(false)
            sessionRef.current = null
          },
        },
      })

      sessionRef.current = session
      setIsReady(true)
    } catch (e) {
      console.error('Live connect FAILED:', e)
      setConnectError(e?.message ?? String(e))
    }
  }, [apiKey])

  const sendText = useCallback((text) => {
    if (!sessionRef.current || !text.trim()) return
    setMessages((prev) => [...prev, { role: 'user', text: text.trim() }])
    sessionRef.current.sendRealtimeInput({ text: text.trim() })
  }, [])

  const startRecording = useCallback(async () => {
    if (!sessionRef.current || isRecording) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE })
      inputCtxRef.current = inputCtx

      const source = inputCtx.createMediaStreamSource(stream)
      const processor = inputCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (!sessionRef.current) return
        const float32 = e.inputBuffer.getChannelData(0)
        const base64 = float32ToBase64Pcm16(float32)
        sessionRef.current.sendRealtimeInput({
          audio: { data: base64, mimeType: 'audio/pcm;rate=16000' },
        })
      }

      source.connect(processor)
      processor.connect(inputCtx.destination)
      setIsRecording(true)
    } catch (e) {
      console.error('Mic error:', e)
    }
  }, [isRecording])

  const stopRecording = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.sendRealtimeInput({ audioStreamEnd: true })
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close()
      inputCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsRecording(false)
  }, [])

  const reset = useCallback(() => {
    stopRecording()
    if (sessionRef.current) {
      sessionRef.current.close?.()
      sessionRef.current = null
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close()
      outputCtxRef.current = null
    }
    nextPlayTimeRef.current = 0
    pendingCoachTranscriptRef.current = ''
    pendingUserTranscriptRef.current = ''
    setMessages([])
    setIsReady(false)
    setIsResponding(false)
  }, [stopRecording])

  return {
    init,
    sendText,
    startRecording,
    stopRecording,
    reset,
    messages,
    isRecording,
    isResponding,
    isReady,
    connectError,
  }
}
