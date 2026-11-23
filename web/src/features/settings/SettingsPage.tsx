import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { useFeature, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { ErrorNote } from '../../components/ErrorNote'
import { getSettings } from './api'
import { ClinicSection } from './ClinicSection'
import { ChairsSection, ProceduresSection } from './CatalogSection'
import { TeamSection } from './TeamSection'
import { DrugsSection } from './DrugsSection'
import { PayersSection } from './PayersSection'
import { PartnersSection } from './PartnersSection'
import { LabItemsSection } from './LabItemsSection'
import { BookingSection } from './BookingSection'
import { LogoSection } from './LogoSection'
import { DeletedPatientsSection } from './DeletedPatientsSection'
import { FeaturesSection } from './FeaturesSection'
import { SubscriptionCard } from './SubscriptionCard'
import { ReviewsSection } from './ReviewsSection'

type Tab = 'clinic' | 'hours' | 'prices' | 'features' | 'installments' | 'booking' | 'reviews' | 'team' | 'payers' | 'partners' | 'drugs' | 'deleted'

export function SettingsPage() {
  const { clinicId, role, clinicName } = useMember()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const hasInstallments = useFeature('installments')
  const hasLabs = useFeature('labs')
  const hasPayers = useFeature('payers')
  const q = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId), enabled: role === 'owner' })

  if (role !== 'owner') return <section className="page"><p className="empty">{t('settings.ownerOnly')}</p></section>

  const tabs: Tab[] = ['clinic', 'hours', 'prices', 'features', ...(hasInstallments ? ['installments' as const] : []), 'booking', 'reviews',
    'team', ...(hasPayers ? ['payers' as const] : []), 'partners', 'drugs', 'deleted']
  const asked = params.get('s') as Tab | null
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'clinic'

  let body: React.ReactNode
  if (q.isPending) body = <p className="muted">{t('common.loading')}</p>
  else if (q.isError) body = <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  else {
    const clinicKey = JSON.stringify(q.data.clinic)
    body = {
      clinic: <><ClinicSection key={clinicKey} initial={q.data.clinic} part="clinic" /><LogoSection /></>,
      hours: <><ClinicSection key={clinicKey} initial={q.data.clinic} part="hours" /><ChairsSection chairs={q.data.chairs} /></>,
      prices: <><ProceduresSection procedures={q.data.procedures} />{hasLabs && <LabItemsSection />}</>,
      features: <FeaturesSection />,
      installments: <ClinicSection key={clinicKey} initial={q.data.clinic} part="installments" />,
      booking: <BookingSection />,
      reviews: <ReviewsSection />,
      team: <TeamSection />,
      payers: <PayersSection />,
      partners: <PartnersSection />,
      drugs: <DrugsSection />,
      deleted: <DeletedPatientsSection />,
    }[tab]
  }

  return (
    <section className="page settings st-page">
      <header className="page-head">
        <div>
          <h1>{t('settings.title')}</h1>
          <p className="muted">{clinicName} · {t('fin.ownerOnlyShort')}</p>
        </div>
      </header>
      <div className="st-grid">
        <nav className="panel st-nav" aria-label={t('settings.title')}>
          {tabs.map((k) => (
            <button key={k} className={k === tab ? 'on' : ''} aria-current={k === tab ? 'page' : undefined}
              onClick={() => setParams(k === 'clinic' ? {} : { s: k }, { replace: true })}>
              {t(`st.tab.${k}` as MessageKey)}
            </button>
          ))}
        </nav>
        <div className="st-body">{body}</div>
        <aside className="st-aside"><SubscriptionCard /></aside>
      </div>
    </section>
  )
}
