import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../features/auth/AuthProvider'
import { searchMyPatients, searchPatients } from '../features/patients/api'
import { useDebounced } from '../lib/useDebounced'
import { useI18n } from '../i18n'
import { Icon } from './Icon'

type Target = { label: string; to: string; hint?: string }

/** Ctrl/⌘+K from anywhere: jump to a patient or a screen. */
export function QuickSearch() {
  const { clinicId, role, userId } = useMember()
  const { t, money } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const term = useDebounced(q, 200)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])

  const patients = useQuery({
    queryKey: ['patients', clinicId, term, role],
    queryFn: () => (role === 'doctor' ? searchMyPatients(clinicId, userId, term) : searchPatients(clinicId, term)),
    enabled: open && term.trim().length >= 2,
  })

  const pages: Target[] = [
    { label: t('nav.today'), to: '/today' },
    { label: t('nav.appointments'), to: '/appointments' },
    { label: t('nav.patients'), to: '/patients' },
    { label: t('nav.labs'), to: '/labs' },
    { label: t('nav.materials'), to: '/materials' },
    ...(role === 'owner' ? [
      { label: t('nav.finance'), to: '/finance' },
      { label: t('nav.cash'), to: '/cash' },
      { label: t('nav.settings'), to: '/settings' },
    ] : []),
  ].filter((p) => !q.trim() || p.label.includes(q.trim()))

  const results: Target[] = [
    ...(patients.data ?? []).slice(0, 6).map((p) => ({
      label: p.full_name, to: `/patients/${p.id}`,
      hint: p.outstanding > 0 ? money(p.outstanding) : p.phone,
    })),
    ...pages,
  ]

  function close() {
    setOpen(false)
    setQ('')
    setActive(0)
  }
  function go(target?: Target) {
    const item = target ?? results[active]
    if (!item) return
    dialog.current?.close()
    navigate(item.to)
  }

  if (!open) return null
  return (
    <dialog ref={dialog} className="dialog quick" onClose={close} aria-label={t('quick.title')}>
      <div className="quick-box">
        <div className="quick-input">
          <Icon name="search" />
          <input autoFocus value={q} placeholder={t('quick.placeholder')}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); go() }
            }} />
        </div>
        <ul className="quick-list">
          {results.map((r, i) => (
            <li key={r.to}>
              <button className={i === active ? 'is-active' : ''} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
                <span>{r.label}</span>
                {r.hint && <span className="muted" dir="ltr">{r.hint}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="quick-empty muted">{t('quick.nothing')}</li>}
        </ul>
        <p className="quick-foot muted">{t('quick.hint')}</p>
      </div>
    </dialog>
  )
}
