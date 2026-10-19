// Fin&Ops ▸ Job costs ◂ monday board "PRODUCTION ACEMARK PL": new Z jobs are created there. A button in
// Job costs reads the board, shows what it would do (preview), and loads only what you tick:
//   • a Z that is not in Job costs yet → a new job, its budget filled from the board:
//       "Wartosc Zlecenia" → offered price (net), "Godziny zalozone na zlecenie" → labour hours × the default rate;
//   • a Z already in Job costs → left alone; its budget can be filled only where it is still empty
//     (never on a locked job or a decided budget);
//   • a Z number that is on the board more than once (Z.102_FAZA_1 / _FAZA_2, Z.214.b…) → listed, never loaded.
import { db } from './supabase';
import { Monday } from './monday';
import { parseMoney, referenceKey, getLabourRate } from './finJobs';
import { listBudgets, type Budget } from './jobBudget';

export const PRODUCTION_BOARD = '3576361679';
export const COL = { value: 'numbers__1', hours: 'numeric_mm6rgrgy', customer: 'dropdown0__1' } as const;

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

export interface BoardItem { id: string; name: string; group: string | null; created: string | null; value: number | null; hours: number | null; customer: string | null }
export type RowStatus = 'new' | 'in_office' | 'duplicate' | 'no_z';
export interface PlanRow extends BoardItem {
  z: number | null; reference: string | null; status: RowStatus;
  jobId: string | null; jobRef: string | null;        // the Job costs record it matches (in_office)
  fill: { offer_net: boolean; labour_hours: boolean } | null;   // in_office: which empty budget fields the board can fill
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
      const fill = { offer_net: it.value !== null && (b?.offer_net ?? null) === null, labour_hours: it.hours !== null && (b?.labour_hours ?? null) === null };
      if (!fill.offer_net && !fill.labour_hours) return { ...row, why: it.value === null && it.hours === null ? 'Nothing on the board to fill' : 'Budget already filled' };
      return { ...row, fill };
    }
    if ((onBoard.get(z) ?? 0) > 1) return { ...base, status: 'duplicate', why: `Z.${z} is on the board ${onBoard.get(z)} times` };
    return { ...base, status: 'new' };
  });
}

/** One board item as read from monday (column texts) → numbers. 0 counts as empty. */
export function boardItem(i: { id: string; name: string; group: string | null; created_at?: string | null; cols: Record<string, string | null> }): BoardItem {
  const n = (v: unknown) => { const x = parseMoney(v); return x === null || x <= 0 ? null : x; };
  return { id: String(i.id), name: clean(i.name), group: i.group, created: i.created_at ? String(i.created_at).slice(0, 10) : null, value: n(i.cols[COL.value]), hours: n(i.cols[COL.hours]), customer: clean(i.cols[COL.customer]).slice(0, 120) || null };
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
  const items = (await new Monday().listItemsDetailed(PRODUCTION_BOARD, Object.values(COL))).map(boardItem);
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
  for (const r of rows) {
    if (want.has(r.id) && r.status === 'new' && r.reference) {
      const key = referenceKey(r.reference);
      if (seen.has(key)) { skipped++; continue; } seen.add(key);
      const d = r.created ? new Date(r.created + 'T12:00:00Z') : null;
      const ins = await db().from('fin_jobs').insert({ tenant_id: tenantId, created_by: by, reference: r.reference, reference_key: key, customer: r.customer,
        period_year: d ? d.getUTCFullYear() : null, period_month: d ? d.getUTCMonth() + 1 : null, note: `From monday (PRODUCTION ACEMARK PL): ${r.name}`.slice(0, 1000) }).select('id').single();
      if (ins.error) { if (/duplicate key/i.test(ins.error.message)) { skipped++; continue; } throw ins.error; }
      if (r.value !== null || r.hours !== null) {
        const b = await db().from('fin_job_budgets').insert({ job_id: ins.data.id, tenant_id: tenantId, offer_net: r.value, labour_hours: r.hours, labour_rate: r.hours !== null ? labourRate : null,
          note: 'From monday', updated_by: by, updated_at: now });
        if (b.error) throw b.error;
      }
      created.push(r.reference);
    } else if (wantFill.has(r.id) && r.status === 'in_office' && r.fill && r.jobId) {
      const patch: Record<string, any> = { updated_by: by, updated_at: now };
      if (r.fill.offer_net) patch.offer_net = r.value;
      if (r.fill.labour_hours) { patch.labour_hours = r.hours; patch.labour_rate = labourRate; }
      const cur = await db().from('fin_job_budgets').select('job_id,labour_rate').eq('tenant_id', tenantId).eq('job_id', r.jobId).maybeSingle();
      if (cur.error) throw cur.error;
      if (cur.data?.labour_rate != null) delete patch.labour_rate;   // keep a rate someone already set
      const w = cur.data
        ? await db().from('fin_job_budgets').update(patch).eq('tenant_id', tenantId).eq('job_id', r.jobId).eq('decision', 'undecided')
        : await db().from('fin_job_budgets').insert({ job_id: r.jobId, tenant_id: tenantId, ...patch });
      if (w.error) throw w.error;
      filled.push(r.jobRef ?? r.reference ?? r.id);
    } else if (want.has(r.id) || wantFill.has(r.id)) skipped++;
  }
  return { created, filled, skipped };
}
