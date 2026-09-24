import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ToothMark } from '../../components/ToothMark'
import { Skeleton } from '../../components/Skeleton'
import { errorKey } from '../../lib/errors'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import { book, getBookingClinic, getSlots } from './api'

/** Public booking page: no login, phone-first, Arabic by default. */
export function BookingPage() {
  const { slug = '' } = useParams()
  const { t, lang, setLang, date: fmtDate } = useI18n()
  const [serviceId, setServiceId] = useState('')
  const [day, setDay] = useState('')
  const [slot, setSlot] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')

  const clinic = useQuery({ queryKey: ['booking', slug], queryFn: () => getBookingClinic(slug), retry: false })
  const service = clinic.data?.services.find((s) => s.id === (serviceId || clinic.data?.services[0]?.id))

  // The next N days the clinic accepts, starting today.
  const days = useMemo(() => {
    if (!clinic.data) return []
    const out: string[] = []
    const start = new Date(`${clinic.data.today}T12:00:00`)
    for (let i = 0; i <= Math.min(clinic.data.horizon_days, 30); i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    return out
  }, [clinic.data])

  const slots = useQuery({
    queryKey: ['booking-slots', slug, day, service?.id],
    queryFn: () => getSlots(slug, day, service!.id),
    enabled: !!day && !!service,
  })

  const submit = useMutation({
    mutationFn: () => book({
      slug, procedureId: service!.id, start: slot, name, phone: normalizePhone(phone), note,
    }),
  })

  const timeFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
    hour: 'numeric', minute: '2-digit', timeZone: clinic.data?.timezone,
  })
  const dayFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: clinic.data?.timezone,
  })

  const shell = (content: React.ReactNode) => (
    <main className="public-form">
      <div className="public-card">
        <div className="public-head">
          {clinic.data?.logo
            ? <img src={clinic.data.logo} alt="" className="brand-logo" />
            : <ToothMark className="brand-mark" />}
          <strong>{clinic.data?.clinic ?? ''}</strong>
          <button type="button" className="link-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('nav.language')}</button>
        </div>
        {content}
      </div>
    </main>
  )

  if (clinic.isPending) return shell(<Skeleton rows={3} />)
  if (clinic.isError) return shell(<p className="empty">{t('book.unavailable')}</p>)

  if (submit.isSuccess) {
    return shell(
      <div className="done-block">
        <h1>{t('book.doneTitle')}</h1>
        <p><strong>{fmtDate(submit.data.starts_at)} — {timeFmt.format(new Date(submit.data.starts_at))}</strong></p>
        <p className="muted">{t('book.doneDetail')}</p>
      </div>,
    )
  }

  const valid = !!service && !!slot && name.trim().length >= 3 && isValidPhone(normalizePhone(phone))
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !submit.isPending) submit.mutate()
  }

  return shell(
    <form className="dialog-form" onSubmit={onSubmit}>
      <h1>{t('book.title')}</h1>

      <label className="field">
        <span>{t('book.service')}</span>
        <select value={service?.id ?? ''} onChange={(e) => { setServiceId(e.target.value); setSlot('') }}>
          {clinic.data.services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      {clinic.data.services.length === 0 && <p className="empty">{t('book.noServices')}</p>}

      <div className="field">
        <span>{t('book.day')}</span>
        <div className="day-strip">
          {days.map((d) => (
            <button key={d} type="button" className={`day-chip ${day === d ? 'is-on' : ''}`}
              onClick={() => { setDay(d); setSlot('') }}>
              {dayFmt.format(new Date(`${d}T12:00:00`))}
            </button>
          ))}
        </div>
      </div>

      {day && (
        <div className="field">
          <span>{t('book.time')}</span>
          {slots.isPending && <Skeleton rows={1} />}
          {slots.data?.length === 0 && <p className="muted">{t('book.noSlots')}</p>}
          <div className="choice-row">
            {slots.data?.map((s) => (
              <label key={s} className={`choice ${slot === s ? 'is-on' : ''}`}>
                <input type="radio" name="slot" checked={slot === s} onChange={() => setSlot(s)} />
                {timeFmt.format(new Date(s))}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>{t('book.name')}</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field">
          <span>{t('book.phone')}</span>
          <input required dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </label>
      </div>

      <label className="field">
        <span>{t('book.note')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t('book.noteHint')} />
      </label>

      {submit.isError && (
        <p className="form-error" role="alert">{t(errorKey(submit.error) ?? 'book.unavailable')}</p>
      )}

      <button type="submit" className="btn btn-primary" disabled={!valid || submit.isPending}>
        {submit.isPending ? t('common.saving') : t('book.submit')}
      </button>
      <p className="hint">{t('book.privacy')}</p>
    </form>,
  )
}
