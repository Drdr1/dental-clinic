import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useMember } from '../features/auth/AuthProvider'
import { useI18n } from '../i18n'
import { daysBetween, getPlanState, getSub } from '../features/settings/subscription'

/** Trial ending, payment late, or read-only: one line at the top of every page. */
export function SubscriptionBanner() {
  const { clinicId, role } = useMember()
  const { t } = useI18n()
  const state = useQuery({ queryKey: ['plan-state', clinicId], queryFn: () => getPlanState(clinicId), staleTime: 10 * 60_000 })
  const isOwner = role === 'owner'
  const sub = useQuery({ queryKey: ['subscription', clinicId], queryFn: () => getSub(clinicId), enabled: isOwner && state.data !== 'active' })
  const s = state.data
  if (!s || s === 'active') return null
  if (s === 'trial') {
    if (!isOwner || !sub.data?.trial_ends_on) return null
    const left = daysBetween(sub.data.today, sub.data.trial_ends_on)
    if (left > 3) return null
    return <div className="sub-banner"><span>{t('sub.trialEnds', { n: Math.max(0, left) })}</span><Link to="/settings">{t('sub.see')}</Link></div>
  }
  if (s === 'past_due') {
    return (
      <div className="sub-banner is-warn">
        <span>{isOwner ? t('sub.pastDueOwner') : t('sub.pastDue')}</span>
        {isOwner && <Link to="/settings">{t('sub.see')}</Link>}
      </div>
    )
  }
  return (
    <div className="sub-banner is-danger">
      <span>{isOwner ? t('sub.suspendedOwner') : t('sub.suspended')}</span>
      {isOwner && <Link to="/settings">{t('sub.see')}</Link>}
    </div>
  )
}
