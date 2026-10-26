// Fin&Ops ▸ Job costs ◂ monday board "PRODUCTION ACEMARK PL": new Z jobs are created there. A button in
// Job costs reads the board, shows what it would do (preview), and loads only what you tick:
//   • a Z that is not in Job costs yet → a new job, its budget filled from the board:
//       "Wartosc Zlecenia" → offered price (net), "Godziny zalozone na zlecenie" → labour hours × the default rate,
//       the "Plan: …" columns (Materiał, Szyby, Panele, Malowanie, Transport, Inne) → the produce scenario line by line;
//   • a Z already in Job costs → left alone; its budget can be filled only where it is still empty
//     (never on a locked job or a decided budget);
//   • a Z number that is on the board more than once (Z.102_FAZA_1 / _FAZA_2, Z.214.b…) → listed, never loaded.
import { db } from './supabase';
import { Monday } from './monday';
import { parseMoney, referenceKey, getLabourRate } from './finJobs';
import { listBudgets, type Budget } from './jobBudget';
import { colReady } from './schemaReady';

export const PRODUCTION_BOARD = '3576361679';
export const COL = { value: 'numbers__1', hours: 'numeric_mm6rgrgy', customer: 'dropdown0__1' } as const;
/** The planned costs production fills on the board → the produce lines of the budget ("Plan: Inne" = extras). */
export const PLAN_COL = { material: 'numeric_mm8g843q', glass: 'numeric_mm8g2969', panels: 'numeric_mm8gzcw4', painting: 'numeric_mm8g2bwm', transport: 'numeric_mm8gq615', extras: 'numeric_mm8g9dg' } as const;
export type PlanKind = keyof typeof PLAN_COL;
export const PLAN_KINDS = Object.keys(PLAN_COL) as PlanKind[];

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** "Z.004b (ref…)", "Z.102_FAZA_2 - EQ…", " Z.445 -  OK…" → 4, 102, 445. Only a Z at the start of the name counts. */
export function zNumber(name: unknown): number | null {
  const m = /^\s*Z\s*\.?\s*0*(\d{1,5})(?!\d)/i.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
}
/** Every Z number in a Job costs reference: "Z.262a, Z.262b, Z.263" → [262, 263]; "Z.102 panele" → [102]. */
export function zNumbersIn(ref: unknown): number[] {
  const out = new Set<number>();
  for (const m of String(ref ?? '').matchAll(/Z\s*\.?\s*0*(\d{1,5})(?!\d)/gi)) out.add(Number(m[1]));
  return [...out];
}

export interface BoardItem { id: string; name: string; group: string | null; created: string | null; value: number | null; hours: number | null; customer: string | null; plan?: Partial<Record<PlanKind, number>> }
export type RowStatus = 'new' | 'in_office' | 'duplicate' | 'no_z';
export interface PlanRow extends BoardItem {
  z: number | null; reference: string | null; status: RowStatus;
  jobId: string | null; jobRef: string | null;        // the Job costs record it matches (in_office)
  fill: { offer_net: boolean; labour_hours: boolean; produce: PlanKind[] } | null;   // in_office: which empty budget fields the board can fill
  why: string | null;                                // in_office and not fillable / duplicate: the reason, for the screen
}
interface OfficeJob { id: string; reference: string; reference_key: string; locked: boolean }

/** The board against Job costs. Pure: the same input always gives the same plan. */
export function planImport(items: BoardItem[], jobs: OfficeJob[], budgets: Map<string, Budget>): PlanRow[] {
  const inOffice = new Map<number, OfficeJob[]>();
  for (const j of jobs) for (const z of zNumbersIn(j.reference)) { const a = inOffice.get(z); if (a) a.push(j); else inOffice.set(z, [j]); }
  const onBoard = new Map<number, number>();
  for (const it of items) { const z = zNumber(it.name); if (z !== null) onBoard.set(z, (onBoard.get(z) ?? 0) + 1); }
  return items.map((it): PlanRow => {
    const z = zNumber(it.name);
    const base = { ...it, z, reference: z === null ? null : `Z.${z}`, jobId: null, jobRef: null, fill: null, why: null };
    if (z === null) return { ...base, status: 'no_z', why: 'No Z number at the start of the name' };
    const hits = inOffice.get(z);
    if (hits?.length) {
      // Fill a budget only on the one job whose reference is exactly this Z — "Z.102 panele" or "Z.262a, Z.262b" are left to a person.
      const exact = hits.filter((j) => j.reference_key === referenceKey(`Z.${z}`));
      const row = { ...base, status: 'in_office' as const, jobId: exact[0]?.id ?? hits[0].id, jobRef: hits.map((j) => j.reference).join(' · ') };
      if (exact.length !== 1 || hits.length > 1 || (onBoard.get(z) ?? 0) > 1) return { ...row, why: 'Several records share this Z number — fill the budget by hand' };
      const j = exact[0];
      if (j.locked) return { ...row, why: 'Job is locked' };
      const b = budgets.get(j.id);
      if (b && b.decision !== 'undecided') return { ...row, why: 'Budget is decided' };
      const produce = PLAN_KINDS.filter((k) => it.plan?.[k] !== undefined && (b?.produce?.[k] ?? null) === null);
      const fill = { offer_net: it.value !== null && (b?.offer_net ?? null) === null, labour_hours: it.hours !== null && (b?.labour_hours ?? null) === null, produce };
      if (!fill.offer_net && !fill.labour_hours && !produce.length) return { ...row, why: it.value === null && it.hours === null && !Object.keys(it.plan ?? {}).length ? 'Nothing on the board to fill' : 'Budget already filled' };
      return { ...row, fill };
    }
    if ((onBoard.get(z) ?? 0) > 1) return { ...base, status: 'duplicate', why: `Z.${z} is on the board ${onBoard.get(z)} times` };
    return { ...base, status: 'new' };
  });
}

