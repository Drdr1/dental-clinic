import { useEffect, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { deleteFile, listFiles, signedUrl, uploadFile, type FileKind, type PatientFile } from './api'

const KINDS: FileKind[] = ['xray', 'photo', 'document']

function Thumb({ file, onOpen }: { file: PatientFile; onOpen: () => void }) {
  const { t, date } = useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const isImage = (file.mime_type ?? '').startsWith('image/')

  useEffect(() => {
    let alive = true
    if (isImage) signedUrl(file.storage_path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [file.storage_path, isImage])

  return (
    <button type="button" className="thumb" onClick={onOpen}>
      {isImage && url ? <img src={url} alt={file.caption ?? t(`file.kind.${file.kind}` as never)} loading="lazy" />
        : <span className="thumb-doc">PDF</span>}
      <span className="thumb-meta">
        <span className="badge badge-neutral">{t(`file.kind.${file.kind}` as never)}</span>
        <span className="muted">{date(file.created_at)}</span>
      </span>
      {file.caption && <span className="thumb-caption">{file.caption}</span>}
    </button>
  )
}

function Viewer({ file, onClose }: { file: PatientFile; onClose: () => void }) {
  const { t, date } = useI18n()
  const { member } = useAuth()
  const qc = useQueryClient()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { signedUrl(file.storage_path).then(setUrl).catch(() => {}) }, [file.storage_path])

  const remove = useMutation({
    mutationFn: () => deleteFile(file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient-files', file.patient_id] }); onClose() },
  })

  return (
    <Modal title={file.caption || t(`file.kind.${file.kind}` as never)} onClose={onClose}>
      <div className="dialog-form">
        {url
          ? ((file.mime_type ?? '').startsWith('image/')
            ? <img className="viewer-image" src={url} alt={file.caption ?? ''} />
            : <iframe className="viewer-pdf" src={url} title={file.caption ?? 'PDF'} />)
          : <Skeleton rows={1} />}
        <p className="muted small">{date(file.created_at)}</p>
        {remove.isError && <ErrorNote error={remove.error} />}
        <div className="dialog-actions">
          {url && <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">{t('file.openFull')}</a>}
          {member?.role === 'owner' && (
            <button className="link-btn danger-link" disabled={remove.isPending}
              onClick={() => { if (confirm(t('file.deleteConfirm'))) remove.mutate() }}>{t('file.delete')}</button>
          )}
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </Modal>
  )
}

export function PatientFiles({ patientId }: { patientId: string }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [kind, setKind] = useState<FileKind>('xray')
  const [caption, setCaption] = useState('')
  const [viewing, setViewing] = useState<PatientFile | null>(null)
  const files = useQuery({ queryKey: ['patient-files', patientId], queryFn: () => listFiles(patientId) })

  const upload = useMutation({
    mutationFn: (list: File[]) =>
      Promise.all(list.map((file) => uploadFile({ clinicId, patientId, file, kind, caption }))),
    onSuccess: () => { setCaption(''); qc.invalidateQueries({ queryKey: ['patient-files', patientId] }) },
  })

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (list.length) upload.mutate(list)
  }

  return (
    <section className="panel panel-wide">
      <div className="panel-head">
        <h2>{t('file.title')}</h2>
      </div>

      <div className="upload-row">
        <label className="field">
          <span>{t('file.kindLabel')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`file.kind.${k}` as never)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('file.caption')}</span>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={120} placeholder={t('file.captionHint')} />
        </label>
        <label className={`btn btn-primary upload-btn ${upload.isPending ? 'is-busy' : ''}`}>
          {upload.isPending ? t('file.uploading') : t('file.add')}
          <input type="file" accept="image/*,application/pdf" multiple hidden onChange={onPick} disabled={upload.isPending} />
        </label>
      </div>
      <p className="hint">{t('file.hint')}</p>
      {upload.isError && <ErrorNote error={upload.error} />}

      {files.isPending && <Skeleton rows={2} variant="cards" />}
      {files.isError && <ErrorNote error={files.error} onRetry={() => files.refetch()} />}
      {files.data?.length === 0 && <p className="muted">{t('file.empty')}</p>}
      {files.data && files.data.length > 0 && (
        <div className="gallery">
          {files.data.map((f) => <Thumb key={f.id} file={f} onOpen={() => setViewing(f)} />)}
        </div>
      )}

      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
