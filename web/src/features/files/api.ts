import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type PatientFile = Tables<'patient_files'>
export type FileKind = 'xray' | 'photo' | 'document'
export const BUCKET = 'patient-files'

export async function listFiles(patientId: string): Promise<PatientFile[]> {
  const { data, error } = await supabase.from('patient_files').select('*')
    .eq('patient_id', patientId).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** Private bucket: every view needs a short-lived signed link. */
export async function signedUrl(path: string, seconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

/** Shrinks big photos in the browser so uploads stay fast on clinic Wi-Fi. */
async function shrink(file: File, maxSide = 1800): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 600_000) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 2_500_000) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  return blob && blob.size < file.size ? blob : file
}

export async function uploadFile(args: {
  clinicId: string; patientId: string; file: File; kind: FileKind; caption: string; sessionId?: string | null
}) {
  const body = await shrink(args.file)
  const ext = (body.type === 'image/jpeg' ? 'jpg' : args.file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${args.clinicId}/${args.patientId}/${crypto.randomUUID()}.${ext}`

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: body.type || args.file.type, upsert: false,
  })
  if (upErr) throw upErr

  const { error } = await supabase.from('patient_files').insert({
    clinic_id: args.clinicId, patient_id: args.patientId, session_id: args.sessionId ?? null,
    kind: args.kind, storage_path: path, caption: args.caption.trim() || null,
    size_bytes: body.size, mime_type: body.type || args.file.type,
  })
  if (error) {
    // Don't leave an orphan object behind if the row fails.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function deleteFile(f: PatientFile) {
  const { error } = await supabase.from('patient_files').delete().eq('id', f.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([f.storage_path])
}
