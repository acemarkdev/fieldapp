// Subiekt nexo → office app. An agent on the Subiekt machine sends a snapshot of this year's sales
// invoices (FS, FL, corrections KFS/KFL) and material issues (RW). The documents are kept as
// received (fin_subiekt_docs); the Sales tab and the Material Cost (RW) column of Job costs are
// then rebuilt from them. The rule throughout: never guess. A document whose job cannot be read
// with certainty is marked "check in Subiekt" — someone adds the number there (the Podtytuł
// field) and the next sync puts it in the right place.
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { referenceKey } from './finJobs';
import { orderCode } from './finOrders';
import { colReady } from './schemaReady';

export const SALE_SYMBOLS = ['FS', 'FL', 'KFS', 'KFL'] as const;
export const SYNC_SYMBOLS = [...SALE_SYMBOLS, 'RW'] as const;
export interface SubDoc {
  doc_id: number; symbol: string; number: string | null; issued: string | null; sold: string | null;
  net: number; gross: number | null; currency: string | null; rate: number | null; units: number | null;
  subtitle: string | null; notes: string | null; flag: number | null; corrects: number | null;
  customer: string | null; country: string | null; not_job?: boolean;
}
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const numOrNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const dateOrNull = (v: unknown) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')); return m ? m[1] : null; };

/** One document as the agent sends it → the stored shape; null when it is not usable. */
export function docFromAgent(r: any): SubDoc | null {
  const doc_id = Number(r?.id), symbol = clean(r?.symbol).toUpperCase();
  if (!Number.isInteger(doc_id) || doc_id <= 0 || !(SYNC_SYMBOLS as readonly string[]).includes(symbol)) return null;
  return {
    doc_id, symbol, number: clean(r.number).slice(0, 80) || null, issued: dateOrNull(r.issued), sold: dateOrNull(r.sold),
    net: round2(numOrNull(r.net) ?? 0), gross: numOrNull(r.gross) === null ? null : round2(Number(r.gross)),
    currency: clean(r.currency).slice(0, 40) || null, rate: numOrNull(r.rate), units: numOrNull(r.units),
    subtitle: clean(r.subtitle).slice(0, 300) || null, notes: clean(r.notes).slice(0, 600) || null,
    flag: numOrNull(r.flag), corrects: numOrNull(r.corrects), customer: clean(r.customer).slice(0, 120) || null, country: clean(r.country).slice(0, 60) || null,
  };
}

// ---- reading the job from a document ----------------------------------------------------------
/** The Z job numbers written in a text ("Z.414", "Z 414", "z414"), in order, without repeats. */
export function zNumbers(text: unknown): string[] {
  const out: string[] = [];
  for (const m of clean(text).matchAll(/(?<![A-Za-z0-9])Z[.\s]?(\d{2,4})(?!\d)/gi)) if (!out.includes('Z.' + m[1])) out.push('Z.' + m[1]);
  return out;
}
/** An OK order number anywhere in a text ("Pedro - OK PL203055 - …" → "OK PL203055"). */
export function okCode(text: unknown): string | null {
  const s = clean(text);
  const m = /(?<![A-Za-z])OK[\s_\-–]*(?:[A-Za-z]{2,6}[\s_\-–]*)?\d{3,}/i.exec(s);
  if (!m) return null;
  const code = orderCode(s.slice(m.index));
  return /^OK /.test(code) ? code : null;
}
export type CheckReason = 'no_number' | 'several_jobs' | 'no_rate';
export interface DocClass { job_ref: string | null; from: 'subtitle' | 'notes' | 'order' | 'corrected' | null; check: CheckReason | null }
/** Which job a document belongs to — or why that cannot be said. `byId` lets a correction with no
 *  number of its own take the job of the invoice it corrects. */
