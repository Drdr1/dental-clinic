import type { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { getAudit, type AuditCategory, type AuditFilter, type AuditRow } from './auditApi'

export type T = ReturnType<typeof useI18n>
export const catKey = (c: AuditCategory) => `au.cat.${c}` as MessageKey

export function fillText(tpl: string, vals: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? '')
}

export type Described = { key: MessageKey; vals: Record<string, string>; rich: Record<string, 'b' | 'old' | 'patient'>; sub: string[] }

export function describe(r: AuditRow, i: T): Described {
  const { t, money, lang } = i
  const d = r.data as Record<string, string | number | boolean | null | undefined>
  const s = (k: string) => (d[k] == null ? '' : String(d[k]))
  const m = (k: string) => (d[k] == null ? '' : money(Number(d[k])))
  const when = (k: string) => (d[k] ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date(s(k))) : '')
  const patient = r.patient_name ?? ''
  const out: Described = { key: `au.${r.action}` as MessageKey, vals: { patient }, rich: { patient: 'patient' }, sub: [] }
  const change = (from: string, to: string) => { out.vals.from = from; out.vals.to = to; out.rich.from = 'old'; out.rich.to = 'b' }
  const reason = () => { if (d.reason) out.sub.push(t('au.reasonQ', { reason: s('reason') })) }
  switch (r.action) {
    case 'payment.add':
      out.vals.amount = m('amount'); out.rich.amount = 'b'
      out.vals.method = d.method ? t(`method.${s('method')}` as MessageKey) : ''
      if (d.installment) out.sub.push(t('au.installment'))
      if (d.receipt_no) out.sub.push(t('au.receipt', { n: s('receipt_no') }))
      break
    case 'payment.reverse':
      out.vals.amount = m('amount'); out.rich.amount = 'b'
      reason()
      if (d.receipt_no) out.sub.push(t('au.receipt', { n: s('receipt_no') }))
      break
    case 'expense.add': case 'expense.void':
      out.vals.amount = m('amount'); out.rich.amount = 'b'
      out.vals.cat = d.category ? t(`fin.cat.${s('category')}` as MessageKey) : ''
      if (d.note) out.sub.push(s('note'))
      reason()
      break
    case 'cash.close': {
      out.vals.counted = m('counted'); out.vals.expected = m('expected'); out.rich.counted = 'b'; out.rich.expected = 'b'
      out.vals.day = d.day ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long' }).format(new Date(`${s('day')}T12:00:00`)) : ''
      const diff = Number(d.difference ?? 0)
      if (diff !== 0) out.sub.push(t(diff < 0 ? 'au.short' : 'au.over', { amount: money(Math.abs(diff)) }))
      reason()
      break
    }
    case 'appt.status':
      change(t(`appt.status.${s('from')}` as MessageKey), t(`appt.status.${s('to')}` as MessageKey))
      break
    case 'appt.move':
      change(when('from'), when('to'))
      if (d.chair) out.sub.push(t('au.onChair', { chair: s('chair') }))
      break
    case 'appt.delete':
      out.sub.push([t('au.was', { at: when('at') }), s('chair'), s('doctor')].filter(Boolean).join(' · '))
      break
    case 'patient.name': case 'patient.phone':
      change(s('from'), s('to'))
      break
    case 'patient.archive':
      reason()
      break
    case 'patient.delete':
      out.vals.name = s('name'); out.rich.name = 'b'
      out.sub.push([s('phone'), d.reason ? t('au.reasonQ', { reason: s('reason') }) : ''].filter(Boolean).join(' · '))
      break
    case 'item.price':
      out.vals.item = s('item') || t('au.anItem')
      change(m('from'), m('to'))
      break
    case 'plan.discount':
      change(m('from'), m('to'))
      if (d.total != null) out.sub.push(t('au.totalNow', { total: m('total'), before: m('total_before') }))
      break
    case 'plan.status':
      out.vals.plan = s('plan')
      change(t(`planStatus.${s('from')}` as MessageKey), t(`planStatus.${s('to')}` as MessageKey))
      reason()
      break
    case 'procedure.price':
      out.vals.name = s('name')
      change(m('from'), m('to'))
      break
    case 'member.add':
      out.vals.name = s('name'); out.rich.name = 'b'
      out.vals.role = d.role ? t(`role.${s('role')}` as MessageKey) : ''
      if (d.percent) out.sub.push(t('au.percentIs', { n: s('percent') }))
      break
    case 'member.role':
      out.vals.name = s('name'); out.rich.name = 'b'
      change(t(`role.${s('from')}` as MessageKey), t(`role.${s('to')}` as MessageKey))
      break
    case 'member.on': case 'member.off':
      out.vals.name = s('name'); out.rich.name = 'b'
      break
    case 'member.percent':
      out.vals.name = s('name'); out.rich.name = 'b'
      change(`${Number(d.from ?? 0)}%`, `${Number(d.to ?? 0)}%`)
      break
  }
  return out
}


/** Downloads everything matching the filter as a CSV that Excel opens (UTF-8 with BOM). */
export async function exportAudit(clinicId: string, f: AuditFilter, i: T) {
  const { t, lang } = i
  const timeFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: 'numeric', minute: '2-digit' })
  const all = await getAudit(clinicId, f, null, 5000)
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [[t('au.col.date'), t('au.col.time'), t('au.col.who'), t('au.col.role'), t('au.col.cat'), t('au.col.what'), t('au.col.detail'), t('au.col.sensitive')].map(esc).join(',')]
  for (const r of all) {
    const d = describe(r, i)
    lines.push([
      new Intl.DateTimeFormat('en-CA').format(new Date(r.at)), timeFmt.format(new Date(r.at)),
      r.actor_name ?? t('au.system'), r.actor_role ? t(`role.${r.actor_role}`) : '', t(catKey(r.category)),
      fillText(t(d.key), d.vals), d.sub.join(' · '), r.sensitive ? t('au.sensitive') : '',
    ].map(esc).join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `audit-${new Intl.DateTimeFormat('en-CA').format(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

