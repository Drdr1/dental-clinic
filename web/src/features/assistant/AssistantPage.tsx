import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Icon } from '../../components/Icon'
import { ask, type Answer } from './api'

/** Questions worth one tap, chosen because reception asks them daily. */
const STARTERS = ['asst.q1', 'asst.q2', 'asst.q3', 'asst.q4'] as const

type Message =
  | { id: number; who: 'me'; text: string }
  | { id: number; who: 'bot'; answer: Answer }
  | { id: number; who: 'error'; error: unknown; question: string }

type Chat = { messages: Message[]; names: Record<string, string> }

/*
 * The chat lives outside the component so stepping away to look at a patient
 * and coming back does not wipe it. It is memory only — nothing with patient
 * names is written to the browser's storage — so a reload starts fresh.
 */
let kept: Chat = { messages: [], names: {} }
let nextId = 1

export function AssistantPage() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [chat, setChat] = useState<Chat>(kept)
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { kept = chat }, [chat])

  const run = useMutation({
    mutationFn: (q: string) => {
      // Context for a follow-up: earlier exchanges, answers in token form.
      const history = []
      const msgs = chat.messages
      for (let i = 0; i < msgs.length - 1; i++) {
        const m = msgs[i], n = msgs[i + 1]
        if (m.who === 'me' && n.who === 'bot') history.push({ q: m.text, a: n.answer.raw ?? '' })
      }
      return ask(clinicId, q, history.slice(-8), chat.names)
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

  const fresh = () => {
    if (run.isPending) return
    setChat({ messages: [], names: {} })
    box.current?.focus()
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

  return (
    <section className="chat">
      <header className="chat-head">
        <div className="chat-title">
          <span className="chat-avatar"><Icon name="assistant" /></span>
          <h1>{t('asst.title')}</h1>
        </div>
        {!empty && (
          <button type="button" className="btn btn-small" onClick={fresh} disabled={run.isPending}>
            <Icon name="plus" /> {t('asst.new')}
          </button>
        )}
      </header>

      <div className="chat-scroll" ref={scroller}>
        <div className="chat-thread">
          {empty && (
            <div className="chat-empty">
              <span className="chat-avatar chat-avatar-lg"><Icon name="assistant" /></span>
              <h2>{t('asst.hello')}</h2>
              <p className="muted">{t('asst.subtitle')}</p>
              <div className="chat-starters">
                {STARTERS.map((k) => (
                  <button key={k} type="button" className="chat-starter" onClick={() => send(t(k))}>
                    {t(k)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chat.messages.map((m) => {
            if (m.who === 'me') {
              return <div key={m.id} className="msg msg-me"><div className="bubble">{m.text}</div></div>
            }
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
            const a = m.answer
            return (
              <div key={m.id} className="msg msg-bot">
                <span className="chat-avatar"><Icon name="assistant" /></span>
                <div className="bubble">
                  <RichText text={a.answer} />
                </div>
              </div>
            )
          })}

          {run.isPending && (
            <div className="msg msg-bot" aria-live="polite">
              <span className="chat-avatar"><Icon name="assistant" /></span>
              <div className="bubble bubble-typing" aria-label={t('asst.thinking')}>
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>
      </div>

      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <textarea
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — as in every chat.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(draft)
            }
          }}
          placeholder={t('asst.placeholder')}
          maxLength={1000}
          autoFocus
        />
        <button className="chat-send" disabled={!draft.trim() || run.isPending} aria-label={t('asst.send')}>
          <Icon name="send" className="icon-flip" />
        </button>
      </form>
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

  for (const line of text.split('\n')) {
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
  flushPara(); flushList()
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