/** One board item as read from monday (column texts) → numbers. 0 counts as empty. */
export function boardItem(i: { id: string; name: string; group: string | null; created_at?: string | null; cols: Record<string, string | null> }): BoardItem {
  const n = (v: unknown) => { const x = parseMoney(v); return x === null || x <= 0 ? null : x; };
  const plan: Partial<Record<PlanKind, number>> = {};
  for (const k of PLAN_KINDS) { const v = n(i.cols[PLAN_COL[k]]); if (v !== null) plan[k] = v; }
  return { id: String(i.id), name: clean(i.name), group: i.group, created: i.created_at ? String(i.created_at).slice(0, 10) : null, value: n(i.cols[COL.value]), hours: n(i.cols[COL.hours]), customer: clean(i.cols[COL.customer]).slice(0, 120) || null, plan };
}

// ---- storage -------------------------------------------------------------------------------------
async function officeJobs(tenantId: string): Promise<OfficeJob[]> {
  const out: OfficeJob[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_jobs').select('id,reference,reference_key,locked').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as OfficeJob[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function previewMondayJobs(tenantId: string): Promise<{ rows: PlanRow[]; labourRate: number; board: string }> {
  const items = (await new Monday().listItemsDetailed(PRODUCTION_BOARD, [...Object.values(COL), ...Object.values(PLAN_COL)])).map(boardItem);
  const [jobs, budgets, labourRate] = await Promise.all([officeJobs(tenantId), listBudgets(tenantId), getLabourRate()]);
  return { rows: planImport(items, jobs, budgets), labourRate, board: PRODUCTION_BOARD };
}
/** Load the ticked rows. The plan is worked out again here, so only a row that is still new (or still
 *  fillable) is written — ticking a duplicate or a job that appeared meanwhile does nothing. */
export async function applyMondayJobs(tenantId: string, by: string, createIds: string[], fillIds: string[]): Promise<{ created: string[]; filled: string[]; skipped: number }> {
  const { rows, labourRate } = await previewMondayJobs(tenantId);
  const want = new Set(createIds.map(String)), wantFill = new Set(fillIds.map(String));
  const created: string[] = [], filled: string[] = []; let skipped = 0;
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const withIds = await colReady('fin_jobs', 'monday_item_id');   // migration 0108
  for (const r of rows) {
    if (want.has(r.id) && r.status === 'new' && r.reference) {
      const key = referenceKey(r.reference);
      if (seen.has(key)) { skipped++; continue; } seen.add(key);
      const d = r.created ? new Date(r.created + 'T12:00:00Z') : null;
      const ins = await db().from('fin_jobs').insert({ tenant_id: tenantId, created_by: by, reference: r.reference, reference_key: key, customer: r.customer,
        period_year: d ? d.getUTCFullYear() : null, period_month: d ? d.getUTCMonth() + 1 : null, note: `From monday (PRODUCTION ACEMARK PL): ${r.name}`.slice(0, 1000), ...(withIds ? { monday_item_id: r.id } : {}) }).select('id').single();
      if (ins.error) { if (/duplicate key/i.test(ins.error.message)) { skipped++; continue; } throw ins.error; }
      const plan = r.plan ?? {};
      if (r.value !== null || r.hours !== null || Object.keys(plan).length) {
        const b = await db().from('fin_job_budgets').insert({ job_id: ins.data.id, tenant_id: tenantId, offer_net: r.value, labour_hours: r.hours, labour_rate: r.hours !== null ? labourRate : null,
          produce: plan, note: 'From monday', updated_by: by, updated_at: now });
        if (b.error) throw b.error;
      }
      created.push(r.reference);
    } else if (wantFill.has(r.id) && r.status === 'in_office' && r.fill && r.jobId) {
      const patch: Record<string, any> = { updated_by: by, updated_at: now };
      if (r.fill.offer_net) patch.offer_net = r.value;
      if (r.fill.labour_hours) { patch.labour_hours = r.hours; patch.labour_rate = labourRate; }
      const cur = await db().from('fin_job_budgets').select('job_id,labour_rate,produce').eq('tenant_id', tenantId).eq('job_id', r.jobId).maybeSingle();
      if (cur.error) throw cur.error;
      if (cur.data?.labour_rate != null) delete patch.labour_rate;   // keep a rate someone already set
      if (r.fill.produce.length) {   // only the planned lines still empty in the budget
        const produce: Record<string, number> = { ...((cur.data?.produce as Record<string, number>) ?? {}) };
        for (const k of r.fill.produce) { const v = r.plan?.[k]; if (v !== undefined) produce[k] = v; }
        patch.produce = produce;
      }
      const w = cur.data
        ? await db().from('fin_job_budgets').update(patch).eq('tenant_id', tenantId).eq('job_id', r.jobId).eq('decision', 'undecided')
        : await db().from('fin_job_budgets').insert({ job_id: r.jobId, tenant_id: tenantId, ...patch });
      if (w.error) throw w.error;
      filled.push(r.jobRef ?? r.reference ?? r.id);
    } else if (want.has(r.id) || wantFill.has(r.id)) skipped++;
  }
  // the jobs already in Job costs under exactly their Z get the link to their monday item (only where they have none)
  if (withIds) for (const r of rows) {
    if (r.status !== 'in_office' || !r.jobId || !r.reference || r.jobRef !== r.reference) continue;
    const { error } = await db().from('fin_jobs').update({ monday_item_id: r.id }).eq('tenant_id', tenantId).eq('id', r.jobId).is('monday_item_id', null);
    if (error) throw error;
  }
  return { created, filled, skipped };
}

// ---- the stage of each Z job: the group of its item on the board (shown on the Job costs list) ----------------
export interface GroupUpdate { jobId: string; group: string | null; color: string | null }
/** Which jobs get which group: by the monday item kept on the job, else by its Z number — only a Z that is on the
 *  board once and a job whose reference is exactly that Z. Only changes are returned. */
export function planGroups(items: { id: string; name: string; group: string | null }[], jobs: { id: string; reference_key: string; monday_item_id?: string | null; monday_group?: string | null; monday_group_color?: string | null }[], colors: Map<string, string | null>): GroupUpdate[] {
  const byItem = new Map(items.map((i) => [String(i.id), i]));
  const byZ = new Map<number, typeof items[number] | null>();
  for (const it of items) { const z = zNumber(it.name); if (z !== null) byZ.set(z, byZ.has(z) ? null : it); }   // null = on the board twice
  const out: GroupUpdate[] = [];
  for (const j of jobs) {
    let it = j.monday_item_id ? byItem.get(String(j.monday_item_id)) : undefined;
    if (!it) { const m = /^Z\.(\d+)$/.exec(j.reference_key); const hit = m ? byZ.get(Number(m[1])) : undefined; if (hit) it = hit; }
    if (!it) continue;
    const group = it.group ?? null, color = group ? colors.get(group) ?? null : null;
    if (group !== (j.monday_group ?? null) || color !== (j.monday_group_color ?? null)) out.push({ jobId: j.id, group, color });
  }
  return out;
}
/** Read the board's groups and write each job's stage. Nothing happens before migration 0109. */
export async function refreshJobGroups(tenantId: string): Promise<{ updated: number }> {
  if (!(await colReady('fin_jobs', 'monday_group'))) return { updated: 0 };
  const m = new Monday();
  const [items, groups] = await Promise.all([m.listItemsDetailed(PRODUCTION_BOARD, []), m.listGroups(PRODUCTION_BOARD)]);
  const colors = new Map(groups.map((g) => [g.title, g.color ?? null]));
  const withIds = await colReady('fin_jobs', 'monday_item_id');
  const jobs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_jobs').select('id,reference_key,monday_group,monday_group_color' + (withIds ? ',monday_item_id' : '')).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error; jobs.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const ups = planGroups(items.map((i) => ({ id: String(i.id), name: clean(i.name), group: i.group })), jobs, colors), now = new Date().toISOString();
  for (const u of ups) {
    const { error } = await db().from('fin_jobs').update({ monday_group: u.group, monday_group_color: u.color, monday_group_at: now }).eq('tenant_id', tenantId).eq('id', u.jobId);
    if (error) throw error;
  }
  return { updated: ups.length };
}
