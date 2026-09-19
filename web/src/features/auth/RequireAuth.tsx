import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './AuthProvider'
import { useI18n } from '../../i18n'

export function RequireAuth() {
  const { loading, session, member, signOut } = useAuth()
  const { t } = useI18n()
  const location = useLocation()

  if (loading) return <div className="splash">{t('common.loading')}</div>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!member) {
    return (
      <div className="splash">
        <p>{t('auth.noClinic')}</p>
        <button className="btn" onClick={signOut}>{t('nav.signOut')}</button>
      </div>
    )
  }
  return <Outlet />
}
