import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

/** Finger / mouse signature. Calls onChange with a PNG data URL, or null when cleared. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useI18n()
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current!
    // Draw at device resolution so the signature stays sharp, but keep the PNG small.
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#12224a'
  }, [])

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvas.current!.getContext('2d')!
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    const ctx = canvas.current!.getContext('2d')!
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    if (empty) setEmpty(false)
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    if (!empty) onChange(canvas.current!.toDataURL('image/png'))
  }
  function clear() {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="sig">
      <canvas ref={canvas} className="sig-canvas" dir="ltr" aria-label={t('sign.area')}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div className="sig-foot">
        <span className="muted">{empty ? t('sign.hint') : ''}</span>
        <button type="button" className="link-btn" onClick={clear}>{t('sign.clear')}</button>
      </div>
    </div>
  )
}
