// Staff accounts for a clinic. Runs server-side with the secret key, which never reaches the browser.
//
// POST /functions/v1/staff  (Authorization: Bearer <caller's session token>)
//   { action: "create", clinic_id, email, password, display_name, role }
//   { action: "set_password", clinic_id, user_id, password }
//
// The caller must be an active owner of clinic_id.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES = ['doctor', 'receptionist'] as const
type Role = (typeof ROLES)[number]

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// `code` is stable for the app to translate; `message` is for logs and developers.
const fail = (status: number, code: string, message: string) => reply(status, { error: { code, message } })

function secretKey(): string | undefined {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'method', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')
  const key = secretKey()
  if (!url || !key) return fail(500, 'config', 'Missing SUPABASE_URL or secret key in the function environment')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Who is calling? Validate their session token with the auth server.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return fail(401, 'unauthenticated', 'Missing bearer token')
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller.user) return fail(401, 'unauthenticated', 'Invalid session')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_request', 'Body must be JSON')
  }
  const clinicId = String(body.clinic_id ?? '')
  if (!clinicId) return fail(400, 'bad_request', 'clinic_id is required')

  // 2. Is the caller an active owner of this clinic?
  const { data: owner, error: ownerError } = await admin
    .from('clinic_members')
    .select('user_id')
    .eq('clinic_id', clinicId)
    .eq('user_id', caller.user.id)
    .eq('role', 'owner')
    .eq('active', true)
    .maybeSingle()
  if (ownerError) return fail(500, 'server', ownerError.message)
  if (!owner) return fail(403, 'not_owner', 'Only the clinic owner can manage staff accounts')

  const password = String(body.password ?? '')
  if (password.length < 8) return fail(400, 'weak_password', 'Password must be at least 8 characters')

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const displayName = String(body.display_name ?? '').trim()
    const role = String(body.role ?? '') as Role
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'bad_email', 'Invalid email')
    if (!displayName) return fail(400, 'bad_request', 'display_name is required')
    if (!ROLES.includes(role)) return fail(400, 'bad_role', 'role must be doctor or receptionist')

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // staff accounts are created by the owner; no confirmation email needed
    })
    if (createError || !created.user) {
      const exists = /already|registered|exists/i.test(createError?.message ?? '')
      return fail(exists ? 409 : 400, exists ? 'email_taken' : 'create_failed', createError?.message ?? 'create failed')
    }

    const { error: memberError } = await admin
      .from('clinic_members')
      .insert({ clinic_id: clinicId, user_id: created.user.id, role, display_name: displayName })
    if (memberError) {
      // Don't leave an orphan login behind.
      await admin.auth.admin.deleteUser(created.user.id)
      return fail(500, 'server', memberError.message)
    }
    return reply(200, { user_id: created.user.id })
  }

  if (body.action === 'set_password') {
    const userId = String(body.user_id ?? '')
    // Only for members of this clinic, and never for another owner.
    const { data: member, error: memberError } = await admin
      .from('clinic_members')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle()
    if (memberError) return fail(500, 'server', memberError.message)
    if (!member) return fail(404, 'not_member', 'User is not a member of this clinic')
    if (member.role === 'owner' && userId !== caller.user.id) {
      return fail(403, 'not_allowed', "Can't change another owner's password")
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return fail(400, 'update_failed', error.message)
    return reply(200, { ok: true })
  }

  return fail(400, 'bad_request', 'Unknown action')
}

Deno.serve(handle)
