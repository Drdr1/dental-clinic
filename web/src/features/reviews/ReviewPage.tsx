import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ToothMark } from '../../components/ToothMark'
import { Icon } from '../../components/Icon'
import { ErrorNote } from '../../components/ErrorNote'
import { whatsappLink } from '../../lib/phone'
import { getReview, submitReview, wentToGoogle, type PublicReview } from './api'

const STAR = 'M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'

function Done({ r, token }: { r: PublicReview; token: string }) {
  const { t } = useI18n()
  const [later, setLater] = useState(false)
  const happy = (r.rating ?? 0) >= 4
  const google = r.google_url && (
    <a className={`btn ${happy ? 'btn-primary' : 'btn-link'} rv-wide`} href={r.google_url} target="_blank" rel="noreferrer"
      onClick={() => { void wentToGoogle(token) }}>
      {t('rv.google')}
    </a>
  )
  if (happy) {
    return (
      <>
        <div className="rv-body">
          <span className="rv-icon"><Icon name="check" /></span>
          <h1>{t('rv.thanks', { name: r.patient })}</h1>
          <p>{r.google_url && !later ? t('rv.thanksGoogle') : t('rv.thanksPlain')}</p>
          <span className="rv-stars-done">{[1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 24 24" className={i <= (r.rating ?? 0) ? 'on' : ''}><path d={STAR} /></svg>)}</span>
        </div>
        {r.google_url && !later && (
          <div className="rv-foot">
            {google}
            <button className="btn rv-wide" onClick={() => setLater(true)}>{t('rv.later')}</button>
          </div>
        )}
      </>
    )
  }
  return (
    <>
      <div className="rv-body">
        <span className="rv-icon"><Icon name="chat" /></span>
        <h1>{t('rv.received')}</h1>
        <p>{r.doctor ? t('rv.sorryDoctor', { doctor: r.doctor }) : t('rv.sorry')}</p>
      </div>
      <div className="rv-foot">
        {r.whatsapp && (
          <a className="btn rv-wide" href={whatsappLink(r.whatsapp)} target="_blank" rel="noreferrer"><Icon name="chat" />{t('rv.whatsapp')}</a>
        )}
        {google}
      </div>
    </>
  )
}

export function ReviewPage() {
  const { token = '' } = useParams()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['public-review', token], queryFn: () => getReview(token) })
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const send = useMutation({
    mutationFn: () => submitReview(token, stars, comment),
    onSuccess: (r) => qc.setQueryData(['public-review', token], r),
  })
  const r = q.data

  return (
    <main className="rv-page">
      <div className="rv-card">
        <header className="rv-head">
          <span className="rv-logo">{r?.logo_url ? <img src={r.logo_url} alt="" /> : <ToothMark />}</span>
          <b>{r?.clinic ?? ''}</b>
        </header>
        {q.isPending && <div className="rv-body"><p className="muted">{t('common.loading')}</p></div>}
        {q.isError && <div className="rv-body"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></div>}
        {q.isSuccess && !r && <div className="rv-body"><h1>{t('rv.notFound')}</h1></div>}
        {r && r.rating != null && <Done r={r} token={token} />}
        {r && r.rating == null && r.expired && <div className="rv-body"><h1>{t('rv.expired')}</h1></div>}
        {r && r.rating == null && !r.expired && (
          <form className="rv-form" onSubmit={(e) => { e.preventDefault(); if (stars && !send.isPending) send.mutate() }}>
            <div className="rv-body">
              <h1>{t('rv.hello', { name: r.patient })}</h1>
              <p>{r.doctor ? t('rv.howWas', { doctor: r.doctor }) : t('rv.howWasPlain')}</p>
              <div className="rv-stars" role="radiogroup" aria-label={t('rv.rate')}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={String(i)}
                    className={i <= stars ? 'on' : ''} onClick={() => setStars(i)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={STAR} /></svg>
                  </button>
                ))}
              </div>
              <div className="rv-scale"><span>{t('rv.bad')}</span><span>{t('rv.great')}</span></div>
              <label className="rv-comment">
                <span>{t('rv.say')}</span>
                <textarea rows={4} maxLength={1000} value={comment} placeholder={t('rv.sayPh')} onChange={(e) => setComment(e.target.value)} />
              </label>
              {send.isError && <ErrorNote error={send.error} />}
            </div>
            <div className="rv-foot">
              <button type="submit" className="btn btn-primary rv-wide" disabled={!stars || send.isPending}>{t('rv.send')}</button>
              <p className="rv-note">{t('rv.private')}</p>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
