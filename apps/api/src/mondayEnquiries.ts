// Fin&Ops ▸ Sales orders ◂ monday board "Acemark PL Enquiries": every offer is an item named by its OK number
// ("OK PL203186 - Sternbau - Inneverglasung"). A button on Sales orders reads the board, shows what it would do
// (preview), and creates only the ticked items as sales orders:
//   • an OK number not in Sales orders yet → a new order (ticked when the offer went to the client, was won or lost;
//     still being priced → listed, not ticked);
//   • an OK number already in Sales orders → left alone (duplicate of the register, never loaded twice);
//   • an OK number on the board more than once (revisions) → listed, never loaded; a name without an OK number → listed.
// The board has no order value: net stays 0 until the rep fills it in.
import { db } from './supabase';
import { Monday } from './monday';
import { orderCode, orderFields } from './finOrders';
import { zNumber } from './mondayJobs';

export const ENQUIRY_BOARD = '5555728429';
export const ECOL = { status: 'status_13', kind: 'color_mkzmrnw1', person: 'person', contact: 'connect_boards1', crm: 'color_mm4c485v', linked: 'board_relation5' } as const;

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface EnqItem { id: string; name: string; group: string | null; created: string | null; status: string | null; kind: string | null; person: string | null; contact: string | null; crm: string | null; linked: string | null }
export type EnqRowStatus = 'new' | 'pricing' | 'in_office' | 'duplicate' | 'no_ok';
export interface EnqRow extends EnqItem {
  code: string | null; state: EnqRowStatus; why: string | null;
  order: { customer: string | null; status: 'offer' | 'accepted' | 'lost'; job: string | null; repId: string | null; rep: string | null; supplier: string | null } | null;
  existing: string | null;   // in_office: the order it matches
}
export interface Rep { id: string; name: string }

/** "OK PL203183 -Sternbau- BV Wagner" → "Sternbau"; "OK PL203179 - Z.447 - Grange House" → "Grange House". */
export function customerFromName(name: string): string | null {
  const rest = clean(name).replace(/^OK[\s_\-–]*[A-Za-z]{0,6}[\s_\-–]*\d{3,}(?:[-/]\d{1,3}(?!\d))*/i, '');
  const parts = rest.split(/\s+[-–]+\s*|\s*[-–]+\s+|^\s*[-–]+|[-–]+\s*$/).map(clean).filter(Boolean);
  const p = parts.find((x) => zNumber(x) === null && !/^ID\s*\d+$/i.test(x));
  return p ? p.slice(0, 160) : null;
}
/** Board status → order status: won = accepted; lost, or in the Dead Enquiries group = lost; anything else = offer. */
export function orderStatusOf(status: string | null, group: string | null): 'offer' | 'accepted' | 'lost' {
  if (/wygran/i.test(status ?? '')) return 'accepted';
  if (/stracon/i.test(status ?? '') || /dead/i.test(group ?? '')) return 'lost';
  return 'offer';
}
/** Ticked by default: the offer reached the client (3.2 Przesłana do klienta, 4. Monitorowane) or is decided. */
export function offerSent(status: string | null, group: string | null): boolean {
  return /^(3\.2|4\.|5\.|6\.)/.test(clean(status)) || /dead|succes/i.test(group ?? '');
}

