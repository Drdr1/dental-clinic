import { NavLink, Outlet } from 'react-router'
import { useAuth, useMember } from '../features/auth/AuthProvider'
import { useI18n } from '../i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ToothMark } from './ToothMark'
import { Icon } from './Icon'
import { QuickSearch } from './QuickSearch'

export function AppShell() {
  const member = useMember()
  // The clinic's own logo, if one was uploaded in Settings.
  const logo = useQuery({
    queryKey: ['clinic-logo', member.clinicId],
    queryFn: async () =>
      (await supabase.from('clinics').select('logo_url').eq('id', member.clinicId).single()).data?.logo_url ?? null,
    staleTime: 300_000,
  })
  const { signOut } = useAuth()
  const { t, lang, setLang } = useI18n()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {logo.data ? <img src={logo.data} alt="" className="brand-logo" /> : <ToothMark className="brand-mark" />}
          <span className="brand-name">{member.clinicName || t('appName')}</span>
        </div>
        <button className="quick-trigger" onClick={() => { const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }); window.dispatchEvent(e) }}>
          <Icon name="search" />
          <span>{t('quick.open')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="nav">
          <NavLink to="/today" className="nav-link"><Icon name="today" />{t('nav.today')}</NavLink>
          <NavLink to="/appointments" className="nav-link"><Icon name="calendar" />{t('nav.appointments')}</NavLink>
          <NavLink to="/patients" className="nav-link"><Icon name="patients" />{t('nav.patients')}</NavLink>
          <NavLink to="/labs" className="nav-link"><Icon name="lab" />{t('nav.labs')}</NavLink>
          <NavLink to="/materials" className="nav-link"><Icon name="materials" />{t('nav.materials')}</NavLink>
          {member.role === 'owner' && <NavLink to="/doctors" className="nav-link"><Icon name="patients" />{t('nav.doctors')}</NavLink>}
          {member.role === 'owner' && <NavLink to="/finance" className="nav-link"><Icon name="finance" />{t('nav.finance')}</NavLink>}
          {member.role === 'owner' && <NavLink to="/cash" className="nav-link"><Icon name="cash" />{t('nav.cash')}</NavLink>}
          {member.role === 'owner' && <NavLink to="/settings" className="nav-link"><Icon name="settings" />{t('nav.settings')}</NavLink>}
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
      <QuickSearch />
    </div>
  )
}
