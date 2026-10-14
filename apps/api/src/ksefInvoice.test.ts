// Run: npx tsx apps/api/src/ksefInvoice.test.ts   (text in the layout of the KSeF PDF generator, as unpdf extracts it)
import { parseKsef, splitByOrder, plMoney } from './ksefInvoice';
import { allocatePurchases, assetIdOf, isTradeInvoice, type TradeInvoice } from './tradeCosts';
import { buildOrderViews, type OrderRow } from './finOrders';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const head = (no: string, kind: string) => `Krajowy System e-Faktur Numer Faktury:\n${no}\n${kind}\nNumer KSeF: 6391813241-20261013-X\nKod waluty: PLN\nPozycje\nFaktura wystawiona w walucie PLN\nLp. Nazwa towaru lub usługi Cena jedn.\nnetto\nIlość Miara Stawka\npodatku\nWartość sprzedaży\nnetto\nWartość sprzedaży\nvat\nUU_ID\n`;
const tail = `Lp. CN Indeks\n1 39252000 OKNO_PCV\nKwota należności ogółem: 1 PLN\n`;

ok('Polish amounts', plMoney('1 772,02') === 1772.02 && plMoney('-9 166,56') === -9166.56 && plMoney('0') === 0);

// A basic invoice: several orders, a line whose reference carries no OK number, a reference split over two rows,
// and a line whose "Ref." moved onto the next page behind the repeated column header.
const basic = head('FS/K2/26/10/0392', 'Faktura podstawowa') + [
  '1 Okno PVC', '770x770', 'WEB/26/1102459', 'Ref.: YUNUS dodatkowe', '558,58 1 szt 23% 558,58 128,47 26765408',
  '2 Okno PVC', '1200x1350', 'WEB/26/1202248', 'Ref.: OK DE202763- Umut', 'Kuzgunkaya-16.09.26', '984,90 1 szt 23% 984,90 226,53 26765409',
  '3 Okno PVC', '1080x1250', 'WEB/26/1202248', 'Ref.: OK DE202763- Umut', 'Kuzgunkaya-16.09.26', '886,01 2 szt 23% 1 772,02 407,56 26765410',
  '4 Roleta', '1080x1250', '685,18 2 szt 23% 1 370,36 315,18 26765414', '1 z 3',
  'Lp. Nazwa towaru lub usługi Cena jedn.', 'netto', 'Ilość Miara Stawka', 'podatku', 'Wartość sprzedaży', 'netto', 'Wartość sprzedaży', 'vat', 'UU_ID',
  'WEB/26/1202248', 'Ref.: OK DE202763- Umut', 'Kuzgunkaya-16.09.26',
  '5 Transport', 'WEB/26/7777777', 'Ref.: OK PL203158 - PCW - J035023P', '8 150,00 1 szt 23% 8 150,00 1 874,50 26765420',
].join('\n') + '\n' + tail;
const b = parseKsef(basic), bs = splitByOrder(b);
ok('basic: header facts', b.number === 'FS/K2/26/10/0392' && b.type === 'basic' && b.currency === 'PLN', b);
ok('basic: every line read, including one whose reference moved to the next page', b.lines.length === 5 && b.lines[3].order === 'OK DE202763' && b.lines[3].net === 1370.36 && b.lines[4].net === 8150, b.lines);
ok('basic: split by order, the line without an OK number left over', JSON.stringify(bs.allocations.map((a) => [a.order, a.net, a.lines])) === JSON.stringify([['OK DE202763', 4127.28, 3], ['OK PL203158', 8150, 1]]) && bs.unassigned.net === 558.58 && bs.total === 12835.86, bs);

