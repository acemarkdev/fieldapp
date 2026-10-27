// Fin&Ops ▸ Sales orders: the customer list the order form picks from (the start of the lite CRM), and the order
// number — "OK" + the customer's country + the next number + the rep's own text: "OK DE203065 - Mülheim, Krüger".
// The number is taken when the order is saved (never when the form opens), so a cancelled form leaves no gap;
// it never goes below one above the highest OK number already in Sales orders.
import { db } from './supabase';
import { colReady } from './schemaReady';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** The countries offered for a customer — the code is the one written in the order number. */
export const COUNTRIES: [string, string][] = [
  ['PL', 'Poland'], ['DE', 'Germany'], ['UK', 'United Kingdom'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
  ['LU', 'Luxembourg'], ['FR', 'France'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['DK', 'Denmark'], ['SE', 'Sweden'],
  ['NO', 'Norway'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['IT', 'Italy'], ['ES', 'Spain'],
];
/** "GB" is written "UK" in the order numbers; anything else must be two letters. */
export function countryCode(v: unknown): string | null {
  const s = clean(v).toUpperCase();
  if (!s) return null;
  if (s === 'GB') return 'UK';
  const byName = COUNTRIES.find(([, n]) => n.toUpperCase() === s);
  if (byName) return byName[0];
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

// ---- customers -------------------------------------------------------------------------------------
export interface Customer { id: string; name1: string; name2: string | null; street: string | null; postal_code: string | null; city: string | null; country: string | null; phone: string | null; email: string | null }
const COLS = 'id,name1,name2,street,postal_code,city,country,phone,email';

export function customerFields(b: any): Result<{ fields: Omit<Customer, 'id'> }> {
  const name1 = clean(b?.name1).slice(0, 160);
  if (!name1) return fail(400, 'Enter the customer name.');
  const raw = clean(b?.country), country = countryCode(raw);
  if (raw && !country) return fail(400, 'Pick the customer’s country.');
  const email = clean(b?.email).slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'The e-mail address does not look right.');
  const t = (k: string, n: number) => clean(b?.[k]).slice(0, n) || null;
  return { ok: true, fields: { name1, name2: t('name2', 160), street: t('street', 200), postal_code: t('postal_code', 20), city: t('city', 120), country, phone: t('phone', 60), email: email || null } };
}
/** The name shown on the order and in the list: both name lines. */
export const customerLabel = (c: { name1: string; name2?: string | null }) => [clean(c.name1), clean(c.name2)].filter(Boolean).join(' ').slice(0, 160);

export async function customersReady(): Promise<boolean> { return colReady('fin_customers', 'id'); }
export async function listCustomers(tenantId: string): Promise<Customer[]> {
  if (!(await customersReady())) return [];
  const out: Customer[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_customers').select(COLS).eq('tenant_id', tenantId).order('name1').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Customer[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function getCustomer(tenantId: string, id: string): Promise<Customer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await customersReady())) return null;
  const { data, error } = await db().from('fin_customers').select(COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; return data as Customer | null;
}
export async function createCustomer(tenantId: string, by: string, b: any): Promise<Result<{ customer: Customer }>> {
  if (!(await customersReady())) return fail(409, 'The customer list needs migration 0111 first.');
  const f = customerFields(b); if (!f.ok) return f;
  const { data, error } = await db().from('fin_customers').insert({ tenant_id: tenantId, created_by: by, ...f.fields }).select(COLS).single();
  if (error) throw error;
  return { ok: true, customer: data as Customer };
}
export async function updateCustomer(tenantId: string, id: string, b: any): Promise<Result<{ customer: Customer }>> {
  if (!(await getCustomer(tenantId, id))) return fail(404, 'Customer not found.');
  const f = customerFields(b); if (!f.ok) return f;
  const { data, error } = await db().from('fin_customers').update({ ...f.fields, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select(COLS).single();
  if (error) throw error;
  // the orders show the customer's name — keep it in step
  const { error: e2 } = await db().from('fin_orders').update({ customer: customerLabel(f.fields) }).eq('tenant_id', tenantId).eq('customer_id', id);
  if (e2) throw e2;
  return { ok: true, customer: data as Customer };
}
/** The customer of that name (case and spacing ignored), created when there is none — used by the monday import. */
export async function customerByName(tenantId: string, by: string, name: string, country: string | null, known?: Customer[]): Promise<Customer | null> {
  const n = clean(name).toLowerCase();
  if (!n || !(await customersReady())) return null;
  const list = known ?? await listCustomers(tenantId);
  const hit = list.find((c) => customerLabel(c).toLowerCase() === n || clean(c.name1).toLowerCase() === n);
  if (hit) return hit;
  const r = await createCustomer(tenantId, by, { name1: clean(name), country });
  if (!r.ok) return null;
  list.push(r.customer);
  return r.customer;
}

// ---- the delivery address ----------------------------------------------------------------------------
export interface Address { name: string | null; street: string | null; postal_code: string | null; city: string | null; country: string | null; phone: string | null }
/** The order's own delivery address; null when it is the customer's address ("same as delivery address" ticked). */
export function deliveryFields(b: any): Result<{ address: Address | null }> {
  if (!b || b.same !== false) return { ok: true, address: null };
  const t = (k: string, n: number) => clean(b[k]).slice(0, n) || null;
  const raw = clean(b.country), country = countryCode(raw);
  if (raw && !country) return fail(400, 'Pick the delivery country.');
  const a: Address = { name: t('name', 160), street: t('street', 200), postal_code: t('postal_code', 20), city: t('city', 120), country, phone: t('phone', 60) };
  if (!a.street && !a.city) return fail(400, 'Enter the delivery address, or tick “same as delivery address”.');
  return { ok: true, address: a };
}

// ---- the order number ----------------------------------------------------------------------------------
/** "OK DE203065 - Mülheim" → { cc: 'DE', n: 203065, text: 'Mülheim' }; null for references in another format. */
export function splitOrderRef(ref: unknown): { cc: string; n: number; text: string } | null {
  const s = clean(ref);
  const m = /^OK[\s_\-–]*([A-Za-z]{2})[\s_\-–]*(\d{6})(?!\d)(.*)$/i.exec(s);
  if (!m) return null;
  return { cc: m[1].toUpperCase(), n: Number(m[2]), text: clean(m[3]).replace(/^[-–:,\s]+/, '').replace(/[-–\s]+$/, '').trim() };
}
export function buildOrderRef(cc: string, n: number, text: unknown): string {
  const t = clean(text);
  return (`OK ${cc}${n}` + (t ? ' - ' + t : '')).slice(0, 200);
}
/** One above the highest six-digit OK number in Sales orders (OK DE203065 → 203066). */
export function floorFrom(refs: unknown[]): number {
  let hi = 0;
  for (const r of refs) { const p = splitOrderRef(r); if (p && p.n > hi) hi = p.n; }
  return hi + 1;
}
async function allRefs(tenantId: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_orders').select('order_ref').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []).map((r: any) => r.order_ref));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const numbersReady = () => colReady('fin_order_numbers', 'next_number');
async function storedNext(tenantId: string): Promise<number | null> {
  if (!(await numbersReady())) return null;
  const { data, error } = await db().from('fin_order_numbers').select('next_number').eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error;
  return data ? Number(data.next_number) : null;
}
/** The number the next order will get (shown on the form; not taken). */
export async function peekOrderNumber(tenantId: string): Promise<number> {
  const floor = floorFrom(await allRefs(tenantId)), s = await storedNext(tenantId);
  return Math.max(floor, s ?? 0);
}
/** Take the next number for an order being saved. */
export async function takeOrderNumber(tenantId: string): Promise<number> {
  const floor = floorFrom(await allRefs(tenantId));
  if (!(await numbersReady())) return floor;
  const { data, error } = await db().rpc('fin_take_order_number', { p_tenant: tenantId, p_floor: floor });
  if (error) throw error;
  return Number(data);
}
/** Admin, during the move from monday: the number the next order gets. It still never goes below an existing one. */
export async function setNextOrderNumber(tenantId: string, n: unknown): Promise<Result<{ next: number }>> {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 100000 || v > 999999) return fail(400, 'The next number has six digits, e.g. 203066.');
  if (!(await numbersReady())) return fail(409, 'Setting the next number needs migration 0111 first.');
  const { error } = await db().from('fin_order_numbers').upsert({ tenant_id: tenantId, next_number: v, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
  return { ok: true, next: await peekOrderNumber(tenantId) };
}
/** Whether another order already uses this OK number (the country is not part of it: DE203065 and PL203065 clash). */
export async function codeTaken(tenantId: string, ref: string, exceptId?: string | null): Promise<boolean> {
  const want = splitOrderRef(ref);
  if (!want) return false;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_orders').select('id,order_ref').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    if ((data ?? []).some((r: any) => r.id !== exceptId && splitOrderRef(r.order_ref)?.n === want.n)) return true;
    if (!data || data.length < 1000) return false;
  }
}
