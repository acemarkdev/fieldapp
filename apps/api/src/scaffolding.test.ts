// Run: npx tsx apps/api/src/scaffolding.test.ts
import { enquiryNumber, jobNumber, mentionedEnquiry, titleOf, tidyAddress, postcode, namePhone, splitContact, customerKind, enquiryStage, jobStage, span, num, looksAddress, buildPlan, customerFields, ENQ, JOB, CON } from './scaffolding';
import type { LinkedItem } from './monday';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// rows as they are on the ACE Scaffolding boards (October 2026)
ok('enquiry numbers', enquiryNumber('ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU') === 4018 && enquiryNumber('ACE2848') === 2848 && enquiryNumber('ACESC2552 - x') === null && enquiryNumber('Test') === null);
ok('job numbers', jobNumber('ACESC2554', 'x') === 2554 && jobNumber(null, 'ACESC816') === 816 && jobNumber(null, 'ACE4018') === null && jobNumber(null, 'ACECS1498') === 1498 && jobNumber(null, 'ACES1592') === 1592 && jobNumber(null, 'ACES2563 - Harvester') === 2563 && jobNumber('ACE4014', 'ACE4014 - 24 Woodsland Road') === null);
ok('titles of unnumbered items', titleOf('New item - Lady Mead Nursing Home, Albourne, Hassocks, BN6 9ES, England.') === 'Lady Mead Nursing Home, Albourne, Hassocks, BN6 9ES, England.' && titleOf('ACECS1498') === '' && titleOf('ACE4014 - 24 Woodsland Road, Hassocks, BN6 8HG') === '24 Woodsland Road, Hassocks, BN6 8HG');
ok('enquiry named in a job', mentionedEnquiry('ACESC2554 - ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU - - Booking for ....') === 4018 && mentionedEnquiry('ACESC2552 - 13-17 Tilbury Way') === null);
ok('titles', titleOf('ACESC2554 - ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU - - Booking for ....') === '4-8 Tilbury Way, Brighton, BN2 9QU' && titleOf('ACE4021 - Jireh Court, Block E') === 'Jireh Court, Block E' && titleOf('ACE2848') === '' && titleOf('ACE4019 - 9237 Jevington House Propping') === '9237 Jevington House Propping',
  [titleOf('ACESC2554 - ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU - - Booking for ....')]);
ok('addresses', tidyAddress('Grayswood Hill, Haslemere, GU27 2LH, England.') === 'Grayswood Hill, Haslemere, GU27 2LH' && tidyAddress('11 Gloucester Road, Brighton, BN2 1AD.') === '11 Gloucester Road, Brighton, BN2 1AD' && postcode('The Curve Carlton Hill, Brighton, BN2 0GX') === 'BN2 0GX' && postcode('brighton bn20gx') === 'BN2 0GX' && postcode('Jireh Court') === null);
ok('looks like an address', looksAddress('4-8 Tilbury Way, Brighton, BN2 9QU') && looksAddress('34 Norton Road, Hove') && !looksAddress('Jireh Court, Block E') && !looksAddress('9237 Jevington House Propping'));
ok('name and phone', JSON.stringify(namePhone('Luke Conrad - 07874 894283')) === JSON.stringify({ name: 'Luke Conrad', phone: '07874 894283' }) && namePhone('Spud - 07860578237').name === 'Spud' && namePhone('07444594907').name === null && namePhone('Zara').phone === null, namePhone('Luke Conrad - 07874 894283'));
ok('My Contacts names', JSON.stringify(splitContact('Tom Morley - Southern Building Company', 'Company')) === JSON.stringify({ person: 'Tom Morley', company: 'Southern Building Company' }) && splitContact('Jade Cooper', 'Person').person === 'Jade Cooper' && splitContact('Lawtech Group', 'Company').company === 'Lawtech Group' && splitContact('Cardo Group', null).company === 'Cardo Group');
ok('customer kinds', customerKind('Roddy Coleman', 'Private', null) === 'domestic' && customerKind('Nicholls Ltd.', 'Trade', null) === 'trade' && customerKind('Lawtech', null, 'Commercial') === 'commercial' && customerKind('ACE Construction', 'Trade', null) === 'ace' && customerKind('X', null, 'Domestic') === 'domestic');
ok('enquiry stages', enquiryStage('6.1 Successful Project', null) === 'won' && enquiryStage('5.1 Hot Enquiry', null) === 'hot' && enquiryStage('5. Quote seen, pending decision', null) === 'pending' && enquiryStage('3. Quote Required', null) === 'quote_required'
  && enquiryStage('3.1 Quote in Draft', null) === 'quote_draft' && enquiryStage('1.2 Awaiting Site Meeting', null) === 'awaiting_details' && enquiryStage('1.1 Waiting For Access For Survey', null) === 'waiting_access' && enquiryStage('1. New Enquiry', null) === 'new'
  && enquiryStage('6.2 Quote Declined', null) === 'declined' && enquiryStage('No Longer Require Quote', null) === 'lost' && enquiryStage('Client Unsuccessful', null) === 'lost' && enquiryStage('On Hold', null) === 'on_hold' && enquiryStage('Details received, quote required', null) === 'quote_required'
  && enquiryStage(null, 'Job Won') === 'won' && enquiryStage(null, 'Dead Enquiry') === 'lost' && enquiryStage('Working on it', null) === 'other', ['5. Quote seen, pending decision', 'Details received, quote required'].map((x) => enquiryStage(x, null)));
