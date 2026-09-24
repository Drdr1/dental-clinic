import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { SignaturePad } from '../../components/SignaturePad'
import { ToothMark } from '../../components/ToothMark'
import { loadPublicForm, submitPublicForm } from './api'
import { optionLabel, optionValue, qLabel } from './labels'

/** What the patient sees when opening the link from WhatsApp (or on the reception tablet). No login. */
export function PublicFormPage() {
  const { token = '' } = useParams()
  const { t, lang, setLang } = useI18n()
  const form = useQuery({ queryKey: ['public-form', token], queryFn: () => loadPublicForm(token), retry: false })
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  const submit = useMutation({ mutationFn: () => submitPublicForm(token, answers, name, signature!) })

  const shell = (content: React.ReactNode) => (
    <main className="public-form">
      <div className="public-card">
        <div className="public-head">
          {form.data?.logo
            ? <img src={form.data.logo} alt="" className="brand-logo" />
            : <ToothMark className="brand-mark" />}
          <strong>{form.data?.clinic}</strong>
          <button type="button" className="link-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('nav.language')}</button>
        </div>
        {content}
      </div>
    </main>
  )

  if (form.isPending) return shell(<p className="muted">{t('common.loading')}</p>)
  if (form.isError) return shell(<p className="empty">{t('pform.invalid')}</p>)
  if (submit.isSuccess) return shell(<div className="done-block"><h1>{t('pform.thanks')}</h1><p>{t('pform.thanksDetail')}</p></div>)

  const f = form.data
  const isConsent = f.kind === 'consent'
  const consentText = lang === 'ar' ? f.body.text_ar ?? f.body.text_en : f.body.text_en ?? f.body.text_ar
  const valid = name.trim().length >= 3 && !!signature && (!isConsent || agreed)

  function set(id: string, v: unknown) { setAnswers((a) => ({ ...a, [id]: v })) }
  function toggle(id: string, v: string) {
    setAnswers((a) => {
      const cur = new Set((a[id] as string[] | undefined) ?? [])
      if (v === 'none') return { ...a, [id]: cur.has('none') ? [] : ['none'] }
      cur.delete('none')
      if (cur.has(v)) cur.delete(v); else cur.add(v)
      return { ...a, [id]: [...cur] }
    })
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !submit.isPending) submit.mutate()
  }

  return shell(
    <form onSubmit={onSubmit} className="dialog-form">
      <div>
        <h1>{f.title}</h1>
        <p className="muted">{t('pform.hello', { name: f.patient_first_name })}</p>
      </div>

      {isConsent && consentText && (
        <>
          <p className="consent-text">{consentText}</p>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{t('pform.agree')}</span>
          </label>
        </>
      )}

      {(f.body.questions ?? []).map((q) => (
        <fieldset key={q.id} className="question">
          <legend>{qLabel(q, lang)}</legend>
          {q.type === 'text' && (
            <textarea rows={2} value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />
          )}
          {q.type === 'yesno' && (
            <div className="choice-row">
              {(['yes', 'no'] as const).map((v) => (
                <label key={v} className={`choice ${answers[q.id] === v ? 'is-on' : ''}`}>
                  <input type="radio" name={q.id} checked={answers[q.id] === v} onChange={() => set(q.id, v)} />
                  {t(`pform.${v}`)}
                </label>
              ))}
            </div>
          )}
          {q.type === 'multi' && (
            <div className="choice-row">
              {q.options.map((o) => {
                const v = optionValue(o)
                const on = ((answers[q.id] as string[] | undefined) ?? []).includes(v)
                return (
                  <label key={v} className={`choice ${on ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(q.id, v)} />
                    {optionLabel(o, lang)}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
      ))}

      <label className="field">
        <span>{t('pform.fullName')}</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <div className="field">
        <span>{t('pform.signature')}</span>
        <SignaturePad onChange={setSignature} />
      </div>

      {submit.isError && <p className="form-error" role="alert">{t('pform.failed')}</p>}
      <button type="submit" className="btn btn-primary" disabled={!valid || submit.isPending}>
        {submit.isPending ? t('common.saving') : t('pform.submit')}
      </button>
      <p className="hint">{t('pform.privacy')}</p>
    </form>,
  )
}
