// Run: npx tsx apps/api/src/perfStatutory.test.ts
import { writedownField, writedownByMonth, DEFAULT_WRITEDOWN } from './perfStatutory';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('default write-down: 1–2 y 50 %, over 2 y 100 %', JSON.stringify(DEFAULT_WRITEDOWN) === '[0,0,0,0.5,1]');
ok('typed % → shares', JSON.stringify(writedownField('0, 0, 10, 50, 100')) === '[0,0,0.1,0.5,1]' && JSON.stringify(writedownField([0, 0, 0, 0.5, 1])) === '[0,0,0,0.5,1]');
ok('wrong count or out of range → refused', writedownField('0,0,50,100') === null && writedownField('0,0,0,50,120') === null && writedownField('a,b,c,d,e') === null);

const E = (b3: number, b4: number) => ({ b: [1000, 1000, 1000, b3, b4] });
const w = writedownByMonth([E(2000, 1000), E(2000, 1500), null, E(1000, 1500)], E(1000, 1000), DEFAULT_WRITEDOWN);
// provisions: Dec 1500 → Jan 2000 → Feb 2500 → Mar no data → Apr 2000
ok('provision at each month end; none without history', JSON.stringify(w.provision) === '[2000,2500,null,2000]', w.provision);
ok('the month\'s cost is the change; a month without history costs 0 and the next compares with the last known', JSON.stringify(w.change) === '[500,500,0,-500]', w.change);
ok('no history before the first month → nothing booked in it', writedownByMonth([E(2000, 1000)], null, DEFAULT_WRITEDOWN).change[0] === 0);

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('perfStatutory ok');
