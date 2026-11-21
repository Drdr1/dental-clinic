/**
 * Voice-to-record.
 *
 * The doctor says what she found or what she did; this turns it into the
 * rows the clinic already keeps — treatment-plan lines (procedure, tooth,
 * price) or a session note with the finished items ticked.
 *
 * Two steps, two requests, with the doctor in between:
 *
 *  1. POST audio (multipart, field "audio") → { text }
 *     Whisper turns speech into text. The text comes back to the screen for
 *     her to read and correct before anything is understood from it.
 *  2. POST JSON { mode: 'plan' | 'session', text, ... } → a draft
 *     Claude reads the text against this clinic's own price list (or the
 *     plan's open items) and fills a fixed shape.
 *
 * Nothing is saved here. The draft goes back to a review screen, and the
 * existing save paths — with their own checks — do the writing.
 *
 * Patient and staff names are stripped from the text before it goes to the
 * model and put back in what returns, as in the assistant. The audio itself
 * cannot be stripped: it goes whole to the speech service, which the clinic
 * chose knowingly.
 */

import { Pseudonyms } from '../assistant/privacy.ts'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-sonnet-5-5'
const MAX_AUDIO_BYTES = 15 * 1024 * 1024   // a few minutes of opus is well under 2 MB

type Json = Record<string, unknown>

/** Permanent teeth in FDI notation — the numbers the tooth chart uses. */
const TEETH = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
])

function cors(extra: HeadersInit = {}): HeadersInit {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://clinic.derops.dev',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...extra,
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors({ 'Content-Type': 'application/json' }) })

/** PostgREST with the doctor's own token, so row-level security decides. */
function rest(url: string, anon: string, jwt: string) {
  const headers = { apikey: anon, Authorization: `Bearer ${jwt}`, Accept: 'application/json' }
  return {
    async get(path: string): Promise<Json[]> {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers })
      if (!res.ok) throw new Error((await res.text()).slice(0, 300))
      return await res.json()
    },
    async rpc(fn: string, args: Json): Promise<unknown> {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
      })
      if (!res.ok) throw new Error((await res.text()).slice(0, 300))
      return await res.json()
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!url || !anon) return json({ error: 'dictation is not configured' }, 500)
  if (!jwt) return json({ error: 'sign in first' }, 401)
  const db = rest(url, anon, jwt)

  try {
    if ((req.headers.get('Content-Type') ?? '').startsWith('multipart/form-data')) {
      return json(await transcribe(req, db))
    }
    const body = await req.json() as Json
    const clinic = String(body.clinicId ?? '')
    const text = String(body.text ?? '').trim().slice(0, 4000)
    if (!clinic || !text) return json({ error: 'bad request' }, 400)

    // Names out before the model, back in after.
    const names = new Pseudonyms()
    await learnNames(db, clinic, names)
    const hidden = names.hide(text)

    if (body.mode === 'plan') return json(await draftPlan(db, clinic, hidden, names))
    if (body.mode === 'session') return json(await draftSession(hidden, body.openItems, names))
    return json({ error: 'bad request' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
})

// ---------------------------------------------------------------------------
// Step 1: speech → text
// ---------------------------------------------------------------------------

async function transcribe(req: Request, db: ReturnType<typeof rest>) {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('speech is not configured')

  const form = await req.formData()
  const audio = form.get('audio')
  const clinic = String(form.get('clinicId') ?? '')
  if (!(audio instanceof File) || !clinic) throw new Error('bad request')
  if (audio.size > MAX_AUDIO_BYTES) throw new Error('التسجيل طويل — سجّل أقل من 3 دقايق')

  // Only someone in this clinic may spend its speech budget. Reading its
  // price list under their token is the membership check: a stranger gets
  // no rows. The names also help Whisper spell the clinic's own terms.
  const procs = await db.get(`procedures?clinic_id=eq.${clinic}&active=is.true&select=name&limit=200`)
  if (!procs.length) throw new Error('مش عضو في العيادة دي')

  const out = new FormData()
  out.append('file', audio, audio.name || 'dictation.webm')
  out.append('model', Deno.env.get('WHISPER_MODEL') ?? 'whisper-1')
  out.append('language', 'ar')
  // A vocabulary hint: dental terms the doctors say in English, and the
  // clinic's own procedure names. Whisper reads at most ~224 tokens of it.
  out.append('prompt', ['كشف، حشو عصب، root canal، composite، crown، zirconia، extraction، scaling، implant، veneer، bridge',
    ...procs.map((p) => String(p.name))].join('، ').slice(0, 800))

  const res = await fetch(WHISPER_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: out })
  if (!res.ok) throw new Error(`speech: ${(await res.text()).slice(0, 200)}`)
  const { text } = await res.json() as { text: string }
  return { text: (text ?? '').trim() }
}

// ---------------------------------------------------------------------------
// Step 2: text → a draft in the clinic's own shape
// ---------------------------------------------------------------------------

async function learnNames(db: ReturnType<typeof rest>, clinic: string, names: Pseudonyms) {
  try {
    const ids = await db.rpc('assistant_identities', { p_clinic: clinic }) as
      { patients: unknown[][]; staff: unknown[][]; others: unknown[][] }
    names.learn([
      ...ids.patients.flatMap(([n, ph]) => [{ value: n, kind: 'PATIENT' }, { value: ph, kind: 'PHONE' }]),
      ...ids.staff.map(([n]) => ({ value: n, kind: 'STAFF' })),
    ])
  } catch { /* dictation rarely names anyone; carry on without the list */ }
}

