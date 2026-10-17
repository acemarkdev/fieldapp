// Specification parameters: storage (spec_values, migration 0080) + resolution for items and POs.
// The catalogue and the inheritance rules live in @ace/shared (spec.ts / specCatalogue.ts).
import { db } from './supabase';
import {
  normaliseSpecValue, specAllowedAt, specScopeKey, resolveItemSpec, resolveJobSpec, specFieldsAtLevel,
  SPEC_FIELDS, SPEC_LEVELS, SPEC_WHO_LABEL, ITEM_TYPES, ALL_ITEM_TYPES, SPEC_TYPE_FIELDS, SPEC_REGS, SPEC_HEADER,
  type SpecLevelKey, type SpecValueRow, type ResolvedSpec,
} from '@ace/shared';
import { getCustomerByCode } from './store';

const COLS = 'level,owner_id,scope_key,param_key,value';
// Until migration 0080 is applied the table is missing: read as "nothing set" so item drawers and POs keep working.
const missingTable = (e: any) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /spec_values/.test(String(e.message ?? '')) && /does not exist|schema cache/.test(String(e.message ?? '')));

/** Every spec row a job's items can inherit from: its customer's, the job's own levels and its items'. */
export async function listJobSpecRows(tenantId: string, jobId: string, customerId: string | null): Promise<SpecValueRow[]> {
  const q1 = db().from('spec_values').select(COLS).eq('tenant_id', tenantId).eq('job_id', jobId);
  const [a, b] = await Promise.all([
    q1,
    customerId ? db().from('spec_values').select(COLS).eq('tenant_id', tenantId).eq('level', 'customer').eq('owner_id', customerId) : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (missingTable(a.error) || missingTable(b.error)) return [];
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return [...(a.data ?? []), ...(b.data ?? [])] as SpecValueRow[];
}

export async function listCustomerSpecRows(tenantId: string, customerId: string): Promise<SpecValueRow[]> {
  const { data, error } = await db().from('spec_values').select(COLS).eq('tenant_id', tenantId).eq('level', 'customer').eq('owner_id', customerId);
  if (missingTable(error)) return [];
  if (error) throw error;
  return (data ?? []) as SpecValueRow[];
}

export interface SpecChange { key: string; label: string; from: string | null; to: string | null }

/**
 * Set (or clear, with '' / null) several fields at one level and scope. Every key must be allowed at
 * that level; values are normalised per field kind. Returns what actually changed (for the audit log).
 */
export async function saveSpecValues(
  tenantId: string,
  t: { level: SpecLevelKey; ownerId: string; jobId: string | null; scopeKey: string },
  values: Record<string, unknown>,
  userId: string | null,
): Promise<SpecChange[]> {
  const norm: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (!SPEC_FIELDS[key]) throw new Error('Unknown specification field: ' + key);
    if (!specAllowedAt(key, t.level)) throw new Error(SPEC_FIELDS[key].label + ' cannot be set at ' + t.level + ' level.');
    norm[key] = normaliseSpecValue(key, raw);
  }
  const keys = Object.keys(norm);
  if (!keys.length) return [];
  const { data: cur, error: e1 } = await db().from('spec_values').select('param_key,value')
    .eq('tenant_id', tenantId).eq('level', t.level).eq('owner_id', t.ownerId).eq('scope_key', t.scopeKey).in('param_key', keys);
  if (missingTable(e1)) throw new Error('Specification storage is not set up yet — apply migration 0080_spec_values.sql.');
  if (e1) throw e1;
  const before = new Map((cur ?? []).map((r: any) => [r.param_key, r.value as string]));
  const changes: SpecChange[] = [];
  const upserts: any[] = [], clears: string[] = [];
  for (const key of keys) {
    const from = before.get(key) ?? null, to = norm[key];
    if (from === to) continue;
    changes.push({ key, label: SPEC_FIELDS[key].label, from, to });
    if (to == null) clears.push(key);
    else upserts.push({ tenant_id: tenantId, level: t.level, owner_id: t.ownerId, job_id: t.jobId, scope_key: t.scopeKey, param_key: key, value: to, updated_by: userId, updated_at: new Date().toISOString() });
  }
  if (upserts.length) {
    const { error } = await db().from('spec_values').upsert(upserts, { onConflict: 'tenant_id,level,owner_id,scope_key,param_key' });
    if (error) throw error;
  }
  if (clears.length) {
    const { error } = await db().from('spec_values').delete()
      .eq('tenant_id', tenantId).eq('level', t.level).eq('owner_id', t.ownerId).eq('scope_key', t.scopeKey).in('param_key', clears);
    if (error) throw error;
  }
  return changes;
}

/** The customer card of a job (by its client code), or null. */
export async function jobCustomerId(tenantId: string, clientCode: string): Promise<string | null> {
  return (await getCustomerByCode(tenantId, clientCode))?.id ?? null;
}

/** Plain JSON for the browser: one resolved field. */
export function resolvedOut(r: ResolvedSpec) {
  return {
    key: r.key, label: r.def.label, section: r.def.section, kind: r.def.kind, options: r.def.options ?? null, unit: r.def.unit ?? null,
    hint: r.def.hint ?? null, reg: r.def.reg ?? null, column: r.def.column ?? null,
    value: r.value, level: r.level, source: r.source, item_editable: r.itemEditable,
    levels: r.entry.levels, who: r.entry.who, decided: r.entry.decided,
  };
}

/** Resolve one item (needs its job's rows from listJobSpecRows). */
export function itemSpecOut(item: any, rows: SpecValueRow[], jobId: string, customerId: string | null) {
  return resolveItemSpec(item, rows, { jobId, customerId }).map(resolvedOut);
}

export { resolveItemSpec, resolveJobSpec, specScopeKey };

/** The catalogue the office page needs to draw the editors (it cannot import @ace/shared). */
export function specCatalogueOut() {
  const levels: Record<string, any[]> = {};
  for (const l of SPEC_LEVELS) {
    if (l.key === 'item') continue;
    levels[l.key] = specFieldsAtLevel(l.key).map((f) => ({
      key: f.key, label: f.def.label, section: f.def.section, kind: f.def.kind, options: f.def.options ?? null, unit: f.def.unit ?? null,
      hint: f.def.hint ?? null, reg: f.def.reg ?? null, who: f.who, types: f.types, decided: f.decided, default: f.default ?? null,
    }));
  }
  const types: Record<string, string[]> = {};
  for (const t of ITEM_TYPES) types[t] = (SPEC_TYPE_FIELDS[t] ?? []).map((e) => e.key);
  return {
    levels: SPEC_LEVELS, who: SPEC_WHO_LABEL, item_types: ALL_ITEM_TYPES, order_form_types: ITEM_TYPES, levelFields: levels, types,
    counts: { header: SPEC_HEADER.length, regs: SPEC_REGS.length },
  };
}
