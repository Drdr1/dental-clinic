import { NavLink, Outlet } from 'react-router'
import { useAuth, useMember } from '../features/auth/AuthProvider'
import { useI18n } from '../i18n'
import { ToothMark } from './ToothMark'

export function AppShell() {
  const member = useMember()
  const { signOut } = useAuth()
  const { t, lang, setLang } = useI18n()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ToothMark className="brand-mark" />
          <span className="brand-name">{member.clinicName || t('appName')}</span>
        </div>
        <nav className="nav">
          <NavLink to="/today" className="nav-link">{t('nav.today')}</NavLink>
          <NavLink to="/patients" className="nav-link">{t('nav.patients')}</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="whoami">
            <span className="whoami-name">{member.displayName}</span>
            <span className="whoami-role">{t(`role.${member.role}`)}</span>
          </div>
          <button className="link-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {t('nav.language')}
          </button>
          <button className="link-btn" onClick={signOut}>{t('nav.signOut')}</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
