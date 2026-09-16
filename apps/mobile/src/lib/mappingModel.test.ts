// Run: npx tsx apps/mobile/src/lib/mappingModel.test.ts
// Guards that the mobile mirror stays in step with packages/shared/src/mapping.ts.
import { buildFloors, buildItemCode, buildGrid, tallyGrid, preloadRows, mappingItemRecords, bucketByProgramme } from './mappingModel';

let pass = 0, fail = 0;
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

eq('GF first', buildFloors(3), ['GF', 'F1', 'F2']);
eq('code floor', buildItemCode({ client: 'AXS', job: 'LAB', block: 'b1', elevation: 'e1', floor: '1', item: 'w5' }), 'AXS.LAB.B1.E1.F1.W5');
eq('code flat over floor', buildItemCode({ client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1', floor: 'GF', flat: '11', room: 'BA', item: 'W01' }), 'AXS.LAB.B1.E1.F11.BA.W01');

const g = buildGrid({ block: 'b1', nElevations: 2, nFloors: 2 });
g.elevations[0].floors[0].windows = 3;
g.elevations[0].floors[0].doors = 1;
g.elevations[1].floors[1].windows = 2;
eq('tally', tallyGrid(g), { windows: 5, doors: 1, items: 6 });
eq('preload count', preloadRows(g).length, 6);

const recs = mappingItemRecords(buildGrid2(), { client_code: 'AXS', job_code: 'LAB', tenant_id: 'T1', job_id: 'J1', createdBy: 'U1' });
eq('records count', recs.length, 3);
eq('record0', recs[0], {
  kind: 'item', stage: 'scanned', block: 'B1', elevation: 'E1', floor: 'GF', flat: null,
  item_code: 'W1', item_type: 'Window', full_code: 'AXS.LAB.B1.E1.GF.W1', created_via: 'mapping',
  tenant_id: 'T1', job_id: 'J1', created_by: 'U1', scanned_by: 'U1',
});
function buildGrid2() {
  const gg = buildGrid({ block: 'B1', nElevations: 1, nFloors: 1 });
  gg.elevations[0].floors[0].windows = 2;
  gg.elevations[0].floors[0].doors = 1;
  return gg;
}

// bucketByProgramme — Live (today/future) / Pending (none) / Done (past)
const jobs = [
  { id: 'a', programme_end: null },
  { id: 'b', programme_end: '2020-01-01' },
  { id: 'c', programme_end: '2999-01-01' },
  { id: 'd', programme_end: '2026-09-15' }, // == today -> live
];
const bk = bucketByProgramme(jobs, '2026-09-15');
eq('pending ids', bk.pending.map((j) => j.id), ['a']);
eq('done ids', bk.done.map((j) => j.id), ['b']);
eq('live ids', bk.live.map((j) => j.id), ['c', 'd']);

console.log(`mappingModel.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
