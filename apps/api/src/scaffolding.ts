// ACE Scaffolding — phase 0: customers, contacts, sites, enquiries (ACE####) and jobs (ACESC####), and the
// one-off import from the ACE Scaffolding monday boards (see docs/SCAFFOLDING_PLAN.md):
//   Estimated Enquiries 1630857450 → scaf_enquiries   ("ACE4018 - 4-8 Tilbury Way, Brighton, BN2 9QU")
//   Project Sheet       1594702968 → scaf_jobs        ("ACESC2551 - 4-8 Tilbury Way…", linked to its enquiry)
//   My Contacts         4710488595 → scaf_customers + scaf_contacts (only the contacts the enquiries link to;
//                                    the board is shared by the whole group). "Tom Morley - Southern Building
//                                    Company" is the person Tom Morley at the customer Southern Building Company.
// Older enquiries have no contact link: the customer is the free text "Client Name X", the contact "Luke Conrad -
// 07874 894283" (+ "Email X"), the site "Job Address X". Older jobs carry the same in Client / Address / Contact.
// The import can be re-run until monday is switched off: it adds what is new and refreshes imported rows, but never
// a row changed in the office app (edited_at). After the switch-off the office database is the only source.
import { db } from './supabase';
import { Monday, type LinkedItem } from './monday';

export const BOARDS = { enquiries: '1630857450', jobs: '1594702968', contacts: '4710488595' } as const;
export const ENQ = {
  source: 'status3', sector: 'color_mkv1qszh', received: 'date', deadline: 'date0', quoteSent: 'date9', client: 'text1', email: 'text7',
  contact: 'contact_number_', address: 'text', surveyor: 'multiple_person__1', clientType: 'status1', estimator: 'people',
  sales: 'multiple_person_mksyqcaf', status: 'status6', followUp: 'status8', price: 'numbers', costUp: 'numbers2', costDown: 'numbers9',
  m2: 'numbers__1', link1: 'connect_boards_mkmn9fqz', link2: 'connect_boards_mkmn7e3n', link3: 'board_relation_mkw8r6tt',
} as const;
export const JOB = {
  enquiry: 'board_relation', erector: 'color_mkv29cqt', po: 'text67', handover: 'color_mkp0kn1d', rams: 'color_mkqet97d', up: 'timeline0__1',
  hireWeeks: 'numbers4', rentStart: 'date', rentEnd: 'date96', dismantleRequest: 'date2', dismantleStart: 'date7', rentPct: 'numbers1',
  status: 'status0', invoiced: 'status_1', payment: 'numbers3__1', client: 'text_1', address: 'text8', email: 'text1', contact: 'text2',
  netCost: 'net_cost', costUp: 'numbers_1_mkmmcav4', costDown: 'numbers_1_mkmm7hf6', price: 'numbers_1_mkmmj243', code: 'text_mm867np8', down: 'date92',
} as const;
export const CON = { email: 'email', phone: 'phone', address: 'location_mkrhh4ms', vat: 'long_text_mkrjs527', type: 'status_mkmmr20e', role: 'status_mkmmjt26', notes: 'long_text4' } as const;

