import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'

type Sub = { plan: string; price: number | null; renews_on: string | null; chairs: number; users: number; assistant_used: number; assistant_limit: number }

async function getSub(clinicId: string): Promise<Sub> {
  const { data, error } = await supabase.rpc('subscription_status', { p_clinic: clinicId })
  if (error) throw error
  return data as unknown as Sub
}

export function SubscriptionCard() {
  const { clinicId } = useMember()
  const { t, money, lang } = useI18n()
  const q = useQuery({ queryKey: ['subscription', clinicId], queryFn: () => getSub(clinicId) })
  const s = q.data
  if (!s) return null
  const pct = s.assistant_limit > 0 ? Math.min(100, (s.assistant_used / s.assistant_limit) * 100) : 0
  const renew = s.renews_on
    ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long' }).format(new Date(`${s.renews_on}T12:00:00`))
    : null
  return (
    <section className="panel st-panel st-sub">
      <div className="panel-head"><h2>{t('st.subscription')}</h2><span className="st-badge">{t('st.active')}</span></div>
      <div className="st-plan">
        <b>{t(`st.plan.${s.plan}` as MessageKey)}</b>
        {s.price != null && <span><strong>{money(s.price)}</strong> / {t('st.month')}</span>}
      </div>
      <p className="muted small st-sub-line">
        {[t('st.nChairs', { n: s.chairs }), t('st.nUsers', { n: s.users }), renew ? t('st.renews', { date: renew }) : ''].filter(Boolean).join(' · ')}
      </p>
      <div className="st-usage">
        <div><span>{t('st.assistantMonth')}</span><b>{t('st.ofQuestions', { a: s.assistant_used, b: s.assistant_limit })}</b></div>
        <div className="rp-track"><i style={{ width: `${pct}%` }} /></div>
      </div>
      <a className="btn st-manage" href="https://derops.dev" target="_blank" rel="noreferrer">{t('st.manage')}</a>
    </section>
  )
}
