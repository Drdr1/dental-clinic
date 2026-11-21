/**
 * The reception assistant.
 *
 * Salma asks a question in Arabic; this answers it from the clinic's own
 * data. Three things make it safe enough to point at live patient records:
 *
 *  1. It runs as the person asking. Every read goes through PostgREST with
 *     her own token, so row-level security decides what she may see. A
 *     receptionist asking for doctor earnings gets the same refusal she
 *     would get from the app.
 *  2. It cannot write. The tools below are reads. Booking an appointment or
 *     taking money stays in the hands of the screens that guard it.
 *  3. Patient identities do not leave this server. Results are stripped
 *     before they go to the model and put back before anyone reads the
 *     answer — see privacy.ts.
 *
 * The API key lives here, never in the browser.
 */

import { Pseudonyms } from './privacy.ts'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-sonnet-5-5'
const MAX_STEPS = 10

type Json = Record<string, unknown>

/** A read the assistant may run, and how to run it. */
type Tool = {
  name: string
  description: string
  input_schema: Json
  run: (rest: Rest, clinic: string, args: Json) => Promise<unknown>
}

/** A thin PostgREST client carrying the asker's own token. */
class Rest {
  constructor(private url: string, private anon: string, private jwt: string) {}

  private async call(path: string): Promise<unknown> {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      headers: {
        apikey: this.anon,
        Authorization: `Bearer ${this.jwt}`,
        Accept: 'application/json',
      },
    })
    const body = await res.text()
    if (!res.ok) throw new Error(body.slice(0, 300))
    return body ? JSON.parse(body) : null
  }

  from(view: string, query: string) {
    return this.call(`${view}?${query}`)
  }

  async rpc(fn: string, args: Json): Promise<unknown> {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: this.anon,
        Authorization: `Bearer ${this.jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(body.slice(0, 300))
    return body ? JSON.parse(body) : null
  }
}

const LIMIT = 40   // enough to answer with, small enough to stay cheap

const TOOLS: Tool[] = [
  {
    name: 'overdue_installments',
    description: 'Patients whose installments are past due, largest first. Use for "مين عليه أقساط متأخرة" and chasing lists.',
    input_schema: { type: 'object', properties: {} },
    run: (rest, clinic) => rest.from('installment_agenda',
      `clinic_id=eq.${clinic}&status=eq.overdue&select=full_name,phone,due_date,amount,remaining,seq&order=remaining.desc&limit=${LIMIT}`),
  },
  {
    name: 'due_soon',
    description: 'Installments due or in their grace period now, and those falling due within a week. Use for "مين هيدفع الأسبوع ده".',
    input_schema: { type: 'object', properties: {} },
    run: (rest, clinic) => rest.from('installment_agenda',
      `clinic_id=eq.${clinic}&status=in.(due,in_grace,upcoming)&select=full_name,phone,due_date,amount,remaining,status&order=due_date.asc&limit=${LIMIT}`),
  },
  {
    name: 'recalls_due',
    description: 'Patients due or overdue for a check-up recall. Use for "مين محتاج كشف دوري".',
    input_schema: { type: 'object', properties: {} },
    run: (rest, clinic) => rest.from('recall_list',
      `clinic_id=eq.${clinic}&select=full_name,phone,recall_type,next_recall_due,status&order=next_recall_due.asc&limit=${LIMIT}`),
  },
  {
    name: 'unscheduled_treatment',
    description: 'Accepted treatment with work still not booked, and what it is worth. Use for "فيه شغل متعلق" or filling a quiet week.',
    input_schema: { type: 'object', properties: {} },
    run: (rest, clinic) => rest.from('unscheduled_treatment',
      `clinic_id=eq.${clinic}&select=full_name,phone,title,remaining_items,remaining_value,last_session_at&order=remaining_value.desc&limit=${LIMIT}`),
  },
  {
    name: 'lab_late',
    description: 'Lab cases past the date their next step was due, and which patients are waiting. Use for "المعمل متأخر في إيه".',
    input_schema: { type: 'object', properties: {} },
    run: (rest, clinic) => rest.from('lab_case_status',
      `clinic_id=eq.${clinic}&stage_late=is.true&select=full_name,lab_name,description,stage,next_due,days_late,doctor_name&order=days_late.desc&limit=${LIMIT}`),
  },
  {
    name: 'find_patient',
    description: 'Look a patient up by name or phone and read their balance and treating doctor. This is the one tool that sends a name off the server, so use it only when the question names somebody.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of the name, or the phone number.' } },
      required: ['query'],
    },
    run: async (rest, clinic, args) => {
      const q = String(args.query ?? '').trim()
      if (!q) return { error: 'empty query' }
      return rest.rpc('assistant_patient_brief', { p_clinic: clinic, p_query: q })
    },
  },
  {
    name: 'day_schedule',
    description: 'The appointments on one day, with time, chair, doctor and status. Use for "مين عندنا بكرة".',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, as YYYY-MM-DD.' } },
      required: ['date'],
    },
    run: (rest, clinic, args) =>
      rest.rpc('assistant_day_schedule', { p_clinic: clinic, p_date: String(args.date) }),
  },
  {
    name: 'money_summary',
    description: 'Income, expenses and profit over a period. Owner only — reception will be refused, which is correct and should be reported as-is.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      },
      required: ['from', 'to'],
    },
    run: (rest, clinic, args) =>
      rest.rpc('finance_summary', { p_clinic: clinic, p_from: String(args.from), p_to: String(args.to) }),
  },
  {
    name: 'doctors_overview',
    description: 'Each doctor over a period: sessions, patients, appointments, work value, money collected, lab cost, what they earned and what was paid to them. Use for "أخبار الدكاترة" or "مين اشتغل أكتر". Owner only — reception will be refused, which is correct and should be reported as-is.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      },
      required: ['from', 'to'],
    },
    run: async (rest, clinic, args) => {
      const rows = await rest.rpc('doctor_overview', {
        p_clinic: clinic, p_from: String(args.from), p_to: String(args.to),
      }) as Json[]
      // Only what answers the question — no phone, no registration number.
      return (rows ?? []).filter((r) => r.active !== false).map((r) => ({
        display_name: r.display_name, specialty: r.specialty, percent: r.percent,
        sessions: r.sessions, patients: r.patients, appointments: r.appointments,
        work_value: r.work_value, collected: r.collected, lab_cost: r.lab_cost,
        earned: r.earned, paid_in_period: r.paid_in_period,
        balance_all_time: Number(r.earned_all_time ?? 0) - Number(r.paid_all_time ?? 0),
      }))
    },
  },
  {
    name: 'describe_database',
    description: 'The tables and views this person can read, with their columns and types. Call this before writing your first query_database in a conversation.',
    input_schema: { type: 'object', properties: {} },
    run: (rest) => rest.rpc('assistant_schema', {}),
  },
  {
    name: 'query_database',
    description: 'Run ONE read-only PostgreSQL SELECT (or WITH … SELECT) against the clinic database and get the rows back (at most 200). Use it for any question the other tools do not cover. It runs as the person asking: rows they may not see are silently filtered out, and nothing can be written. Always filter by clinic_id. Aggregate in SQL (sum, count, group by) rather than fetching rows to add up yourself.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SELECT statement.' } },
      required: ['sql'],
    },
    run: (rest, _clinic, args) => rest.rpc('assistant_query', { p_sql: String(args.sql ?? '') }),
  },
]

const SYSTEM_TEMPLATE = `أنت مساعد لعيادة أسنان، بتساعد موظفة الاستقبال والدكاترة.

قواعد لازم تلتزم بيها:
- جاوب من البيانات اللي بترجعلك من الأدوات بس. لو مالقتش البيانات، قول إنك مالقتهاش — ما تخمّنش رقم ولا تاريخ ولا اسم أبداً.
- ردّك بالعامية المصرية، قصير وعملي. لو الإجابة قايمة أسماء، اعملها نقط مرتبة.
- المبالغ بالجنيه المصري.
- أنت مش بتعمل أي حاجة، بتقرا بس. لو حد طلب منك تحجز ميعاد أو تسجل فلوس، قوله يعملها من الشاشة بتاعتها.
- لو أداة رجعت رفض صلاحية، قول ببساطة إن البيانات دي مش متاحة لحسابك، من غير ما تحاول تلف حواليها.
- ما تدّيش نصيحة طبية ولا تشخيص. لو السؤال طبي، قول إن ده قرار الدكتور.
- عندك أدوات جاهزة للأسئلة المتكررة — استخدمها لما تنفع. لأي سؤال تاني عن العيادة استخدم describe_database وبعدين query_database واكتب SQL بنفسك.
- في الـSQL: فلتر دايماً بـ clinic_id = '{{CLINIC}}'. الأوقات timestamptz — حوّلها بـ at time zone '{{TZ}}' قبل ما تقارن بتاريخ. الحسابات (مجموع، عدد) تتعمل في الـSQL مش في دماغك. لو الاستعلام رجع خطأ، صلّحه وجرّب تاني.
- الشخص اللي بيسأل دوره: {{ROLE}}. الصفوف اللي مش مسموح له يشوفها بتختفي من غير خطأ — فلو موظفة الاستقبال سألت عن المصروفات أو أرباح العيادة أو مستحقات الدكاترة ورجعلك صفر أو مافيش صفوف، ما تقولش "صفر"؛ قول إن البيانات دي مش متاحة لحسابها.
- ده شات: الأسئلة اللي قبل كده في نفس المحادثة سياق. لو الموظفة قالت "هي" أو "التاني" أو "طب وبكرة؟" افهمها من اللي فات. ولو محتاج رقم جديد، هاته من الأداة تاني بدل ما تعتمد على رد قديم.

البيانات اللي بتوصلك فيها رموز زي PATIENT_1 و PHONE_2 مكان الأسماء والأرقام — دي بتترجع لاسمها الحقيقي قبل ما الموظفة تقرا الرد. استخدم الرمز زي ما هو في ردّك.`

function cors(extra: HeadersInit = {}): HeadersInit {
  return {
    // The stack already names its one browser origin; reuse it rather than open to all.
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://clinic.derops.dev',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...extra,
  }
}

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors({ 'Content-Type': 'application/json' }) })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!key || !url || !anon) return json({ error: 'assistant is not configured' }, 500)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'sign in first' }, 401)

  let question = ''
  let clinic = ''
  let history: { q: string; a: string }[] = []
  let seedMap: Record<string, string> = {}
  try {
    const body = await req.json()
    question = String(body.question ?? '').trim().slice(0, 1000)
    clinic = String(body.clinicId ?? '')
    // Earlier turns of this chat. Answers arrive in their token form — the
    // same text the model wrote — so no name rides along in the history.
    if (Array.isArray(body.history)) {
      history = body.history.slice(-8).map((t: Json) => ({
        q: String(t?.q ?? '').slice(0, 1000),
        a: String(t?.a ?? '').slice(0, 4000),
      })).filter((t: { q: string; a: string }) => t.q && t.a)
    }
    if (body.names && typeof body.names === 'object' && !Array.isArray(body.names)) {
      seedMap = Object.fromEntries(Object.entries(body.names as Json).slice(0, 400)) as Record<string, string>
    }
  } catch {
    return json({ error: 'bad request' }, 400)
  }
  if (!question || !clinic) return json({ error: 'bad request' }, 400)

  const rest = new Rest(url, anon, jwt)
  const names = new Pseudonyms()
  names.seed(seedMap)
  const used: string[] = []
  let nudged = false

  // Who is asking, and the clinic's clock — for the prompt only. The token is
  // decoded, not trusted: the database verifies it again on every read.
  let role = 'unknown'
  let tz = 'Africa/Cairo'
  try {
    const sub = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub
    const [members, clinics] = await Promise.all([
      rest.from('clinic_members', `clinic_id=eq.${clinic}&user_id=eq.${sub}&select=role`),
      rest.from('clinics', `id=eq.${clinic}&select=timezone`),
    ]) as [Json[], Json[]]
    role = String(members?.[0]?.role ?? 'unknown')
    tz = String(clinics?.[0]?.timezone ?? tz)
  } catch { /* the prompt just says unknown; the database still decides */ }

  // Every name and number this person could see, so a free query cannot
  // carry one out under a renamed column or inside a note.
  try {
    const ids = await rest.rpc('assistant_identities', { p_clinic: clinic }) as
      { patients: unknown[][]; staff: unknown[][]; others: unknown[][] }
    names.learn([
      ...ids.patients.flatMap(([n, ph, wa, nid, addr]) => [
        { value: n, kind: 'PATIENT' }, { value: ph, kind: 'PHONE' }, { value: wa, kind: 'PHONE' },
        { value: nid, kind: 'NATIONAL_ID' }, { value: addr, kind: 'ADDRESS' },
      ]),
      ...ids.staff.flatMap(([n, ph, reg]) => [
        { value: n, kind: 'STAFF' }, { value: ph, kind: 'PHONE' }, { value: reg, kind: 'NATIONAL_ID' },
      ]),
      // Insurers and companies that pay for patients.
      ...ids.others.flatMap(([n, ph]) => [{ value: n, kind: 'PATIENT' }, { value: ph, kind: 'PHONE' }]),
    ])
  } catch {
    // Without the list a free query could leak a name, so it is not offered.
  }
  const tools = names.learned ? TOOLS : TOOLS.filter((t) => t.name !== 'query_database')
  const system = SYSTEM_TEMPLATE
    .replaceAll('{{CLINIC}}', clinic).replaceAll('{{TZ}}', tz)
    .replaceAll('{{ROLE}}', ({ owner: 'صاحب العيادة', doctor: 'دكتور', receptionist: 'موظفة استقبال' } as Record<string, string>)[role] ?? role)

  // Membership is not checked here on purpose: every read below runs under
  // this person's own token, so the database refuses what they may not see.
  const today = new Date().toISOString().slice(0, 10)
  const messages: Json[] = []
  for (const turn of history) {
    messages.push({ role: 'user', content: turn.q })
    messages.push({ role: 'assistant', content: turn.a })
  }
  messages.push({ role: 'user', content: `${question}\n\n(النهاردة ${today})` })

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2500,
          system,
          tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
          messages,
        }),
      })
      if (!res.ok) throw new Error(`model: ${(await res.text()).slice(0, 200)}`)
      const reply = await res.json()

      const calls = (reply.content ?? []).filter((c: Json) => c.type === 'tool_use')
      if (!calls.length) {
        const text = (reply.content ?? [])
          .filter((c: Json) => c.type === 'text').map((c: Json) => c.text).join('\n').trim()
        if (!text) {
          // The model can finish a turn with nothing written — most often after
          // reading several tools' worth of rows. Never hand back a blank
          // bubble: ask it once more to write the answer.
          if (reply.stop_reason === 'max_tokens') throw new Error('الرد طلع أطول من اللازم — اسأل سؤال أضيق')
          if (nudged) throw new Error('المساعد ماقدرش يكتب رد — جرّب تسأل بطريقة تانية')
          nudged = true
          if (reply.content?.length) messages.push({ role: 'assistant', content: reply.content })
          messages.push({ role: 'user', content: 'اكتب الرد للموظفة دلوقتي من البيانات اللي جاتلك.' })
          continue
        }
        await rest.rpc('log_assistant_query', {
          p_clinic: clinic, p_question: question, p_tools: used, p_answered: true,
        }).catch(() => {})
        return json({
          answer: names.reveal(text),
          // The token form and its key go back to the browser so the next
          // question can carry this one as context without exposing names.
          raw: text,
          names: names.toMap(),
          used: used.map((u) => u.split(':')[0]),
          hidden: names.hiddenCount,
        })
      }

      messages.push({ role: 'assistant', content: reply.content })
      const results: Json[] = []
      for (const call of calls) {
        const tool = tools.find((x) => x.name === call.name)
        // The model refers to people by token; the database needs the real
        // value. Put names back into the arguments here, on our side.
        const args = Object.fromEntries(Object.entries((call.input ?? {}) as Json)
          .map(([k, v]) => [k, typeof v === 'string' ? names.reveal(v) : v]))
        // The log keeps the query as the model wrote it — in tokens, no names.
        used.push(call.name === 'query_database'
          ? `query_database: ${String((call.input as Json)?.sql ?? '').slice(0, 400)}` : call.name)
        let content: string
        try {
          if (!tool) throw new Error('unknown tool')
          const rows = await tool.run(rest, clinic, args)
          // Identities are removed here, before anything crosses the network.
          content = JSON.stringify(names.hide(rows)).slice(0, 12000)
        } catch (e) {
          // A database error can quote a value back; scrub it like any result.
          content = JSON.stringify({ error: names.hide(String(e instanceof Error ? e.message : e)) })
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content })
      }
      messages.push({ role: 'user', content: results })
    }

    throw new Error('too many steps')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await rest.rpc('log_assistant_query', {
      p_clinic: clinic, p_question: question, p_tools: used, p_answered: false, p_error: message,
    }).catch(() => {})
    return json({ error: message }, 502)
  }
})
