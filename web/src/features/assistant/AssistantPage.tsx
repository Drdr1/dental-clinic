import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Icon } from '../../components/Icon'
import { ask, type Answer } from './api'
import { transcribe } from '../dictation/api'

/** Questions worth one tap, chosen because reception asks them daily. */
const STARTERS = ['asst.q1', 'asst.q2', 'asst.q3', 'asst.q4'] as const

type Message =
  | { id: number; who: 'me'; text: string }
  | { id: number; who: 'bot'; answer: Answer }
  | { id: number; who: 'error'; error: unknown; question: string }

type Chat = { messages: Message[]; names: Record<string, string> }
type Saved = { id: number; title: string; at: number; chat: Chat }

/*
 * The chats live outside the component so stepping away to look at a patient
 * and coming back does not wipe them. Memory only: nothing with patient names
 * is written to the browser's storage, so a reload starts fresh.
 */
let kept: Chat = { messages: [], names: {} }
let saved: Saved[] = []
let nextId = 1

export function AssistantPage() {
  const { clinicId } = useMember()
  const { t, day } = useI18n()
  const [chat, setChat] = useState<Chat>(kept)
  const [history, setHistory] = useState<Saved[]>(saved)
  const [draft, setDraft] = useState('')
  const [mic, setMic] = useState<'idle' | 'recording' | 'working'>('idle')
  const [micError, setMicError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { kept = chat }, [chat])
  useEffect(() => { saved = history }, [history])
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((tr) => tr.stop()) }, [])

  const run = useMutation({
    mutationFn: (q: string) => {
      // Context for a follow-up: earlier exchanges, answers in token form.
      const past = []
      const msgs = chat.messages
      for (let i = 0; i < msgs.length - 1; i++) {
        const m = msgs[i], n = msgs[i + 1]
        if (m.who === 'me' && n.who === 'bot') past.push({ q: m.text, a: n.answer.raw ?? '' })
      }
      return ask(clinicId, q, past.slice(-8), chat.names)
    },
    onSuccess: (answer) => setChat((c) => ({
      messages: [...c.messages, { id: nextId++, who: 'bot', answer }],
      names: answer.names ?? c.names,
    })),
    onError: (error, question) => setChat((c) => ({
      ...c, messages: [...c.messages, { id: nextId++, who: 'error', error, question }],
    })),
  })

  const send = (raw: string) => {
    const q = raw.trim()
    if (!q || run.isPending) return
    setChat((c) => ({ ...c, messages: [...c.messages, { id: nextId++, who: 'me', text: q }] }))
    setDraft('')
    run.mutate(q)
  }

  // Put the open chat on the list (once), then start a clean one.
  const shelve = (c: Chat) => {
    const first = c.messages.find((m) => m.who === 'me')
    if (!first || first.who !== 'me') return
    setHistory((h) => [{ id: first.id, title: first.text, at: Date.now(), chat: c }, ...h.filter((x) => x.id !== first.id)].slice(0, 20))
  }
  const fresh = () => {
    if (run.isPending) return
    shelve(chat)
    setChat({ messages: [], names: {} })
    box.current?.focus()
  }
  const open = (s: Saved) => {
    if (run.isPending) return
    shelve(chat)
    setChat(s.chat)
  }
  const currentId = chat.messages.find((m) => m.who === 'me')?.id

  // Talk instead of typing: the words land in the box to read before asking.
  async function toggleMic() {
    if (mic === 'recording') { recorder.current?.state === 'recording' && recorder.current.stop(); return }
    if (mic === 'working') return
    setMicError('')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { setMicError(t('dict.micDenied')); return }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' })
      if (blob.size < 1000) { setMic('idle'); return }
      setMic('working')
      try {
        const text = await transcribe(clinicId, blob)
        setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text))
        box.current?.focus()
      } catch (e) { setMicError(e instanceof Error ? e.message : String(e)) } finally { setMic('idle') }
    }
    recorder.current = rec
    rec.start()
    setMic('recording')
  }

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, run.isPending])

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  const empty = chat.messages.length === 0
  const when = (ms: number) => {
    const d = new Date(ms), now = new Date()
    if (d.toDateString() === now.toDateString()) return t('asst.todayShort')
    const y = new Date(now); y.setDate(now.getDate() - 1)
    if (d.toDateString() === y.toDateString()) return t('appt.yesterday')
    return day(d.toISOString())
  }

  return (
    <section className="page asst-page">
      <div className="asst-layout">
        <section className="panel asst-chat">
          <header className="panel-head asst-head">
            <div>
              <h1>{t('asst.title')}</h1>
              <p className="muted">{t('asst.subtitleShort')}</p>
            </div>
            <button type="button" className="btn btn-small" onClick={fresh} disabled={run.isPending || empty}>{t('asst.new')}</button>
          </header>

          <div className="chat-scroll" ref={scroller}>
            <div className="chat-thread">
              {empty && (
                <div className="chat-empty">
                  <span className="chat-avatar chat-avatar-lg"><Icon name="assistant" /></span>
                  <h2>{t('asst.hello')}</h2>
                </div>
              )}
              {chat.messages.map((m) => {
                if (m.who === 'me') return <div key={m.id} className="msg msg-me"><div className="bubble">{m.text}</div></div>
                if (m.who === 'error') {
                  return (
                    <div key={m.id} className="msg msg-bot">
                      <span className="chat-avatar"><Icon name="assistant" /></span>
                      <div className="bubble bubble-error">
                        <ErrorNote error={m.error} onRetry={run.isPending ? undefined : () => send(m.question)} />
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={m.id} className="msg msg-bot">
                    <span className="chat-avatar"><Icon name="assistant" /></span>
                    <div className="bubble"><RichText text={m.answer.answer} /></div>
                  </div>
                )
              })}
              {run.isPending && (
                <div className="msg msg-bot" aria-live="polite">
                  <span className="chat-avatar"><Icon name="assistant" /></span>
                  <div className="bubble bubble-typing" aria-label={t('asst.thinking')}><span /><span /><span /></div>
                </div>
              )}
            </div>
          </div>

          <div className="asst-starters">
            {STARTERS.map((k) => (
              <button key={k} type="button" className="chip chip-line" disabled={run.isPending} onClick={() => send(t(k))}>{t(k)}</button>
            ))}
          </div>
          {micError && <p className="danger-text small asst-mic-error">{micError}</p>}
          <form className="asst-composer" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
            <textarea
              ref={box}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line, as in every chat.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft) }
              }}
              placeholder={t('asst.placeholder')}
              maxLength={1000}
              autoFocus
            />
            {typeof MediaRecorder !== 'undefined' && (
              <button type="button" className={`asst-mic${mic === 'recording' ? ' is-on' : ''}`} onClick={toggleMic}
                disabled={mic === 'working'} aria-label={t(mic === 'recording' ? 'dict.stop' : 'dict.record')} title={t(mic === 'recording' ? 'dict.stop' : 'dict.record')}>
                <Icon name={mic === 'recording' ? 'stop' : 'mic'} />
              </button>
            )}
            <button className="btn btn-primary" disabled={!draft.trim() || run.isPending}>{t('asst.send')}</button>
          </form>
        </section>

        <aside className="panel asst-side">
          <h2>{t('asst.chats')}</h2>
          <ul className="asst-list">
            {!empty && (
              <li><button className="on" aria-current="true">
                <strong>{(chat.messages.find((m) => m.who === 'me') as { text: string } | undefined)?.text}</strong>
                <span>{t('asst.now')}</span>
              </button></li>
            )}
            {history.filter((h) => h.id !== currentId).map((h) => (
              <li key={h.id}><button onClick={() => open(h)} disabled={run.isPending}>
                <strong>{h.title}</strong><span>{when(h.at)}</span>
              </button></li>
            ))}
          </ul>
          {empty && history.length === 0 && <p className="muted small">{t('asst.noChats')}</p>}
        </aside>
      </div>
    </section>
  )
}

