// ACE Scaffolding — phase 1: the enquiry pipeline (create / edit enquiries, status with a loss reason, follow-ups)
// and quotes (revisions with priced elements, the PDF, sent → accepted / declined, won → job). See scaffolding.ts
// for the records and docs/SCAFFOLDING_PLAN.md for the plan.
// Pricing of an element (as ACE Scaffolding quotes today): the price covers erecting, dismantling and the included
// hire weeks; after them the scaffold is rented per whole week at a % of that price (or a fixed £ a week). The labour
// part of the price is kept apart for CIS and the VAT domestic reverse charge (labour, not hire).
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { clean, key, postcode, tidyAddress, ENQUIRY_STAGES, OPEN_STAGES, nextNumber, type EnquiryStage } from './scaffolding';

export const ELEMENTS = ['Independent scaffold', 'Protection fan', 'Monarflex sheeting', 'Roof edge protection', 'Birdcage', 'Loading bay', 'Stair tower', 'Chimney scaffold', 'Temporary roof', 'Propping', 'Hoist', 'Pavement licence', 'Adaption', 'Other'];
export const LOSS_REASONS = ['Too pricey', 'Went to another scaffolding company', 'Client lost the tender', 'Project cancelled or postponed', 'Funding issues', 'No answer', 'Other'];

