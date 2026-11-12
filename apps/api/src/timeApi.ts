// Production time ▸ API for an external system: read-only time entries, authenticated by an API key.
//   GET /api/v1/time-entries?from=2026-11-01&to=2026-11-30[&company=acemark|wem][&offset=0&limit=1000]
//   header  X-API-Key: tak_…   (or  Authorization: Bearer tak_…)
// Keys are made and revoked by an admin on Production time ▸ API access. Only a key's hash is stored; the key is
// shown once. A key can be limited to one company (Acemark / WEM). No pay rates or amounts are ever returned.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { local, hoursBetween, prodCompanyOf, companyReady, type ProdCompany } from './prodTime';

export interface ApiKey { id: string; name: string; hash: string; tenant_id: string; company: ProdCompany | null; created_by: string; created_at: string; last_used_at: string | null; scope?: 'read' | 'import' }   // import = the Clockify import (POST); read = time entries (GET)
const CFG = 'time_api_keys';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function readKeys(): Promise<ApiKey[]> { try { const v = JSON.parse((await getConfig(CFG)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
async function writeKeys(keys: ApiKey[]) { await setConfig(CFG, JSON.stringify(keys)); }

/** The keys of a tenant, without their hashes (for the admin screen). */
export async function listApiKeys(tenantId: string) {
  return (await readKeys()).filter((k) => k.tenant_id === tenantId).map(({ hash: _h, ...k }) => k);
}
/** A new key. Returns the key itself — shown once, never stored. */
export async function createApiKey(tenantId: string, by: string, name: unknown, company: unknown, scope: unknown = 'read'): Promise<{ ok: true; key: string; id: string } | { ok: false; error: string }> {
  const n = clean(name).slice(0, 60);
  if (!n) return { ok: false, error: 'Give the key a name (the system that will use it).' };
  const keys = await readKeys();
  if (keys.filter((k) => k.tenant_id === tenantId).length >= 20) return { ok: false, error: 'At most 20 keys — revoke an old one first.' };
  const key = 'tak_' + randomBytes(24).toString('hex'), id = randomBytes(6).toString('hex');
  const co = company === 'acemark' || company === 'wem' ? company : null;
  keys.push({ id, name: n, hash: sha(key), tenant_id: tenantId, company: co, created_by: by, created_at: new Date().toISOString(), last_used_at: null, scope: scope === 'import' ? 'import' : 'read' });
  await writeKeys(keys);
  return { ok: true, key, id };
}
export async function revokeApiKey(tenantId: string, id: string): Promise<boolean> {
  const keys = await readKeys(), next = keys.filter((k) => !(k.tenant_id === tenantId && k.id === id));
  if (next.length === keys.length) return false;
  await writeKeys(next); return true;
}
/** The key from the request headers → its record; null when unknown. */
export async function keyFromRequest(headers: Record<string, unknown>): Promise<ApiKey | null> {
  const auth = String(headers['authorization'] ?? ''), raw = String(headers['x-api-key'] ?? '') || (/^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : '');
  const k = raw.trim();
  if (!/^tak_[0-9a-f]{48}$/.test(k)) return null;
  const got = Buffer.from(sha(k), 'hex');
  const keys = await readKeys();
  const hit = keys.find((x) => { const want = Buffer.from(x.hash, 'hex'); return want.length === got.length && timingSafeEqual(want, got); }) ?? null;
  if (hit && (!hit.last_used_at || Date.now() - Date.parse(hit.last_used_at) > 10 * 60000)) {   // note the use, at most every 10 minutes
    hit.last_used_at = new Date().toISOString(); writeKeys(keys).catch(() => {});
  }
  return hit;
}

// ---- a small rate limit per key: 120 requests a minute ----
const hits = new Map<string, number[]>();
export function rateLimited(id: string): boolean {
  const now = Date.now(), list = (hits.get(id) ?? []).filter((t) => now - t < 60000);
  list.push(now); hits.set(id, list);
  return list.length > 120;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The query → a checked request, or the error to answer. Dates are days in Poland (Europe/Warsaw). */
export function parseQuery(q: URLSearchParams, key: Pick<ApiKey, 'company'>): { ok: true; from: string; to: string; company: ProdCompany | null; offset: number; limit: number } | { ok: false; error: string } {
  const from = clean(q.get('from')), to = clean(q.get('to')) || from;
  if (!DAY.test(from) || !DAY.test(to)) return { ok: false, error: 'Give from (and optionally to) as YYYY-MM-DD, e.g. ?from=2026-11-01&to=2026-11-30.' };
  if (to < from) return { ok: false, error: '"to" is before "from".' };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) return { ok: false, error: 'At most 93 days per request — ask for the months one by one.' };
  const want = q.get('company') ? clean(q.get('company')).toLowerCase() : null;
  if (want && want !== 'acemark' && want !== 'wem') return { ok: false, error: 'company is acemark or wem.' };
  if (key.company && want && want !== key.company) return { ok: false, error: 'This key only reads ' + key.company + '.' };
  const offset = Math.max(0, Math.floor(Number(q.get('offset') ?? 0)) || 0), limit = Math.min(5000, Math.max(1, Math.floor(Number(q.get('limit') ?? 1000)) || 1000));
  return { ok: true, from, to, company: key.company ?? (want as ProdCompany | null), offset, limit };
}
/** A day in Poland → the UTC instant it starts (covers summer and winter time). */
export function polishDayStart(day: string): string {
  for (const off of ['+01:00', '+02:00']) { const iso = new Date(day + 'T00:00:00' + off).toISOString(); if (local(iso).date === day && local(iso).time.startsWith('00:00')) return iso; }
  return new Date(day + 'T00:00:00+01:00').toISOString();
}
const nextDay = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);

/** One time entry as the API returns it. */
export function entryOut(e: any, task: any | undefined) {
  const s = local(e.started_at), en = e.ended_at ? local(e.ended_at) : null;
  return {
    id: e.id, company: prodCompanyOf(e.company), running: !e.ended_at,
    started_at: e.started_at, ended_at: e.ended_at ?? null, date: s.date, start_time: s.time, end_date: en?.date ?? null, end_time: en?.time ?? null,
    duration_hours: Math.round(hoursBetween(e.started_at, e.ended_at) * 10000) / 10000,
    worker: { id: e.user_id ?? null, name: e.user_name ?? null, email: e.user_email ?? null },
    job_ref: task?.job_ref ?? null, job_key: e.job_key ?? task?.job_key ?? null,
    task: { id: e.task_id ?? null, name: e.task_name ?? task?.export_name ?? null, operation: task?.operation ?? null, op_id: task?.op_id ?? null, code: task?.code ?? null, station: task?.station ?? null },
    time_type: e.time_type ?? null, qty_done: e.qty_done == null ? null : Number(e.qty_done),
    note: e.note ?? null, source: e.source ?? null, created_at: e.created_at ?? null,
  };
}

/** The entries that start within the days asked, oldest first, one page. */
export async function readEntries(tenantId: string, r: { from: string; to: string; company: ProdCompany | null; offset: number; limit: number }) {
  const gte = polishDayStart(r.from), lt = polishDayStart(nextDay(r.to));
  let q = db().from('time_entries').select('*', { count: 'exact' }).eq('tenant_id', tenantId).gte('started_at', gte).lt('started_at', lt).order('started_at').order('id').range(r.offset, r.offset + r.limit - 1);
  if (r.company && (await companyReady())) q = q.eq('company', r.company);
  const { data, error, count } = await q; if (error) throw error;
  const rows = data ?? [], ids = [...new Set(rows.map((e: any) => e.task_id).filter(Boolean))];
  const tasks = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t, error: te } = await db().from('prod_tasks').select('*').eq('tenant_id', tenantId).in('id', ids.slice(i, i + 200));
    if (te) throw te; for (const x of t ?? []) tasks.set(x.id, x);
  }
  const total = count ?? rows.length, next = r.offset + rows.length < total ? r.offset + rows.length : null;
  return { from: r.from, to: r.to, company: r.company ?? 'all', timezone: 'Europe/Warsaw', total, offset: r.offset, limit: r.limit, next_offset: next, entries: rows.map((e: any) => entryOut(e, e.task_id ? tasks.get(e.task_id) : undefined)) };
}
