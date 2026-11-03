// Run: npx tsx apps/api/src/subiektMatch.test.ts   (examples are real Podtytuł texts and orders from prod)
import { docRefs, overheadReason, otherIncomeHint, suggest, linkFor, type OrderLite, type DocLite } from './subiektMatch';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
let seq = 0;
const doc = (symbol: string, subtitle: string | null, customer: string | null, net: number, notes: string | null = null): DocLite => ({ doc_id: ++seq, symbol, number: `${symbol} ${seq}/ACE/01/2026`, subtitle, notes, customer, net_pln: net });
const ord = (id: string, order_ref: string, o: Partial<OrderLite> = {}): OrderLite => ({ id, order_ref, job_ref: null, customer: 'Acemark Glazing Ltd.', net: null, status: 'accepted', invoice_refs: null, ...o });

// Reference numbers on a document
ok('references are read', docRefs('WEB/25/1579946 19/11/2025 EQ - L2025 12133 - Workplace Creati').join() === 'WEB251579946,L202512133', docRefs('WEB/25/1579946 19/11/2025 EQ - L2025 12133'));
ok('more references', docRefs('ZMAL/26/0021497 02/06/2026').join() === 'ZMAL260021497' && docRefs('PO-AG26-0466, PO-AG26-0473').length === 2 && docRefs('HLA49 – L2026 30562 - Marshgate Lane').join() === 'L202630562');
ok('no references in plain words', !docRefs('J.Sz. ').length && !docRefs('K O A R').length && !docRefs('na magazyn UK').length && !docRefs('BN1 3RJ - 12.05.26').length);

// Overhead reasons from an RW's Podtytuł
const r = (t: string) => overheadReason(t);
ok('overhead reasons', r('Próby na CNC') === 'trials' && r('próby na cnc') === 'trials' && r('Próby na zagniatarce') === 'trials' && r('na złom') === 'scrap' && r('Reklamacja PCW') === 'warranty' && r('UK - reklamacja') === 'warranty' && r('Idris pęknięta szyba') === 'warranty'
  && r('Wysyłka do UK') === 'shipment' && r('Do Anglii') === 'shipment' && r('UK Estimus') === 'shipment' && r('Niemcy') === 'shipment' && r('BRAK NA MAGAZYNIE') === 'stock' && r('Produkcja') === 'production' && r('Drzwi na halę') === 'production' && r('SSE sprzedaż') === 'other_income');
ok('a name or nothing is not an overhead', r('Idris') === null && r('Robert') === null && r('') === null && r('Dominik Holadnia') === null);
ok('scrap and zero-value sales are other income', otherIncomeHint(doc('FS', null, 'MAREK KURGANIAK PPHU', 6260, 'Złom aluminium')) && otherIncomeHint(doc('FS', null, 'JEŻYK STACJA DEMONTAŻU POJAZDÓW DAWID NOWAK', 650)) && otherIncomeHint(doc('FL', 'OF/25/2302644', 'Anna Piwowar', 0)) && otherIncomeHint(doc('FS', 'J.Sz. ', 'Acemark Glazing Ltd.', 13560, 'Prowizja - wrzesień 2026 J.Sz. ')) && !otherIncomeHint(doc('FS', null, 'WEM SPÓŁKA', 9496)));

// Suggestions
const orders = [
  ord('A', 'EQ - L2025 12462 -3Sphere - 80 Buckingham Road, Brighton', { net: 316453 }),
  ord('B', 'L2025 12462 - 3Sphere - 80 Buckingham Road, Brighton, BN1 3RJ - Extern', { net: 363625 }),
  ord('C', 'OK DEUK202975-EQ - L2025 12462 -3Sphere - 80 Buckingham - Sash', { job_ref: 'Z.411', net: 28402 }),
  ord('D', 'web-26-0044846-OK-DEUK14012026-3-1. Pricing Request L2025 16840', { job_ref: 'Z.390', net: 4899 }),
  ord('E', 'OK PL202683 Acemark ZMAL', { net: 3540 }),
  ord('F', 'OK DE202991 - Aygün', { customer: 'Orcun Aygün', net: 64850 }),
  ord('G', 'OK DE202000 - old', { customer: 'Orcun Aygün', net: 100, status: 'lost' }),
];
const [s1, s2, s3, s4, s5, s6] = suggest([
  doc('FS', 'EQ - L2025 12462 - 3Sphere - 80 Buckingham Road, Brighton, BN1 3RJ', 'Acemark Glazing Ltd.', 152006.26),
  doc('FS', 'L2025 16840', 'Acemark Glazing Ltd.', 4899),
  doc('FS', 'J.Sz. ', 'Acemark Glazing Ltd.', 3537.89),
  doc('FL', 'WEB/26/0934496', 'Orcun Aygün', 32458.4),
  doc('RW', 'L2025 16840', null, 4891.88),
  doc('RW', 'Próby na CNC', null, 428),
], orders);
ok('a reference on several orders lists them all', s1.candidates.map((c) => c.order_id).join() === 'A,B,C' && s1.candidates.every((c) => c.why === 'reference'), s1.candidates);
ok('a reference on one order', s2.candidates.map((c) => c.order_id).join() === 'D');
ok('no reference: the customer with the amount within 3 %', s3.candidates.map((c) => c.order_id).join() === 'E' && s3.candidates[0].why === 'customer_amount', s3.candidates);
ok('no reference, no amount: the customer’s open orders (not lost ones)', s4.candidates.map((c) => c.order_id).join() === 'F' && s4.candidates[0].why === 'customer');
ok('an RW naming an order’s reference gets its Z job', s5.job === 'Z.390' && s5.overhead === null);
ok('an RW with an overhead word gets the reason', s6.overhead === 'trials' && !s6.candidates.length && s6.job === null);
const [s7] = suggest([doc('RW', 'SPRZEDAŻ FS 13/ACE/03/2026', null, 2323.6)], [], (no) => (no === 'FS 13/ACE/03/2026' ? 'Z.377' : null));
ok('an RW naming an invoice gets that invoice’s job', s7.job === 'Z.377', s7);

// How a link is stored
ok('an order with a Z number → the job', JSON.stringify(linkFor(orders[2], orders)) === '{"ref":"Z.411"}');
ok('an OK code only this order has → the code', JSON.stringify(linkFor(orders[4], orders)) === '{"ref":"OK PL202683"}');
ok('a code that only this order answers to → the code', JSON.stringify(linkFor(orders[1], orders)) === '{"ref":"L2025 12462"}');
ok('no code of its own → the invoice number on the order', JSON.stringify(linkFor(orders[0], orders)) === '{"invoiceRefs":true}');
const twins = [ord('T1', 'OK PL202950-EQ - first'), ord('T2', 'OK PL202950 - second')];
ok('a code two orders share → the invoice number on the order', JSON.stringify(linkFor(twins[0], twins)) === '{"invoiceRefs":true}');
const [sz] = suggest([doc('FS', 'Z.372, Z.384', 'Acemark Glazing Ltd.', 2997.06)], [ord('Z1', 'OK X', { job_ref: 'Z.372' }), ord('Z2', 'OK Y', { job_ref: 'Z.3720' })]);
ok('Z numbers on the document find the orders with those jobs (exactly)', sz.candidates.map((c) => c.order_id).join() === 'Z1', sz.candidates);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('subiektMatch: all passed');