// ---- small parsers -----------------------------------------------------------------------------
export const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** The comparison key of a name or address: lower case, letters and digits only. */
export const key = (v: unknown) => clean(v).toLowerCase().normalize('NFKD').replace(/[^0-9a-z]/g, '');
const orNull = (v: unknown) => clean(v) || null;
export function num(v: unknown): number | null { const t = clean(v).replace(/[£,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; }
export function day(v: unknown): string | null { const m = /^(\d{4}-\d{2}-\d{2})/.exec(clean(v)); return m ? m[1] : null; }
/** monday timeline text "2026-10-01 - 2026-10-10" → [start, end]. */
export function span(v: unknown): [string | null, string | null] { const m = /(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(clean(v)); return m ? [m[1], m[2] ?? m[1]] : [null, null]; }
/** ACE4018 → 4018 (never ACESC…). */
export function enquiryNumber(name: unknown): number | null { const m = /^\s*ACE\s*-?\s*0*(\d{1,6})(?!\d)/i.exec(String(name ?? '')); return m ? Number(m[1]) : null; }
/** ACESC2552 → 2552, from the Project Code column or the name (also the typos ACECS1498, ACES1592). */
export function jobNumber(...texts: unknown[]): number | null { for (const t of texts) { const m = /AC(?:ESC|ECS|ES)\s*-?\s*0*(\d{1,6})(?!\d)/i.exec(String(t ?? '')); if (m) return Number(m[1]); } return null; }
/** Test and empty items on the boards ("TEST 1234", "New item", "Empty"). */
export const isJunk = (name: unknown) => /^\s*(test\b|new item\s*$|empty\s*$)/i.test(String(name ?? ''));
/** The enquiry an item's name mentions ("ACESC2554 - ACE4018- 4-8 Tilbury Way… - - Booking for …" → 4018). */
export function mentionedEnquiry(name: unknown): number | null { const m = /(?:^|[^A-Z])ACE\s*-?\s*0*(\d{1,6})(?!\d)/i.exec(String(name ?? '').replace(/ACESC\s*-?\s*\d+/gi, ' ')); return m ? Number(m[1]) : null; }
export const isBooking = (name: unknown) => /booking for/i.test(String(name ?? ''));
/** The title of an item without its numbers: "ACESC2554 - ACE4018- 4-8 Tilbury Way, Brighton - - Booking for ...." → "4-8 Tilbury Way, Brighton". */
export function titleOf(name: unknown): string {
  return clean(name).replace(/^New item\s*[-–:]\s*/i, '').replace(/^AC(?:ESC|ECS|ES)\s*-?\s*\d+\s*[-–:]*\s*/i, '').replace(/^ACE\s*-?\s*\d+\s*[-–:]*\s*/i, '').replace(/\s*-\s*-\s*Booking for.*$/i, '').replace(/\s*[-–]\s*$/, '').trim();
}
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
export function postcode(v: unknown): string | null { const m = POSTCODE.exec(clean(v)); return m ? (m[1] + ' ' + m[2]).toUpperCase() : null; }
/** "Grayswood Hill, Haslemere, GU27 2LH, England." → "Grayswood Hill, Haslemere, GU27 2LH". */
export function tidyAddress(v: unknown): string {
  return clean(v).replace(/[.\s]+$/, '').replace(/,?\s*(England|United Kingdom|UK|Great Britain)$/i, '').replace(/[,.\s]+$/, '').trim();
}
/** Looks like an address (has a UK postcode, or a house number and a comma). */
export const looksAddress = (v: unknown) => !!postcode(v) || /^\d+[a-z]?[\s-]/i.test(clean(v)) && clean(v).includes(',');
/** "Luke Conrad - 07874 894283" → name + phone; "Spud - 07860578237"; "07444 594907" → phone only. */
export function namePhone(v: unknown): { name: string | null; phone: string | null } {
  const t = clean(v);
  const m = /(\+?\d[\d ]{8,}\d)\s*$/.exec(t);
  const phone = m ? m[1].replace(/\s+/g, ' ') : null;
  const name = (m ? t.slice(0, m.index) : t).replace(/[\s\-–:,/]+$/, '').trim();
  return { name: name || null, phone };
}
/** A "My Contacts" item: "Tom Morley - Southern Building Company" → person + company. One part: a person
 *  (Item Type Person) or a company. */
export function splitContact(name: unknown, itemType: unknown): { person: string | null; company: string | null } {
  const t = clean(name), i = t.indexOf(' - ');
  if (i > 0) return { person: t.slice(0, i).trim() || null, company: t.slice(i + 3).trim() || null };
  return /person/i.test(clean(itemType)) ? { person: t || null, company: null } : { person: null, company: t || null };
}
export type CustomerKind = 'domestic' | 'trade' | 'commercial' | 'ace';
export function customerKind(name: unknown, clientType: unknown, sector: unknown): CustomerKind {
  if (/^(ace|acemark)\b/i.test(clean(name))) return 'ace';
  const c = clean(clientType).toLowerCase(), s = clean(sector).toLowerCase();
  if (c === 'private' || s === 'domestic') return 'domestic';
  if (c === 'trade') return 'trade';
  return 'commercial';
}

// ---- stages ------------------------------------------------------------------------------------
export const ENQUIRY_STAGES = ['new', 'waiting_access', 'awaiting_details', 'survey', 'quote_required', 'quote_draft', 'quote_sent', 'pending', 'hot', 'won', 'declined', 'lost', 'no_answer', 'on_hold', 'other'] as const;
export const OPEN_STAGES: EnquiryStage[] = ['new', 'waiting_access', 'awaiting_details', 'survey', 'quote_required', 'quote_draft', 'quote_sent', 'pending', 'hot'];
/** A quote still at "sent" / "seen, pending" this many days after the enquiry came in is imported as "no answer"
 *  (on monday most old quotes were left at "4. Quote sent to client"). */
export const STALE_DAYS = 183;
export type EnquiryStage = typeof ENQUIRY_STAGES[number];
/** The monday "Status of Enquiry" label (or, when empty, the group) → our stage. */
export function enquiryStage(label: unknown, group: unknown): EnquiryStage {
  const l = clean(label).toLowerCase();
  const by: [RegExp, EnquiryStage][] = [
    [/^1\.1\b/, 'waiting_access'], [/^1\.2\b/, 'awaiting_details'], [/^1\.?\s/, 'new'], [/^2\.?\s/, 'survey'], [/^3\.1\b/, 'quote_draft'],
    [/^3\.?\s|quote required/, 'quote_required'], [/^4\.?\s/, 'quote_sent'], [/^5\.1\b/, 'hot'], [/^5\.?\s/, 'pending'], [/^6\.1\b/, 'won'],
    [/^6\.2\b/, 'declined'], [/no longer require|client unsuccessful|uncontactable|missed deadline/, 'lost'], [/on hold/, 'on_hold'],
  ];
  for (const [re, st] of by) if (re.test(l)) return st;
  if (l) return 'other';
  const g = clean(group).toLowerCase();
  return g === 'job won' ? 'won' : g === 'dead enquiry' ? 'lost' : g === 'enquiries' ? 'new' : 'other';
}
export const JOB_STAGES = ['booking', 'upcoming', 'to_be_rented', 'ongoing', 'still_up', 'being_rented', 'ready_for_dismantle', 'part_dismantled', 'down', 'commercial', 'na'] as const;
export type JobStage = typeof JOB_STAGES[number];
export function jobStage(label: unknown, group: unknown, name: unknown): JobStage {
  const l = clean(label).toLowerCase();
  const map: Record<string, JobStage> = { 'to be rented': 'to_be_rented', 'still up': 'still_up', down: 'down', 'ready for dismantle': 'ready_for_dismantle', 'project ongoing': 'ongoing', 'part dismantled': 'part_dismantled', commercial: 'commercial', 'n/a': 'na', 'being rented': 'being_rented' };
  if (map[l]) return map[l];
  if (isBooking(name) || /bookings/i.test(clean(group))) return 'booking';
  return /complete/i.test(clean(group)) ? 'down' : 'upcoming';
}

// ---- the import plan (pure) ---------------------------------------------------------------------
export interface PCustomer { key: string; name: string; kind: CustomerKind; email: string | null; phone: string | null; address: string | null; vat_number: string | null; notes: string | null; monday_id: number | null }
export interface PContact { import_key: string; customer: string; name: string; role: string | null; email: string | null; phone: string | null; monday_id: number | null }
export interface PSite { key: string; address: string; postcode: string | null; customer: string | null }
export interface PEnquiry {
  monday_id: number; number: number | null; title: string | null; customer: string | null; contact: string | null; site: string | null;
  stage: EnquiryStage; status_label: string | null; follow_up: string | null; source: string | null; sector: string | null; client_type: string | null;
  received: string | null; deadline: string | null; quote_sent: string | null; price: number | null; est_cost_up: number | null; est_cost_down: number | null;
  size_m2: number | null; estimator: string | null; surveyor: string | null; salesperson: string | null; monday_group: string | null;
}
export interface PJob {
  monday_id: number; number: number | null; title: string | null; enquiry: number | null; customer: string | null; site: string | null;
  stage: JobStage; status_label: string | null; erector: string | null; po_number: string | null; handover: string | null; rams: string | null; invoiced: string | null;
  up_start: string | null; up_end: string | null; hire_weeks: number | null; rent_pct: number | null; rent_start: string | null; rent_end: string | null;
  dismantle_request: string | null; dismantle_start: string | null; down_date: string | null;
  price: number | null; payment: number | null; net_cost: number | null; actual_cost_up: number | null; actual_cost_down: number | null; monday_group: string | null;
}
export interface Plan { customers: PCustomer[]; contacts: PContact[]; sites: PSite[]; enquiries: PEnquiry[]; jobs: PJob[]; skipped: { board: string; name: string; why: string }[] }

/** The enquiry's links to "My Contacts" (three columns were used over time; the first filled one wins). */
export const contactLinks = (it: LinkedItem) => [...(it.links[ENQ.link1] ?? []), ...(it.links[ENQ.link2] ?? []), ...(it.links[ENQ.link3] ?? [])];

/** `today` (YYYY-MM-DD) decides which open enquiries are old. Items without a number get one when written (writePlan). */
export function buildPlan(enqItems: LinkedItem[], jobItems: LinkedItem[], contactItems: LinkedItem[], today = new Date().toISOString().slice(0, 10)): Plan {
  const customers = new Map<string, PCustomer>(), contacts = new Map<string, PContact>(), sites = new Map<string, PSite>();
  const skipped: Plan['skipped'] = [];
  const addCustomer = (name: string, kind: CustomerKind, extra: Partial<PCustomer> = {}): string | null => {
    const k = key(name); if (!k) return null;
    const have = customers.get(k);
    if (!have) customers.set(k, { key: k, name: clean(name), kind, email: null, phone: null, address: null, vat_number: null, notes: null, monday_id: null, ...extra });
    else for (const f of ['email', 'phone', 'address', 'vat_number', 'notes', 'monday_id'] as const) if (have[f] == null && extra[f] != null) (have as any)[f] = extra[f];
    return k;
  };
  const addContact = (c: PContact) => { if (!contacts.has(c.import_key)) contacts.set(c.import_key, c); return c.import_key; };
  const addSite = (address: string | null, customer: string | null): string | null => {
    const a = tidyAddress(address); const k = key(a); if (!k || k.length < 4) return null;
    if (!sites.has(k)) sites.set(k, { key: k, address: a, postcode: postcode(a), customer });
    return k;
  };

  // My Contacts items → customer (+ contact)
  const fromContact = new Map<string, { customer: string | null; contact: string | null }>();
  const kindHint = new Map<string, { clientType: string | null; sector: string | null }>();
  for (const e of enqItems) for (const id of contactLinks(e)) if (!kindHint.has(id)) kindHint.set(id, { clientType: e.cols[ENQ.clientType], sector: e.cols[ENQ.sector] });
  for (const c of contactItems) {
    const { person, company } = splitContact(c.name, c.cols[CON.type]);
    const hint = kindHint.get(c.id);
    const email = orNull(c.cols[CON.email]), phone = orNull(c.cols[CON.phone]);
    const custName = company ?? person;
    if (!custName) { skipped.push({ board: 'contacts', name: c.name, why: 'no name' }); continue; }
    const kind = company ? customerKind(company, hint?.clientType, hint?.sector) : 'domestic';
    const ck = addCustomer(custName, kind, company && !person
      ? { email, phone, address: orNull(tidyAddress(c.cols[CON.address])), vat_number: orNull(c.cols[CON.vat]), notes: orNull(c.cols[CON.notes]), monday_id: Number(c.id) }
      : { address: orNull(tidyAddress(c.cols[CON.address])), vat_number: orNull(c.cols[CON.vat]) });
    const ct = person && ck ? addContact({ import_key: 'm' + c.id, customer: ck, name: person, role: orNull(c.cols[CON.role]), email, phone, monday_id: Number(c.id) }) : null;
    fromContact.set(c.id, { customer: ck, contact: ct });
  }

  // enquiries
  const enquiries: PEnquiry[] = [];
  const enqByMonday = new Map<string, PEnquiry>(), enqByNumber = new Map<number, PEnquiry>();
  for (const e of enqItems) {
    if (isJunk(e.name)) { skipped.push({ board: 'enquiries', name: e.name, why: 'test or empty item' }); continue; }
    const n = enquiryNumber(e.name);   // null: numbered when written
    const col = (c: string) => e.cols[c];
    let customer: string | null = null, contact: string | null = null;
    const link = contactLinks(e).map((id) => fromContact.get(id)).find(Boolean);
    if (link) { customer = link.customer; contact = link.contact; }
    if (!customer) {
      const np = namePhone(col(ENQ.contact)), clientName = clean(col(ENQ.client)) || np.name;
      if (clientName) {
        customer = addCustomer(clientName, customerKind(clientName, col(ENQ.clientType), col(ENQ.sector)));
        const personName = np.name ?? (clean(col(ENQ.client)) ? null : clientName);
        if (customer && (personName || np.phone || orNull(col(ENQ.email)))) {
          const pn = personName ?? clientName;
          contact = addContact({ import_key: 'c:' + customer + ':' + key(pn), customer, name: pn, role: null, email: orNull(col(ENQ.email)), phone: np.phone, monday_id: null });
        }
      }
    }
    const title = titleOf(e.name) || null;
    const site = addSite(clean(col(ENQ.address)) || (title && looksAddress(title) ? title : null), customer);
    const p: PEnquiry = {
      monday_id: Number(e.id), number: n, title: title ?? (orNull(tidyAddress(col(ENQ.address)))), customer, contact, site,
      stage: enquiryStage(col(ENQ.status), e.group), status_label: orNull(col(ENQ.status)), follow_up: orNull(col(ENQ.followUp)),
      source: orNull(col(ENQ.source)), sector: orNull(col(ENQ.sector)), client_type: orNull(col(ENQ.clientType)),
      received: day(col(ENQ.received)) ?? day(e.created_at), deadline: day(col(ENQ.deadline)), quote_sent: day(col(ENQ.quoteSent)),
      price: num(col(ENQ.price)), est_cost_up: num(col(ENQ.costUp)), est_cost_down: num(col(ENQ.costDown)), size_m2: num(col(ENQ.m2)),
      estimator: orNull(col(ENQ.estimator)), surveyor: orNull(col(ENQ.surveyor)), salesperson: orNull(col(ENQ.sales)), monday_group: e.group,
    };
    enquiries.push(p); enqByMonday.set(e.id, p); if (n !== null && !enqByNumber.has(n)) enqByNumber.set(n, p);
  }

  // jobs
  const jobs: PJob[] = [];
  for (const j of jobItems) {
    const col = (c: string) => j.cols[c];
    if (isJunk(j.name)) { skipped.push({ board: 'jobs', name: j.name, why: 'test or empty item' }); continue; }
    const n = jobNumber(col(JOB.code), j.name);
    if (n === null && isBooking(j.name)) { skipped.push({ board: 'jobs', name: j.name, why: 'booking without an ACESC number' }); continue; }
    const enq = (j.links[JOB.enquiry] ?? []).map((id) => enqByMonday.get(id)).find(Boolean) ?? (mentionedEnquiry(j.name) !== null ? enqByNumber.get(mentionedEnquiry(j.name)!) : undefined);
    let customer = enq?.customer ?? null;
    if (!customer && clean(col(JOB.client))) {
      customer = addCustomer(col(JOB.client)!, customerKind(col(JOB.client), null, null));
      const np = namePhone(col(JOB.contact));
      if (customer && (np.name || np.phone)) addContact({ import_key: 'c:' + customer + ':' + key(np.name ?? col(JOB.client)), customer, name: np.name ?? clean(col(JOB.client)), role: null, email: orNull(col(JOB.email)), phone: np.phone, monday_id: null });
    }
    const title = titleOf(j.name) || null;
    const site = enq?.site ?? addSite(clean(col(JOB.address)) || (title && looksAddress(title) ? title : null), customer);
    const [upStart, upEnd] = span(col(JOB.up));
    jobs.push({
      monday_id: Number(j.id), number: n, title: title ?? orNull(tidyAddress(col(JOB.address))), enquiry: enq ? enq.monday_id : null, customer, site,
      stage: jobStage(col(JOB.status), j.group, j.name), status_label: orNull(col(JOB.status)), erector: orNull(col(JOB.erector)),
      po_number: orNull(col(JOB.po)), handover: orNull(col(JOB.handover)), rams: orNull(col(JOB.rams)), invoiced: orNull(col(JOB.invoiced)),
      up_start: upStart, up_end: upEnd, hire_weeks: num(col(JOB.hireWeeks)), rent_pct: num(col(JOB.rentPct)),
      rent_start: day(col(JOB.rentStart)), rent_end: day(col(JOB.rentEnd)), dismantle_request: day(col(JOB.dismantleRequest)),
      dismantle_start: day(col(JOB.dismantleStart)), down_date: day(col(JOB.down)),
      price: num(col(JOB.price)) ?? enq?.price ?? num(col(JOB.netCost)), payment: num(col(JOB.payment)), net_cost: num(col(JOB.netCost)),
      actual_cost_up: num(col(JOB.costUp)), actual_cost_down: num(col(JOB.costDown)), monday_group: j.group,
    });
  }
  // an enquiry with a job is won; one still open long after it came in had no answer
  const withJob = new Set(jobs.map((j) => j.enquiry).filter((x) => x !== null));
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  for (const e of enquiries) {
    if (withJob.has(e.monday_id) && e.stage !== 'won') e.stage = 'won';
    else if ((e.stage === 'quote_sent' || e.stage === 'pending') && e.received && e.received < cutoff) e.stage = 'no_answer';   // Hot, New, Survey… stay as set
  }
  return { customers: [...customers.values()], contacts: [...contacts.values()], sites: [...sites.values()], enquiries, jobs, skipped };
}

// ---- monday → plan ------------------------------------------------------------------------------
export async function readMonday(): Promise<Plan> {
  const m = new Monday();
  const [enq, jobs] = await Promise.all([m.listItemsLinked(BOARDS.enquiries, Object.values(ENQ)), m.listItemsLinked(BOARDS.jobs, Object.values(JOB))]);
  const ids = [...new Set(enq.flatMap(contactLinks))];
  const contacts = ids.length ? await m.getItemsLinked(ids, Object.values(CON)) : [];
  return buildPlan(enq, jobs, contacts);
}

// ---- database ------------------------------------------------------------------------------------
async function all<T>(table: string, cols: string, tenantId: string, extra?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function upsert(table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(table + ': ' + error.message);
  }
}
export interface ImportResult { customers: number; contacts: number; sites: number; enquiries: number; jobs: number; kept: number; skipped: Plan['skipped'] }
/** Writes the plan. Rows changed in the office app (edited_at) are left as they are. */
export async function writePlan(tenantId: string, plan: Plan): Promise<ImportResult> {
  const now = new Date().toISOString();
  const edited = async (table: string, k: string) => new Set((await all<any>(table, k, tenantId, (q) => q.not('edited_at', 'is', null))).map((r) => String(r[k])));
  let kept = 0;
  const keep = <T>(rows: T[], set: Set<string>, k: (r: T) => string) => rows.filter((r) => { const ok = !set.has(k(r)); if (!ok) kept++; return ok; });

  const eC = await edited('scaf_customers', 'name_key');
  await upsert('scaf_customers', keep(plan.customers, eC, (c) => c.key).map((c) => ({ tenant_id: tenantId, name: c.name, name_key: c.key, kind: c.kind, email: c.email, phone: c.phone, address: c.address, vat_number: c.vat_number, notes: c.notes, monday_id: c.monday_id, imported_at: now })), 'tenant_id,name_key');
  const custId = new Map((await all<any>('scaf_customers', 'id,name_key', tenantId)).map((r) => [r.name_key, r.id]));

  const eT = await edited('scaf_contacts', 'import_key');
  await upsert('scaf_contacts', keep(plan.contacts, eT, (c) => c.import_key).filter((c) => custId.has(c.customer)).map((c) => ({ tenant_id: tenantId, customer_id: custId.get(c.customer), name: c.name, role: c.role, email: c.email, phone: c.phone, monday_id: c.monday_id, import_key: c.import_key, imported_at: now })), 'tenant_id,import_key');
  const contId = new Map((await all<any>('scaf_contacts', 'id,import_key', tenantId, (q) => q.not('import_key', 'is', null))).map((r) => [r.import_key, r.id]));

  // a site's customer: the one the plan gives it, else the customer of the first enquiry naming it
  const eS = await edited('scaf_sites', 'address_key');
  await upsert('scaf_sites', keep(plan.sites, eS, (s) => s.key).map((s) => ({ tenant_id: tenantId, address: s.address, address_key: s.key, postcode: s.postcode, customer_id: s.customer ? custId.get(s.customer) ?? null : null, imported_at: now })), 'tenant_id,address_key');
  const siteId = new Map((await all<any>('scaf_sites', 'id,address_key', tenantId)).map((r) => [r.address_key, r.id]));

  // items with no number on monday get the next free one, once (a re-import finds them by monday id)
  const number = async (table: string, rows: { monday_id: number; number: number | null }[]) => {
    const have = new Map((await all<any>(table, 'monday_id,number', tenantId, (q) => q.not('monday_id', 'is', null))).map((r) => [String(r.monday_id), r.number]));
    let next = Math.max(0, ...rows.map((r) => r.number ?? 0), ...[...have.values()].map(Number)) + 1;
    for (const r of rows) if (r.number === null) r.number = have.get(String(r.monday_id)) ?? next++;
  };
  await number('scaf_enquiries', plan.enquiries);
  await number('scaf_jobs', plan.jobs);
  const eE = await edited('scaf_enquiries', 'monday_id');
  await upsert('scaf_enquiries', keep(plan.enquiries, eE, (e) => String(e.monday_id)).map(({ customer, contact, site, ...e }) => ({
    tenant_id: tenantId, ...e, customer_id: customer ? custId.get(customer) ?? null : null, contact_id: contact ? contId.get(contact) ?? null : null,
    site_id: site ? siteId.get(site) ?? null : null, imported_at: now,
  })), 'tenant_id,monday_id');
  const enqId = new Map((await all<any>('scaf_enquiries', 'id,monday_id', tenantId, (q) => q.not('monday_id', 'is', null))).map((r) => [String(r.monday_id), r.id]));

  const eJ = await edited('scaf_jobs', 'monday_id');
  await upsert('scaf_jobs', keep(plan.jobs, eJ, (j) => String(j.monday_id)).map(({ enquiry, customer, site, ...j }) => ({
    tenant_id: tenantId, ...j, enquiry_id: enquiry ? enqId.get(String(enquiry)) ?? null : null, customer_id: customer ? custId.get(customer) ?? null : null,
    site_id: site ? siteId.get(site) ?? null : null, imported_at: now,
  })), 'tenant_id,monday_id');

  return { customers: plan.customers.length, contacts: plan.contacts.length, sites: plan.sites.length, enquiries: plan.enquiries.length, jobs: plan.jobs.length, kept, skipped: plan.skipped };
}

// ---- reads for the office pages ------------------------------------------------------------------
export async function summary(tenantId: string) {
  const count = async (t: string) => { const { count, error } = await db().from(t).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId); if (error) throw error; return count ?? 0; };
  const maxOf = async (t: string) => { const { data, error } = await db().from(t).select('number').eq('tenant_id', tenantId).order('number', { ascending: false }).limit(1); if (error) throw error; return data?.[0]?.number ?? 0; };
  const last = async (t: string) => { const { data } = await db().from(t).select('imported_at').eq('tenant_id', tenantId).not('imported_at', 'is', null).order('imported_at', { ascending: false }).limit(1); return data?.[0]?.imported_at ?? null; };
  const [customers, sites, enquiries, jobs, maxE, maxJ, importedAt] = await Promise.all([count('scaf_customers'), count('scaf_sites'), count('scaf_enquiries'), count('scaf_jobs'), maxOf('scaf_enquiries'), maxOf('scaf_jobs'), last('scaf_enquiries')]);
  return { customers, sites, enquiries, jobs, nextEnquiry: 'ACE' + (maxE + 1), nextJob: 'ACESC' + (maxJ + 1), importedAt };
}
/** Next number for a new record (phase 1 / 2 create enquiries and jobs with it). */
export async function nextNumber(tenantId: string, table: 'scaf_enquiries' | 'scaf_jobs'): Promise<number> {
  const { data, error } = await db().from(table).select('number').eq('tenant_id', tenantId).order('number', { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.number ?? 0) + 1;
}
const nameMap = async (tenantId: string) => new Map((await all<any>('scaf_customers', 'id,name', tenantId)).map((c) => [c.id, c.name]));
export async function listEnquiries(tenantId: string) {
  const [rows, cust] = await Promise.all([
    all<any>('scaf_enquiries', 'id,number,title,customer_id,stage,status_label,follow_up,loss_reason,source,sector,client_type,received,quote_sent,price,est_cost_up,est_cost_down,estimator,salesperson,next_action,next_action_note', tenantId),
    nameMap(tenantId),
  ]);
  return rows.map((r) => ({ ...r, customer: cust.get(r.customer_id) ?? null, price: r.price === null ? null : Number(r.price), est_cost_up: r.est_cost_up === null ? null : Number(r.est_cost_up), est_cost_down: r.est_cost_down === null ? null : Number(r.est_cost_down) }))
    .sort((a, b) => b.number - a.number);
}
export async function listJobs(tenantId: string) {
  const [rows, cust, enq] = await Promise.all([
    all<any>('scaf_jobs', 'id,number,title,customer_id,enquiry_id,stage,status_label,erector,up_start,up_end,hire_weeks,rent_pct,rent_start,dismantle_request,down_date,price,invoiced', tenantId),
    nameMap(tenantId),
    all<any>('scaf_enquiries', 'id,number', tenantId),
  ]);
  const en = new Map(enq.map((e) => [e.id, e.number]));
  return rows.map((r) => ({ ...r, customer: cust.get(r.customer_id) ?? null, enquiry: en.get(r.enquiry_id) ?? null, price: r.price === null ? null : Number(r.price) }))
    .sort((a, b) => b.number - a.number);
}
export async function getEnquiry(tenantId: string, id: string) {
  const { data: e, error } = await db().from('scaf_enquiries').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!e) return null;
  const one = async (t: string, i: string | null) => { if (!i) return null; const { data } = await db().from(t).select('*').eq('id', i).maybeSingle(); return data; };
  const [customer, contact, site, jobs] = await Promise.all([one('scaf_customers', e.customer_id), one('scaf_contacts', e.contact_id), one('scaf_sites', e.site_id),
    db().from('scaf_jobs').select('id,number,title,stage').eq('tenant_id', tenantId).eq('enquiry_id', id).order('number').then((r: any) => r.data ?? [])]);
  return { ...e, customer, contact, site, jobs };
}
export async function getJob(tenantId: string, id: string) {
  const { data: j, error } = await db().from('scaf_jobs').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!j) return null;
  const one = async (t: string, i: string | null, cols = '*') => { if (!i) return null; const { data } = await db().from(t).select(cols).eq('id', i).maybeSingle(); return data; };
  const [customer, site, enquiry] = await Promise.all([one('scaf_customers', j.customer_id), one('scaf_sites', j.site_id), one('scaf_enquiries', j.enquiry_id, 'id,number,title,stage,price')]);
  return { ...j, customer, site, enquiry };
}
export async function listCustomers(tenantId: string) {
  const [cust, contacts, enq, jobs, sites] = await Promise.all([
    all<any>('scaf_customers', 'id,name,kind,email,phone,active', tenantId),
    all<any>('scaf_contacts', 'id,customer_id', tenantId),
    all<any>('scaf_enquiries', 'id,customer_id,stage,received', tenantId),
    all<any>('scaf_jobs', 'id,customer_id', tenantId),
    all<any>('scaf_sites', 'id,customer_id', tenantId),
  ]);
  const n = (rows: any[]) => { const m = new Map<string, number>(); for (const r of rows) if (r.customer_id) m.set(r.customer_id, (m.get(r.customer_id) ?? 0) + 1); return m; };
  const nc = n(contacts), ne = n(enq), nj = n(jobs), ns = n(sites), won = n(enq.filter((e) => e.stage === 'won'));
  const lastEnq = new Map<string, string>(); for (const e of enq) if (e.customer_id && e.received && (lastEnq.get(e.customer_id) ?? '') < e.received) lastEnq.set(e.customer_id, e.received);
  return cust.map((c) => ({ ...c, contacts: nc.get(c.id) ?? 0, enquiries: ne.get(c.id) ?? 0, won: won.get(c.id) ?? 0, jobs: nj.get(c.id) ?? 0, sites: ns.get(c.id) ?? 0, last: lastEnq.get(c.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function getCustomer(tenantId: string, id: string) {
  const { data: c, error } = await db().from('scaf_customers').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!c) return null;
  const q = (t: string, cols: string, order: string, asc = true) => db().from(t).select(cols).eq('tenant_id', tenantId).eq('customer_id', id).order(order, { ascending: asc }).then((r: any) => { if (r.error) throw r.error; return r.data ?? []; });
  const [contacts, sites, enquiries, jobs] = await Promise.all([
    q('scaf_contacts', 'id,name,role,email,phone,notes', 'name'), q('scaf_sites', 'id,address,postcode,access_notes', 'address'),
    q('scaf_enquiries', 'id,number,title,stage,received,price', 'number', false), q('scaf_jobs', 'id,number,title,stage,up_start,price', 'number', false),
  ]);
  return { ...c, contacts, sites, enquiries, jobs };
}

// ---- edits (Customers & sites) ----------------------------------------------------------------------
const KINDS: CustomerKind[] = ['domestic', 'trade', 'commercial', 'ace'];
const txt = (v: unknown, max = 300) => { const t = clean(v).slice(0, max); return t || null; };
export function customerFields(b: any, creating: boolean): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const f: Record<string, unknown> = {};
  if (creating || 'name' in b) { const n = txt(b.name, 200); if (!n) return { ok: false, error: 'Give the customer a name.' }; f.name = n; f.name_key = key(n); }
  if ('kind' in b || creating) { const k = String(b.kind ?? 'commercial'); if (!KINDS.includes(k as CustomerKind)) return { ok: false, error: 'Choose domestic, trade, commercial or ACE company.' }; f.kind = k; }
  for (const k of ['email', 'phone', 'address', 'vat_number'] as const) if (k in b) f[k] = txt(b[k]);
  if ('notes' in b) f.notes = txt(b.notes, 4000);
  if ('active' in b) f.active = b.active !== false;
  if ('retention_pct' in b) { const t = clean(b.retention_pct).replace('%', ''); const n = t ? Number(t) : null; if (n !== null && !(n >= 0 && n <= 50)) return { ok: false, error: 'Retention 0–50%.' }; f.retention_pct = n; }
  if ('payment_days' in b) { const t = clean(b.payment_days); const n = t ? Math.round(Number(t)) : null; if (n !== null && !(n >= 0 && n <= 365)) return { ok: false, error: 'Payment days 0–365.' }; f.payment_days = n; }
  return { ok: true, fields: f };
}
const dupe = (e: any) => /scaf_customers_key|duplicate key/.test(String(e?.message ?? ''));
export async function saveCustomer(tenantId: string, id: string | null, b: any) {
  const v = customerFields(b ?? {}, !id); if (!v.ok) return v;
  const now = new Date().toISOString();
  const r = id
    ? await db().from('scaf_customers').update({ ...v.fields, edited_at: now }).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
    : await db().from('scaf_customers').insert({ tenant_id: tenantId, ...v.fields, edited_at: now }).select('id').single();
  if (r.error) return { ok: false as const, error: dupe(r.error) ? 'A customer with this name already exists.' : r.error.message };
  return { ok: true as const, id: (r.data as any)?.id ?? id };
}
export async function saveContact(tenantId: string, id: string | null, b: any) {
  const name = txt(b?.name, 200); if (!name) return { ok: false as const, error: 'Give the contact a name.' };
  const f: Record<string, unknown> = { name, role: txt(b.role, 120), email: txt(b.email, 200), phone: txt(b.phone, 60), notes: txt(b.notes, 2000), edited_at: new Date().toISOString() };
  if (id) { const r = await db().from('scaf_contacts').update(f).eq('tenant_id', tenantId).eq('id', id); return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const, id }; }
  if (!b.customer_id) return { ok: false as const, error: 'Which customer?' };
  const r = await db().from('scaf_contacts').insert({ tenant_id: tenantId, customer_id: b.customer_id, ...f }).select('id').single();
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const, id: (r.data as any).id };
}
export async function saveSite(tenantId: string, id: string | null, b: any) {
  const address = tidyAddress(b?.address); if (!address) return { ok: false as const, error: 'Give the site address.' };
  const f: Record<string, unknown> = { address, address_key: key(address), postcode: postcode(address), access_notes: txt(b.access_notes, 2000), edited_at: new Date().toISOString() };
  if ('customer_id' in (b ?? {})) f.customer_id = b.customer_id || null;
  const r = id ? await db().from('scaf_sites').update(f).eq('tenant_id', tenantId).eq('id', id) : await db().from('scaf_sites').insert({ tenant_id: tenantId, ...f }).select('id').single();
  if (r.error) return { ok: false as const, error: /scaf_sites_key|duplicate key/.test(r.error.message) ? 'This address is already a site.' : r.error.message };
  return { ok: true as const, id: id ?? (r.data as any).id };
}
export async function removeRow(tenantId: string, table: 'scaf_contacts' | 'scaf_sites', id: string) {
  const { error } = await db().from(table).delete().eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
}