/**
 * The model answers in light markdown — bold, dashes, numbered lines. Render
 * just that, as React nodes rather than HTML, so nothing in an answer can
 * ever be markup.
 */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; start: number; items: string[] } | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join('\n'))}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((x, i) => <li key={i}>{inline(x)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length} start={list.start}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }

  let table: string[][] | null = null
  const flushTable = () => {
    if (!table) return
    const [head, ...body] = table
    blocks.push(
      <div key={blocks.length} className="rich-table"><table className="table table-plain">
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
      </table></div>,
    )
    table = null
  }

  for (const line of text.split('\n')) {
    // A markdown table: | a | b | rows, with a |---| line under the header.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList()
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      table = table ? [...table, cells] : [cells]
      continue
    }
    flushTable()
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)
    const number = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line)
    if (bullet && list?.ordered && /^\s+/.test(line)) {
      // A dash indented under a numbered item is a detail of that item.
      list.items[list.items.length - 1] += '\n• ' + bullet[1]
    } else if (bullet || number) {
      flushPara()
      const ordered = !!number
      if (list && list.ordered !== ordered) flushList()
      // Keep the model's own numbering, so a list broken by sub-points
      // carries on at 6 rather than starting again at 1.
      if (!list) list = { ordered, start: number ? Number(number[1]) : 1, items: [] }
      list.items.push(bullet ? bullet[1] : number![2])
    } else if (/^\s+\S/.test(line) && list) {
      // An indented line under a list item belongs to that item.
      list.items[list.items.length - 1] += '\n' + line.trim()
    } else if (!line.trim()) {
      flushPara(); flushList()
    } else if (heading) {
      flushPara(); flushList()
      blocks.push(<p key={blocks.length}><strong>{inline(heading[1])}</strong></p>)
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara(); flushList(); flushTable()
  return <div className="rich">{blocks}</div>
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{numbers(part.slice(2, -2))}</strong>
      : <Fragment key={i}>{numbers(part)}</Fragment>)
}

/** Dates and phone numbers inside Arabic text: keep each one whole and left-to-right. */
function numbers(s: string): ReactNode {
  return s.split(/(\d[\d\-/]*\d)/g).map((part, i) =>
    i % 2 && /[-/]/.test(part) || i % 2 && part.length >= 8
      ? <bdi key={i} dir="ltr">{part}</bdi>
      : <Fragment key={i}>{part}</Fragment>)
}