export function classifyDoc(d: SubDoc, byId?: Map<number, SubDoc>): DocClass {
  const sub = clean(d.subtitle), zs = zNumbers(sub);
  if (zs.length > 1) return { job_ref: null, from: null, check: 'several_jobs' };
  if (zs.length === 1) {
    // "Z.414" → "Z.414";  "Z.282 poprawka" keeps its words: the sheet treats it as a record of its own
    const m = /^Z[.\s]?\d{2,4}\b[\s\-–]*(.*)$/i.exec(sub);
    const tail = m ? clean(m[1]) : '';
    return { job_ref: tail ? (zs[0] + ' ' + tail).slice(0, 80) : zs[0], from: 'subtitle', check: null };
  }
  const zn = zNumbers(d.notes);
  if (zn.length > 1) return { job_ref: null, from: null, check: 'several_jobs' };
  if (zn.length === 1) return { job_ref: zn[0], from: 'notes', check: null };
  if (d.symbol !== 'RW') {
    const ok = okCode(sub) ?? okCode(d.notes);
    if (ok) return { job_ref: ok, from: 'order', check: null };
  }
  if (d.corrects && byId) {
    const orig = byId.get(d.corrects);
    if (orig) { const c = classifyDoc(orig); if (c.job_ref) return { job_ref: c.job_ref, from: 'corrected', check: null }; }
  }
  return { job_ref: null, from: null, check: 'no_number' };
}

const isPln = (currency: string | null) => !currency || /z[łl]ot|^pln$/i.test(currency);
/** A document amount in złoty: as it is for PLN, otherwise × the rate stored on the document. */
export function toPln(amount: number | null, d: Pick<SubDoc, 'currency' | 'rate' | 'units'>): number | null {
  if (amount === null) return null;
  if (isPln(d.currency)) return round2(amount);
  if (!d.rate || d.rate <= 0) return null;
  return round2((amount * d.rate) / (d.units && d.units > 0 ? d.units : 1));
}
const COUNTRY: Record<string, string> = { polska: 'PL', niemcy: 'DE', 'wielka brytania': 'UK', hiszpania: 'ES', holandia: 'NL', niderlandy: 'NL', francja: 'FR', belgia: 'BE', austria: 'AT', irlandia: 'IE', szwajcaria: 'CH' };
export const countryCode = (v: string | null) => { const s = clean(v); return /^[A-Za-z]{2,3}$/.test(s) ? (s.toUpperCase() === 'GB' ? 'UK' : s.toUpperCase()) : (COUNTRY[s.toLowerCase()] ?? null); };
/** The country written in an OK order number: "OK UK203065 - Smith" → UK; a Z number or "OK 203065" → null. */
export const refCountry = (ref: string | null) => { const m = /^OK ([A-Za-z]{2})\d/.exec(orderCode(ref ?? '') ?? ''); return m ? countryCode(m[1]) : null; };

/** A sales document → the Sales-tab row. `supplierOf` gives the producer of a trade order. The country is the
 *  customer's in Subiekt; a private customer often has none there, so then it is the one in the OK number, and for
 *  a Z job the one of its sales order (`countryOf`). */
export function saleRow(d: SubDoc, c: DocClass, supplierOf?: (jobRef: string) => string | null, countryOf?: (jobRef: string) => string | null): Record<string, any> {
  const net = toPln(d.net, d), gross = toPln(d.gross, d);
  const date = d.issued ?? d.sold;
  const check: CheckReason | null = net === null ? 'no_rate' : (c.check && !d.not_job ? c.check : null);
  const production = !!c.job_ref && /^Z\./.test(c.job_ref);
  const foreign = !isPln(d.currency) ? `${d.currency}: ${d.net.toFixed(2)} net${d.rate ? `, rate ${d.rate}${d.units && d.units !== 1 ? '/' + d.units : ''}` : ''}` : '';
  return {
    invoice_no: d.number, invoice_date: date, job_ref: c.job_ref, job_key: c.job_ref ? referenceKey(c.job_ref).slice(0, 80) : null,
    period_year: date ? +date.slice(0, 4) : null, period_month: date ? +date.slice(5, 7) : null,
    producer: production ? 'Acemark PL' : (c.job_ref && supplierOf ? supplierOf(c.job_ref) : null), buyer: d.customer,
    net: net ?? 0, gross, country: countryCode(d.country) ?? (c.job_ref ? refCountry(c.job_ref) ?? countryOf?.(c.job_ref) ?? null : null),
    // an advance invoice (and its correction) is a prepayment; the closing advance and FS are final
    kind: (d.symbol === 'FL' && d.flag !== 3) || d.symbol === 'KFL' ? 'prepaid' : 'final',
    note: [foreign, clean(d.subtitle) && !c.job_ref ? clean(d.subtitle) : ''].filter(Boolean).join(' · ').slice(0, 500) || null,
    seller: 'Acemark PL', source: 'subiekt', source_id: d.doc_id, needs_check: check,
  };
}
const SALE_COLS = ['invoice_no', 'invoice_date', 'job_ref', 'job_key', 'period_year', 'period_month', 'producer', 'buyer', 'net', 'gross', 'country', 'kind', 'note', 'seller', 'source', 'source_id', 'needs_check'] as const;
const same = (a: any, b: any) => (a === null || a === undefined ? '' : typeof a === 'number' || /^-?\d+(\.\d+)?$/.test(String(a)) ? Number(a).toFixed(2) : String(a)) === (b === null || b === undefined ? '' : typeof b === 'number' || /^-?\d+(\.\d+)?$/.test(String(b)) ? Number(b).toFixed(2) : String(b));
export const rowDiffers = (cur: Record<string, any>, next: Record<string, any>, cols: readonly string[]) => cols.some((k) => !same(cur[k], next[k]));
const noKey = (v: unknown) => clean(v).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export interface SalesPlan { insert: Record<string, any>[]; update: { id: string; fields: Record<string, any>; adopted: boolean }[]; remove: string[] }
/** What has to change on the Sales tab. A typed invoice with the same number is taken over
 *  ("adopted") instead of being duplicated; rows that came from Subiekt and are gone there are removed. */
