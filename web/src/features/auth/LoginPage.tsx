import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { useI18n } from '../../i18n'
import { DersMark } from '../../components/DersMark'

export function LoginPage() {
  const { session, loading } = useAuth()
  const { t, lang, setLang } = useI18n()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (!loading && session) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)
    if (error) setFailed(true)
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <DersMark className="login-mark" />
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
        {failed && <p className="form-error" role="alert">{t('login.failed')}</p>}
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
