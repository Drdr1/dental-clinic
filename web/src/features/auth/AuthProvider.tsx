import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { setClinicTimeZone } from '../../lib/dates'

export type Role = 'owner' | 'doctor' | 'receptionist'

export type Membership = {
  userId: string
  clinicId: string
  clinicName: string
  role: Role
  displayName: string
  /** Parts of the system the owner switched off in Settings → Features. */
  disabledFeatures: string[]
  /** Post-visit review requests are switched on. */
  reviewsEnabled: boolean
}

type AuthState = {
  loading: boolean
  session: Session | null
  member: Membership | null
  isDoctor: boolean
  signOut: () => Promise<void>
  /** Re-read the membership (after renaming the clinic, for example). */
  reloadMember: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [member, setMember] = useState<Membership | null>(null)
  const [memberLoaded, setMemberLoaded] = useState(false)
  const [memberVersion, setMemberVersion] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    // Keep this callback synchronous: calling Supabase from inside it can deadlock the auth lock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setMember(null)
      setMemberLoaded(true)
      return
    }
    // Show the loading state only when the user changes, not on a background reload.
    if (lastUserId.current !== userId) {
      lastUserId.current = userId
      setMemberLoaded(false)
    }
    supabase
      .from('clinic_members')
      .select('clinic_id, role, display_name, clinics(name, disabled_features, reviews_enabled, timezone)')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setMember(null)
        } else {
          // Many-to-one embed: an object with generated types; normalize defensively anyway.
          const clinic = Array.isArray(data.clinics) ? data.clinics[0] : data.clinics
          // "Today" is the clinic's day, whatever timezone the phone or laptop is set to.
          setClinicTimeZone(clinic?.timezone)
          setMember({
            userId,
            clinicId: data.clinic_id,
            clinicName: clinic?.name ?? '',
            role: data.role as Role,
            displayName: data.display_name,
            disabledFeatures: clinic?.disabled_features ?? [],
            reviewsEnabled: !!clinic?.reviews_enabled,
          })
        }
        setMemberLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId, memberVersion])

  const value: AuthState = {
    loading: !sessionLoaded || (userId !== null && !memberLoaded),
    session,
    member,
    isDoctor: member?.role === 'owner' || member?.role === 'doctor',
    signOut: async () => {
      await supabase.auth.signOut()
    },
    reloadMember: () => setMemberVersion((v) => v + 1),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For screens under <RequireAuth>, where a membership is guaranteed. */
/** False when the owner switched this part of the system off. */
export function useFeature(name: 'installments' | 'labs' | 'commission' | 'materials' | 'assistant' | 'payers'): boolean {
  const ctx = useContext(AuthContext)
  return !ctx?.member?.disabledFeatures.includes(name)
}

export function useMember(): Membership {
  const { member } = useAuth()
  if (!member) throw new Error('useMember used outside an authenticated clinic route')
  return member
}
