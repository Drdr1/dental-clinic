import { useI18n } from '../i18n'

const tone: Record<string, string> = {
  draft: 'neutral',
  presented: 'info',
  declined: 'muted',
  active: 'ok',
  completed: 'muted',
  cancelled: 'muted',
}

export function PlanStatusBadge({ status }: { status: string | null }) {
  const { t } = useI18n()
  if (!status) return null
  const key = `planStatus.${status}` as Parameters<typeof t>[0]
  return <span className={`badge badge-${tone[status] ?? 'neutral'}`}>{t(key)}</span>
}
