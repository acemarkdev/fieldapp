// Production time ▸ WEM, step 3: the analysis per task code (the rules of analiza.py) and the export in the WEM layout.
//   • Per code: minutes of work (Praca), setup (Przezbrojenie) and rework (Poprawka); pieces counted from work entries
//     only (rework is never a new piece); minutes of work per piece, all minutes per piece, % lost = (setup + rework) / all;
//     labour cost at each worker's own rate on the day (default rate when the worker has none) and cost per piece.
//   • An entry without a time type counts as work (as in analiza.py) and is reported as a gap, like a finished work
//     entry without a quantity.
//   • Per product (Sash, Casement, Drzwi): minutes and cost for one unit when every code of its path (pre-cut timber,
//     so without the sawn-timber-only rows) has pieces in the period — sash rows × 2 sashes for a Sash, × 1 otherwise.
//   • Weekly trend (Monday to Sunday, Polish time), for everything and per code.
import type { CatalogRow } from './wemTasks';
import { local } from './prodTime';

export type TimeType = 'work' | 'setup' | 'rework';
export const TYPE_PL: Record<TimeType, string> = { work: 'Praca', setup: 'Przezbrojenie', rework: 'Poprawka' };
export interface AEntry { id: string; user_id: string | null; user_name: string | null; task_id: string | null; task_name: string | null; started_at: string; ended_at: string | null; time_type?: string | null; qty_done?: number | string | null; note?: string | null }
export interface ATask { id: string; code?: string | null; position?: string | null; job_ref?: string | null }
export interface Mins { work: number; setup: number; rework: number }
export interface CodeStat extends Mins {
  code: string; department: string | null; product: string | null; element: string | null; activity: string; station: string | null; unit: string | null;
  entries: number; total: number; pieces: number; workPerPiece: number | null; totalPerPiece: number | null; lostPct: number | null;
  cost: number | null; costPerPiece: number | null; noQty: number; untyped: number;
}
export interface Week extends Mins { week: string; total: number; pieces: number; lostPct: number | null; cost: number | null }
export interface ProductPath { product: string; sashes: number; codes: number; measured: number; missing: string[]; complete: boolean; minutesPerUnit: number | null; costPerUnit: number | null; timberExtra: number | null }
export interface Analysis {
  codes: CodeStat[]; weeks: Week[]; codeWeeks: Record<string, Week[]>; products: ProductPath[];
  totals: Mins & { entries: number; total: number; lostPct: number | null; cost: number | null; downtime: number; other: number; noCode: number; noQty: number; untyped: number };
  topLost: string[]; topSlow: string[];
}

