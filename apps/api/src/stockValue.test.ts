// Run: npx tsx apps/api/src/stockValue.test.ts
import { bucketOf, daysBetween, lotFromAgent, summarise, lotValue, TOTAL, type Lot } from './stockValue';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('days between', daysBetween('2026-10-01', '2026-10-17') === 16 && daysBetween('2025-10-17', '2026-10-17') === 365);
const day = '2026-10-17';
ok('buckets at their edges', bucketOf('2026-07-19', day) === 0 && bucketOf('2026-07-18', day) === 1 && bucketOf('2026-04-20', day) === 1 && bucketOf('2026-04-19', day) === 2
  && bucketOf('2025-10-17', day) === 2 && bucketOf('2025-10-16', day) === 3 && bucketOf('2024-10-17', day) === 3 && bucketOf('2024-10-16', day) === 4, [bucketOf('2026-07-19', day), bucketOf('2026-04-20', day), bucketOf('2025-10-17', day), bucketOf('2024-10-17', day)]);
ok('unknown date is the oldest bucket', bucketOf(null, day) === 4);

// rows as the agent sends them (Acemark PL, October 2026)
const a = lotFromAgent({ lot: 158670, product_id: 115103, symbol: '1028200', name: 'Podkładka dystansowa 100x28x2', grp: '', supplier: 'CORTIZO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', unit: 'szt', warehouse: 'ACE', qty: '1854.000000', unit_cost: 0.1107, received: '2026-02-20', last_issue: null });
ok('agent lot', !!a && a.qty === 1854 && a.unit_cost === 0.1107 && a.grp === null && a.received === '2026-02-20' && a.last_issue === null, a);
ok('agent lot without quantity or id is dropped', lotFromAgent({ lot: 1, product_id: 2, symbol: 'X', qty: 0 }) === null && lotFromAgent({ product_id: 2, symbol: 'X', qty: 3 }) === null);
ok('a lot without cost is worth 0 (and kept)', lotValue({ qty: 5, unit_cost: null }) === 0);

const L = (lot_id: number, product_id: number, wh: string, qty: number, cost: number | null, received: string | null, supplier = 'CORTIZO'): Lot =>
  ({ lot_id, product_id, symbol: 'S' + product_id, name: null, grp: null, supplier, unit: 'szt', warehouse: wh, qty, unit_cost: cost, received, last_issue: null });
const lots = [L(1, 10, 'ACE', 100, 1, '2026-10-01'), L(2, 10, 'ACE', 10, 2, '2025-01-01'), L(3, 11, 'PROD', 4, 25, '2023-01-01'), L(4, 12, 'ACE', 3, 10, '2026-06-01', 'DORMA')];
const h = summarise(lots, day);
const ace = h.find((r) => r.warehouse === 'ACE' && r.supplier === 'CORTIZO')!, prod = h.find((r) => r.warehouse === 'PROD')!;
ok('summary per warehouse and supplier', h.length === 3 && ace.products === 1 && ace.value === 120 && ace.b0 === 100 && ace.b3 === 20 && prod.b4 === 100, h);
const t = summarise(lots.map((l) => ({ ...l, warehouse: TOTAL, grp: null, supplier: null })), day)[0];
ok('day total', t.value === 250 && t.products === 3 && t.b0 + t.b1 + t.b2 + t.b3 + t.b4 === 250, t);

if (fail) { console.error(`${fail} stock value test(s) failed`); process.exit(1); }
console.log('All stock value tests passed');
