// Run: npx tsx apps/api/src/mondayEnquiries.test.ts
import { customerFromName, orderStatusOf, offerSent, planEnquiries, boardEnquiry, type EnqItem } from './mondayEnquiries';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// customer from the item name
ok('customer between dashes', customerFromName('OK PL203183 -Sternbau- BV Wagner') === 'Sternbau', customerFromName('OK PL203183 -Sternbau- BV Wagner'));
ok('customer with spaces around the dash', customerFromName('OK PL203186 - Sternbau  - Inneverglasung') === 'Sternbau', customerFromName('OK PL203186 - Sternbau  - Inneverglasung'));
ok('a Z number is skipped', customerFromName('OK PL203179 - Z.447 - Grange House ( WM Windows )') === 'Grange House ( WM Windows )', customerFromName('OK PL203179 - Z.447 - Grange House ( WM Windows )'));
ok('SSE with an ID', customerFromName('OK DEES203185 -SSE- ID42284') === 'SSE', customerFromName('OK DEES203185 -SSE- ID42284'));
ok('postcode with a dash stays', customerFromName('OK PL203182 -Przemysław Płaza- 05-080 Klaudyn') === 'Przemysław Płaza', customerFromName('OK PL203182 -Przemysław Płaza- 05-080 Klaudyn'));

// statuses
ok('won → accepted, lost / dead → lost, else offer', orderStatusOf('5. Wygrana', null) === 'accepted' && orderStatusOf('6. Stracona', null) === 'lost' && orderStatusOf('3.2 Przesłana do klienta', 'Dead Enquiries') === 'lost' && orderStatusOf('3. Wysłane do wyceny', 'Live Enquiries') === 'offer');
ok('ticked when the offer reached the client or is decided', offerSent('3.2 Przesłana do klienta', null) && offerSent('4. Monitorowane', null) && offerSent('5. Wygrana', null) && !offerSent('3. Wysłane do wyceny', 'Live Enquiries') && !offerSent('3.1 Wycenione', null) && !offerSent('2. W trakcie', null));

// column texts → item
const bi = boardEnquiry({ id: '1', name: ' OK PL1  x ', group: 'Live Enquiries', created_at: '2026-10-22T15:45:27Z', cols: { status_13: '5. Wygrana', color_mkzmrnw1: 'Produkcja', person: 'Tomasz Hojnacki', connect_boards1: '', color_mm4c485v: null, board_relation5: 'Z.453 -OK PL1' } });
ok('board item read', bi.name === 'OK PL1 x' && bi.created === '2026-10-22' && bi.contact === null && bi.kind === 'Produkcja', bi);

// the plan
const it = (id: string, name: string, o: Partial<EnqItem> = {}): EnqItem => ({ id, name, group: 'Live Enquiries', created: '2026-10-01', status: '3.2 Przesłana do klienta', kind: null, person: null, contact: null, crm: null, linked: null, ...o });
const reps = [{ id: 'r1', name: 'Tomasz Hojnacki' }];
const rows = planEnquiries([
  it('a', 'OK PL203186 - Sternbau - Inneverglasung', { kind: 'Produkcja', person: 'Natalia Cieloch, Tomasz Hojnacki' }),
  it('b', 'OK PL203175 -Nowak'),                                     // already in Sales orders
  it('c', 'OK PL203100 - rev 1'), it('d', 'OK PL203100 - rev 2'),    // twice on the board
  it('e', 'Radek test'),
  it('f', 'OK PL203190 - Kowalski', { status: '3. Wysłane do wyceny' }),
  it('g', 'OK PL203179 - Z.447 - Grange House', { status: '5. Wygrana', group: 'Tomasz Hojnacki' }),
  it('h', 'OK DEES203185 -SSE- ID42284', { linked: 'Z.453 -OK DEES203185 -SSE-', crm: 'SSE', contact: 'Hans Müller' }),
], [{ order_ref: 'ok pl203175 Nowak' }, { order_ref: 'Z.330' }], reps);
const R = (id: string) => rows.find((r) => r.id === id)!;
ok('new order, rep from the person column, Produkcja → supplier Acemark PL', R('a').state === 'new' && R('a').order?.repId === 'r1' && R('a').order?.supplier === 'Acemark PL' && R('a').order?.customer === 'Sternbau', R('a'));
ok('already in Sales orders → in_office (case and spaces aside)', R('b').state === 'in_office' && R('b').existing === 'ok pl203175 Nowak', R('b'));
ok('OK number twice on the board → duplicate', R('c').state === 'duplicate' && R('d').state === 'duplicate');
ok('no OK number → no_ok', R('e').state === 'no_ok');
ok('still being priced → pricing (not ticked)', R('f').state === 'pricing' && R('f').order?.status === 'offer');
ok('won, Z from the name, rep from the group', R('g').state === 'new' && R('g').order?.status === 'accepted' && R('g').order?.job === 'Z.447' && R('g').order?.rep === 'Tomasz Hojnacki', R('g'));
ok('Z from the linked production item; customer from My Contacts first', R('h').order?.job === 'Z.453' && R('h').order?.customer === 'Hans Müller', R('h'));

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('mondayEnquiries ok');