// Settlement invoice: the advance comes off as a "Zaliczka" line that fits on one row; the goods are the cost.
const settle = head('FR/K2/26/10/0248', 'Faktura rozliczeniowa') + [
  '1 Zaliczka 9 166,56 -1 szt 23% -9 166,56 -2 108,31 26765336',
  '2 Okno PVC', '2900x2000', 'WEB/26/1201900', 'Ref.: OK DE203066- UNAL', '2 159,81 1 szt 23% 2 159,81 496,76 26765337',
  '3 Okno PVC', '1060x1177', 'WEB/26/1201900', '16 006,30 1 szt 23% 16 006,30 3 681,45 26765343',   // no Ref: same WEB number as line 2
].join('\n') + '\n' + tail;
const s = parseKsef(settle), ss = splitByOrder(s);
ok('settlement: the advance line is read and kept out of the cost', s.type === 'settlement' && s.lines.length === 3 && ss.advances === -9166.56, ss);
ok('settlement: a line without a reference takes the order of its WEB number; total = what is left to pay', ss.allocations.length === 1 && ss.allocations[0].order === 'OK DE203066' && ss.allocations[0].net === 18166.11 && ss.total === 8999.55 && !ss.unassigned.lines.length, ss);

// Correction: the "before" state (marked Tak) counts with a minus, the "after" state with a plus.
const corr = head('FSK/F13/26/08/0048', 'Faktura korygująca') + 'Numer faktury korygowanej: FS/K2/26/08/0722\n' + [
  '1 Okno PVC', 'WEB/26/0934496', 'Ref.: OK DE202999 - Orcun', '864,52 1 szt 23% 864,52 198,84 26153062 Tak',
  '2 Okno PVC', 'WEB/26/0934496', 'Ref.: OK DE202999 - Orcun', '1 107,52 1 szt 23% 1 107,52 254,73 26153064 Tak',
  '1 Okno PVC', 'WEB/26/0934496', 'Ref.: OK DE202999 - Orcun', '864,52 0 szt 23% 0 0 26153063',
  '2 Okno PVC', 'WEB/26/0934496', 'Ref.: OK DE202999 - Orcun', '1 107,52 1 szt 23% 1 107,52 254,73 26153065',
].join('\n') + '\n' + tail;
const c = parseKsef(corr), cs = splitByOrder(c);
ok('correction: before minus, after plus', c.type === 'correction' && c.corrects === 'FS/K2/26/08/0722' && c.lines.length === 4 && cs.total === -864.52 && cs.allocations[0].net === -864.52, cs);

// Advance invoice: not a cost — its order table is not read as lines.
const adv = head('FZ/F10/26/09/1260', 'Faktura zaliczkowa') + '1 Zaliczka 69 646,58 1 szt 23% 69 646,58 13 023,34 26602862\nZamówienie\n1 Okno PVC\nRef.: OK DE203098\n1 095,01 1 szt 23% 1 095,01 251,85\n' + tail;
ok('advance: no lines', parseKsef(adv).type === 'advance' && parseKsef(adv).lines.length === 0);
ok('not a KSeF invoice', parseKsef('Faktura VAT nr 12/2026\nRazem 100,00').type === 'unknown');

// monday file column and which invoices are trade
ok('asset id from the file column', assetIdOf('https://ace189144.monday.com/protected_static/7332973/resources/3315715118/13.10.2026%20-%20Eko-Okna%20-%20FS.K2.26.10.0392.pdf') === '3315715118' && assetIdOf('') === null && assetIdOf('https://x/resources/1/photo.jpg') === null);
ok('trade = 499.V Handel from 2026', isTradeInvoice({ subcategory: '499.V Handel', period_year: 2026 }) && !isTradeInvoice({ subcategory: '499 Handel', period_year: 2026 }) && !isTradeInvoice({ subcategory: '499.V Handel', period_year: 2025 }) && !isTradeInvoice({ subcategory: '499.V Handel', period_year: 2026, removed: true }));

