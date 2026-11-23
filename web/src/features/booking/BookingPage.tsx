import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ToothMark } from '../../components/ToothMark'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { errorKey } from '../../lib/errors'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import { book, getBookingClinic, getDay } from './api'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Public booking page: no login, phone-first, Arabic by default. */
export function BookingPage() {
  const { slug = '' } = useParams()
  const { t, lang, setLang, money, time } = useI18n()
  const [serviceId, setServiceId] = useState('')
  const [day, setDay] = useState('')
  const [slot, setSlot] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const clinic = useQuery({ queryKey: ['booking', slug], queryFn: () => getBookingClinic(slug), retry: false })
  const c = clinic.data
  const service = c?.services.find((s) => s.id === (serviceId || c?.services[0]?.id))
  const closed = useMemo(() => new Set(c?.closed_weekdays ?? []), [c])
  const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG'

  // The days the clinic takes bookings for, starting today.
  const days = useMemo(() => {
    if (!c) return []
    const start = new Date(`${c.today}T12:00:00`)
    return Array.from({ length: Math.min(c.horizon_days, 30) + 1 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i)
      return { iso: ymd(d), dow: d.getDay(), num: d.getDate(), date: d }
    })
  }, [c])
  // Open on the first day the clinic works, so times show straight away.
  useEffect(() => {
    if (!day && days.length) setDay(days.find((d) => !closed.has(d.dow))?.iso ?? '')
  }, [days, closed, day])

  const slots = useQuery({
    queryKey: ['booking-day', slug, day, service?.id],
    queryFn: () => getDay(slug, day, service!.id),
    enabled: !!day && !!service,
  })

  const submit = useMutation({
    mutationFn: () => book({ slug, procedureId: service!.id, start: slot, name, phone: normalizePhone(phone), note: '' }),
  })

  // Times in the clinic's own timezone, read the way the clinic reads them (5:30 م).
  const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: c?.timezone })
  const clock = (iso: string) => time(clockFmt.format(new Date(iso)))
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long' })
  const fullDay = (d: Date) => `${dayName(d.getDay())} ${d.getDate()} ${monthFmt.format(d)}`
  const dayName = (dow: number) => weekday.format(new Date(2026, 0, 4 + dow, 12))

  const hours = c && (() => {
    const off = [...closed].sort().map(dayName)
    const when = off.length ? t('book.exceptDays', { days: off.join(t('book.and')) }) : t('book.everyDay')
    return `${when} · ${t('book.hoursRange', { from: time(c.opens_at).replace(':00', ''), to: time(c.closes_at).replace(':00', '') })}`
  })()

  const priceText = (p: number | null | undefined) => (p == null ? null : p === 0 ? t('book.free') : money(p))
  const chosenDay = days.find((d) => d.iso === day)
  const step = !service ? 1 : !day ? 2 : !slot ? 3 : 4
  const valid = !!service && !!slot && name.trim().length >= 3 && isValidPhone(normalizePhone(phone))
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !submit.isPending) submit.mutate()
  }

  const header = (
    <header className="bk-hero">
      <div className="bk-hero-in">
        <div className="bk-clinic">
          <span className="bk-logo">{c?.logo ? <img src={c.logo} alt="" /> : <ToothMark />}</span>
          <div>
            <h1>{c?.clinic ?? ''}</h1>
            {c && (
              <p>
                {c.address && <span className="bk-addr"><Icon name="pin" />{c.address}</span>}
                <span>{hours}</span>
              </p>
            )}
          </div>
        </div>
        <div className="bk-hero-side">
          <span>{t('book.quick')}</span>
          <button type="button" className="bk-lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'عربي'}</button>
        </div>
      </div>
    </header>
  )
  const page = (body: React.ReactNode) => (
    <main className="bk">
      {header}
      <div className="bk-body">{body}</div>
      <p className="bk-foot">{t('book.poweredBy')}</p>
    </main>
  )

  if (clinic.isPending) return page(<section className="bk-card"><Skeleton rows={4} /></section>)
  if (clinic.isError || !c) return page(<section className="bk-card"><p className="empty">{t('book.unavailable')}</p></section>)

  if (submit.isSuccess) {
    return page(
      <section className="bk-card bk-done">
        <h2>{t('book.doneTitle')}</h2>
        <p className="bk-done-when">{fullDay(new Date(submit.data.starts_at))} · {clock(submit.data.starts_at)}</p>
        <p className="muted">{t('book.doneDetail')}</p>
        <button className="btn" onClick={() => { submit.reset(); setSlot('') }}>{t('book.another')}</button>
      </section>,
    )
  }

  const steps = ['service', 'day', 'time', 'you'] as const
  return page(
    <>
      <section className="bk-card bk-main">
        <ol className="bk-steps">
          {steps.map((s, i) => (
            <li key={s} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}>
              <b>{i + 1}</b><span>{t(`book.step.${s}`)}</span>
            </li>
          ))}
        </ol>

        <h3>{t('book.step.service')}</h3>
        {c.services.length === 0 && <p className="empty">{t('book.noServices')}</p>}
        <div className="bk-services">
          {c.services.map((s) => (
            <button key={s.id} type="button" className={`bk-service${service?.id === s.id ? ' on' : ''}`}
              onClick={() => { setServiceId(s.id); setSlot('') }}>
              <b>{s.name}</b>
              <span>{t('book.minutes', { n: s.minutes })}{priceText(s.price) ? ` · ${priceText(s.price)}` : ''}</span>
            </button>
          ))}
        </div>

        <h3>{t('book.step.day')}</h3>
        <div className="bk-days">
          {days.map((d) => {
            const off = closed.has(d.dow)
            return (
              <button key={d.iso} type="button" disabled={off} className={`bk-day${day === d.iso ? ' on' : ''}${off ? ' off' : ''}`}
                onClick={() => { setDay(d.iso); setSlot('') }}>
                <span>{dayName(d.dow)}</span>
                <b>{d.num}</b>
                {off && <small>{t('book.closed')}</small>}
              </button>
            )
          })}
        </div>

        <h3>{t('book.step.time')}</h3>
        {slots.isPending && day && <Skeleton rows={1} />}
        {slots.data && slots.data.every((s) => !s.free) && <p className="muted">{t('book.noSlots')}</p>}
        {/* A day with nothing left shows the message alone, not a wall of crossed-out times. */}
        {slots.data?.some((s) => s.free) && <div className="bk-times">
          {slots.data.map((s) => (
            <button key={s.slot} type="button" disabled={!s.free} className={`bk-time${slot === s.slot ? ' on' : ''}${s.free ? '' : ' taken'}`}
              onClick={() => setSlot(s.slot)}>
              {clock(s.slot)}
            </button>
          ))}
        </div>}
      </section>

      <form className="bk-card bk-side" onSubmit={onSubmit}>
        <h2>{t('book.yours')}</h2>
        <dl className="bk-summary">
          <div><dt>{t('book.step.service')}</dt><dd>{service?.name ?? '—'}</dd></div>
          <div><dt>{t('book.step.day')}</dt><dd>{chosenDay ? fullDay(chosenDay.date) : '—'}</dd></div>
          <div><dt>{t('book.step.time')}</dt><dd>{slot ? clock(slot) : '—'}</dd></div>
          {service?.price != null && <div><dt>{t('book.price')}</dt><dd>{priceText(service.price)}</dd></div>}
        </dl>
        <label className="field">
          <span>{t('book.fullName')}</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder={t('book.namePh')} />
        </label>
        <label className="field">
          <span>{t('book.phone')}</span>
          <input required dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="01xxxxxxxxx" />
          <small className="hint">{t('book.phoneHint')}</small>
        </label>
        {submit.isError && <p className="form-error" role="alert">{t(errorKey(submit.error) ?? 'book.unavailable')}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!valid || submit.isPending}>
          {submit.isPending ? t('common.saving') : t('book.confirmBtn')}
        </button>
        <p className="hint">{t('book.tentative')}</p>
      </form>
    </>,
  )
}
