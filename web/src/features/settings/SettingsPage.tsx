import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
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

export function SettingsPage() {
  const { clinicId, role } = useMember()
  const { t } = useI18n()
  const q = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId), enabled: role === 'owner' })

  if (role !== 'owner') return <section className="page"><p className="empty">{t('settings.ownerOnly')}</p></section>
  if (q.isPending) return <section className="page"><p className="muted">{t('common.loading')}</p></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>

  return (
    <section className="page settings">
      <header className="page-head"><h1>{t('settings.title')}</h1></header>
      <ClinicSection key={JSON.stringify(q.data.clinic)} initial={q.data.clinic} />
      <ProceduresSection procedures={q.data.procedures} />
      <div className="settings-grid">
        <ChairsSection chairs={q.data.chairs} />
      </div>
      <LogoSection />
      <BookingSection />
      <LabItemsSection />
      <PayersSection />
      <DrugsSection />
      <TeamSection />
      <PartnersSection />
      <DeletedPatientsSection />
    </section>
  )
}
