import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { ErrorNote } from '../../components/ErrorNote'

const FEATURES = ['installments', 'labs', 'commission', 'materials', 'booking', 'assistant', 'payers'] as const
type Feature = (typeof FEATURES)[number]

async function getFeatures(clinicId: string) {
  const { data, error } = await supabase.from('clinics').select('disabled_features, booking_enabled').eq('id', clinicId).single()
  if (error) throw error
  return data
}

export function FeaturesSection() {
  const { clinicId } = useMember()
  const { reloadMember } = useAuth()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['features', clinicId], queryFn: () => getFeatures(clinicId) })

  const toggle = useMutation({
    mutationFn: async ({ f, on }: { f: Feature; on: boolean }) => {
      const cur = q.data!
      const patch = f === 'booking'
        ? { booking_enabled: on }
        : { disabled_features: on ? cur.disabled_features.filter((x) => x !== f) : [...new Set([...cur.disabled_features, f])] }
      const { error } = await supabase.from('clinics').update(patch).eq('id', clinicId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['features'] })
      qc.invalidateQueries({ queryKey: ['booking-settings'] })
      reloadMember()
    },
  })

  const isOn = (f: Feature) => (f === 'booking' ? !!q.data?.booking_enabled : !q.data?.disabled_features.includes(f))

  return (
    <section className="panel st-panel">
      <h2>{t('st.features')}</h2>
      <p className="muted st-lead">{t('st.featuresLead')}</p>
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {toggle.isError && <ErrorNote error={toggle.error} />}
      <ul className="st-features">
        {FEATURES.map((f) => (
          <li key={f}>
            <div>
              <b>{t(`st.f.${f}` as MessageKey)}</b>
              <span>{t(`st.f.${f}Hint` as MessageKey)}</span>
            </div>
            <label className="au-switch">
              <input type="checkbox" checked={isOn(f)} disabled={!q.data || toggle.isPending}
                onChange={(e) => toggle.mutate({ f, on: e.target.checked })} aria-label={t(`st.f.${f}` as MessageKey)} />
              <i aria-hidden="true" />
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
