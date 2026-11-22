import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { createStaff, getTeam, setStaffPassword, updateMember } from './api'

function suggestPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function AddStaffDialog({ onClose, initialRole = 'receptionist' }: { onClose: () => void; initialRole?: 'receptionist' | 'doctor' }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(suggestPassword)
  const [role, setRole] = useState<'receptionist' | 'doctor'>(initialRole)

  const create = useMutation({
    mutationFn: () => createStaff(clinicId, { email: email.trim(), password, display_name: name.trim(), role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  })

  if (create.isSuccess) {
    return (
      <Modal title={t('team.created')} onClose={onClose}>
        <p>{t('team.handOver')}</p>
        <dl className="credentials" dir="ltr">
          <div><dt>Email</dt><dd>{email.trim()}</dd></div>
          <div><dt>Password</dt><dd>{password}</dd></div>
        </dl>
        <p className="hint">{t('team.handOverHint')}</p>
        <div className="dialog-actions"><button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button></div>
      </Modal>
    )
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!create.isPending) create.mutate()
  }

  return (
    <Modal title={t('team.add')} onClose={onClose}>
      <form className="dialog-form" onSubmit={onSubmit}>
        <label className="field">
          <span>{t('team.name')}</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </label>
        <label className="field">
          <span>{t('login.email')}</span>
          <input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>{t('login.password')}</span>
            <input required minLength={8} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span>{t('team.role')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'receptionist' | 'doctor')}>
              <option value="receptionist">{t('role.receptionist')}</option>
              <option value="doctor">{t('role.doctor')}</option>
            </select>
          </label>
        </div>
        <small className="hint">{role === 'doctor' ? t('team.doctorHint') : t('team.receptionHint')}</small>
        {create.isError && <ErrorNote error={create.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('team.create')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PasswordDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [password, setPassword] = useState(suggestPassword)
  const save = useMutation({ mutationFn: () => setStaffPassword(clinicId, userId, password) })

  return (
    <Modal title={t('team.resetTitle', { name })} onClose={onClose}>
      {save.isSuccess ? (
        <>
          <p>{t('team.resetDone')}</p>
          <dl className="credentials" dir="ltr"><div><dt>Password</dt><dd>{password}</dd></div></dl>
          <div className="dialog-actions"><button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button></div>
        </>
      ) : (
        <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate() }}>
          <label className="field">
            <span>{t('team.newPassword')}</span>
            <input required minLength={8} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {save.isError && <ErrorNote error={save.error} />}
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>{t('team.resetSubmit')}</button>
            <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function CommissionInput({ clinicId, userId, value }: { clinicId: string; userId: string; value: number }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [draft, setDraft] = useState(String(value))
  const [justSaved, setJustSaved] = useState(false)
  const save = useMutation({
    mutationFn: (v: number) => updateMember(clinicId, userId, { commission_percent: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    },
  })
  const n = Number(draft)
  const changed = draft !== String(value)
  const valid = draft !== '' && Number.isFinite(n) && n >= 0 && n <= 100

  return (
    <span className="inline-controls">
      <input className="cell-input num-input" type="number" min={0} max={100} step={1} dir="ltr"
        value={draft} aria-label={t('team.commission')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && changed && valid) save.mutate(n) }} />
      <span className="muted">%</span>
      {/* An explicit save, so it's never unclear whether the number stuck. */}
      {changed && (
        <button className="btn btn-small btn-primary" disabled={!valid || save.isPending}
          onClick={() => save.mutate(n)}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      )}
      {!changed && justSaved && <span className="ok-text small">{t('common.saved')}</span>}
      {save.isError && <span className="danger-text small">{t('common.saveFailed')}</span>}
    </span>
  )
}

export function TeamSection() {
  const { clinicId } = useMember()
  const { session } = useAuth()
  const { t, date } = useI18n()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null)
  const team = useQuery({ queryKey: ['team', clinicId], queryFn: () => getTeam(clinicId) })
  const me = session?.user.id

  const update = useMutation({
    mutationFn: (a: { userId: string; patch: { role?: 'doctor' | 'receptionist'; active?: boolean } }) =>
      updateMember(clinicId, a.userId, a.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('team.title')}</h2>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('team.add')}</button>
      </div>
      {team.isError && <ErrorNote error={team.error} onRetry={() => team.refetch()} />}
      {update.isError && <ErrorNote error={update.error} />}
      {team.data && (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>{t('team.name')}</th>
                <th>{t('login.email')}</th>
                <th>{t('team.role')}</th>
                <th>{t('team.commission')}</th>
                <th>{t('team.lastSignIn')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.data.map((m) => {
                const isMe = m.user_id === me
                const isOwner = m.role === 'owner'
                return (
                  <tr key={m.user_id} className={m.active ? '' : 'is-inactive'}>
                    <td>{m.display_name}{isMe && <span className="muted"> {t('team.you')}</span>}</td>
                    <td dir="ltr" className="phone">{m.email}</td>
                    <td>
                      {isOwner || isMe ? t(`role.${m.role}`) : (
                        <select className="cell-select" value={m.role} disabled={update.isPending}
                          onChange={(e) => update.mutate({ userId: m.user_id, patch: { role: e.target.value as 'doctor' | 'receptionist' } })}>
                          <option value="receptionist">{t('role.receptionist')}</option>
                          <option value="doctor">{t('role.doctor')}</option>
                        </select>
                      )}
                      {!m.active && <span className="badge badge-muted"> {t('team.inactive')}</span>}
                    </td>
                    <td>
                      {m.role === 'receptionist' ? <span className="muted">—</span> : (
                        <CommissionInput key={`${m.user_id}-${m.commission_percent}`} clinicId={clinicId} userId={m.user_id} value={Number(m.commission_percent ?? 0)} />
                      )}
                    </td>
                    <td className="muted">{m.last_sign_in ? date(m.last_sign_in) : t('team.never')}</td>
                    <td className="num">
                      <span className="payment-actions">
                        {(!isOwner || isMe) && (
                          <button className="link-btn" onClick={() => setResetting({ id: m.user_id, name: m.display_name })}>
                            {t('team.resetPassword')}
                          </button>
                        )}
                        {!isOwner && !isMe && (
                          <button className={`link-btn ${m.active ? 'danger-link' : ''}`} disabled={update.isPending}
                            onClick={() => update.mutate({ userId: m.user_id, patch: { active: !m.active } })}>
                            {m.active ? t('team.deactivate') : t('team.activate')}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{t('team.deactivateHint')}</p>
      {adding && <AddStaffDialog onClose={() => setAdding(false)} />}
      {resetting && <PasswordDialog userId={resetting.id} name={resetting.name} onClose={() => setResetting(null)} />}
    </section>
  )
}
