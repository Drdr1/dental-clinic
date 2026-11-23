import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'

async function getReviewSettings(clinicId: string) {
  const { data, error } = await supabase.from('clinics').select('reviews_enabled, google_review_url').eq('id', clinicId).single()
  if (error) throw error
  return data
}

function Form({ initial }: { initial: { reviews_enabled: boolean; google_review_url: string | null } }) {
  const { clinicId } = useMember()
  const { reloadMember } = useAuth()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [on, setOn] = useState(initial.reviews_enabled)
  const [url, setUrl] = useState(initial.google_review_url ?? '')
  const clean = url.trim()
  const valid = clean === '' || /^https:\/\/\S+$/i.test(clean)
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clinics').update({ reviews_enabled: on, google_review_url: clean || null }).eq('id', clinicId)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['review-settings'] }); reloadMember() },
  })
  return (
    <form className="panel st-panel" onSubmit={(e) => { e.preventDefault(); if (valid && !save.isPending) save.mutate() }}>
      <h2>{t('st.tab.reviews')}</h2>
      <p className="muted st-lead">{t('st.reviewsLead')}</p>
      <ul className="st-features">
        <li>
          <div><b>{t('st.reviewsAsk')}</b><span>{t('st.reviewsAskHint')}</span></div>
          <label className="au-switch">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label={t('st.reviewsAsk')} />
            <i aria-hidden="true" />
          </label>
        </li>
      </ul>
      <label className="field">
        <span>{t('st.googleLink')}</span>
        <input dir="ltr" value={url} placeholder="https://g.page/r/…/review" maxLength={300} aria-invalid={!valid}
          onChange={(e) => setUrl(e.target.value)} />
        <small className="hint">{t('st.googleLinkHint')}</small>
      </label>
      {!valid && <p className="form-error">{t('st.googleLinkBad')}</p>}
      {save.isError && <ErrorNote error={save.error} />}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</button>
        {save.isSuccess && !save.isPending && <span className="ok-text">{t('settings.saved')}</span>}
      </div>
    </form>
  )
}

export function ReviewsSection() {
  const { clinicId } = useMember()
  const q = useQuery({ queryKey: ['review-settings', clinicId], queryFn: () => getReviewSettings(clinicId) })
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return null
  return <Form key={JSON.stringify(q.data)} initial={q.data} />
}
