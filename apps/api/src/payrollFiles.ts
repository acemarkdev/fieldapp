// Fin&Ops ▸ Payroll ◂ the accountant's monthly files (PDF, Polish payroll program):
//   Lista płac   — one row per person: pay components and "Do wypłaty" (net to pay)
//   ZUS          — the transfer of all social + health contributions (employee and employer)
//   PIT-4        — the transfer of the income tax advances, with its period (rok, M, miesiąc)
// Loading a month: every person belongs to a group (Office / Sales / Production / Other — Other is
// e.g. someone employed here whose cost is recharged to the UK, so left out of Payroll). Per group:
//   salaries = sum of net to pay; taxes = (ZUS + PIT-4) split by each group's share of gross pay.
// Taxes only ever come from the files; salaries can get a lump sum on top (typed per month).
import { db } from './supabase';
import { parseMoney, parseMonth } from './finJobs';
import { PAYROLL_DEPTS, type PayrollDept } from './finPayroll';

export const PAY_GROUPS = [...PAYROLL_DEPTS, 'Other'] as const;
export type PayGroup = (typeof PAY_GROUPS)[number];
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** "Szczypiorska  Justyna" / "SZCZYPIORSKA JUSTYNA" → one key. */
export const personKey = (name: unknown) => clean(name).toLocaleUpperCase('pl-PL');
const MONEY = /^-?\d+,\d{2}$/;

// ---- reading the files (text as extracted from the PDF) --------------------------------------------
export type FileKind = 'list' | 'zus' | 'pit4';
export function fileKind(text: string): FileKind | null {
  if (/Lista\s+płac/i.test(text)) return 'list';
  if (/PIT-?4R?\b/.test(text) && /Urząd\s+Skarbowy/i.test(text)) return 'pit4';
  if (/Zakład\s+Ubezpieczeń\s+Społecznych/i.test(text)) return 'zus';
  return null;
}
export interface ListPerson { name: string; key: string; gross: number; net: number }
export interface PayList { year: number; month: number; payDate: string | null; company: string | null; people: ListPerson[]; gross: number; net: number }
/** The payroll list: person rows "12 TEODORCZYK KAMIL 10094,97 0,00 … 7464,75". Gross = the first four
 *  amounts (pay components, taxable benefits, sick pay, holiday pay); net = the last ("Do wypłaty").
 *  Checked against the NARASTAJĄCO totals so a changed layout is noticed instead of loaded wrong. */
export function parseList(text: string): Result<{ list: PayList }> {
  const mm = /Lista\s+płac\s+za\s+miesiąc\s+(\S+)\s+(\d{4})/i.exec(text);
  const month = mm ? parseMonth(mm[1]) : null;
  if (!mm || !month) return fail(400, 'Payroll list: the month ("Lista płac za miesiąc …") was not found.');
  const people: ListPerson[] = [];
  for (const line of text.split('\n')) {
    const t = clean(line).split(' ');
    if (t.length < 8 || !/^\d{1,3}$/.test(t[0])) continue;
    let i = t.length; while (i > 1 && MONEY.test(t[i - 1])) i--;
    const nums = t.slice(i).map((x) => parseMoney(x) ?? 0), name = t.slice(1, i).join(' ');
    if (nums.length < 8 || !/\p{L}/u.test(name)) continue;
    people.push({ name, key: personKey(name), gross: round2(nums[0] + nums[1] + nums[2] + nums[3]), net: nums[nums.length - 1] });
  }
  if (!people.length) return fail(400, 'Payroll list: no person rows were found.');
  const gross = round2(people.reduce((s, p) => s + p.gross, 0)), net = round2(people.reduce((s, p) => s + p.net, 0));
  const tot = /NARASTAJĄCO:([\s\S]*?)Data\s+wypłaty/i.exec(text);
  if (tot) {
    const n = tot[1].split(/\s+/).filter((x) => MONEY.test(x)).map((x) => parseMoney(x) ?? 0);
    const tg = round2(n.slice(0, 4).reduce((s, x) => s + x, 0)), tn = n[n.length - 1];
    if (Math.abs(tg - gross) > 0.05 || Math.abs(tn - net) > 0.05) return fail(400, `Payroll list: the rows (gross ${gross.toFixed(2)}, net ${net.toFixed(2)}) do not add up to the list's totals (gross ${tg.toFixed(2)}, net ${tn.toFixed(2)}) — the file layout may have changed.`);
  }
  const pd = /Data\s+wypłaty:\s*(\d{2})\.(\d{2})\.(\d{4})/i.exec(text);
  const co = /Firma:\s*([^\n]+)/i.exec(text);
  return { ok: true, list: { year: Number(mm[2]), month, payDate: pd ? `${pd[3]}-${pd[2]}-${pd[1]}` : null, company: co ? clean(co[1]) : null, people, gross, net } };
}
/** A transfer form: the amount stands on a line of its own (the same on every copy of the form). */
function transferAmount(text: string, what: string): Result<{ amount: number }> {
  const a = [...new Set(text.split('\n').map(clean).filter((l) => MONEY.test(l)))];
  if (a.length !== 1) return fail(400, `${what}: ${a.length ? 'more than one amount' : 'no amount'} found on the transfer.`);
  return { ok: true, amount: parseMoney(a[0])! };
}
export const parseZus = (text: string) => transferAmount(text, 'ZUS');
export function parsePit4(text: string): Result<{ amount: number; year: number | null; month: number | null }> {
  const a = transferAmount(text, 'PIT-4'); if (!a.ok) return a;
  const p = /\bM\s+(\d)\s*(\d)\s+M\s+(\d)\s*(\d)\b/.exec(text);   // "11. okres": RR M MM, e.g. "M 2 6 M 0 9"
  return { ok: true, amount: a.amount, year: p ? 2000 + Number(p[1] + p[2]) : null, month: p ? Number(p[3] + p[4]) : null };
}