const txt = (v: unknown, max = 300) => { const t = clean(v).slice(0, max); return t || null; };
const long = (v: unknown, max = 8000) => { const t = String(v ?? '').replace(/\r/g, '').trim().slice(0, max); return t || null; };
const dayOrNull = (v: unknown) => { const t = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const money = (v: unknown): number | null => { const t = clean(v).replace(/[£,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const round2 = (n: number) => Math.round(n * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---- quote lines and totals (pure) ---------------------------------------------------------------
export interface QuoteLine { element: string | null; description: string | null; price: number; labour: number | null; est_cost_up: number | null; est_cost_down: number | null; hire_weeks: number | null; rent_pct: number | null; rent_weekly: number | null }
/** Screen input → lines, or the first problem. Empty rows (no element, description or price) are dropped. */
export function quoteLines(input: unknown): { ok: true; lines: QuoteLine[] } | { ok: false; error: string } {
  const rows = Array.isArray(input) ? input : [];
  const out: QuoteLine[] = [];
  for (let i = 0; i < rows.length && i < 200; i++) {
    const r: any = rows[i] ?? {};
    const element = txt(r.element, 80), description = long(r.description, 2000);
    const vals: Record<string, number | null> = {};
    for (const f of ['price', 'labour', 'est_cost_up', 'est_cost_down', 'hire_weeks', 'rent_pct', 'rent_weekly']) {
      const n = money(r[f]);
      if (Number.isNaN(n)) return { ok: false, error: `Line ${i + 1}: ${f.replace(/_/g, ' ')} is not a number.` };
      if (n !== null && n < 0) return { ok: false, error: `Line ${i + 1}: ${f.replace(/_/g, ' ')} cannot be negative.` };
      vals[f] = n;
    }
    if (!element && !description && !vals.price) continue;
    if (vals.labour !== null && vals.price !== null && vals.labour > vals.price) return { ok: false, error: `Line ${i + 1}: the labour part is more than the price.` };
    if (vals.rent_pct !== null && vals.rent_pct > 100) return { ok: false, error: `Line ${i + 1}: rent % a week over 100.` };
    out.push({ element, description, price: vals.price ?? 0, labour: vals.labour, est_cost_up: vals.est_cost_up, est_cost_down: vals.est_cost_down, hire_weeks: vals.hire_weeks, rent_pct: vals.rent_pct, rent_weekly: vals.rent_weekly });
  }
  return { ok: true, lines: out };
}
/** The weekly rent of a line after its included weeks: a fixed £, else % of its price. */
export const weeklyRent = (l: QuoteLine) => l.rent_weekly ?? (l.rent_pct !== null ? round2(l.price * l.rent_pct / 100) : null);
export function quoteTotals(lines: QuoteLine[]) {
  const sum = (f: (l: QuoteLine) => number | null) => round2(lines.reduce((a, l) => a + (f(l) ?? 0), 0));
  const price = sum((l) => l.price), costUp = sum((l) => l.est_cost_up), costDown = sum((l) => l.est_cost_down);
  const labour = lines.some((l) => l.labour !== null) ? sum((l) => l.labour) : null;
  const profit = round2(price - costUp - costDown);
  return { price, labour, hire: labour === null ? null : round2(price - labour), costUp, costDown, profit, margin: price > 0 ? Math.round((profit / price) * 1000) / 10 : null, weeklyRent: sum(weeklyRent) };
}
/** Hire terms a job takes from the accepted quote: the included weeks and rent % when every line agrees. */
export function jobTerms(lines: QuoteLine[]): { hire_weeks: number | null; rent_pct: number | null } {
  const same = (f: (l: QuoteLine) => number | null) => { const v = [...new Set(lines.map(f).filter((x) => x !== null))]; return v.length === 1 ? v[0] : null; };
  return { hire_weeks: same((l) => l.hire_weeks), rent_pct: same((l) => l.rent_pct) };
}

// ---- enquiries ---------------------------------------------------------------------------------
const STAGES = new Set<string>(ENQUIRY_STAGES);
export function enquiryFields(b: any): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const f: Record<string, unknown> = {};
  for (const k of ['title', 'source', 'sector', 'client_type', 'estimator', 'surveyor', 'salesperson', 'next_action_note'] as const) if (k in b) f[k] = txt(b[k], k === 'title' ? 200 : 120);
  if ('description' in b) f.description = long(b.description);
  if ('notes' in b) f.notes = long(b.notes);
  for (const k of ['received', 'deadline', 'next_action'] as const) if (k in b) { const d = dayOrNull(b[k]); if (b[k] && !d) return { ok: false, error: 'Dates as YYYY-MM-DD.' }; f[k] = d; }
  for (const k of ['customer_id', 'contact_id', 'site_id'] as const) if (k in b) f[k] = b[k] || null;
  if ('size_m2' in b) { const n = money(b.size_m2); if (Number.isNaN(n)) return { ok: false, error: 'Size is not a number.' }; f.size_m2 = n; }
  if ('stage' in b) {
    if (!STAGES.has(String(b.stage))) return { ok: false, error: 'Unknown status.' };
    f.stage = b.stage;
    if (b.stage === 'declined' || b.stage === 'lost') { const r = txt(b.loss_reason, 120); if (!r) return { ok: false, error: 'Give the reason it was lost.' }; f.loss_reason = r; }
    else if (OPEN_STAGES.includes(b.stage as EnquiryStage) || b.stage === 'won') f.loss_reason = null;
    if (!OPEN_STAGES.includes(b.stage as EnquiryStage)) { f.next_action = null; f.next_action_note = null; }   // closed: nothing to chase
  }
  return { ok: true, fields: f };
}
/** Quick-add of a customer / site while creating an enquiry: { new_customer: {name, kind}, new_site: {address} }. */
async function quickAdds(tenantId: string, b: any, now: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (b.new_customer && clean(b.new_customer.name)) {
    const name = clean(b.new_customer.name).slice(0, 200), name_key = key(name);
    const have = await db().from('scaf_customers').select('id').eq('tenant_id', tenantId).eq('name_key', name_key).maybeSingle();
    if (have.data) b.customer_id = (have.data as any).id;
    else {
      const kind = ['domestic', 'trade', 'commercial', 'ace'].includes(b.new_customer.kind) ? b.new_customer.kind : 'commercial';
      const r = await db().from('scaf_customers').insert({ tenant_id: tenantId, name, name_key, kind, email: txt(b.new_customer.email, 200), phone: txt(b.new_customer.phone, 60), edited_at: now }).select('id').single();
      if (r.error) return { ok: false, error: r.error.message };
      b.customer_id = (r.data as any).id;
    }
    if (clean(b.new_customer.contact)) {
      const r = await db().from('scaf_contacts').insert({ tenant_id: tenantId, customer_id: b.customer_id, name: clean(b.new_customer.contact).slice(0, 200), email: txt(b.new_customer.email, 200), phone: txt(b.new_customer.phone, 60), edited_at: now }).select('id').single();
      if (!r.error) b.contact_id = (r.data as any).id;
    }
  }
  if (b.new_site && clean(b.new_site.address)) {
    const address = tidyAddress(b.new_site.address), address_key = key(address);
    const have = await db().from('scaf_sites').select('id').eq('tenant_id', tenantId).eq('address_key', address_key).maybeSingle();
    if (have.data) b.site_id = (have.data as any).id;
    else {
      const r = await db().from('scaf_sites').insert({ tenant_id: tenantId, address, address_key, postcode: postcode(address), customer_id: b.customer_id || null, edited_at: now }).select('id').single();
      if (r.error) return { ok: false, error: r.error.message };
      b.site_id = (r.data as any).id;
    }
    if (!clean(b.title)) b.title = address;
  }
  return { ok: true };
}
export async function saveEnquiry(tenantId: string, id: string | null, body: any): Promise<{ ok: true; id: string; number?: number } | { ok: false; error: string }> {
  const b = { ...(body ?? {}) }, now = new Date().toISOString();
  const q = await quickAdds(tenantId, b, now); if (!q.ok) return q;
  const v = enquiryFields(b); if (!v.ok) return v;
  if (id) {
    const r = await db().from('scaf_enquiries').update({ ...v.fields, edited_at: now }).eq('tenant_id', tenantId).eq('id', id);
    return r.error ? { ok: false, error: r.error.message } : { ok: true, id };
  }
  if (!v.fields.customer_id) return { ok: false, error: 'Choose or add the customer.' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextNumber(tenantId, 'scaf_enquiries');
    const r = await db().from('scaf_enquiries').insert({ tenant_id: tenantId, number, stage: 'new', received: today(), ...v.fields, edited_at: now }).select('id').single();
    if (!r.error) return { ok: true, id: (r.data as any).id, number };
    if (!/duplicate key/.test(r.error.message)) return { ok: false, error: r.error.message };
  }
  return { ok: false, error: 'Could not number the enquiry — try again.' };
}

// ---- quotes ------------------------------------------------------------------------------------
const lineCols = 'element,description,price,labour,est_cost_up,est_cost_down,hire_weeks,rent_pct,rent_weekly';
const numOr = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const asLine = (r: any): QuoteLine => ({ element: r.element, description: r.description, price: Number(r.price) || 0, labour: numOr(r.labour), est_cost_up: numOr(r.est_cost_up), est_cost_down: numOr(r.est_cost_down), hire_weeks: numOr(r.hire_weeks), rent_pct: numOr(r.rent_pct), rent_weekly: numOr(r.rent_weekly) });
async function quoteRow(tenantId: string, id: string) {
  const { data, error } = await db().from('scaf_quotes').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; return data as any;
}
export async function getQuote(tenantId: string, id: string) {
  const q = await quoteRow(tenantId, id); if (!q) return null;
  const { data, error } = await db().from('scaf_quote_lines').select(lineCols).eq('quote_id', id).order('position');
  if (error) throw error;
  const lines = (data ?? []).map(asLine);
  return { ...q, lines, totals: quoteTotals(lines) };
}
export async function listQuotes(tenantId: string, enquiryId: string) {
  const { data, error } = await db().from('scaf_quotes').select('id,revision,status,sent_at,decided_at,created_at').eq('tenant_id', tenantId).eq('enquiry_id', enquiryId).order('revision', { ascending: false });
  if (error) throw error;
  const ids = (data ?? []).map((q: any) => q.id);
  const lines = ids.length ? (await db().from('scaf_quote_lines').select('quote_id,' + lineCols).in('quote_id', ids)).data ?? [] : [];
  return (data ?? []).map((q: any) => ({ ...q, totals: quoteTotals((lines as any[]).filter((l) => l.quote_id === q.id).map(asLine)) }));
}
/** A new revision: a copy of the latest one (or empty, with the default intro and terms). */
export async function newQuote(tenantId: string, enquiryId: string, userId: string) {
  const { data: prev } = await db().from('scaf_quotes').select('id,revision,intro,terms,valid_days').eq('tenant_id', tenantId).eq('enquiry_id', enquiryId).order('revision', { ascending: false }).limit(1);
  const last = (prev ?? [])[0] as any, s = await settings();
  const r = await db().from('scaf_quotes').insert({ tenant_id: tenantId, enquiry_id: enquiryId, revision: (last?.revision ?? 0) + 1, intro: last?.intro ?? s.intro, terms: last?.terms ?? s.terms, valid_days: last?.valid_days ?? s.valid_days, created_by: userId }).select('id').single();
  if (r.error) return { ok: false as const, error: r.error.message };
  const id = (r.data as any).id;
  if (last) {
    const { data: lines } = await db().from('scaf_quote_lines').select('position,' + lineCols).eq('quote_id', last.id).order('position');
    if (lines?.length) await db().from('scaf_quote_lines').insert((lines as any[]).map((l) => ({ ...l, tenant_id: tenantId, quote_id: id })));
  }
  return { ok: true as const, id };
}
export async function saveQuote(tenantId: string, id: string, b: any) {
  const q = await quoteRow(tenantId, id); if (!q) return { ok: false as const, error: 'Not found.' };
  if (q.status !== 'draft') return { ok: false as const, error: 'A sent quote cannot be changed — make a new revision.' };
  const v = quoteLines(b.lines); if (!v.ok) return v;
  const valid = Number(b.valid_days); if (!Number.isInteger(valid) || valid < 1 || valid > 365) return { ok: false as const, error: 'Valid for 1–365 days.' };
  const u = await db().from('scaf_quotes').update({ intro: long(b.intro, 4000), terms: long(b.terms, 12000), valid_days: valid, edited_at: new Date().toISOString() }).eq('id', id);
  if (u.error) return { ok: false as const, error: u.error.message };
  const d = await db().from('scaf_quote_lines').delete().eq('quote_id', id);
  if (d.error) return { ok: false as const, error: d.error.message };
  if (v.lines.length) { const i = await db().from('scaf_quote_lines').insert(v.lines.map((l, k) => ({ ...l, tenant_id: tenantId, quote_id: id, position: k }))); if (i.error) return { ok: false as const, error: i.error.message }; }
  return { ok: true as const, totals: quoteTotals(v.lines) };
}
export async function deleteQuote(tenantId: string, id: string) {
  const q = await quoteRow(tenantId, id); if (!q) return { ok: false as const, error: 'Not found.' };
  if (q.status !== 'draft') return { ok: false as const, error: 'Only a draft can be deleted.' };
  const r = await db().from('scaf_quotes').delete().eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
/** sent: the enquiry moves to "quote sent" with this quote's price and costs, a chase-up in a week; an older sent
 *  revision is superseded. accepted → the enquiry is won. declined → the enquiry is declined, with the reason. */
export async function setQuoteStatus(tenantId: string, id: string, status: string, reason?: unknown) {
  const q = await getQuote(tenantId, id); if (!q) return { ok: false as const, error: 'Not found.' };
  const now = new Date().toISOString(), d = today();
  if (status === 'sent') {
    if (q.status !== 'draft') return { ok: false as const, error: 'Only a draft can be marked sent.' };
    if (!q.lines.length) return { ok: false as const, error: 'The quote has no lines.' };
    await db().from('scaf_quotes').update({ status: 'superseded' }).eq('enquiry_id', q.enquiry_id).eq('status', 'sent');
    await db().from('scaf_quotes').update({ status: 'sent', sent_at: d, edited_at: now }).eq('id', id);
    const { data: e } = await db().from('scaf_enquiries').select('stage,next_action').eq('id', q.enquiry_id).maybeSingle();
    const t = q.totals;
    await db().from('scaf_enquiries').update({
      stage: e && ['won', 'hot'].includes((e as any).stage) ? (e as any).stage : 'quote_sent', quote_sent: d, price: t.price, est_cost_up: t.costUp, est_cost_down: t.costDown,
      next_action: (e as any)?.next_action ?? addDays(d, 7), next_action_note: (e as any)?.next_action ? undefined : 'Chase the quote', edited_at: now,
    }).eq('id', q.enquiry_id);
    return { ok: true as const };
  }
  if (status === 'accepted' || status === 'declined') {
    if (q.status !== 'sent') return { ok: false as const, error: 'Mark the quote sent first.' };
    const why = txt(reason, 120);
    if (status === 'declined' && !why) return { ok: false as const, error: 'Give the reason it was declined.' };
    await db().from('scaf_quotes').update({ status, decided_at: d, edited_at: now }).eq('id', id);
    await db().from('scaf_enquiries').update(status === 'accepted'
      ? { stage: 'won', loss_reason: null, next_action: null, next_action_note: null, price: q.totals.price, edited_at: now }
      : { stage: 'declined', loss_reason: why, next_action: null, next_action_note: null, edited_at: now }).eq('id', q.enquiry_id);
    return { ok: true as const };
  }
  if (status === 'draft') {   // undo "sent" (a mistake), only while nothing was decided
    if (q.status !== 'sent') return { ok: false as const, error: 'Only a sent quote can go back to draft.' };
    await db().from('scaf_quotes').update({ status: 'draft', sent_at: null, edited_at: now }).eq('id', id);
    return { ok: true as const };
  }
  return { ok: false as const, error: 'Unknown status.' };
}
/** Won → a job (next ACESC number) from the accepted quote. One job per accepted quote. */
export async function jobFromQuote(tenantId: string, quoteId: string) {
  const q = await getQuote(tenantId, quoteId); if (!q) return { ok: false as const, error: 'Not found.' };
  if (q.status !== 'accepted') return { ok: false as const, error: 'Only an accepted quote becomes a job.' };
  const have = await db().from('scaf_jobs').select('id,number').eq('tenant_id', tenantId).eq('quote_id', quoteId).maybeSingle();
  if (have.data) return { ok: true as const, id: (have.data as any).id, number: (have.data as any).number, existed: true };
  const { data: e } = await db().from('scaf_enquiries').select('id,title,customer_id,site_id,contact_id').eq('id', q.enquiry_id).maybeSingle();
  const terms = jobTerms(q.lines);
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextNumber(tenantId, 'scaf_jobs');
    const r = await db().from('scaf_jobs').insert({
      tenant_id: tenantId, number, title: (e as any)?.title ?? null, enquiry_id: q.enquiry_id, customer_id: (e as any)?.customer_id ?? null, site_id: (e as any)?.site_id ?? null,
      quote_id: quoteId, stage: 'upcoming', erector: 'ACE Scaff', price: q.totals.price, ...terms, edited_at: new Date().toISOString(),
    }).select('id').single();
    if (!r.error) {
      const jobId = (r.data as any).id;
      // one scaffold per quote line (phase 2; skipped quietly before migration 0098)
      await db().from('scaf_scaffolds').insert((q.lines as QuoteLine[]).map((l: QuoteLine, i: number) => ({ tenant_id: tenantId, job_id: jobId, position: i, element: l.element, description: l.description, price: l.price, labour: l.labour, hire_weeks: l.hire_weeks, rent_pct: l.rent_pct, rent_weekly: l.rent_weekly })));
      if ((e as any)?.contact_id) await db().from('scaf_jobs').update({ contact_id: (e as any).contact_id }).eq('id', jobId);
      return { ok: true as const, id: jobId, number };
    }
    if (!/duplicate key/.test(r.error.message)) return { ok: false as const, error: r.error.message };
  }
  return { ok: false as const, error: 'Could not number the job — try again.' };
}
/** Everything the quote PDF needs. */
export async function quotePdfData(tenantId: string, id: string) {
  const q = await getQuote(tenantId, id); if (!q) return null;
  const { data: e } = await db().from('scaf_enquiries').select('number,title,description,customer_id,contact_id,site_id').eq('id', q.enquiry_id).maybeSingle();
  const one = async (t: string, i: string | null) => { if (!i) return null; const { data } = await db().from(t).select('*').eq('id', i).maybeSingle(); return data as any; };
  const en = e as any;
  const [customer, contact, site] = await Promise.all([one('scaf_customers', en?.customer_id), one('scaf_contacts', en?.contact_id), one('scaf_sites', en?.site_id)]);
  return { quote: q, enquiry: en, customer, contact, site, company: await settings() };
}

// ---- company details and quote defaults (Overview ▸ Quote settings) -----------------------------------
export interface ScafSettings { name: string; address: string; phone: string; email: string; web: string; company_no: string; vat_no: string; intro: string; terms: string; valid_days: number }
export const DEFAULT_SETTINGS: ScafSettings = {
  name: 'ACE Scaffolding', address: '', phone: '', email: '', web: '', company_no: '', vat_no: '',
  intro: 'Thank you for your enquiry. We are pleased to quote as follows for the supply, erection and dismantling of scaffolding at the above site.',
  terms: [
    'Prices exclude VAT at the prevailing rate.',
    'Each price includes erection, dismantling and the hire period stated. After it, hire is charged per week or part week at the weekly rate shown until we receive a written dismantle request.',
    'Hire starts on the date the scaffold is handed over.',
    'Alterations and adaptions requested on site are charged extra and confirmed in writing.',
    'The scaffold must not be altered or loaded beyond its design by anyone other than ACE Scaffolding.',
    'Licences, permits and road closures are charged at cost unless included above.',
  ].join('\n'),
  valid_days: 30,
};
export async function settings(): Promise<ScafSettings> {
  try { const raw = await getConfig('scaf_settings'); return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS; } catch { return DEFAULT_SETTINGS; }
}
export async function saveSettings(b: any): Promise<{ ok: true } | { ok: false; error: string }> {
  const s: ScafSettings = { ...DEFAULT_SETTINGS };
  for (const k of ['name', 'address', 'phone', 'email', 'web', 'company_no', 'vat_no'] as const) s[k] = clean(b?.[k]).slice(0, k === 'address' ? 300 : 120);
  s.intro = long(b?.intro, 4000) ?? ''; s.terms = long(b?.terms, 12000) ?? '';
  const v = Number(b?.valid_days); if (!Number.isInteger(v) || v < 1 || v > 365) return { ok: false, error: 'Valid for 1–365 days.' };
  s.valid_days = v;
  if (!s.name) return { ok: false, error: 'Give the company name.' };
  await setConfig('scaf_settings', JSON.stringify(s));
  return { ok: true };
}