const CODE_RE = /([A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{0,3}\d{2})$/;
const r1 = (n: number) => Math.round(n * 10) / 10, r2 = (n: number) => Math.round(n * 100) / 100;
const minutes = (e: AEntry) => e.ended_at ? Math.max(0, (Date.parse(e.ended_at) - Date.parse(e.started_at)) / 60000) : 0;
const typeOf = (t: unknown): TimeType | null => (t === 'work' || t === 'setup' || t === 'rework' ? t : null);
const qtyOf = (q: unknown): number | null => { if (q === null || q === undefined || q === '') return null; const n = Number(String(q).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const lost = (m: Mins) => { const t = m.work + m.setup + m.rework; return t ? r1(((m.setup + m.rework) / t) * 100) : null; };
/** The entry's task code, order and position: from its task, else read from the task name (WEM-2026-001_1_SAS-SKR-ST05). */
export function whereOf(e: Pick<AEntry, 'task_id' | 'task_name'>, tasks: Map<string, ATask>): { code: string; order: string; pos: string } {
  const t = e.task_id ? tasks.get(e.task_id) : undefined;
  const name = String(e.task_name ?? '');
  const code = t?.code || CODE_RE.exec(name)?.[1] || '';
  const m = code ? new RegExp(`^(.*)_([^_]*)_${code}$`).exec(name) : null;
  return { code, order: t?.job_ref || m?.[1] || '', pos: t?.position || m?.[2] || '' };
}
/** Monday of the entry's week (YYYY-MM-DD, Polish time). */
export function weekOf(iso: string): string {
  const day = local(iso).date, d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const SASHES: Record<string, number> = { Sash: 2 };

/** `rateOf(entry)` → zł per hour on the entry's day; `money` false leaves every cost out (a role without time.rates). */
export function analyse(entries: AEntry[], tasks: ATask[], catalog: CatalogRow[], rateOf: (e: AEntry) => number, money: boolean): Analysis {
  const byTask = new Map(tasks.map((t) => [t.id, t])), cat = new Map(catalog.map((c) => [c.code, c]));
  const acc = new Map<string, Mins & { entries: number; pieces: number; cost: number; noQty: number; untyped: number }>();
  const weeks = new Map<string, Map<string, Mins & { pieces: number; cost: number }>>();   // code ('' = all) → week → sums
  const add = (code: string, wk: string, type: TimeType, m: number, pcs: number, cost: number) => {
    for (const k of [code, '*']) {
      const w = weeks.get(k) ?? weeks.set(k, new Map()).get(k)!;
      const s = w.get(wk) ?? w.set(wk, { work: 0, setup: 0, rework: 0, pieces: 0, cost: 0 }).get(wk)!;
      s[type] += m; s.pieces += pcs; s.cost += cost;
    }
  };
  let noCode = 0, costAll = 0;
  for (const e of entries) {
    if (!e.ended_at) continue;
    const m = minutes(e), { code } = whereOf(e, byTask), t = typeOf(e.time_type), type: TimeType = t ?? 'work';
    const cost = money ? (m / 60) * rateOf(e) : 0;
    costAll += cost;
    if (!code) { noCode += m; continue; }
    const a = acc.get(code) ?? acc.set(code, { work: 0, setup: 0, rework: 0, entries: 0, pieces: 0, cost: 0, noQty: 0, untyped: 0 }).get(code)!;
    const q = qtyOf(e.qty_done), pcs = type === 'work' && q !== null ? q : 0;
    a[type] += m; a.entries++; a.pieces += pcs; a.cost += cost;
    if (!t) a.untyped++;
    if (type === 'work' && q === null && !code.startsWith('OGL-')) a.noQty++;
    add(code, weekOf(e.started_at), type, m, pcs, cost);
  }
  const codes: CodeStat[] = [...acc.entries()].map(([code, a]) => {
    const k = cat.get(code), total = a.work + a.setup + a.rework;
    return { code, department: k?.department ?? null, product: k?.product ?? null, element: k?.element ?? null, activity: k?.activity ?? 'unknown code', station: k?.station ?? null, unit: k?.unit ?? null,
      entries: a.entries, work: r1(a.work), setup: r1(a.setup), rework: r1(a.rework), total: r1(total), pieces: r2(a.pieces),
      workPerPiece: a.pieces ? r2(a.work / a.pieces) : null, totalPerPiece: a.pieces ? r2(total / a.pieces) : null, lostPct: lost(a),
      cost: money ? r2(a.cost) : null, costPerPiece: money && a.pieces ? r2(a.cost / a.pieces) : null, noQty: a.noQty, untyped: a.untyped };
  }).sort((x, y) => (cat.get(x.code)?.sort ?? 1e9) - (cat.get(y.code)?.sort ?? 1e9) || x.code.localeCompare(y.code));
  const weekList = (w: Map<string, Mins & { pieces: number; cost: number }> | undefined): Week[] => [...(w ?? new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, s]) => ({ week, work: r1(s.work), setup: r1(s.setup), rework: r1(s.rework), total: r1(s.work + s.setup + s.rework), pieces: r2(s.pieces), lostPct: lost(s), cost: money ? r2(s.cost) : null }));
  const codeWeeks: Record<string, Week[]> = {}; for (const c of codes) codeWeeks[c.code] = weekList(weeks.get(c.code));
  // one unit of each product: every code of its path measured (pre-cut timber; the sawn-timber rows shown apart)
  const stat = new Map(codes.map((c) => [c.code, c]));
  const products: ProductPath[] = [...new Set(catalog.filter((c) => c.active !== false && c.qty_rule !== 'none' && c.product && /^(SAS|CAS|DRZ)-/.test(c.code)).map((c) => c.product!))].map((product) => {
    const rows = catalog.filter((c) => c.active !== false && c.product === product && /^(SAS|CAS|DRZ)-/.test(c.code)), sashes = SASHES[product] ?? 1;
    const mult = (c: CatalogRow) => (c.qty_rule === 'sash' ? sashes : 1);
    const path = rows.filter((c) => !c.timber_only), missing = path.filter((c) => !stat.get(c.code)?.pieces).map((c) => c.code);
    const sum = (list: CatalogRow[], f: (s: CodeStat) => number | null) => list.reduce((t, c) => { const s = stat.get(c.code), v = s ? f(s) : null; return t + (v ?? 0) * mult(c); }, 0);
    const complete = !missing.length && path.length > 0;
    const timber = rows.filter((c) => c.timber_only && stat.get(c.code)?.pieces);
    return { product, sashes, codes: path.length, measured: path.length - missing.length, missing, complete,
      minutesPerUnit: complete ? r1(sum(path, (s) => s.totalPerPiece)) : null, costPerUnit: complete && money ? r2(sum(path, (s) => s.costPerPiece)) : null,
      timberExtra: complete && timber.length ? r1(sum(timber, (s) => s.totalPerPiece)) : null };
  });
  const tot = codes.reduce((t, c) => ({ work: t.work + c.work, setup: t.setup + c.setup, rework: t.rework + c.rework }), { work: 0, setup: 0, rework: 0 });
  const measured = codes.filter((c) => !c.code.startsWith('OGL-') && c.total > 0);
  return {
    codes, weeks: weekList(weeks.get('*')), codeWeeks, products,
    totals: { entries: codes.reduce((n, c) => n + c.entries, 0), work: r1(tot.work), setup: r1(tot.setup), rework: r1(tot.rework), total: r1(tot.work + tot.setup + tot.rework), lostPct: lost(tot),
      cost: money ? r2(costAll) : null, downtime: stat.get('OGL-PRZ-01')?.total ?? 0, other: stat.get('OGL-INN-01')?.total ?? 0, noCode: r1(noCode),
      noQty: codes.reduce((n, c) => n + c.noQty, 0), untyped: codes.reduce((n, c) => n + c.untyped, 0) },
    topLost: measured.filter((c) => (c.lostPct ?? 0) > 0).sort((a, b) => (b.lostPct ?? 0) - (a.lostPct ?? 0) || b.total - a.total).slice(0, 5).map((c) => c.code),
    topSlow: measured.filter((c) => c.totalPerPiece !== null).sort((a, b) => (b.totalPerPiece ?? 0) - (a.totalPerPiece ?? 0)).slice(0, 5).map((c) => c.code),
  };
}

// ---- the export in the WEM layout: one line = one start–stop stretch -----------------------------------
export const WEM_EXPORT_HEAD = ['ID', 'Pracownik', 'Nr zlecenia', 'Poz.', 'Kod tasku', 'Rodzaj czasu', 'Start', 'Stop', 'Ilość wykonana', 'Uwagi'];
const stamp = (iso: string) => { const l = local(iso); return `${l.date} ${l.time.slice(0, 5)}`; };
export function wemExportRows(entries: AEntry[], tasks: ATask[]): string[][] {
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  return entries.filter((e) => e.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at)).map((e, i) => {
    const w = whereOf(e, byTask), t = typeOf(e.time_type), q = qtyOf(e.qty_done);
    return [String(i + 1), e.user_name ?? '', w.order, w.pos, w.code, t ? TYPE_PL[t] : '', stamp(e.started_at), stamp(e.ended_at!), q === null ? '' : String(q).replace('.', ','), e.note ?? ''];
  });
}
