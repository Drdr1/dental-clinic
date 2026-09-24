import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { todayLocal } from '../../lib/dates'
import { PAYMENT_METHODS, type PaymentMethod } from '../payments/api'
import { methodKey } from '../payments/labels'
import { getPayouts, recordPayout, saveDoctorProfile, type Doctor } from './api'

const DAYS = [0, 1, 2, 3, 4, 5, 6]   // 0 = Sunday

export function ProfileDialog({ doctor, onClose }: { doctor: Doctor; onClose: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [p, setP] = useState({
    specialty: doctor.specialty ?? '', phone: doctor.phone ?? '', registration_no: doctor.registration_no ?? '',
    work_days: doctor.work_days ?? [], works_from: doctor.works_from?.slice(0, 5) ?? '', works_to: doctor.works_to?.slice(0, 5) ?? '',
  })
  const save = useMutation({
    mutationFn: () => saveDoctorProfile(clinicId, doctor.user_id, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctors'] }); onClose() },
  })
  const toggleDay = (d: number) =>
    setP({ ...p, work_days: p.work_days.includes(d) ? p.work_days.filter((x) => x !== d) : [...p.work_days, d].sort() })

  return (
    <Modal title={t('doc.profileTitle', { name: doctor.display_name })} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate() }}>
        <div className="field-row">
          <label className="field"><span>{t('doc.specialty')}</span>
            <input value={p.specialty} onChange={(e) => setP({ ...p, specialty: e.target.value })}
              placeholder={t('doc.specialtyHint')} /></label>
          <label className="field"><span>{t('doc.phone')}</span>
            <input dir="ltr" inputMode="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></label>
        </div>

        <label className="field"><span>{t('doc.registration')}</span>
          <input dir="ltr" value={p.registration_no} onChange={(e) => setP({ ...p, registration_no: e.target.value })} />
          <small className="hint">{t('doc.registrationHint')}</small></label>

        <div className="field">
          <span>{t('doc.workDays')}</span>
          <div className="choice-row">
            {DAYS.map((d) => (
              <label key={d} className={`choice ${p.work_days.includes(d) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={p.work_days.includes(d)} onChange={() => toggleDay(d)} />
                {t(`day.${d}` as Parameters<typeof t>[0])}
              </label>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label className="field"><span>{t('doc.from')}</span>
            <input type="time" value={p.works_from} onChange={(e) => setP({ ...p, works_from: e.target.value })} /></label>
          <label className="field"><span>{t('doc.to')}</span>
            <input type="time" value={p.works_to} onChange={(e) => setP({ ...p, works_to: e.target.value })} /></label>
        </div>

        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PayoutDialog({ doctor, range, onClose }: {
  doctor: Doctor; range: { from: string; to: string }; onClose: () => void
}) {
  const { clinicId } = useMember()
  const { t, money, date } = useI18n()
  const qc = useQueryClient()
  const due = Math.round((doctor.earned - doctor.paid_all_time) * 100) / 100
  const [amount, setAmount] = useState(due > 0 ? String(due) : '')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidOn, setPaidOn] = useState(todayLocal())
  const [note, setNote] = useState('')
  const history = useQuery({ queryKey: ['payouts', doctor.user_id], queryFn: () => getPayouts(clinicId, doctor.user_id) })

  const save = useMutation({
    mutationFn: () => recordPayout({
      clinicId, userId: doctor.user_id, amount: Number(amount), method, paidOn,
      from: range.from, to: range.to, note,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['finance'] })
      onClose()
    },
  })

  return (
    <Modal title={t('doc.payTitle', { name: doctor.display_name })} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (Number(amount) > 0) save.mutate() }}>
        <dl className="totals wide">
          <div><dt>{t('doc.earnedPeriod')}</dt><dd>{money(doctor.earned)}</dd></div>
          <div><dt>{t('doc.paidTotal')}</dt><dd>{money(doctor.paid_all_time)}</dd></div>
          <div className="totals-net"><dt>{t('doc.balance')}</dt><dd>{money(due)}</dd></div>
        </dl>

        <div className="field-row">
          <label className="field"><span>{t('pay.amount')}</span>
            <input type="number" min="0.01" step="any" required dir="ltr" autoFocus
              value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span>{t('pay.method')}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </select></label>
          <label className="field"><span>{t('receipt.date')}</span>
            <input type="date" required max={todayLocal()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
        </div>

        <label className="field"><span>{t('pay.note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
        <p className="hint">{t('doc.payHint')}</p>

        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!(Number(amount) > 0) || save.isPending}>
            {save.isPending ? t('common.saving') : t('doc.pay')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>

        {(history.data?.length ?? 0) > 0 && (
          <>
            <hr className="rule" />
            <h3>{t('doc.payoutHistory')}</h3>
            <table className="table table-compact">
              <tbody>
                {history.data!.map((x) => (
                  <tr key={x.id}>
                    <td>{date(x.paid_on)}</td>
                    <td className="num">{money(x.amount)}</td>
                    <td className="muted">{t(methodKey(x.method))}</td>
                    <td className="muted">{x.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </form>
    </Modal>
  )
}
