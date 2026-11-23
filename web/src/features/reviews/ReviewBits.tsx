import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Icon } from '../../components/Icon'
import { whatsappLink } from '../../lib/phone'
import { Stars } from '../reports/ReviewsPanel'
import { getFollowUps, requestReview, resolveReview, type ReviewRow } from './api'

/** Next to a finished visit on the Today schedule: ask for a review, or show how it went. */
export function ReviewCell({ appointmentId, patientName, phone, review }: {
  appointmentId: string; patientName: string; phone: string; review: ReviewRow | undefined
}) {
  const { clinicName } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const ask = useMutation({
    mutationFn: async () => {
      // Open the tab now, while the click still counts, then point it at WhatsApp.
      const w = window.open('', '_blank')
      try {
        const link = await requestReview(appointmentId)
        const first = patientName.trim().split(/\s+/)[0] ?? ''
        const text = t('rv.message', { name: first, clinic: clinicName, link })
        const url = phone ? `${whatsappLink(phone)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
        if (w) w.location.href = url
        else window.location.href = url
      } catch (e) {
        w?.close()
        throw e
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['reviews-today'] }),
  })

  if (review?.rating != null) {
    return review.rating <= 3 && !review.resolved_at
      ? <span className="rv-cell"><Stars value={review.rating} size={12} /><span className="rp-tag is-danger">{t('rv.needsFollowUp')}</span></span>
      : <span className="rv-cell"><Stars value={review.rating} size={12} /><span className="muted small">{t('rv.rated')}</span></span>
  }
  if (review) {
    return (
      <button className="rv-cell rv-sent" onClick={() => ask.mutate()} disabled={ask.isPending} title={t('rv.resend')}>
        {t('rv.sentWaiting')}
      </button>
    )
  }
  return (
    <button className="btn btn-small" onClick={() => ask.mutate()} disabled={ask.isPending}>
      <Icon name="chat" />{t('rv.ask')}
    </button>
  )
}

/** Owner sees every low rating still open; a doctor sees their own visits. */
export function FollowUpCard() {
  const { clinicId, role, userId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['review-followups', clinicId], queryFn: () => getFollowUps(clinicId), enabled: role !== 'receptionist' })
  const resolve = useMutation({
    mutationFn: resolveReview,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['review-followups'] }); qc.invalidateQueries({ queryKey: ['reviews-today'] }) },
  })
  const rows = (q.data ?? []).filter((r) => role === 'owner' || r.doctor_id === userId)
  if (rows.length === 0) return null
  return (
    <section className="panel rv-follow">
      <div className="panel-head"><h2>{t('rv.followTitle')}</h2><span className="rp-tag is-danger">{rows.length}</span></div>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <div className="rv-follow-top">
              <Stars value={r.rating ?? 0} size={12} />
              <b>{t('rv.ratedVisit', { name: r.patients?.full_name ?? '', n: r.rating ?? 0 })}</b>
            </div>
            {r.comment && <p>«{r.comment}»</p>}
            <div className="rp-low-btns">
              {r.patients?.phone && <a className="btn btn-small" href={whatsappLink(r.patients.phone)} target="_blank" rel="noreferrer"><Icon name="chat" />{t('rp.talk')}</a>}
              <button className="btn btn-small btn-ink" disabled={resolve.isPending} onClick={() => resolve.mutate(r.id)}>{t('rp.resolved')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