/** Ask the model to fill exactly one tool, and return what it filled. */
async function fill(system: string, text: string, tool: Json): Promise<Json> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('dictation is not configured')
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000, system,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: text }],
    }),
  })
  if (!res.ok) throw new Error(`model: ${(await res.text()).slice(0, 200)}`)
  const reply = await res.json()
  const call = (reply.content ?? []).find((c: Json) => c.type === 'tool_use')
  if (!call) throw new Error('المساعد ماقدرش يفهم الكلام — جرّب تاني')
  return call.input as Json
}

async function draftPlan(db: ReturnType<typeof rest>, clinic: string, text: string, names: Pseudonyms) {
  const procs = await db.get(
    `procedures?clinic_id=eq.${clinic}&active=is.true&select=id,name,default_price&order=name&limit=300`)
  if (!procs.length) throw new Error('مفيش إجراءات في قايمة الأسعار')
  // Short handles instead of uuids: easier for the model, and nothing it
  // makes up can match a real row by accident.
  const handle = new Map(procs.map((p, i) => [`P${i + 1}`, p]))
  const list = [...handle].map(([h, p]) => `${h} | ${p.name} | ${p.default_price}`).join('\n')

  const system = `أنت بتساعد دكتور أسنان مصري يسجّل خطة علاج بالكلام. حوّل كلامه لبنود من قايمة إجراءات العيادة دي بس:

${list}

قواعد:
- كل بند لازم يكون إجراء من القايمة (اكتب الكود P...). لو قال حاجة مش في القايمة أو مش واضحة، حطها في unclear بكلامه، وما تخمّنش.
- الأسنان بترقيم FDI (11–48). "16" يعني ضرس 16. "الضرس الأخير تحت شمال" = 38، "تحت يمين" = 48، "فوق يمين" = 18، "فوق شمال" = 28. "الأمامية فوق" = 11 12 13 21 22 23. لو مش متأكد من رقم السنة، سيبها فاضية وحطها في unclear.
- إجراء على كذا سنة = بند واحد بكل الأسنان دي.
- السعر: لو قال سعر بالتحديد حطه، غير كده سيبه فاضي (هيتاخد سعر القايمة).
- note: تفاصيل قالها زي اللون أو الخامة أو "مؤقت"، باختصار. من غير تشخيص من عندك.`

  const out = await fill(system, text, {
    name: 'draft_plan',
    description: 'The plan lines the doctor dictated.',
    input_schema: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              procedure: { type: 'string', description: 'The P… code from the list.' },
              teeth: { type: 'array', items: { type: 'integer' } },
              price: { type: 'number', description: 'Only if a price was said.' },
              note: { type: 'string' },
            },
            required: ['procedure', 'teeth'],
          },
        },
        unclear: { type: 'array', items: { type: 'string' }, description: 'Anything that could not be matched, in the doctor\'s words.' },
      },
      required: ['lines', 'unclear'],
    },
  })

  // Trust nothing the model wrote: every line is checked against real rows.
  const unclear = (Array.isArray(out.unclear) ? out.unclear : []).map((u) => names.reveal(String(u)))
  const lines = []
  for (const l of (Array.isArray(out.lines) ? out.lines : []) as Json[]) {
    const p = handle.get(String(l.procedure))
    if (!p) { unclear.push('بند مش في قايمة الأسعار'); continue }
    const teeth = (Array.isArray(l.teeth) ? l.teeth : []).map(Number)
    const bad = teeth.filter((t) => !TEETH.has(t))
    if (bad.length) unclear.push(`${p.name}: رقم سنة غير صحيح ${bad.join('، ')}`)
    const price = typeof l.price === 'number' && l.price >= 0 ? l.price : Number(p.default_price)
    lines.push({
      procedureId: p.id, procedureName: p.name,
      teeth: [...new Set(teeth.filter((t) => TEETH.has(t)))].sort((a, b) => a - b),
      price, priceSaid: typeof l.price === 'number',
      note: l.note ? names.reveal(String(l.note)).slice(0, 120) : '',
    })
  }
  return { lines, unclear }
}

async function draftSession(text: string, openItems: unknown, names: Pseudonyms) {
  const items = (Array.isArray(openItems) ? openItems : []).slice(0, 100)
    .map((i: Json) => ({ id: String(i.id), label: String(i.label) }))
  const handle = new Map(items.map((it, i) => [`I${i + 1}`, it]))
  const list = items.length
    ? [...handle].map(([h, it]) => `${h} | ${it.label}`).join('\n')
    : '(مفيش بنود مفتوحة — دي زيارة من غير خطة)'

  const system = `أنت بتساعد دكتور أسنان مصري يسجّل جلسة بالكلام. البنود المفتوحة في خطته:

${list}

- done: أكواد البنود (I...) اللي قال إنه خلّصها في الجلسة دي بس. لو قال إنه بدأ حاجة ومخلصهاش، ما تحطهاش.
- note: ملاحظة الجلسة بالعربي، مرتبة ومختصرة، بنفس كلامه ومصطلحاته (الإنجليزي يفضل إنجليزي). من غير ما تزوّد تشخيص أو حاجة ماقالهاش.
- next: لو قال حاجة عن الزيارة الجاية (إمتى أو هيعمل إيه)، باختصار. غير كده فاضي.`

  const out = await fill(system, text, {
    name: 'draft_session',
    description: 'What was done in this session.',
    input_schema: {
      type: 'object',
      properties: {
        done: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
        next: { type: 'string' },
      },
      required: ['done', 'note'],
    },
  })

  const done = (Array.isArray(out.done) ? out.done : [])
    .map((h) => handle.get(String(h))?.id).filter((id): id is string => !!id)
  return {
    doneItemIds: [...new Set(done)],
    note: names.reveal(String(out.note ?? '')).slice(0, 2000),
    next: names.reveal(String(out.next ?? '')).slice(0, 300),
  }
}
