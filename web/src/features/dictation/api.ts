import { supabase } from '../../lib/supabase'

const URL_ = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dictation`

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('sign in first')
  return session.access_token
}

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `dictation failed (${res.status})`)
  return body as T
}

/** Speech → text. The text comes back for the doctor to read before anything is understood from it. */
export async function transcribe(clinicId: string, audio: Blob): Promise<string> {
  const form = new FormData()
  const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('audio', audio, `dictation.${ext}`)
  form.append('clinicId', clinicId)
  const res = await fetch(URL_(), { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: form })
  return (await read<{ text: string }>(res)).text
}

export type DraftLine = {
  procedureId: string
  procedureName: string
  teeth: number[]
  price: number
  /** True when the doctor said the price; otherwise it is the price list's. */
  priceSaid: boolean
  note: string
}
export type PlanDraft = { lines: DraftLine[]; unclear: string[] }
export type SessionDraft = { doneItemIds: string[]; note: string; next: string }

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(URL_(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return read<T>(res)
}

export const draftPlan = (clinicId: string, text: string) =>
  post<PlanDraft>({ mode: 'plan', clinicId, text })

export const draftSession = (clinicId: string, text: string, openItems: { id: string; label: string }[]) =>
  post<SessionDraft>({ mode: 'session', clinicId, text, openItems })
