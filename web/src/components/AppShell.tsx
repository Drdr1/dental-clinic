import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth, useMember } from '../features/auth/AuthProvider'
import { useI18n } from '../i18n'
import { DersMark } from './DersMark'
import { Icon } from './Icon'
import { QuickSearch } from './QuickSearch'
import { SideRail } from './SideRail'
import { TopBar } from './TopBar'

function openQuickSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
}

export function AppShell() {
  const member = useMember()
  const { signOut } = useAuth()
  const { t, lang, setLang } = useI18n()
  const isOwner = member.role === 'owner'
  // The drawer is reception's work too; the money reports are not.
  const canCash = isOwner || member.role === 'receptionist'

  // Phone: the rest of the menu lives in a sheet behind "المزيد".
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const mark = <DersMark className="brand-mark" />

  return (
    <div className="shell">
      {/* Phone only: the clinic name goes home, the dots open everything else. */}
      <header className="topbar">
        <Link to="/today" className="brand">
          {mark}
          <span className="brand-name">{member.clinicName || t('appName')}</span>
        </Link>
        <button className="icon-btn" onClick={() => setMoreOpen((v) => !v)} aria-label={t('nav.more')}>
          <Icon name="more" />
        </button>
      </header>

      <SideRail clinicName={member.clinicName ?? ''} isOwner={isOwner} canCash={canCash} />

      <main className="content">
        <TopBar displayName={member.displayName} roleLabel={t(`role.${member.role}`)}
          onSearch={openQuickSearch} onSignOut={signOut} />
        <Outlet />
      </main>

      {/* Phone only: the four screens reception and the doctor use all day. */}
      <nav className="tabbar">
        <NavLink to="/today" className="tab"><Icon name="today" /><span>{t('nav.today')}</span></NavLink>
        <NavLink to="/appointments" className="tab"><Icon name="calendar" /><span>{t('nav.appointments')}</span></NavLink>
        <NavLink to="/patients" className="tab"><Icon name="patients" /><span>{t('nav.patients')}</span></NavLink>
        <button className={`tab${moreOpen ? ' is-on' : ''}`} onClick={() => setMoreOpen((v) => !v)}>
          <Icon name="more" /><span>{t('nav.more')}</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="whoami">
              <span className="whoami-name">{member.displayName}</span>
              <span className="whoami-role">{t(`role.${member.role}`)}</span>
            </div>
            <nav className="sheet-nav">
              <button className="nav-link" onClick={() => { setMoreOpen(false); openQuickSearch() }}>
                <Icon name="search" />{t('quick.open')}
              </button>
              <NavLink to="/assistant" className="nav-link"><Icon name="assistant" />{t('nav.assistant')}</NavLink>
              <NavLink to="/labs" className="nav-link"><Icon name="lab" />{t('nav.labs')}</NavLink>
              <NavLink to="/materials" className="nav-link"><Icon name="materials" />{t('nav.materials')}</NavLink>
              {isOwner && <NavLink to="/doctors" className="nav-link"><Icon name="patients" />{t('nav.doctors')}</NavLink>}
              {isOwner && <NavLink to="/finance" className="nav-link"><Icon name="finance" />{t('nav.finance')}</NavLink>}
              {canCash && <NavLink to="/cash" className="nav-link"><Icon name="cash" />{t('nav.cash')}</NavLink>}
              {isOwner && <NavLink to="/settings" className="nav-link"><Icon name="settings" />{t('nav.settings')}</NavLink>}
            </nav>
            <div className="sheet-foot">
              <button className="btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('nav.language')}</button>
              <button className="btn" onClick={signOut}>{t('nav.signOut')}</button>
            </div>
          </div>
        </div>
      )}

      <QuickSearch />
    </div>
  )
}