export function planSales(docs: SubDoc[], existing: Record<string, any>[], supplierOf?: (jobRef: string) => string | null, countryOf?: (jobRef: string) => string | null): SalesPlan {
  const byId = new Map(docs.map((d) => [d.doc_id, d]));
  const sourced = new Map<number, Record<string, any>>(), typed = new Map<string, Record<string, any>[]>();
  for (const r of existing) {
    if (r.source === 'subiekt' && r.source_id != null) sourced.set(Number(r.source_id), r);
    else if (!r.source && r.invoice_no) { const k = noKey(r.invoice_no); (typed.get(k) ?? typed.set(k, []).get(k)!).push(r); }
  }
  const plan: SalesPlan = { insert: [], update: [], remove: [] };
  const seen = new Set<number>();
  for (const d of docs) {
    if (!(SALE_SYMBOLS as readonly string[]).includes(d.symbol)) continue;
    seen.add(d.doc_id);
    const next = saleRow(d, classifyDoc(d, byId), supplierOf, countryOf);
    const cur = sourced.get(d.doc_id);
    if (cur) { if (rowDiffers(cur, next, SALE_COLS)) plan.update.push({ id: cur.id, fields: next, adopted: false }); continue; }
    const match = d.number ? typed.get(noKey(d.number))?.shift() : undefined;
    if (match) plan.update.push({ id: match.id, fields: next, adopted: true });
    else plan.insert.push(next);
  }
  for (const [sid, r] of sourced) if (!seen.has(sid)) plan.remove.push(r.id);
  return plan;
}

export interface JobLite { id: string; reference_key: string; locked: boolean }
export interface ItemLite { id: string; job_id: string; kind: string; source: string | null; source_id: number | null; amount: number; invoice_no: string | null; item_date: string | null }
export interface MaterialPlan {
  createJobs: { reference: string; reference_key: string; customer: string | null; period_year: number | null; period_month: number | null }[];
  upsert: { job_key: string; id: string | null; fields: Record<string, any> }[];   // id = the line to update, null = new
  remove: string[]; typedReplaced: number; lockedSkipped: string[];
}
/** What has to change in Job costs. For a production job (Z…) with RW documents, Material Cost (RW)
 *  becomes those documents — one line each — and a material amount typed or imported before is
 *  removed. A job that does not exist yet is created (month of its first sales invoice, else its
 *  first RW). Locked jobs are never touched. */
