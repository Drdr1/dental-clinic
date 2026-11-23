import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { ErrorNote } from '../../components/ErrorNote'
import { toIsoDate, todayLocal } from '../../lib/dates'
import { getReport, type Report } from './api'
import { ReviewsPanel, Stars } from './ReviewsPanel'

type Preset = 'this' | 'last' | 'three'

function rangeFor(p: Preset) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (p === 'this') return { from: toIsoDate(new Date(y, m, 1)), to: todayLocal() }
  if (p === 'last') return { from: toIsoDate(new Date(y, m - 1, 1)), to: toIsoDate(new Date(y, m, 0)) }
  return { from: toIsoDate(new Date(y, m - 2, 1)), to: todayLocal() }
}

const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function Bar({ label, sub, value, width }: { label: string; sub?: string; value: string; width: number }) {
  return (
    <li>
      <div className="rp-bar-head"><span>{label}{sub && <small> · {sub}</small>}</span><b>{value}</b></div>
      <div className="rp-track"><i style={{ width: `${Math.max(0, Math.min(100, width))}%` }} /></div>
    </li>
  )
}

function hourLabel(h: number) {
  const x = h % 12
  return String(x === 0 ? 12 : x)
}

function Numbers({ r, preset, from }: { r: Report; preset: Preset; from: string }) {
  const { t, money, lang } = useI18n()
  const fmt = (n: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB').format(n)
  const p = r.plans
  const a = r.appointments
  const attended = a.done + a.no_show
  const diff = r.new_patients - r.prev_new_patients
  const prevName = preset === 'three'
    ? t('rp.prev3')
    : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long' })
      .format(new Date(new Date(`${from}T12:00:00`).getFullYear(), new Date(`${from}T12:00:00`).getMonth() - 1, 15))
  const topSource = Math.max(1, ...r.sources.map((s) => s.patients))
  const topHour = Math.max(1, ...r.hours.map((h) => h.n))
  const busiest = r.hours.reduce((b, h) => (h.n > b.n ? h : b), r.hours[0] ?? { hour: 0, n: 0 })
  const quietest = r.hours.reduce((b, h) => (h.n < b.n ? h : b), r.hours[0] ?? { hour: 0, n: 0 })
  const dayPart = (h: number) => t(h < 12 ? 'rp.morning' : h < 17 ? 'rp.afternoon' : 'rp.evening')
  const rv = r.reviews
  const planRows: [MessageKey, number, number, string][] = [
    ['rp.presented', p.presented, p.presented_value, 'is-light'],
    ['rp.accepted', p.accepted, p.accepted_value, ''],
    ['rp.pending', p.pending, p.pending_value, 'is-grey'],
    ['rp.declined', p.declined, p.declined_value, 'is-ink'],
  ]

  return (
    <>
      <div className="kpis rp-kpis">
        <article className="kpi">
          <span className="kpi-sub">{t('rp.newPatients')}</span>
          <strong className="kpi-value">{fmt(r.new_patients)}</strong>
          <span className="kpi-sub">
            {prevName} {fmt(r.prev_new_patients)}
            {diff !== 0 && ` · ${t(diff > 0 ? 'rp.higher' : 'rp.lower', { n: fmt(Math.abs(diff)) })}`}
          </span>
        </article>
        <article className="kpi">
          <span className="kpi-sub">{t('rp.plansAccepted')}</span>
          <strong className="kpi-value">{pctOf(p.accepted, p.presented)}%</strong>
          <span className="kpi-sub">{t('rp.ofPresented', { a: fmt(p.accepted), b: fmt(p.presented) })}</span>
        </article>
        <article className="kpi">
          <span className="kpi-sub">{t('rp.noShows')}</span>
          <strong className="kpi-value">{pctOf(a.no_show, attended)}%</strong>
          <span className="kpi-sub">{t('rp.ofAppts', { a: fmt(a.no_show), b: fmt(attended) })}</span>
        </article>
        <article className="kpi">
          <span className="kpi-sub">{t('rp.avgRating')}</span>
          <strong className="kpi-value">{rv?.avg != null ? rv.avg.toFixed(1) : '—'}</strong>
          {rv?.avg != null && <Stars value={rv.avg} />}
          <span className="kpi-sub">{t('rp.ratingsOf', { a: fmt(rv?.count ?? 0), b: fmt(rv?.requested ?? 0) })}</span>
        </article>
      </div>

      <div className="rp-grid">
        <div className="rp-main">
          <div className="rp-row">
            <section className="panel rp-panel">
              <div className="panel-head"><h2>{t('rp.sources')}</h2><span className="muted small">{t('rp.nPatients', { n: fmt(r.new_patients) })}</span></div>
              {r.sources.length === 0
                ? <p className="muted">{t('rp.none')}</p>
                : (
                  <ul className="rp-bars">
                    {r.sources.map((s) => (
                      <Bar key={s.source} label={t(`rp.src.${s.source}` as MessageKey)}
                        sub={s.collected > 0 ? t('rp.paid', { amount: money(s.collected) }) : undefined}
                        value={t('rp.nPatients', { n: fmt(s.patients) })} width={(s.patients / topSource) * 100} />
                    ))}
                  </ul>
                )}
            </section>
            <section className="panel rp-panel">
              <div className="panel-head"><h2>{t('rp.plans')}</h2><span className="muted small">{t('rp.funnel')}</span></div>
              <div className="rp-funnel">
                {planRows.map(([k, n, v, cls]) => (
                  <div key={k} className="rp-funnel-row">
                    <div className="rp-funnel-label"><span>{t(k)}</span><b>{t('rp.nPlans', { n: fmt(n) })}</b></div>
                    <div className="rp-funnel-track"><i className={cls} style={{ width: `${k === 'rp.presented' ? (n > 0 ? 100 : 0) : pctOf(n, p.presented)}%` }} /></div>
                    <span className="rp-funnel-value">{money(v)}</span>
                  </div>
                ))}
              </div>
              {r.decline_reasons.length > 0 && (
                <div className="rp-reasons">
                  <b>{t('rp.reasons')}</b>
                  <div>{r.decline_reasons.map((x) => <span key={x.reason} className="rp-tag">{x.reason} · {fmt(x.n)}</span>)}</div>
                </div>
              )}
            </section>
          </div>

          <div className="rp-row">
            <section className="panel rp-panel">
              <div className="panel-head">
                <h2>{t('rp.appointments')}</h2>
                <span className="muted small">{t('rp.apptTotal', { n: fmt(a.total), online: fmt(a.online) })}</span>
              </div>
              <div className="rp-stack">
                {a.done > 0 && <i style={{ flex: a.done }} />}
                {a.cancelled > 0 && <i className="is-grey" style={{ flex: a.cancelled }} />}
                {a.no_show > 0 && <i className="is-ink" style={{ flex: a.no_show }} />}
              </div>
              <div className="rp-legend">
                <div><span><i />{t('rp.done')}</span><b>{fmt(a.done)}</b></div>
                <div><span><i className="is-grey" />{t('rp.cancelled')}</span><b>{fmt(a.cancelled)}</b></div>
                <div><span><i className="is-ink" />{t('rp.noShow')}</span><b>{fmt(a.no_show)}</b></div>
              </div>
            </section>
            <section className="panel rp-panel">
              <div className="panel-head"><h2>{t('rp.chairs')}</h2></div>
              <p className="muted small rp-under">{t('rp.chairsSub')}</p>
              <ul className="rp-bars">
                {r.chairs.map((c) => <Bar key={c.name} label={c.name} value={`${c.pct}%`} width={c.pct} />)}
              </ul>
            </section>
          </div>

          <section className="panel rp-panel">
            <div className="panel-head"><h2>{t('rp.hours')}</h2><span className="muted small">{t('rp.hoursSub')}</span></div>
            <div className="rp-chart">
              {r.hours.map((h) => (
                <div key={h.hour} className="rp-col">
                  <span>{h.n}</span>
                  <i className={h.n === busiest.n && h.n > 0 ? 'is-top' : ''} style={{ height: `${(h.n / topHour) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="rp-axis">{r.hours.map((h) => <span key={h.hour}>{hourLabel(h.hour)}</span>)}</div>
            {busiest.n > 0 && (
              <p className="muted small">
                {t('rp.busiest', { h: hourLabel(busiest.hour), part: dayPart(busiest.hour) })}
                {quietest.hour !== busiest.hour && ` ${t('rp.quietest', { h: hourLabel(quietest.hour), part: dayPart(quietest.hour) })}`}
              </p>
            )}
          </section>

          <section className="panel rp-panel">
            <div className="panel-head"><h2>{t('rp.doctors')}</h2></div>
            {r.doctors.length === 0 ? <p className="muted">{t('rp.none')}</p> : (
              <div className="rp-table-wrap">
                <table className="rp-table">
                  <thead>
                    <tr><th>{t('rp.doctor')}</th><th>{t('rp.apptsDone')}</th><th>{t('rp.noShow')}</th><th>{t('rp.planAcceptance')}</th><th>{t('rp.rating')}</th></tr>
                  </thead>
                  <tbody>
                    {r.doctors.map((d) => (
                      <tr key={d.user_id}>
                        <td><b>{d.name}</b></td>
                        <td>{fmt(d.done)}</td>
                        <td>{fmt(d.no_show)}</td>
                        <td>{d.presented > 0 ? `${pctOf(d.accepted, d.presented)}%` : '—'}</td>
                        <td>{d.rating != null ? <span className="rp-rate"><b>{d.rating.toFixed(1)}</b><Stars value={d.rating} /></span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="rp-side">
          <ReviewsPanel reviews={rv} />
        </div>
      </div>
    </>
  )
}

export function ReportsPage() {
  const { clinicId, role } = useMember()
  const { t, lang } = useI18n()
  const [preset, setPreset] = useState<Preset>('this')
  const range = rangeFor(preset)
  const enabled = role === 'owner'
  const q = useQuery({ queryKey: ['reports', clinicId, range.from, range.to], queryFn: () => getReport(clinicId, range.from, range.to), enabled })

  if (!enabled) return <section className="page"><p className="empty">{t('fin.ownerOnly')}</p></section>

  const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' })
    .format(new Date(`${preset === 'three' ? range.to : range.from}T12:00:00`))

  return (
    <section className="page reports">
      <header className="page-head">
        <div>
          <h1>{t('rp.title')}</h1>
          <p className="muted">{preset === 'three' ? t('rp.last3') : monthName} · {t('fin.ownerOnlyShort')}</p>
        </div>
        <div className="row-buttons">
          <div className="seg">
            <button className="on">{t('rp.numbers')}</button>
          </div>
          <div className="seg">
            <button className={preset === 'this' ? 'on' : ''} onClick={() => setPreset('this')}>{t('fin.thisMonth')}</button>
            <button className={preset === 'last' ? 'on' : ''} onClick={() => setPreset('last')}>{t('fin.lastMonth')}</button>
            <button className={preset === 'three' ? 'on' : ''} onClick={() => setPreset('three')}>{t('rp.last3')}</button>
          </div>
        </div>
      </header>
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && <Numbers r={q.data} preset={preset} from={range.from} />}
    </section>
  )
}
