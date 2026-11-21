import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { updatePatient } from './api'

/**
 * A running note on the patient, for the detail that belongs to the case
 * rather than to one visit — the working length reached in a root canal,
 * say, which the next appointment has to pick up from.
 */
export function PatientNotes({ patientId, initial }: { patientId: string; initial: string | null }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [text, setText] = useState(initial ?? '')
  const [saved, setSaved] = useState(false)

  // Another device may have edited it while this page was open.
  useEffect(() => { setText(initial ?? '') }, [initial])

  const save = useMutation({
    mutationFn: () => updatePatient(patientId, { notes: text.trim() || null }),
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
    },
  })

  const dirty = text !== (initial ?? '')

  return (
    <section className="panel panel-wide">
      <div className="panel-head">
        <h2>{t('note.title')}</h2>
        {saved && !dirty && <span className="badge badge-ok">{t('note.saved')}</span>}
      </div>
      <textarea
        className="note-box"
        rows={4}
        value={text}
        placeholder={t('note.placeholder')}
        onChange={(e) => { setText(e.target.value); setSaved(false) }}
      />
      {save.isError && <ErrorNote error={save.error} />}
      {dirty && (
        <div className="head-actions">
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button className="btn" onClick={() => { setText(initial ?? ''); setSaved(false) }}>
            {t('common.cancel')}
          </button>
        </div>
      )}
    </section>
  )
}
