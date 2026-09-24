import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** The clinic's uploaded logo (a small PNG data URL), or null. */
export function useClinicLogo(clinicId?: string | null) {
  return useQuery({
    queryKey: ['clinic-logo', clinicId],
    queryFn: async () =>
      (await supabase.from('clinics').select('logo_url').eq('id', clinicId!).single()).data?.logo_url ?? null,
    enabled: !!clinicId,
    staleTime: 300_000,
  })
}