export function planMaterial(docs: SubDoc[], jobs: JobLite[], items: ItemLite[]): MaterialPlan {
  const byId = new Map(docs.map((d) => [d.doc_id, d]));
  const jobByKey = new Map(jobs.map((j) => [j.reference_key, j])), jobById = new Map(jobs.map((j) => [j.id, j]));
  const rwBy = new Map<string, { ref: string; docs: SubDoc[] }>(), firstSale = new Map<string, SubDoc>(), firstAny = new Map<string, SubDoc>();
  const day = (d: SubDoc) => d.issued ?? d.sold ?? '9999';
  for (const d of docs) {
    const c = classifyDoc(d, byId);
    if (!c.job_ref || !/^Z\./.test(c.job_ref)) continue;
    const key = referenceKey(c.job_ref).slice(0, 80);
    if (d.symbol === 'RW') { if (toPln(d.net, d) !== null) (rwBy.get(key) ?? rwBy.set(key, { ref: c.job_ref, docs: [] }).get(key)!).docs.push(d); }
    else if (!firstSale.has(key) || day(d) < day(firstSale.get(key)!)) firstSale.set(key, d);
    if (!firstAny.has(key) || day(d) < day(firstAny.get(key)!)) firstAny.set(key, d);
  }
  const plan: MaterialPlan = { createJobs: [], upsert: [], remove: [], typedReplaced: 0, lockedSkipped: [] };
  const sourcedBySid = new Map<number, ItemLite>(), materialByJob = new Map<string, ItemLite[]>();
  for (const it of items) {
    if (it.kind !== 'material') continue;
    if (it.source === 'subiekt' && it.source_id != null) sourcedBySid.set(Number(it.source_id), it);
    (materialByJob.get(it.job_id) ?? materialByJob.set(it.job_id, []).get(it.job_id)!).push(it);
  }
  const keep = new Set<number>();
  for (const [key, g] of rwBy) {
    const job = jobByKey.get(key);
    if (job?.locked) { plan.lockedSkipped.push(g.ref); for (const d of g.docs) keep.add(d.doc_id); continue; }
    if (!job) {
      const when = firstSale.get(key) ?? firstAny.get(key)!; const dt = when.issued ?? when.sold;
      plan.createJobs.push({ reference: g.ref, reference_key: key, customer: (firstSale.get(key) ?? when).customer, period_year: dt ? +dt.slice(0, 4) : null, period_month: dt ? +dt.slice(5, 7) : null });
    } else for (const it of materialByJob.get(job.id) ?? []) if (!it.source) { plan.remove.push(it.id); plan.typedReplaced++; }
    for (const d of g.docs) {
      keep.add(d.doc_id);
      const fields = { kind: 'material', amount: toPln(d.net, d)!, hours: null, rate: null, invoice_no: d.number, supplier: null, item_date: d.issued ?? d.sold, note: 'Subiekt', source: 'subiekt', source_id: d.doc_id };
      const cur = sourcedBySid.get(d.doc_id);
      // a line that sits under another job (the number was corrected in Subiekt) is moved by remove + add
      if (cur && job && cur.job_id === job.id) { if (rowDiffers(cur, fields, ['amount', 'invoice_no', 'item_date'])) plan.upsert.push({ job_key: key, id: cur.id, fields }); }
      else { if (cur && !jobById.get(cur.job_id)?.locked) plan.remove.push(cur.id); plan.upsert.push({ job_key: key, id: null, fields }); }
    }
  }
  // lines whose RW is gone from Subiekt, or lost its job number
  for (const [sid, it] of sourcedBySid) if (!keep.has(sid) && !jobById.get(it.job_id)?.locked && !plan.remove.includes(it.id)) plan.remove.push(it.id);
  return plan;
}

/** The documents that need a number in Subiekt, newest first (for the list in the app). */
export function docsToCheck(docs: SubDoc[]): (SubDoc & { reason: CheckReason; net_pln: number | null })[] {
  const byId = new Map(docs.map((d) => [d.doc_id, d]));
  const out: (SubDoc & { reason: CheckReason; net_pln: number | null })[] = [];
  for (const d of docs) {
    const net_pln = toPln(d.net, d);
    const reason: CheckReason | null = net_pln === null ? 'no_rate' : (d.not_job ? null : classifyDoc(d, byId).check);
    if (reason) out.push({ ...d, reason, net_pln });
  }
  return out.sort((a, b) => String(b.issued ?? '').localeCompare(String(a.issued ?? '')) || b.doc_id - a.doc_id);
}

