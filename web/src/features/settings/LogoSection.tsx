import { useEffect, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'

async function getLogo(clinicId: string) {
  const { data, error } = await supabase.from('clinics').select('logo_url').eq('id', clinicId).single()
  if (error) throw error
  return data.logo_url
}

/** Shrinks to a small PNG so it prints sharply but stays inline in the row. */
async function toSmallPng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const max = 320
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function LogoSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['clinic-logo', clinicId], queryFn: () => getLogo(clinicId) })
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => { setPreview(q.data ?? null) }, [q.data])

  const save = useMutation({
    mutationFn: async (value: string | null) => {
      const { error } = await supabase.from('clinics').update({ logo_url: value }).eq('id', clinicId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic-logo'] }),
  })

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const url = await toSmallPng(file)
    if (url.length > 380_000) { alert(t('logo.tooBig')); return }
    setPreview(url)
    save.mutate(url)
  }

  return (
    <section className="panel">
      <h2>{t('logo.title')}</h2>
      <p className="muted">{t('logo.hint')}</p>
      <div className="logo-row">
        {preview
          ? <img src={preview} alt={t('logo.title')} className="logo-preview" />
          : <span className="muted">{t('logo.none')}</span>}
        <span className="row-buttons">
          <label className="btn btn-primary upload-btn">
            {t('logo.upload')}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={onPick} />
          </label>
          {preview && (
            <button className="link-btn danger-link" onClick={() => { setPreview(null); save.mutate(null) }}>
              {t('logo.remove')}
            </button>
          )}
        </span>
      </div>
      {save.isError && <ErrorNote error={save.error} />}
    </section>
  )
}
