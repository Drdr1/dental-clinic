import { useEffect, useRef, useState } from 'react'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Icon } from '../../components/Icon'
import { transcribe } from './api'

const MAX_SECONDS = 180

type Props = {
  value: string
  onChange: (text: string) => void
  placeholder?: string
}

/**
 * A text box with a microphone. Tap to talk, tap again to stop; what was said
 * lands in the box as text she can read and fix — nothing is understood from
 * it until she asks. Typing works just as well, for a quiet word or a fix.
 */
export function DictateBox({ value, onChange, placeholder }: Props) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(value)
  latest.current = value

  // Never leave the microphone on behind a closed dialog.
  useEffect(() => () => {
    window.clearInterval(timer.current)
    recorder.current?.stream.getTracks().forEach((tr) => tr.stop())
  }, [])

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  async function start() {
    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      // Say which of the three it is — each has a different fix.
      const name = e instanceof DOMException ? e.name : ''
      setError(t(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'dict.micMissing'
        : name === 'NotReadableError' || name === 'AbortError' ? 'dict.micBusy'
        : name === 'NotAllowedError' || name === 'SecurityError' ? 'dict.micDenied'
        : 'dict.noMic'))
      return
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      window.clearInterval(timer.current)
      stream.getTracks().forEach((tr) => tr.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' })
      if (blob.size < 1000) { setState('idle'); return }   // a tap, not speech
      setState('working')
      try {
        const text = await transcribe(clinicId, blob)
        const before = latest.current.trim()
        onChange(before ? `${before}\n${text}` : text)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setState('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setState('recording')
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) rec.state === 'recording' && rec.stop()
        return s + 1
      })
    }, 1000)
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="dictate">
      <div className={`dictate-box ${state === 'recording' ? 'is-recording' : ''}`}>
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('dict.placeholder')} disabled={state === 'working'} />
        {supported && (
          <button type="button"
            className={`dictate-mic ${state === 'recording' ? 'is-on' : ''}`}
            onClick={state === 'recording' ? stop : start}
            disabled={state === 'working'}
            aria-label={state === 'recording' ? t('dict.stop') : t('dict.record')}>
            <Icon name={state === 'recording' ? 'stop' : 'mic'} />
          </button>
        )}
      </div>
      <p className="hint dictate-status" aria-live="polite">
        {state === 'recording' && <><span className="rec-dot" /> {t('dict.recording', { time: clock })}</>}
        {state === 'working' && t('dict.transcribing')}
        {state === 'idle' && !error && (supported ? t('dict.hint') : t('dict.hintNoMic'))}
        {error && <span className="error-text">{error}</span>}
      </p>
    </div>
  )
}
