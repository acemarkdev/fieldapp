// Run: npx tsx apps/mobile/src/lib/fieldLogic.test.ts
import { poShortName, poLocationLine, styleKey } from './itemName';
import { searchByFlat, groupByJobFlat, customersIn } from './scheduleSearch';
import { fitterTap, afterSnagRaised } from './fitterStatus';
import type { SchedRow } from './scheduleGrouping';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got ?? ''); } };

// Item name, as on the purchase order
ok('flat + room', poShortName({ flat: '26B', room_code: 'BA', item_code: 'W2' }) === 'Flat 26B Bathroom');
ok('room code is case-insensitive', poShortName({ flat: '12', room_code: 'kt' }) === 'Flat 12 Kitchen');
ok('unknown room code is shown as typed', poShortName({ flat: '3', room_code: 'XX' }) === 'Flat 3 XX');
ok('flat without a room', poShortName({ flat: ' 7 ' }) === 'Flat 7');
ok('no flat → item code', poShortName({ flat: '', item_code: 'D1', room_code: 'KT' }) === 'D1');
ok('location line', poLocationLine({ block: 'B4', elevation: 'E1', flat: '26B', floor: '2', room_code: 'BA', item_code: 'W2' }) === 'B4 · E1 · Flat 26B · Fl 2 · Bathroom · W2');
ok('location line skips blanks', poLocationLine({ block: 'B4', flat: null, item_code: 'W2' }) === 'B4 · W2');
ok('style key as stored', styleKey('24', { '24': 1 }) === '24');
ok('style key with the word Style', styleKey('Style 24', { '24': 1 }) === '24');
ok('unknown style → none', styleKey('999', { '24': 1 }) === null && styleKey(null, { '24': 1 }) === null);

// Flat search on the schedule
const row = (id: string, flat: string | null, status: string | null, job = 'j1', client = 'AXS', date: string | null = null): SchedRow =>
  ({ id, full_code: id, room_code: 'BA', item_code: 'W1', flat, block: null, item_type: 'Window', kind: 'item', install_status: status, planned_install_date: date, job_id: job, jobs: { client_code: client, job_code: job.toUpperCase(), name: 'Site ' + job } });
const R = [
  row('a', '26', 'scheduled'), row('b', '26B', 'scheduled'), row('c', '26', 'installed_no_snag'), row('d', '126', 'scheduled'),
  row('e', '26', 'scheduled', 'j2', 'PCC', '2026-10-09'), row('f', '2', 'scheduled'), row('g', null, 'scheduled'), row('h', '26', 'delayed'),
  row('i', 'Flat 26', 'scheduled', 'j3', 'AXS', '2026-10-08'),
];
const ids = (x: SchedRow[]) => x.map((r) => r.id).join(',');
ok('empty query → nothing', searchByFlat(R, '  ').length === 0);
ok('only scheduled items, exact flat first, then 26B; not 126 or 2', ids(searchByFlat(R, '26')) === 'i,e,a,b', ids(searchByFlat(R, '26')));
ok('typing "flat 26" works too', ids(searchByFlat(R, 'Flat 26')) === 'i,e,a,b');
ok('case and spaces ignored', ids(searchByFlat(R, ' 26b ')) === 'b');
ok('no match', searchByFlat(R, '99').length === 0);
ok('does not change the input list', R[0].id === 'a' && R.length === 9);
const G = groupByJobFlat(searchByFlat(R, '26'));
ok('one group per job + flat; a flat stored as "Flat 26" is not doubled', G.length === 4 && G[0].title === 'Site j3 · Flat 26', G.map((g) => g.title));
ok('group titles carry site and flat', G.some((g) => g.title === 'Site j1 · Flat 26') && G.some((g) => g.title === 'Site j1 · Flat 26B') && G.some((g) => g.title === 'Site j2 · Flat 26'), G.map((g) => g.title));
ok('customers found', customersIn(searchByFlat(R, '26')).join(',') === 'AXS,PCC');

// Fitter buttons
ok('Installed', JSON.stringify(fitterTap('installed', 'scheduled', false, '2026-10-06')) === JSON.stringify({ undo: false, change: { install_status: 'installed_no_snag', actual_install_date: '2026-10-06' } }));
ok('Installed on an item with a snag stays Installed + snag', fitterTap('installed', 'delayed', true, '2026-10-06').change.install_status === 'installed_snag');
ok('tapping Installed again undoes it', (() => { const r = fitterTap('installed', 'installed_no_snag', false, '2026-10-06'); return r.undo && r.change.install_status === 'scheduled' && r.change.actual_install_date === null; })());
ok('Installed + snag counts as the Installed button being on', fitterTap('installed', 'installed_snag', true, '2026-10-06').undo === true);
ok('lit Installed always offers undo, even if the snag flag disagrees with the status', fitterTap('installed', 'installed_no_snag', true, '2026-10-06').undo === true && fitterTap('installed', 'installed_snag', false, '2026-10-06').undo === true);
ok('Delayed clears the install date', (() => { const r = fitterTap('delayed', 'installed_no_snag', false, '2026-10-06'); return !r.undo && r.change.install_status === 'delayed' && r.change.actual_install_date === null; })());
ok('tapping Delayed again undoes it', fitterTap('delayed', 'delayed', false, '2026-10-06').undo === true);
ok('snag raised → Installed + snag today', JSON.stringify(afterSnagRaised(null, '2026-10-06')) === JSON.stringify({ install_status: 'installed_snag', actual_install_date: '2026-10-06' }));
ok('snag raised keeps an earlier install date', afterSnagRaised('2026-10-01', '2026-10-06').actual_install_date === '2026-10-01');

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All field-logic tests passed.');