// ---- the split ------------------------------------------------------------------------------------
export interface GroupTotals { people: number; gross: number; net: number; taxes: number }
/** Net per group and ZUS + PIT-4 split by gross share (cents distributed so the parts add up exactly). */
export function splitByGroup(people: (ListPerson & { group: PayGroup })[], zus: number, pit: number): Record<PayGroup, GroupTotals> {
  const out = Object.fromEntries(PAY_GROUPS.map((g) => [g, { people: 0, gross: 0, net: 0, taxes: 0 }])) as Record<PayGroup, GroupTotals>;
  for (const p of people) { const o = out[p.group]; o.people++; o.gross = round2(o.gross + p.gross); o.net = round2(o.net + p.net); }
  const totalGross = PAY_GROUPS.reduce((s, g) => s + out[g].gross, 0), cents = Math.round((zus + pit) * 100);
  if (totalGross <= 0) return out;
  const raw = PAY_GROUPS.map((g) => (cents * out[g].gross) / totalGross), base = raw.map(Math.floor);
  let left = cents - base.reduce((s, x) => s + x, 0);
  raw.map((r, i) => [r - base[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  PAY_GROUPS.forEach((g, i) => { out[g].taxes = base[i] / 100; });
  return out;
}

/** The three files of one month, read and checked. Groups come from `groups` (the screen) or the saved people. */
export interface Preview { year: number; month: number; payDate: string | null; company: string | null; people: (ListPerson & { group: PayGroup | null; known: boolean })[]; gross: number; net: number; zus: number; pit: number; pitPeriod: string | null; warnings: string[]; files: { kind: FileKind; name: string }[] }
export function buildPreview(texts: { name: string; text: string }[], saved: Map<string, PayGroup>): Result<{ preview: Preview }> {
  const by: Partial<Record<FileKind, { name: string; text: string }>> = {};
  for (const f of texts) {
    const k = fileKind(f.text);
    if (!k) return fail(400, `${f.name}: not a payroll list, ZUS or PIT-4 transfer.`);
    if (by[k]) return fail(400, `Two ${k === 'list' ? 'payroll lists' : k === 'zus' ? 'ZUS transfers' : 'PIT-4 transfers'} were chosen (${by[k]!.name}, ${f.name}).`);
    by[k] = f;
  }
  const missing = (['list', 'zus', 'pit4'] as FileKind[]).filter((k) => !by[k]).map((k) => (k === 'list' ? 'the payroll list' : k === 'zus' ? 'the ZUS transfer' : 'the PIT-4 transfer'));
  if (missing.length) return fail(400, `Choose all three files — missing: ${missing.join(', ')}.`);
  const l = parseList(by.list!.text); if (!l.ok) return l;
  const z = parseZus(by.zus!.text); if (!z.ok) return z;
  const p = parsePit4(by.pit4!.text); if (!p.ok) return p;
  const warnings: string[] = [];
  if (p.year && p.month && (p.year !== l.list.year || p.month !== l.list.month)) warnings.push(`The PIT-4 transfer is for ${p.year}-${String(p.month).padStart(2, '0')}, the payroll list for ${l.list.year}-${String(l.list.month).padStart(2, '0')}.`);
  const keys = new Set<string>();
  for (const x of l.list.people) { if (keys.has(x.key)) warnings.push(`${x.name} is on the list twice.`); keys.add(x.key); }
  return { ok: true, preview: { year: l.list.year, month: l.list.month, payDate: l.list.payDate, company: l.list.company, gross: l.list.gross, net: l.list.net, zus: z.amount, pit: p.amount,
    pitPeriod: p.year && p.month ? `${p.year}-${String(p.month).padStart(2, '0')}` : null, warnings, files: (['list', 'zus', 'pit4'] as FileKind[]).map((k) => ({ kind: k, name: by[k]!.name })),
    people: l.list.people.map((x) => ({ ...x, group: saved.get(x.key) ?? null, known: saved.has(x.key) })) } };
}

// ---- storage -------------------------------------------------------------------------------------
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return String(text);
}
const missingTable = (e: any) => /(fin_payroll_people|fin_payroll_loads|lump|source)/.test(String(e?.message ?? '')) && /(does not exist|schema cache|not find)/i.test(String(e?.message ?? ''));
const NEEDS = 'Loading payroll files needs migration 0085.';
export interface Person { key: string; name: string; group: PayGroup; updated_by: string | null; updated_at: string | null }
export async function listPeople(tenantId: string): Promise<Person[] | null> {
  const { data, error } = await db().from('fin_payroll_people').select('name_key,name,grp,updated_by,updated_at').eq('tenant_id', tenantId).order('name');
  if (error) { if (missingTable(error)) return null; throw error; }
  return (data ?? []).map((r: any) => ({ key: r.name_key, name: r.name, group: r.grp, updated_by: r.updated_by, updated_at: r.updated_at }));
}
export async function setPersonGroup(tenantId: string, by: string, key: unknown, group: unknown): Promise<Result<{ name: string }>> {
  if (!PAY_GROUPS.includes(group as PayGroup)) return fail(400, 'Choose Office, Sales, Production or Other.');
  const { data, error } = await db().from('fin_payroll_people').update({ grp: group, updated_by: by, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('name_key', String(key)).select('name');
  if (error) { if (missingTable(error)) return fail(503, NEEDS); throw error; }
  if (!data?.length) return fail(404, 'Person not found.');
  return { ok: true, name: data[0].name };
}
async function readFiles(files: any[]): Promise<Result<{ texts: { name: string; text: string }[] }>> {
  if (!Array.isArray(files) || !files.length) return fail(400, 'Choose the three files.');
  if (files.length > 3) return fail(400, 'Choose only the three files: payroll list, ZUS and PIT-4.');
  const texts: { name: string; text: string }[] = [];
  for (const f of files) {
    const m = /^data:([^;]*);base64,(.+)$/.exec(String(f?.dataUrl ?? ''));
    const name = clean(f?.name).slice(0, 160) || 'file';
    if (!m) return fail(400, `${name}: could not read the file.`);
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > 5_000_000) return fail(400, `${name}: the file is too large.`);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') return fail(400, `${name}: not a PDF.`);
    try { texts.push({ name, text: await pdfText(new Uint8Array(bytes)) }); } catch { return fail(400, `${name}: the PDF could not be read.`); }
  }
  return { ok: true, texts };
}
export async function previewFiles(tenantId: string, files: any[]): Promise<Result<{ preview: Preview; loaded: { loaded_by: string; loaded_at: string } | null }>> {
  const people = await listPeople(tenantId); if (people === null) return fail(503, NEEDS);
  const r = await readFiles(files); if (!r.ok) return r;
  const b = buildPreview(r.texts, new Map(people.map((p) => [p.key, p.group]))); if (!b.ok) return b;
  const { data } = await db().from('fin_payroll_loads').select('loaded_by,loaded_at').eq('tenant_id', tenantId).eq('period_year', b.preview.year).eq('period_month', b.preview.month).maybeSingle();
  return { ok: true, preview: b.preview, loaded: data ?? null };
}
/** Load the month: the files are read again here (nothing from the screen is trusted but the groups). */
export async function applyFiles(tenantId: string, by: string, files: any[], groups: Record<string, unknown>): Promise<Result<{ year: number; month: number; split: Record<PayGroup, GroupTotals> }>> {
  const people = await listPeople(tenantId); if (people === null) return fail(503, NEEDS);
  const r = await readFiles(files); if (!r.ok) return r;
  const saved = new Map(people.map((p) => [p.key, p.group]));
  const b = buildPreview(r.texts, saved); if (!b.ok) return b;
  const pv = b.preview;
  const rows = pv.people.map((x) => ({ ...x, group: (PAY_GROUPS.includes(groups?.[x.key] as PayGroup) ? groups[x.key] : x.group) as PayGroup | null }));
  const none = rows.filter((x) => !x.group);
  if (none.length) return fail(400, `Choose a group for ${none.map((x) => x.name).join(', ')}.`);
  const split = splitByGroup(rows as (ListPerson & { group: PayGroup })[], pv.zus, pv.pit);
  const now = new Date().toISOString();
  const pp = await db().from('fin_payroll_people').upsert(rows.map((x) => ({ tenant_id: tenantId, name_key: x.key, name: x.name, grp: x.group, updated_by: by, updated_at: now })), { onConflict: 'tenant_id,name_key' });
  if (pp.error) throw pp.error;
  const ld = await db().from('fin_payroll_loads').upsert({ tenant_id: tenantId, period_year: pv.year, period_month: pv.month, pay_date: pv.payDate,
    people: rows.map((x) => ({ name: x.name, key: x.key, group: x.group, gross: x.gross, net: x.net })), gross: pv.gross, net: pv.net, zus: pv.zus, pit: pv.pit, split, files: pv.files, loaded_by: by, loaded_at: now },
    { onConflict: 'tenant_id,period_year,period_month' });
  if (ld.error) throw ld.error;
  const pr = await db().from('fin_payroll').upsert(PAYROLL_DEPTS.map((d) => ({ tenant_id: tenantId, period_year: pv.year, period_month: pv.month, department: d, salaries: split[d].net, taxes: split[d].taxes, actual: true, source: 'files', updated_by: by, updated_at: now })),
    { onConflict: 'tenant_id,period_year,period_month,department' });
  if (pr.error) throw pr.error;
  return { ok: true, year: pv.year, month: pv.month, split };
}
export async function getLoad(tenantId: string, year: number, month: number): Promise<any | null> {
  const { data, error } = await db().from('fin_payroll_loads').select('*').eq('tenant_id', tenantId).eq('period_year', year).eq('period_month', month).maybeSingle();
  if (error) { if (missingTable(error)) return null; throw error; }
  return data;
}
/** Undo a month's load: the month goes back to an estimate (lump sums stay). */
export async function removeLoad(tenantId: string, year: number, month: number): Promise<Result> {
  const d = await db().from('fin_payroll_loads').delete().eq('tenant_id', tenantId).eq('period_year', year).eq('period_month', month).select('period_month');
  if (d.error) { if (missingTable(d.error)) return fail(503, NEEDS); throw d.error; }
  if (!d.data?.length) return fail(404, 'This month was not loaded from files.');
  const u = await db().from('fin_payroll').update({ salaries: null, taxes: null, actual: false, source: null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('period_year', year).eq('period_month', month).eq('source', 'files');
  if (u.error) throw u.error;
  return { ok: true };
}
/** A lump sum on top of a department's salaries for a month (never any tax on it). Empty clears it. */
export async function saveLump(tenantId: string, by: string, b: any): Promise<Result<{ year: number; month: number; department: PayrollDept; amount: number | null }>> {
  const year = Number(b.year), month = Number(b.month), department = b.department as PayrollDept;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return fail(400, 'Month or year looks wrong.');
  if (!PAYROLL_DEPTS.includes(department)) return fail(400, 'Unknown department.');
  const raw = clean(b.amount), amount = raw === '' ? null : parseMoney(raw);
  if (raw !== '' && amount === null) return fail(400, 'Enter the amount.');
  if ((amount ?? 0) < 0) return fail(400, 'Amounts cannot be negative.');
  const { error } = await db().from('fin_payroll').upsert({ tenant_id: tenantId, period_year: year, period_month: month, department, lump: amount, lump_note: amount === null ? null : clean(b.note).slice(0, 200) || null, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,period_year,period_month,department' });
  if (error) { if (missingTable(error)) return fail(503, NEEDS); throw error; }
  return { ok: true, year, month, department, amount };
}
/** The loaded months, without the people (for the Payroll table). */
export async function listLoads(tenantId: string): Promise<any[]> {
  const { data, error } = await db().from('fin_payroll_loads').select('period_year,period_month,pay_date,gross,net,zus,pit,split,files,loaded_by,loaded_at').eq('tenant_id', tenantId);
  if (error) { if (missingTable(error)) return []; throw error; }
  return data ?? [];
}
