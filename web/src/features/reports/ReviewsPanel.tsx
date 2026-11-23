import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { whatsappLink } from '../../lib/phone'
import { Icon } from '../../components/Icon'
import type { Report } from './api'
import { resolveReview } from '../reviews/api'

const STAR = 'M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'

export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  const full = Math.round(value)
  return (
    <span className="stars" aria-label={value.toFixed(1)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={i <= full ? 'on' : ''}>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  )
}

export function ReviewsPanel({ reviews }: { reviews: Report['reviews'] }) {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const resolve = useMutation({ mutationFn: resolveReview, onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }) })
  const dayFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long' })
  const fmt = (n: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB').format(n)
  const rv = reviews
  if (!rv || (rv.count === 0 && rv.low.length === 0)) {
    return (
      <section className="panel rp-panel">
        <div className="panel-head"><h2>{t('rp.reviews')}</h2></div>
        <p className="muted">{t('rp.noReviews')}</p>
      </section>
    )
  }
  const top = Math.max(1, ...Object.values(rv.dist))
  return (
    <section className="panel rp-panel">
      <div className="panel-head">
        <h2>{t('rp.reviews')}</h2>
        {rv.follow_up > 0 && <span className="pill pill-danger rp-pill">{t('rp.followUp', { n: fmt(rv.follow_up) })}</span>}
      </div>
      {rv.avg != null && <div className="rp-score">
        <strong>{rv.avg.toFixed(1)}</strong>
        <div>
          <Stars value={rv.avg} size={17} />
          <span className="muted small">{t('rp.replyRate', { n: fmt(rv.count), pct: rv.requested > 0 ? Math.round((rv.count / rv.requested) * 100) : 0 })}</span>
        </div>
      </div>}
      <ul className="rp-dist">
        {[5, 4, 3, 2, 1].map((s) => (
          <li key={s}>
            <span>{s}</span>
            <span className="stars"><svg width={12} height={12} viewBox="0 0 24 24" aria-hidden="true" className="on"><path d={STAR} /></svg></span>
            <div className="rp-track"><i className={s <= 3 ? 'is-ink' : ''} style={{ width: `${((rv.dist[s] ?? 0) / top) * 100}%` }} /></div>
            <span>{fmt(rv.dist[s] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <div className="rp-google"><span>{t('rp.toGoogle')}</span><b>{fmt(rv.google)}</b></div>
      {rv.low.length > 0 && (
        <div className="rp-low">
          <h3>{t('rp.lowTitle')}</h3>
          <ul>
            {rv.low.map((l) => (
              <li key={l.id}>
                <div className="rp-low-head"><b>{l.patient}</b><Stars value={l.stars} size={12} /></div>
                <p>{l.comment ? `«${l.comment}»` : t('rp.noComment')}</p>
                <div className="rp-low-foot">
                  <span className="muted small">{[l.doctor, l.at ? dayFmt.format(new Date(l.at)) : ''].filter(Boolean).join(' · ')}</span>
                  <span className="rp-low-btns">
                    {l.phone && <a className="btn btn-small" href={whatsappLink(l.phone)} target="_blank" rel="noreferrer"><Icon name="chat" />{t('rp.talk')}</a>}
                    <button className="btn btn-small btn-ink" disabled={resolve.isPending} onClick={() => resolve.mutate(l.id)}>{t('rp.resolved')}</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