ok('job stages', jobStage('Down', null, 'x') === 'down' && jobStage('Ready For Dismantle', null, 'x') === 'ready_for_dismantle' && jobStage(null, 'Bookings', 'ACESC2554 - … Booking for ....') === 'booking' && jobStage(null, 'Upcoming Projects', 'ACESC2552') === 'upcoming' && jobStage(null, 'Complete Projects', 'x') === 'down');
ok('timeline and numbers', JSON.stringify(span('2026-10-01 - 2026-10-10')) === '["2026-10-01","2026-10-10"]' && span('')[0] === null && num('38015.44') === 38015.44 && num('£1,250') === 1250 && num('') === null);

const item = (id: string, name: string, cols: Record<string, string | null>, links: Record<string, string[]> = {}, group: string | null = null): LinkedItem => ({ id, name, group, created_at: '2025-01-01T00:00:00Z', cols, links });
const enq = [
  item('13355040405', 'ACE4021 - Jireh Court, Block E', { [ENQ.source]: 'Regular Client', [ENQ.sector]: 'Commercial', [ENQ.received]: '2026-10-22', [ENQ.status]: '3. Quote Required' }, { [ENQ.link1]: ['4720388075'] }, 'Enquiries'),
  item('13343252500', 'ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU', { [ENQ.received]: '2026-10-21', [ENQ.status]: '6.1 Successful Project', [ENQ.price]: '5000' }, { [ENQ.link1]: ['9904792545'] }, 'Job Won'),
  item('8943828347', 'ACE2848', { [ENQ.client]: 'Nicholls Ltd.', [ENQ.email]: 'lukec@nichollsltd.com', [ENQ.contact]: 'Luke Conrad - 07874 894283', [ENQ.address]: 'Grayswood Hill, Haslemere, GU27 2LH, England.', [ENQ.clientType]: 'Trade', [ENQ.status]: '5.1 Hot Enquiry', [ENQ.price]: '91012.5' }, {}, 'Chase Up'),
  item('6694971159', 'ACE1955', { [ENQ.client]: 'Roddy Coleman', [ENQ.contact]: 'Roddy - 07976287575', [ENQ.address]: '34-35 Sussex Square, Brighton, BN2 5AD, England.', [ENQ.clientType]: 'Private' }),
  item('1', 'TEST 1234', {}),
  item('2', '39 Wivelsfield Rd, Saltdean, Brighton BN2 8FP', { [ENQ.received]: '2026-06-16' }, {}, 'Job Won'),
  item('3', 'ACE1000 - Old quote', { [ENQ.received]: '2025-01-10', [ENQ.status]: '4. Quote sent to client' }),
  item('4', 'ACE1001 - Old quote with a job', { [ENQ.received]: '2025-01-10', [ENQ.status]: '4. Quote sent to client' }),
  item('5', 'ACE4010 - Recent quote', { [ENQ.received]: '2026-09-01', [ENQ.status]: '4. Quote sent to client' }),
];
const jobs = [
  item('13343235599', 'ACESC2551 - 4-8 Tilbury Way, Brighton, BN2 9QU', { [JOB.erector]: 'ACE Scaff', [JOB.rentPct]: '4', [JOB.code]: 'ACESC2551' }, { [JOB.enquiry]: ['13343252500'] }, 'Upcoming Projects'),
  item('13343228211', 'ACESC2554 - ACE4018- 4-8 Tilbury Way, Brighton, BN2 9QU - - Booking for ....', { [JOB.code]: 'ACESC2554' }, {}, 'Bookings'),
  item('7', 'ACE1001 - Old quote with a job', {}, { [JOB.enquiry]: ['4'] }, 'Complete Projects'),
  item('8', 'ACE2315 - 13 Shanklin Road, Brighton, BN2 3LP, England. - Booking for ....', {}, {}, 'Bookings'),
  item('9', 'ACECS1498', { [JOB.status]: 'Down' }, {}, 'Complete Projects'),
  item('3365186043', 'ACESC801', { [JOB.client]: 'ACE Construction', [JOB.address]: '2 Lewes Road, Halland, Lewes, BN8 6PN.', [JOB.contact]: 'Dan - 07557230405', [JOB.status]: 'Down', [JOB.hireWeeks]: '12', [JOB.rentPct]: '4', [JOB.netCost]: '1300', [JOB.rentStart]: '2023-01-04', [JOB.down]: '2022-11-16', [JOB.up]: '2022-10-20 - 2022-10-21' }, {}, 'Complete Projects'),
];
const contacts = [
  item('4720388075', 'Tom Morley - Southern Building Company', { [CON.email]: 'tomm@southernbuildingcompany.co.uk', [CON.phone]: '07444594907', [CON.type]: 'Company' }),
  item('9904792545', 'Cardo Group', { [CON.type]: 'Company', [CON.address]: 'Unit 1, Brighton, BN1 1AA' }),
];
const p = buildPlan(enq, jobs, contacts, '2026-10-22');
const cust = (n: string) => p.customers.find((c) => c.name === n);
ok('customers from My Contacts and from the old text', !!cust('Southern Building Company') && !!cust('Cardo Group') && cust('Nicholls Ltd.')?.kind === 'trade' && cust('Roddy Coleman')?.kind === 'domestic' && cust('ACE Construction')?.kind === 'ace' && p.customers.length === 5, p.customers.map((c) => c.name + ':' + c.kind));
ok('a company item keeps its address and monday id', cust('Cardo Group')?.address === 'Unit 1, Brighton, BN1 1AA' && cust('Cardo Group')?.monday_id === 9904792545);
ok('contacts', p.contacts.some((c) => c.import_key === 'm4720388075' && c.name === 'Tom Morley' && c.phone === '07444594907') && p.contacts.some((c) => c.name === 'Luke Conrad' && c.email === 'lukec@nichollsltd.com' && c.phone === '07874 894283') && p.contacts.some((c) => c.name === 'Dan' && c.customer === 'aceconstruction'), p.contacts);
ok('sites: from the address column or an address-like name, not from "Jireh Court, Block E"', p.sites.some((s) => s.address === 'Grayswood Hill, Haslemere, GU27 2LH' && s.postcode === 'GU27 2LH') && p.sites.some((s) => s.address === '4-8 Tilbury Way, Brighton, BN2 9QU' && s.customer === 'cardogroup') && !p.sites.some((s) => /Jireh/.test(s.address)) && p.sites.some((s) => s.address === '2 Lewes Road, Halland, Lewes, BN8 6PN'), p.sites.map((s) => s.address));
const e4018 = p.enquiries.find((e) => e.number === 4018)!, e2848 = p.enquiries.find((e) => e.number === 2848)!;
ok('enquiries', p.enquiries.length === 8 && e4018.stage === 'won' && e4018.customer === 'cardogroup' && e4018.price === 5000 && e2848.stage === 'hot' && e2848.title === 'Grayswood Hill, Haslemere, GU27 2LH' && e2848.contact !== null && p.enquiries.find((e) => e.number === 4021)!.contact === 'm4720388075', e2848);
ok('test items and bookings without a number are left out', p.skipped.map((x) => x.why).join('|') === 'test or empty item|booking without an ACESC number', p.skipped);
const st = (n: string) => p.enquiries.find((e) => e.title === n);
ok('an enquiry without a number is kept (numbered when written)', st('39 Wivelsfield Rd, Saltdean, Brighton BN2 8FP')?.number === null && st('39 Wivelsfield Rd, Saltdean, Brighton BN2 8FP')?.stage === 'won');
ok('old open quote → no answer; with a job → won; recent stays open', st('Old quote')?.stage === 'no_answer' && st('Old quote with a job')?.stage === 'won' && st('Recent quote')?.stage === 'quote_sent', p.enquiries.map((e) => e.title + ':' + e.stage));
ok('a job with only an ACE number is kept and linked; the typo ACECS1498 is read', p.jobs.find((j) => j.monday_id === 7)?.number === null && p.jobs.find((j) => j.monday_id === 7)?.enquiry === 4 && p.jobs.find((j) => j.monday_id === 9)?.number === 1498);
const j2551 = p.jobs.find((j) => j.number === 2551)!, j2554 = p.jobs.find((j) => j.number === 2554)!, j801 = p.jobs.find((j) => j.number === 801)!;
ok('jobs linked to their enquiry (link column or ACE number in the name)', j2551.enquiry === 13343252500 && j2551.customer === 'cardogroup' && j2551.price === 5000 && j2551.rent_pct === 4 && j2554.enquiry === 13343252500 && j2554.stage === 'booking' && j2551.site === j2554.site, [j2551, j2554]);
ok('old job: customer, site, price and dates from its own columns', j801.customer === 'aceconstruction' && j801.stage === 'down' && j801.hire_weeks === 12 && j801.price === 1300 && j801.up_start === '2022-10-20' && j801.up_end === '2022-10-21' && j801.down_date === '2022-11-16' && j801.title === '2 Lewes Road, Halland, Lewes, BN8 6PN', j801);

ok('customer form', (() => { const v = customerFields({ name: '  Cardo  Group ', kind: 'trade', email: ' a@b.c ' }, true); return v.ok && v.fields.name === 'Cardo Group' && v.fields.name_key === 'cardogroup' && v.fields.email === 'a@b.c'; })() && !customerFields({ name: '' }, true).ok && !customerFields({ name: 'X', kind: 'vip' }, true).ok && customerFields({ phone: '1' }, false).ok);

if (fail) { console.error(fail + ' scaffolding check(s) failed'); process.exit(1); }
console.log('scaffolding: all checks passed');
