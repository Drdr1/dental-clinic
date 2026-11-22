import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { useI18n } from '../../i18n'

export function LoginPage() {
  const { session, loading } = useAuth()
  const { t, lang, setLang } = useI18n()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 'credentials' only when the server really said the email or password is wrong;
  // anything else (no network, a wrong app key) says so, with the server's reason.
  const [forgot, setForgot] = useState(false)
  const [failed, setFailed] = useState<null | { kind: 'credentials' } | { kind: 'other'; detail: string }>(null)

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (!loading && session) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFailed(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)
    if (!error) return
    const bad = error.code === 'invalid_credentials' || (error.status === 400 && /invalid login/i.test(error.message))
    setFailed(bad ? { kind: 'credentials' } : { kind: 'other', detail: `${error.status ?? ''} ${error.message}`.trim() })
  }

  const logo = (cls: string) => (
    <div className={cls}>
      <span className="login-logo-mark">
        <svg aria-hidden="true" viewBox="0 0 48 48" fill="currentColor"><path d="M15 8c4 0 5 2 9 2s5-2 9-2c5 0 7 4 7 9 0 5-3 7-4 12-.5 3-1.2 9-3.5 9-2.8 0-2.5-10-8.5-10s-5.7 10-8.5 10c-2.3 0-3-6-3.5-9-1-5-4-7-4-12 0-5 2-9 7-9z" /></svg>
      </span>
      <b>ضرس <span dir="ltr">Ders</span></b>
    </div>
  )

  return (
    <main className="login">
      <aside className="login-brand">
        {logo('login-logo')}
        <div className="login-pitch">
          <h2>{t('login.pitch')}</h2>
          <p>{t('login.pitchSub')}</p>
        </div>
        <span className="login-by">{t('login.by')}</span>
      </aside>

      <div className="login-side">
        <form className="login-card" onSubmit={onSubmit}>
          {logo('login-logo login-phone-logo')}
          <div>
            <h1>{t('login.heading')}</h1>
            <span className="muted">{t('login.sub')}</span>
          </div>
          <label className="field">
            <span>{t('login.email')}</span>
            <input type="email" dir="ltr" autoComplete="username" required value={email} placeholder="name@clinic.eg"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('login.password')}</span>
            <input type="password" dir="ltr" autoComplete="current-password" required value={password} placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {failed?.kind === 'credentials' && <p className="form-error" role="alert">{t('login.failed')}</p>}
          {failed?.kind === 'other' && (
            <p className="form-error" role="alert">{t('login.unreachable')} <span dir="ltr" className="small">({failed.detail})</span></p>
          )}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? t('login.submitting') : t('login.submit')}
          </button>
          <div className="login-links">
            <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot}>{t('login.forgot')}</button>
            <button type="button" dir={lang === 'ar' ? 'ltr' : 'rtl'} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('login.otherLang')}</button>
          </div>
          {forgot && <p className="login-note" role="status">{t('login.forgotNote')}</p>}
          <div className="login-demo">
            {t('login.notYet')} <a href="https://derops.dev" target="_blank" rel="noreferrer">{t('login.demo')}</a>
          </div>
        </form>
      </div>
    </main>
  )
}
