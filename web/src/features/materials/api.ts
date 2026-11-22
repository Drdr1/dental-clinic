import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import type { PaymentMethod } from '../payments/api'

export type MaterialStock = Tables<'material_stock'>
export type Movement = Tables<'material_movements'>

export async function getStock(clinicId: string): Promise<MaterialStock[]> {
  const { data, error } = await supabase.from('material_stock').select('*').eq('clinic_id', clinicId)
    .order('active', { ascending: false }).order('name')
  if (error) throw error
  return data
}

export async function getLowStock(clinicId: string): Promise<MaterialStock[]> {
  const { data, error } = await supabase.from('material_stock').select('*').eq('clinic_id', clinicId)
    .eq('is_low', true).order('name')
  if (error) throw error
  return data
}

export async function saveMaterial(clinicId: string, m: {
  id?: string; name: string; unit: string; min_stock: number; supplier_name: string; supplier_phone: string; active: boolean
}) {
  const row = {
    name: m.name.trim(), unit: m.unit.trim() || 'piece', min_stock: m.min_stock,
    supplier_name: m.supplier_name.trim() || null, supplier_phone: m.supplier_phone.trim() || null, active: m.active,
  }
  const { error } = m.id
    ? await supabase.from('materials').update(row).eq('id', m.id)
    : await supabase.from('materials').insert({ ...row, clinic_id: clinicId })
  if (error) throw error
}

export async function recordPurchase(materialId: string, quantity: number, totalCost: number, method: PaymentMethod, date: string, note: string) {
  const { error } = await supabase.rpc('record_purchase', {
    p_material_id: materialId, p_quantity: quantity, p_total_cost: totalCost, p_method: method,
    p_occurred_on: date, p_note: note.trim() || undefined,
  })
  if (error) throw error
}

export async function recordUsage(materialId: string, quantity: number, note: string) {
  const { error } = await supabase.rpc('record_usage', { p_material_id: materialId, p_quantity: quantity, p_note: note.trim() || undefined })
  if (error) throw error
}

export async function recordCount(materialId: string, counted: number) {
  const { data, error } = await supabase.rpc('record_stock_count', { p_material_id: materialId, p_counted: counted })
  if (error) throw error
  return data as number
}

export async function getHistory(materialId: string): Promise<Movement[]> {
  const { data, error } = await supabase.from('material_movements').select('*').eq('material_id', materialId)
    .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data
}

export async function getRecipes(clinicId: string) {
  const [links, procedures] = await Promise.all([
    supabase.from('procedure_materials').select('procedure_id, material_id, quantity').eq('clinic_id', clinicId),
    supabase.from('procedures').select('id, name').eq('clinic_id', clinicId).eq('active', true).order('name'),
  ])
  if (links.error) throw links.error
  if (procedures.error) throw procedures.error
  return { links: links.data, procedures: procedures.data }
}

export async function setRecipe(clinicId: string, procedureId: string, materialId: string, quantity: number | null) {
  const { error } = quantity
    ? await supabase.from('procedure_materials')
        .upsert({ clinic_id: clinicId, procedure_id: procedureId, material_id: materialId, quantity })
    : await supabase.from('procedure_materials').delete().eq('procedure_id', procedureId).eq('material_id', materialId)
  if (error) throw error
}

/** Deletes a material. Needs force (owner) once it has any stock history. */
export async function deleteMaterial(materialId: string, force = false) {
  const { error } = await supabase.rpc('delete_material', { p_material: materialId, p_force: force })
  if (error) throw error
}

/** The page's top numbers: purchases this month and the last stock count. */
export async function getMaterialSummary(clinicId: string) {
  const d = new Date()
  const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  const [buys, counts] = await Promise.all([
    supabase.from('material_movements').select('total_cost, occurred_on').eq('clinic_id', clinicId)
      .eq('kind', 'purchase').gte('occurred_on', monthStart),
    supabase.from('material_movements').select('quantity, occurred_on').eq('clinic_id', clinicId)
      .eq('kind', 'adjustment').order('occurred_on', { ascending: false }).limit(200),
  ])
  if (buys.error) throw buys.error
  if (counts.error) throw counts.error
  const lastCount = counts.data[0]?.occurred_on ?? null
  return {
    monthBuys: buys.data.reduce((s, r) => s + (r.total_cost ?? 0), 0),
    monthBuyCount: buys.data.length,
    lastCount,
    lastCountDiff: lastCount ? counts.data.filter((r) => r.occurred_on === lastCount).reduce((s, r) => s + Math.abs(r.quantity), 0) : 0,
  }
}
