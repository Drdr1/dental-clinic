import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { AUDIT_CATEGORIES, PAGE, getAudit, getAuditWeek, type AuditFilter, type AuditRow } from './auditApi'
import { catKey, describe, type T } from './auditText'


/** Fills `{key}` slots in a message with React nodes (or plain text for the export). */
function fill(tpl: string, vals: Record<string, ReactNode>): ReactNode[] {
  return tpl.split(/(\{\w+\})/).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/)
    return <Fragment key={i}>{m ? vals[m[1]] ?? '' : part}</Fragment>
  })
}
function Sentence({ r, i }: { r: AuditRow; i: T }) {
  const d = describe(r, i)
  const nodes: Record<string, ReactNode> = {}
  for (const [k, v] of Object.entries(d.vals)) {
    const kind = d.rich[k]
    if (kind === 'b') nodes[k] = <b><bdi>{v}</bdi></b>
    else if (kind === 'old') nodes[k] = <s className="au-old"><bdi>{v}</bdi></s>
    else if (kind === 'patient' && r.patient_id && v) nodes[k] = <Link className="au-patient" to={`/patients/${r.patient_id}`}>{v}</Link>
    else nodes[k] = v
  }
  return (
    <>
      <p className="au-main">{fill(i.t(d.key), nodes)}</p>
      {d.sub.length > 0 && <p className="au-sub">{d.sub.join(' · ')}</p>}
    </>
  )
}


function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function AuditLog({ f, setF }: { f: AuditFilter; setF: (f: AuditFilter) => void }) {
  const { clinicId } = useMember()
  const i = useI18n()
  const { t, lang } = i
  const week = useQuery({ queryKey: ['audit-week', clinicId], queryFn: () => getAuditWeek(clinicId) })
  const q = useInfiniteQuery({
    queryKey: ['audit', clinicId, f],
    queryFn: ({ pageParam }) => getAudit(clinicId, f, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].at : undefined),
  })
  const rows = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const [now] = useState(() => Date.now())
  const today = dayKey(new Date(now).toISOString())
  const yesterday = dayKey(new Date(now - 864e5).toISOString())

  const groups: { key: string; label: string; rows: AuditRow[] }[] = []
  for (const r of rows) {
    const k = dayKey(r.at)
    let g = groups[groups.length - 1]
    if (!g || g.key !== k) {
      const name = dayFmt.format(new Date(r.at))
      g = { key: k, label: k === today ? t('au.today', { day: name }) : k === yesterday ? t('au.yesterday', { day: name }) : name, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }

  const people = week.data?.people ?? []


  return (
    <div className="au-grid">
      <section className="panel au-panel">
        <div className="au-cats">
          <button className={!f.category ? 'on' : ''} onClick={() => setF({ ...f, category: null })}>{t('au.all')}</button>
          {AUDIT_CATEGORIES.map((c) => (
            <button key={c} className={f.category === c ? 'on' : ''} onClick={() => setF({ ...f, category: c })}>{t(catKey(c))}</button>
          ))}
        </div>
        <div className="au-tools">
          <label className="au-switch">
            <input type="checkbox" checked={f.sensitive} onChange={(e) => setF({ ...f, sensitive: e.target.checked })} />
            <i aria-hidden="true" />
            <span>{t('au.onlySensitive')}</span>
          </label>
          <select className="au-select" value={f.actor ?? ''} onChange={(e) => setF({ ...f, actor: e.target.value || null })}>
            <option value="">{t('au.everyone')}</option>
            {people.map((p) => <option key={p.actor ?? 'none'} value={p.actor ?? 'none'}>{p.actor ? p.name : t('au.system')}</option>)}
          </select>
        </div>

        {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
        {q.isSuccess && rows.length === 0 && <p className="muted">{t('au.empty')}</p>}

        {groups.map((g) => (
          <div key={g.key} className="au-day">
            <div className="au-day-head"><h3>{g.label}</h3><span>{t('au.nChanges', { n: g.rows.length })}</span></div>
            <ul className="au-list">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <span className="au-time">{timeFmt.format(new Date(r.at))}</span>
                  <div className="au-body">
                    <p className="au-who"><b>{r.actor_name ?? t('au.system')}</b>{r.actor_role && <span>{t(`role.${r.actor_role}`)}</span>}</p>
                    <Sentence r={r} i={i} />
                  </div>
                  <span className="au-tags">
                    <span className="rp-tag">{t(catKey(r.category))}</span>
                    {r.sensitive && <span className="rp-tag is-danger">{t('au.sensitive')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {q.hasNextPage && (
          <button className="btn au-more" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? t('common.loading') : t('au.older')}
          </button>
        )}
      </section>

      <div className="au-side">
        <section className="panel au-panel">
          <h2>{t('au.thisWeek')}</h2>
          <div className="au-week">
            <div><span>{t('au.allChanges')}</span><b>{week.data?.total ?? '—'}</b></div>
            <div className="is-danger"><span>{t('au.sensitiveN')}</span><b>{week.data?.sensitive ?? '—'}</b></div>
          </div>
          <ul className="au-people">
            {people.map((p) => (
              <li key={p.actor ?? 'none'}>
                <b>{p.actor ? p.name : t('au.system')}</b>
                <span>
                  <span className="muted small">{t('au.nChanges', { n: p.n })}</span>
                  {p.sensitive > 0 && <span className="rp-tag is-danger">{t('au.nSensitive', { n: p.sensitive })}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel au-panel">
          <h2>{t('au.whatSensitive')}</h2>
          <ul className="au-rules">
            <li>{t('au.rule1')}</li><li>{t('au.rule2')}</li><li>{t('au.rule3')}</li><li>{t('au.rule4')}</li><li>{t('au.rule5')}</li>
          </ul>
          <p className="au-note">{t('au.locked')}</p>
        </section>
      </div>
    </div>
  )
}
