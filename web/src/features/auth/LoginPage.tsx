import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { useI18n } from '../../i18n'
import { ToothMark } from '../../components/ToothMark'

export function LoginPage() {
  const { session, loading } = useAuth()
  const { t, lang, setLang } = useI18n()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 'credentials' only when the server really said the email or password is wrong;
  // anything else (no network, a wrong app key) says so, with the server's reason.
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

  return (
    <main className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <ToothMark className="login-mark" />
        <h1>{t('login.title')}</h1>
        <label className="field">
          <span>{t('login.email')}</span>
          <input type="email" dir="ltr" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('login.password')}</span>
          <input type="password" dir="ltr" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {failed?.kind === 'credentials' && <p className="form-error" role="alert">{t('login.failed')}</p>}
        {failed?.kind === 'other' && (
          <p className="form-error" role="alert">{t('login.unreachable')} <span dir="ltr" className="small">({failed.detail})</span></p>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>
        <button type="button" className="link-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {t('nav.language')}
        </button>
      </form>
    </main>
  )
}