// ---- the agent's key ---------------------------------------------------------------------------
const sha = (s: string) => createHash('sha256').update(s).digest();
/** A new key for the agent. Only its hash is stored; the key itself is shown once. */
export async function newAgentKey(tenantId: string, by: string): Promise<string> {
  const key = 'sbk_' + randomBytes(24).toString('hex');
  await setConfig('subiekt_agent', JSON.stringify({ hash: sha(key).toString('hex'), tenant_id: tenantId, created_by: by, created_at: new Date().toISOString() }));
  return key;
}
export async function agentTenant(key: unknown): Promise<string | null> {
  const k = String(key ?? '');
  if (!/^sbk_[0-9a-f]{48}$/.test(k)) return null;
  let cfg: any; try { cfg = JSON.parse((await getConfig('subiekt_agent')) || 'null'); } catch { return null; }
  if (!cfg?.hash || !cfg?.tenant_id) return null;
  const want = Buffer.from(String(cfg.hash), 'hex'), got = sha(k);
  return want.length === got.length && timingSafeEqual(want, got) ? String(cfg.tenant_id) : null;
}

// ---- storage -----------------------------------------------------------------------------------
async function all<T>(table: string, cols: string, tenantId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order(table === 'fin_subiekt_docs' ? 'doc_id' : 'id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const docOut = (r: any): SubDoc => ({ ...r, doc_id: Number(r.doc_id), net: Number(r.net) || 0, gross: r.gross === null ? null : Number(r.gross), rate: r.rate === null ? null : Number(r.rate), corrects: r.corrects === null ? null : Number(r.corrects) });
export async function listDocs(tenantId: string): Promise<SubDoc[]> { return (await all<any>('fin_subiekt_docs', '*', tenantId)).map(docOut); }
async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
}

export interface SyncSummary {
  at: string; docs: number; sales: { added: number; updated: number; adopted: number; removed: number };
  material: { lines: number; removed: number; jobsCreated: number; typedReplaced: number; lockedSkipped: string[] }; toCheck: number; agent?: string | null;
}
/** Rebuild the Sales tab and the material lines from the stored documents. */
export async function applyDocs(tenantId: string): Promise<SyncSummary> {
  const docs = await listDocs(tenantId);
  const [sales, orders, jobs, items] = await Promise.all([
    all<any>('fin_sales', '*', tenantId), all<any>('fin_orders', 'order_ref,job_ref,supplier' + ((await colReady('fin_orders', 'customer_id')) ? ',customer_id' : ''), tenantId),
    all<any>('fin_jobs', 'id,reference_key,locked', tenantId), all<any>('fin_job_items', 'id,job_id,kind,source,source_id,amount,invoice_no,item_date', tenantId),
  ]);
  const supplier = new Map<string, string>(), country = new Map<string, string>();
  for (const o of orders) if (o.supplier) for (const ref of [o.order_ref, o.job_ref]) { const code = orderCode(ref); if (code) supplier.set(noKey(code), String(o.supplier)); }
  // a Z job's country: its sales order's OK number, else that order's customer (migration 0111)
  let custCountry = new Map<string, string>();
  try { custCountry = new Map((await all<any>('fin_customers', 'id,country', tenantId)).filter((c) => c.country).map((c) => [c.id, countryCode(c.country) ?? String(c.country)])); } catch { /* before 0111 */ }
  for (const o of orders) { const cc = refCountry(o.order_ref) ?? (o.customer_id ? custCountry.get(o.customer_id) : null); const code = orderCode(o.job_ref ?? ''); if (cc && code && !country.has(noKey(code))) country.set(noKey(code), cc); }
  const sp = planSales(docs, sales, (ref) => supplier.get(noKey(ref)) ?? null, (ref) => { const code = orderCode(ref); return code ? country.get(noKey(code)) ?? null : null; });
  const now = new Date().toISOString();
  for (let i = 0; i < sp.insert.length; i += 200) { const { error } = await db().from('fin_sales').insert(sp.insert.slice(i, i + 200).map((r) => ({ tenant_id: tenantId, created_by: 'Subiekt', ...r }))); if (error) throw error; }
  await pool(sp.update, 6, async (u) => { const { error } = await db().from('fin_sales').update({ ...u.fields, updated_at: now }).eq('tenant_id', tenantId).eq('id', u.id); if (error) throw error; });
  for (let i = 0; i < sp.remove.length; i += 100) { const { error } = await db().from('fin_sales').delete().eq('tenant_id', tenantId).in('id', sp.remove.slice(i, i + 100)); if (error) throw error; }

  const mp = planMaterial(docs, jobs, items.map((it) => ({ ...it, amount: Number(it.amount) || 0, source_id: it.source_id === null ? null : Number(it.source_id) })));
  const jobId = new Map<string, string>(jobs.map((j) => [j.reference_key, j.id]));
  for (const j of mp.createJobs) {
    const { data, error } = await db().from('fin_jobs').insert({ tenant_id: tenantId, created_by: 'Subiekt', ...j }).select('id').single();
    if (error) throw error; jobId.set(j.reference_key, data.id);
  }
  for (let i = 0; i < mp.remove.length; i += 100) { const { error } = await db().from('fin_job_items').delete().eq('tenant_id', tenantId).in('id', mp.remove.slice(i, i + 100)); if (error) throw error; }
  const fresh = mp.upsert.filter((u) => !u.id).map((u) => ({ tenant_id: tenantId, job_id: jobId.get(u.job_key), created_by: 'Subiekt', ...u.fields })).filter((r) => r.job_id);
  for (let i = 0; i < fresh.length; i += 200) { const { error } = await db().from('fin_job_items').insert(fresh.slice(i, i + 200)); if (error) throw error; }
  await pool(mp.upsert.filter((u) => u.id), 6, async (u) => { const { error } = await db().from('fin_job_items').update({ ...u.fields, updated_at: now }).eq('tenant_id', tenantId).eq('id', u.id!); if (error) throw error; });

  return { at: now, docs: docs.length, sales: { added: sp.insert.length, updated: sp.update.filter((u) => !u.adopted).length, adopted: sp.update.filter((u) => u.adopted).length, removed: sp.remove.length },
    material: { lines: mp.upsert.length, removed: mp.remove.length - mp.typedReplaced, jobsCreated: mp.createJobs.length, typedReplaced: mp.typedReplaced, lockedSkipped: mp.lockedSkipped }, toCheck: docsToCheck(docs).length };
}
/** A snapshot from the agent: store it (documents no longer in Subiekt are dropped) and rebuild. */
export async function receiveSnapshot(tenantId: string, body: any): Promise<{ ok: true; summary: SyncSummary } | { ok: false; status: number; error: string }> {
  const raw: any[] = Array.isArray(body?.docs) ? body.docs : [];
  const docs = raw.map(docFromAgent).filter((d): d is SubDoc => !!d);
  if (!raw.length || docs.length < raw.length * 0.9) return { ok: false, status: 400, error: 'The snapshot is empty or malformed; nothing was changed.' };
  const have = await all<any>('fin_subiekt_docs', 'doc_id', tenantId);
  // a snapshot that has lost most of what was there is more likely a broken query than real deletions
  if (have.length > 50 && docs.length < have.length * 0.5) return { ok: false, status: 409, error: 'The snapshot has far fewer documents than last time; nothing was changed.' };
  const now = new Date().toISOString();
  for (let i = 0; i < docs.length; i += 500) { const { error } = await db().from('fin_subiekt_docs').upsert(docs.slice(i, i + 500).map((d) => ({ tenant_id: tenantId, ...d, synced_at: now })), { onConflict: 'tenant_id,doc_id' }); if (error) throw error; }
  const keep = new Set(docs.map((d) => d.doc_id)), gone = have.map((h) => Number(h.doc_id)).filter((id) => !keep.has(id));
  for (let i = 0; i < gone.length; i += 200) { const { error } = await db().from('fin_subiekt_docs').delete().eq('tenant_id', tenantId).in('doc_id', gone.slice(i, i + 200)); if (error) throw error; }
  const summary = { ...(await applyDocs(tenantId)), agent: clean(body?.agent).slice(0, 40) || null };
  await setConfig('subiekt_last_sync', JSON.stringify(summary));
  return { ok: true, summary };
}
export async function lastSync(): Promise<SyncSummary | null> { try { return JSON.parse((await getConfig('subiekt_last_sync')) || 'null'); } catch { return null; } }
export async function hasAgentKey(): Promise<boolean> { try { return !!JSON.parse((await getConfig('subiekt_agent')) || 'null')?.hash; } catch { return false; } }
/** The accountant's "belongs to no job" tick on a sales document. */
export async function setNotJob(tenantId: string, docId: number, value: boolean, by: string): Promise<boolean> {
  const { data, error } = await db().from('fin_subiekt_docs').update({ not_job: value, not_job_by: value ? by : null }).eq('tenant_id', tenantId).eq('doc_id', docId).in('symbol', [...SALE_SYMBOLS]).select('doc_id');
  if (error) throw error;
  if (!(data ?? []).length) return false;
  await applyDocs(tenantId);
  return true;
}
