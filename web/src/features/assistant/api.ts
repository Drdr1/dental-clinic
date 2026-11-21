import { supabase } from '../../lib/supabase'

export type Answer = {
  answer: string
  /** The same answer with names still as tokens — what the model wrote. */
  raw: string
  /** Token → real value for this chat so far; stays between browser and our server. */
  names: Record<string, string>
  /** Which reads ran, so the person can see where the answer came from. */
  used: string[]
  /** How many names and numbers were held back from the model. */
  hidden: number
}

/** One earlier exchange, carried as context in its token form. */
export type Turn = { q: string; a: string }

/**
 * The assistant runs on our own server, not in the browser: the API key
 * stays there, and every read it makes uses this person's token, so the
 * database refuses whatever they could not open themselves.
 */
export async function ask(
  clinicId: string, question: string, history: Turn[], names: Record<string, string>,
): Promise<Answer> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('sign in first')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clinicId, question, history, names }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `assistant failed (${res.status})`)
  return body as Answer
}
