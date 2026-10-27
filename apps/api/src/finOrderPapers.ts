// Fin&Ops ▸ Sales orders: the order's papers — the customer's documents in versions, and the quotes sent to the
// customer (step B of replacing the monday Enquiries board).
//   • Documents: v1 = the first note + file; every later file is the next version and needs a comment. The newest is
//     the current one; older ones stay, marked outdated.
//   • Quotes: one per version — amount, scope (delivery only / delivery + install), the file sent and the budget
//     behind it, with a status: sent, approved, rejected, rework. At most one version is approved. The quote in force
//     (the approved one, else the newest) sets the order's net value and budget costs; the order's status follows:
//     approved → accepted, the newest rejected → lost, otherwise offer. An order without quotes is left as it is.
import { db } from './supabase';
import { parseMoney } from './finJobs';
import { colReady } from './schemaReady';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

export const QUOTE_STATUSES = ['sent', 'approved', 'rejected', 'rework'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export type QuoteScope = 'delivery' | 'install';
export const ORDER_FILE_BUCKET = 'orderfiles';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface QuoteRow {
  id: string; order_id: string; version: number; amount: number; scope: QuoteScope;
  cost_purchase: number | null; cost_install: number | null; cost_delivery: number | null;
  status: QuoteStatus; comment: string | null; file_name: string | null; storage_path: string | null;
  content_type: string | null; size_bytes: number | null; status_at: string; status_by: string | null; created_by: string | null; created_at: string;
}
export interface DocRow { id: string; order_id: string; version: number; comment: string; file_name: string; storage_path: string; content_type: string | null; size_bytes: number | null; created_by: string | null; created_at: string }

// ---- rules ------------------------------------------------------------------------------------------
/** The quote that counts: the approved version, else the newest. */
export function quoteInForce<T extends { version: number; status: string }>(quotes: T[]): T | null {
  if (!quotes.length) return null;
  return quotes.find((q) => q.status === 'approved') ?? quotes.reduce((a, b) => (b.version > a.version ? b : a));
}
/** A quote's total cost; installation does not count when we only deliver. */
export function quoteCost(q: { scope: QuoteScope; cost_purchase: number | null; cost_install: number | null; cost_delivery: number | null }): number {
  return round2((q.cost_purchase ?? 0) + (q.scope === 'install' ? q.cost_install ?? 0 : 0) + (q.cost_delivery ?? 0));
}
export function quoteMargin(q: Parameters<typeof quoteCost>[0] & { amount: number }): number | null {
  return q.amount ? round2((q.amount - quoteCost(q)) / q.amount) : null;
}
/** What the quotes set on the order; null when the order has no quotes (it is then left as typed). */
export function orderFromQuotes(quotes: QuoteRow[]): { net: number; cost_purchase: number | null; cost_install: number | null; cost_delivery: number | null; status: 'offer' | 'accepted' | 'lost' } | null {
  const q = quoteInForce(quotes);
  if (!q) return null;
  const newest = quotes.reduce((a, b) => (b.version > a.version ? b : a));
  const status = q.status === 'approved' ? 'accepted' : newest.status === 'rejected' ? 'lost' : 'offer';
  return { net: q.amount, cost_purchase: q.cost_purchase, cost_install: q.scope === 'install' ? q.cost_install : 0, cost_delivery: q.cost_delivery, status };
}

/** The form → a quote's fields. `creating`: amount and scope are set once (a change is a new version). */
export function quoteFields(b: any, creating: boolean): Result<{ fields: Record<string, any> }> {
  const f: Record<string, any> = {};
  if (creating) {
    const amount = parseMoney(b?.amount);
    if (amount === null || amount <= 0) return fail(400, 'Enter the quote amount.');
    f.amount = amount;
    f.scope = b?.scope === 'delivery' ? 'delivery' : 'install';
  }
  for (const k of ['cost_purchase', 'cost_install', 'cost_delivery']) {
    if (!(k in (b ?? {}))) continue;
    const n = parseMoney(b[k]);
    if (n !== null && n < 0) return fail(400, 'Amounts cannot be negative.');
    f[k] = n;
  }
  if ('status' in (b ?? {}) || creating) {
    const s = clean(b?.status) || 'sent';
    if (!(QUOTE_STATUSES as readonly string[]).includes(s)) return fail(400, 'Pick the quote status.');
    f.status = s;
  }
  if ('comment' in (b ?? {})) f.comment = clean(b.comment).slice(0, 1000) || null;
  return { ok: true, fields: f };
}
/** A data URL from the browser → the bytes to store. */
export function fileFrom(v: any): Result<{ name: string; bytes: Buffer; contentType: string }> {
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,(.+)$/.exec(String(v?.dataUrl ?? ''));
  if (!m) return fail(400, 'Attach the file.');
  const bytes = Buffer.from(m[2], 'base64');
  const name = clean(v?.name).slice(0, 160) || 'file';
  if (bytes.length > MAX_FILE_BYTES) return fail(400, `“${name}” is over 25 MB.`);
  return { ok: true, name, bytes, contentType: m[1] || 'application/octet-stream' };
}

// ---- storage ------------------------------------------------------------------------------------------
export const papersReady = () => colReady('fin_order_quotes', 'id');
async function ensureBucket(): Promise<void> {
  const { data } = await db().storage.getBucket(ORDER_FILE_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(ORDER_FILE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}
async function store(tenantId: string, orderId: string, file: { name: string; bytes: Buffer; contentType: string }): Promise<{ file_name: string; storage_path: string; content_type: string; size_bytes: number }> {
  await ensureBucket();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  const path = `${tenantId}/${orderId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
  const { error } = await db().storage.from(ORDER_FILE_BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
  if (error) throw error;
  return { file_name: file.name, storage_path: path, content_type: file.contentType, size_bytes: file.bytes.length };
}
async function signed(paths: (string | null)[]): Promise<Map<string, string>> {
  const ok = paths.filter((p): p is string => !!p), out = new Map<string, string>();
  if (!ok.length) return out;
  const { data } = await db().storage.from(ORDER_FILE_BUCKET).createSignedUrls(ok, 3600);
  for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}
async function removeFiles(paths: (string | null)[]): Promise<void> {
  const ok = paths.filter((p): p is string => !!p);
  if (ok.length) { try { await db().storage.from(ORDER_FILE_BUCKET).remove(ok); } catch { /* best effort */ } }
}
const num = (v: any) => (v === null || v === undefined ? null : Number(v));
const quoteOut = (r: any): QuoteRow => ({ ...r, amount: Number(r.amount) || 0, cost_purchase: num(r.cost_purchase), cost_install: num(r.cost_install), cost_delivery: num(r.cost_delivery), size_bytes: num(r.size_bytes) });

export async function listQuotes(tenantId: string, orderId: string): Promise<QuoteRow[]> {
  const { data, error } = await db().from('fin_order_quotes').select('*').eq('tenant_id', tenantId).eq('order_id', orderId).order('version');
  if (error) throw error; return (data ?? []).map(quoteOut);
}
export async function listDocs(tenantId: string, orderId: string): Promise<DocRow[]> {
  const { data, error } = await db().from('fin_order_docs').select('*').eq('tenant_id', tenantId).eq('order_id', orderId).order('version');
  if (error) throw error; return (data ?? []).map((r: any) => ({ ...r, size_bytes: num(r.size_bytes) }));
}
/** The order's papers for the order window, with links to open the files (valid for an hour). */
export async function orderPapers(tenantId: string, orderId: string) {
  if (!(await papersReady())) return { ready: false, docs: [], quotes: [] };
  const [docs, quotes] = await Promise.all([listDocs(tenantId, orderId), listQuotes(tenantId, orderId)]);
  const urls = await signed([...docs.map((d) => d.storage_path), ...quotes.map((q) => q.storage_path)]);
  const strip = <T extends { storage_path: string | null }>(r: T) => { const { storage_path, ...rest } = r; return { ...rest, url: storage_path ? urls.get(storage_path) ?? null : null }; };
  return { ready: true, docs: docs.map(strip), quotes: quotes.map((q) => ({ ...strip(q), cost: quoteCost(q), margin: quoteMargin(q) })) };
}
/** The newest quote of every order (version and status) — for the list. */
export async function latestQuotes(tenantId: string): Promise<Map<string, { version: number; status: QuoteStatus; count: number }>> {
  const out = new Map<string, { version: number; status: QuoteStatus; count: number }>();
  if (!(await papersReady())) return out;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_order_quotes').select('order_id,version,status').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const cur = out.get(r.order_id);
      if (!cur) out.set(r.order_id, { version: r.version, status: r.status, count: 1 });
      else { cur.count++; if (r.version > cur.version) { cur.version = r.version; cur.status = r.status; } }
    }
    if (!data || data.length < 1000) break;
  }
  // an approved version wins over a newer one in the list too
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_order_quotes').select('order_id,version,status').eq('tenant_id', tenantId).eq('status', 'approved').order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) { const cur = out.get(r.order_id); if (cur) { cur.version = r.version; cur.status = 'approved'; } }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Copy the quote in force to the order (net, budget costs, status). */
export async function syncOrder(tenantId: string, orderId: string): Promise<void> {
  const patch = orderFromQuotes(await listQuotes(tenantId, orderId));
  if (!patch) return;
  const upd: Record<string, any> = { ...patch, updated_at: new Date().toISOString() };
  // once the order has its Z job, the budget costs come from the job's decided budget (Job costs) — keep them
  const { data: ord, error: e0 } = await db().from('fin_orders').select('job_ref').eq('tenant_id', tenantId).eq('id', orderId).maybeSingle();
  if (e0) throw e0;
  if (ord?.job_ref) { delete upd.cost_purchase; delete upd.cost_install; delete upd.cost_delivery; }
  // a confirmed realisation date only stands while the order is accepted
  if (patch.status !== 'accepted' && (await colReady('fin_orders', 'confirmed_date'))) upd.confirmed_date = null;
  const { error } = await db().from('fin_orders').update(upd).eq('tenant_id', tenantId).eq('id', orderId);
  if (error) throw error;
}

export async function addDoc(tenantId: string, orderId: string, by: string, b: any): Promise<Result<{ version: number }>> {
  if (!(await papersReady())) return fail(409, 'Documents need migration 0112 first.');
  const comment = clean(b?.comment).slice(0, 1000);
  const docs = await listDocs(tenantId, orderId);
  if (!comment) return fail(400, docs.length ? 'A new version needs a comment: what changed?' : 'Write the note that goes with the document.');
  const file = fileFrom(b?.file); if (!file.ok) return file;
  const version = docs.reduce((m, d) => Math.max(m, d.version), 0) + 1;
  const stored = await store(tenantId, orderId, file);
  const { error } = await db().from('fin_order_docs').insert({ tenant_id: tenantId, order_id: orderId, version, comment, created_by: by, ...stored });
  if (error) { await removeFiles([stored.storage_path]); throw error; }
  return { ok: true, version };
}
export async function deleteDoc(tenantId: string, orderId: string, docId: string): Promise<Result> {
  const docs = await listDocs(tenantId, orderId), d = docs.find((x) => x.id === docId);
  if (!d) return fail(404, 'Document not found.');
  if (d.version !== Math.max(...docs.map((x) => x.version))) return fail(409, 'Only the newest version can be removed.');
  const { error } = await db().from('fin_order_docs').delete().eq('tenant_id', tenantId).eq('id', docId);
  if (error) throw error;
  await removeFiles([d.storage_path]);
  return { ok: true };
}

export async function addQuote(tenantId: string, orderId: string, by: string, b: any): Promise<Result<{ version: number }>> {
  if (!(await papersReady())) return fail(409, 'Quotes need migration 0112 first.');
  const f = quoteFields(b, true); if (!f.ok) return f;
  const file = fileFrom(b?.file); if (!file.ok) return fail(400, 'Attach the quote sent to the customer.');
  const quotes = await listQuotes(tenantId, orderId);
  if (f.fields.status === 'approved' && quotes.some((q) => q.status === 'approved')) return fail(409, `v${quotes.find((q) => q.status === 'approved')!.version} is already approved — change its status first.`);
  const version = quotes.reduce((m, q) => Math.max(m, q.version), 0) + 1;
  const stored = await store(tenantId, orderId, file);
  const { error } = await db().from('fin_order_quotes').insert({ tenant_id: tenantId, order_id: orderId, version, created_by: by, status_by: by, ...f.fields, ...stored });
  if (error) { await removeFiles([stored.storage_path]); throw error; }
  await syncOrder(tenantId, orderId);
  return { ok: true, version };
}
export async function updateQuote(tenantId: string, orderId: string, quoteId: string, by: string, b: any): Promise<Result> {
  const quotes = await listQuotes(tenantId, orderId), q = quotes.find((x) => x.id === quoteId);
  if (!q) return fail(404, 'Quote not found.');
  const f = quoteFields(b, false); if (!f.ok) return f;
  if (f.fields.status === 'approved' && q.status !== 'approved') {
    const other = quotes.find((x) => x.status === 'approved' && x.id !== q.id);
    if (other) return fail(409, `v${other.version} is already approved — change its status first.`);
  }
  const patch: Record<string, any> = { ...f.fields, updated_at: new Date().toISOString() };
  if (f.fields.status && f.fields.status !== q.status) { patch.status_at = patch.updated_at; patch.status_by = by; }
  const { error } = await db().from('fin_order_quotes').update(patch).eq('tenant_id', tenantId).eq('id', quoteId);
  if (error) throw error;
  await syncOrder(tenantId, orderId);
  return { ok: true };
}
/** Only the newest version, and not an approved one. */
export async function deleteQuote(tenantId: string, orderId: string, quoteId: string): Promise<Result> {
  const quotes = await listQuotes(tenantId, orderId), q = quotes.find((x) => x.id === quoteId);
  if (!q) return fail(404, 'Quote not found.');
  if (q.version !== Math.max(...quotes.map((x) => x.version))) return fail(409, 'Only the newest version can be removed.');
  if (q.status === 'approved') return fail(409, 'An approved quote cannot be removed — change its status first.');
  const { error } = await db().from('fin_order_quotes').delete().eq('tenant_id', tenantId).eq('id', quoteId);
  if (error) throw error;
  await removeFiles([q.storage_path]);
  await syncOrder(tenantId, orderId);
  return { ok: true };
}
