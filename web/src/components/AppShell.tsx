import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth, useMember } from '../features/auth/AuthProvider'
import { useI18n } from '../i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ToothMark } from './ToothMark'
import { Icon } from './Icon'
import { QuickSearch } from './QuickSearch'

function openQuickSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
}

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
  const isOwner = member.role === 'owner'
  // The drawer is reception's work too; the money reports are not.
  const canCash = isOwner || member.role === 'receptionist'

  // Phone: the rest of the menu lives in a sheet behind "المزيد".
  const [moreOpen, setMoreOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => { setMoreOpen(false); setUserOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!userOpen) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('.user-menu')) setUserOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setUserOpen(false) }
    document.addEventListener('mousedown', close); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [userOpen])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const mark = logo.data ? <img src={logo.data} alt="" className="brand-logo" /> : <ToothMark className="brand-mark" />

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

      {/* Desktop: a narrow icon rail. Every icon carries its name as a tooltip
          and for screen readers, so nothing is guessed from the picture alone. */}
      <aside className="rail" aria-label={t('appName')}>
        <Link to="/today" className="rail-logo" aria-label={member.clinicName || t('appName')} title={member.clinicName || t('appName')}>
          {logo.data ? <img src={logo.data} alt="" /> : <ToothMark className="rail-mark" />}
        </Link>
        <nav className="rail-nav">
          <RailLink to="/today" icon="today" label={t('nav.today')} />
          <RailLink to="/appointments" icon="calendar" label={t('nav.appointments')} />
          <RailLink to="/patients" icon="patients" label={t('nav.patients')} />
          <RailLink to="/labs" icon="lab" label={t('nav.labs')} />
          <RailLink to="/materials" icon="materials" label={t('nav.materials')} />
          <RailLink to="/assistant" icon="assistant" label={t('nav.assistant')} />
          {(canCash || isOwner) && <span className="rail-divider" aria-hidden="true" />}
          {canCash && <RailLink to="/cash" icon="cash" label={t('nav.cash')} />}
          {isOwner && <RailLink to="/finance" icon="finance" label={t('nav.finance')} />}
          {isOwner && <RailLink to="/doctors" icon="doctor" label={t('nav.doctors')} />}
          {isOwner && <RailLink to="/settings" icon="settings" label={t('nav.settings')} />}
        </nav>
      </aside>

      <main className="content">
        {/* Desktop top bar: search, the two things reception adds all day, and who is signed in. */}
        <div className="appbar">
          <button className="appbar-search" onClick={openQuickSearch}>
            <Icon name="search" />
            <span>{t('shell.search')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="appbar-actions">
            <button className="btn" onClick={() => navigate('/patients?new=1')}>{t('shell.newPatient')}</button>
            <button className="btn btn-primary" onClick={() => navigate('/appointments?new=1')}>{t('shell.newAppointment')}</button>
            <div className="user-menu">
              <button className="user-chip" onClick={() => setUserOpen((v) => !v)} aria-expanded={userOpen}>
                <span className="user-avatar"><Icon name="patients" /></span>
                <span className="user-text">
                  <b>{member.displayName}</b>
                  <span>{t(`role.${member.role}`)}</span>
                </span>
              </button>
              {userOpen && (
                <div className="user-pop" role="menu">
                  <button role="menuitem" onClick={() => { setUserOpen(false); setLang(lang === 'ar' ? 'en' : 'ar') }}>
                    <Icon name="globe" />{t('nav.language')}
                  </button>
                  <button role="menuitem" onClick={signOut}><Icon name="logout" />{t('nav.signOut')}</button>
                </div>
              )}
            </div>
          </div>
        </div>
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
              {isOwner && <NavLink to="/doctors" className="nav-link"><Icon name="doctor" />{t('nav.doctors')}</NavLink>}
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

function RailLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink to={to} className="rail-link" aria-label={label} title={label}>
      <Icon name={icon} />
      <span className="rail-tip" aria-hidden="true">{label}</span>
    </NavLink>
  )
}