// Invoices → cost per order
const inv = (id: string, o: Partial<TradeInvoice> = {}): TradeInvoice => ({ id, supplier: 'Eko-Okna', invoice_no: 'FS/' + id, invoice_date: '2026-10-13', net: 1000, order_ref: null, pdf_type: 'basic', pdf_status: 'ok', pdf_total: 1000, monday_item_id: 'm' + id, ...o });
const known = (code: string) => ['OK DE202763', 'OK DE203066', 'OK PL203158'].includes(code);
const L = (cost_id: string, net: number, order_code: string | null, advance = false, ref: string | null = null) => ({ cost_id, net, advance, order_code, ref, name: 'Okno' });
const r1 = allocatePurchases([inv('1')], [L('1', 600, 'OK DE202763'), L('1', 400, null, false, 'YUNUS dodatkowe')], known);
ok('lines with an order are placed; the rest is listed to check with its reference', r1.purchases.length === 1 && r1.purchases[0].net === 600 && r1.toCheck.length === 1 && r1.toCheck[0].reason === 'no_reference' && r1.toCheck[0].unassigned === 400 && r1.toCheck[0].refs[0] === 'YUNUS dodatkowe', r1);
const r2 = allocatePurchases([inv('1', { order_ref: 'OK PL203158' })], [L('1', 600, 'OK DE202763'), L('1', 400, null)], known);
ok('"Zlecenie" on the board takes the lines that have no order', r2.purchases.map((p) => p.order_code + ':' + p.net).sort().join() === 'OK DE202763:600,OK PL203158:400' && !r2.toCheck.length, r2);
ok('advance invoices and "Zaliczka" lines are never a cost', !allocatePurchases([inv('2', { pdf_type: 'advance', pdf_status: 'ok' })], [], known).purchases.length && allocatePurchases([inv('3')], [L('3', -500, null, true), L('3', 1500, 'OK DE203066')], known).purchases[0].net === 1500);
const r3 = allocatePurchases([inv('4', { pdf_status: 'not_ksef', order_ref: 'Idris' }), inv('5', { pdf_status: 'mismatch' }), inv('6', { pdf_status: 'no_pdf', order_ref: 'OK DE203066', net: 219.71 })], [L('5', 999, 'OK DE203066')], known);
ok('an unreadable or mismatching PDF: whole invoice to the "Zlecenie" order; a name there is reported as not an order', r3.purchases.length === 1 && r3.purchases[0].net === 219.71 && r3.purchases[0].from === 'zlecenie' && r3.toCheck.map((t) => t.reason).join() === 'unknown_order,mismatch', r3);
const r4 = allocatePurchases([inv('7')], [L('7', 300, 'OK DE999999')], known);
ok('an OK number that is not in the register is listed, not guessed', !r4.purchases.length && r4.toCheck[0].reason === 'unknown_order', r4);

const knownZ = (code: string) => ['OK DE203066', 'Z.339'].includes(code);
const r5 = allocatePurchases([inv('10', { pdf_status: null, order_ref: 'Z.339', net: 4382.57 }), inv('11', { pdf_status: null, order_ref: 'Buckingham' }), inv('12', { pdf_status: null })], [], knownZ);
ok('"Zlecenie" may hold a Z number; a name is not an order; an unread PDF says so', r5.purchases.length === 1 && r5.purchases[0].order_code === 'Z.339' && r5.toCheck.map((t) => t.reason).join() === 'unknown_order,not_read', r5);

// The order gets its actual cost
const order: OrderRow = { id: 'o1', rep_user_id: null, rep_name: null, company: 'Acemark', supplier: 'EKO_OKNA', material: 'PVC', customer: 'UNAL', order_ref: 'OK DE203066- UNAL BV: Fatma', job_ref: null, status: 'accepted', offer_year: 2026, offer_month: 9, enquiry_month: 9, net: 30000, cost_purchase: 17000, cost_install: 2000, cost_delivery: 1000, planned_year: null, planned_month: null, first_payment_date: null, invoice_refs: null, note: null, comment: null };
const pr = allocatePurchases([inv('8'), inv('9', { invoice_no: 'FR/K2/26/10/0248' })], [L('8', 500, 'OK DE203066'), L('9', 18166.11, 'OK DE203066')], known).purchases;
const v = buildOrderViews([order, { ...order, id: 'o2', order_ref: 'OK DE209999' }], [], [], [], pr);
ok('order: actual purchase from the invoices, actual margin with installation and delivery', v[0].actual_purchase === 18666.11 && v[0].actual_costs === 21666.11 && v[0].actual_margin === 0.28 && v[0].purchases.length === 2 && v[0].costs === 20000, [v[0].actual_purchase, v[0].actual_costs, v[0].actual_margin]);
ok('order without purchase invoices has no actual figures', v[1].actual_purchase === null && v[1].actual_margin === null && !v[1].purchases.length);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('ksefInvoice: all passed');
