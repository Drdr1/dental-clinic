import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Icon } from '../../components/Icon'
import { getTimeline, type EventKind } from './timeline'

const icons: Record<EventKind, string> = {
  session: 'patients', prescription: 'alert', lab_sent: 'lab', lab_fitted: 'lab', form: 'today', plan: 'materials',
}

/** The patient's medical history: what actually happened, newest first. */
export function Timeline({ patientId }: { patientId: string }) {
  const { t, date } = useI18n()
  const q = useQuery({ queryKey: ['timeline', patientId], queryFn: () => getTimeline(patientId) })
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

  if (q.isPending) return <Skeleton rows={5} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  if (!q.data.length) return <p className="muted">{t('timeline.empty')}</p>

  return (
    <ol className="timeline">
      {q.data.map((e) => (
        <li key={e.id} className={`tl-${e.kind}`}>
          <span className="tl-dot"><Icon name={icons[e.kind]} /></span>
          <div className="tl-body">
            <div className="tl-head">
              <strong>{t(e.title as Parameters<typeof t>[0])}</strong>
              <span className="muted">{date(e.at)}{(e.at ?? '').includes('T') && !e.at.endsWith('T09:00:00') ? ` · ${fmt.format(new Date(e.at))}` : ''}</span>
              {e.link && <Link to={e.link} className="tl-link">{t('timeline.open')}</Link>}
            </div>
            {e.details.length > 0 && <p className="tl-details">{e.details.join(' · ')}</p>}
            {e.warn && <p className="warn-text tl-details">{t('timeline.override', { reason: e.warn })}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