export function planEnquiries(items: EnqItem[], orders: { order_ref: string; job_ref?: string | null }[], reps: Rep[]): EnqRow[] {
  const have = new Map<string, string>();
  for (const o of orders) { const c = alnum(orderCode(o.order_ref)); if (c.startsWith('OK') && !have.has(c)) have.set(c, o.order_ref); }
  const codeOf = (n: string) => { const c = orderCode(n); return /^OK [A-Z]{0,6}\d{3,}/.test(c) ? c : null; };
  const onBoard = new Map<string, number>();
  for (const it of items) { const c = codeOf(it.name); if (c) onBoard.set(alnum(c), (onBoard.get(alnum(c)) ?? 0) + 1); }
  const repBy = new Map(reps.map((r) => [clean(r.name).toLowerCase(), r]));
  const repOf = (it: EnqItem) => {
    for (const n of clean(it.person).split(/\s*,\s*/)) { const r = repBy.get(n.toLowerCase()); if (r) return r; }
    return repBy.get(clean(it.group).toLowerCase()) ?? null;
  };
  return items.map((it): EnqRow => {
    const code = codeOf(it.name);
    const base = { ...it, code, why: null, order: null, existing: null };
    if (!code) return { ...base, state: 'no_ok', why: 'No OK number at the start of the name' };
    const ex = have.get(alnum(code));
    if (ex) return { ...base, state: 'in_office', existing: ex, why: `Already in Sales orders: ${ex}`.slice(0, 300) };
    const n = onBoard.get(alnum(code)) ?? 0;
    if (n > 1) return { ...base, state: 'duplicate', why: `${code} is on the board ${n} times` };
    // the Z number: written in the name ("OK PL203179 - Z.447 - …") or the name of a linked PRODUCTION item ("Z.453 -OK …")
    const zIn = (s: string, re: RegExp) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
    const zn = zIn(clean(it.name), /\bZ\s*\.\s*0*(\d{1,5})(?!\d)/i) ?? zIn(clean(it.linked), /(?:^|,\s*)Z\s*\.?\s*0*(\d{1,5})(?!\d)/i);
    const r = repOf(it);
    const order = {
      customer: (clean(it.contact).split(/\s*,\s*/)[0] || clean(it.crm) || customerFromName(it.name) || null),
      status: orderStatusOf(it.status, it.group), job: zn === null ? null : 'Z.' + zn,
      repId: r?.id ?? null, rep: r?.name ?? null, supplier: /produkc/i.test(it.kind ?? '') ? 'Acemark PL' : null,
    };
    return { ...base, order, state: offerSent(it.status, it.group) ? 'new' : 'pricing' };
  });
}

// ---- storage -------------------------------------------------------------------------------------
export function boardEnquiry(i: { id: string; name: string; group: string | null; created_at?: string | null; cols: Record<string, string | null> }): EnqItem {
  const t = (k: string) => clean(i.cols[k]) || null;
  return { id: String(i.id), name: clean(i.name), group: i.group, created: i.created_at ? String(i.created_at).slice(0, 10) : null,
    status: t(ECOL.status), kind: t(ECOL.kind), person: t(ECOL.person), contact: t(ECOL.contact), crm: t(ECOL.crm), linked: t(ECOL.linked) };
}
async function allOrders(tenantId: string): Promise<{ order_ref: string; job_ref: string | null }[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_orders').select('order_ref,job_ref').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function previewEnquiries(tenantId: string, reps: Rep[]): Promise<{ rows: EnqRow[]; board: string }> {
  const items = (await new Monday().listItemsDetailed(ENQUIRY_BOARD, Object.values(ECOL))).map(boardEnquiry);
  return { rows: planEnquiries(items, await allOrders(tenantId), reps), board: ENQUIRY_BOARD };
}
/** Create the ticked rows. The plan is worked out again here, so only an item that is still new (or still being
 *  priced — when ticked by hand) is written; an OK number that reached Sales orders meanwhile is skipped. */
export async function applyEnquiries(tenantId: string, by: string, ids: string[], reps: Rep[]): Promise<{ created: string[]; skipped: number }> {
  const { rows } = await previewEnquiries(tenantId, reps);
  const want = new Set(ids.map(String)), created: string[] = [], seen = new Set<string>();
  let skipped = 0;
  const fresh: Record<string, any>[] = [];
  for (const r of rows) {
    if (!want.has(r.id)) continue;
    if ((r.state !== 'new' && r.state !== 'pricing') || !r.order || !r.code || seen.has(alnum(r.code))) { skipped++; continue; }
    seen.add(alnum(r.code));
    const d = r.created ? new Date(r.created + 'T12:00:00Z') : null;
    const f = orderFields({ order_ref: r.name, customer: r.order.customer, status: r.order.status, company: 'Acemark', supplier: r.order.supplier,
      net: 0, offer_year: d ? d.getUTCFullYear() : null, offer_month: d ? d.getUTCMonth() + 1 : null, enquiry_month: d ? d.getUTCMonth() + 1 : null,
      note: `From monday (Acemark PL Enquiries): ${r.status ?? ''}${r.kind ? ' · ' + r.kind : ''}`, job_ref: r.order.job }, true);
    if (!f.ok) { skipped++; continue; }
    fresh.push({ tenant_id: tenantId, created_by: by, rep_user_id: r.order.repId, rep_name: r.order.rep, ...f.fields });
    created.push(r.code);
  }
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await db().from('fin_orders').insert(fresh.slice(i, i + 200));
    if (error) throw error;
  }
  return { created, skipped };
}
