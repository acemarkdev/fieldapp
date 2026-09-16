// Run: npx tsx packages/shared/src/mapping.test.ts
import {
  clampDim, floorLabel, buildFloors, levelSeg, levelOf, buildItemCode,
  buildGrid, tallyGrid, preloadRows, expandCouple, mappingItemRecords,
} from './mapping';

let pass = 0, fail = 0;
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

// clampDim
eq('clamp default', clampDim(undefined), 1);
eq('clamp min', clampDim(0), 1);
eq('clamp max', clampDim(999), 60);
eq('clamp normal', clampDim('3'), 3);

// floorLabel / buildFloors — GF first
eq('floorLabel 1 = GF', floorLabel(1), 'GF');
eq('floorLabel 2 = F1', floorLabel(2), 'F1');
eq('buildFloors 3', buildFloors(3), ['GF', 'F1', 'F2']);
eq('buildFloors clamps', buildFloors(0), ['GF']);

// levelSeg
eq('levelSeg num', levelSeg('1'), 'F1');
eq('levelSeg F-num', levelSeg('F1'), 'F1');
eq('levelSeg 11', levelSeg('11'), 'F11');
eq('levelSeg GF', levelSeg('GF'), 'GF');
eq('levelSeg label', levelSeg('gf'), 'GF');
eq('levelSeg empty', levelSeg(''), '');

// levelOf — flat wins over floor
eq('levelOf flat', levelOf('GF', '11'), '11');
eq('levelOf floor', levelOf('GF', ''), 'GF');

// buildItemCode — matches office server output
eq('code floor', buildItemCode({ client: 'AXS', job: 'LAB', block: 'b1', elevation: 'e1', floor: '1', item: 'w5' }),
  'AXS.LAB.B1.E1.F1.W5');
eq('code with room', buildItemCode({ client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1', floor: '1', room: 'LR', item: 'W5' }),
  'AXS.LAB.B1.E1.F1.LR.W5');
eq('code flat overrides floor', buildItemCode({ client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1', floor: 'GF', flat: '11', room: 'BA', item: 'W01' }),
  'AXS.LAB.B1.E1.F11.BA.W01');
eq('code GF', buildItemCode({ client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1', floor: 'GF', item: 'D1' }),
  'AXS.LAB.B1.E1.GF.D1');
eq('code skips empty', buildItemCode({ client: 'AXS', job: 'LAB', item: 'W1' }), 'AXS.LAB.W1');

// buildGrid
const grid = buildGrid({ block: 'b1', nElevations: 2, nFloors: 2 });
eq('grid block upper', grid.block, 'B1');
eq('grid elevations', grid.elevations.map((e) => e.elevation), ['E1', 'E2']);
eq('grid floors GF first', grid.elevations[0].floors.map((f) => f.floor), ['GF', 'F1']);
eq('grid cells zeroed', grid.elevations[0].floors[0], { floor: 'GF', windows: 0, doors: 0 });

// tally
grid.elevations[0].floors[0].windows = 3; // E1 GF: 3 windows
grid.elevations[0].floors[0].doors = 1;   // E1 GF: 1 door
grid.elevations[1].floors[1].windows = 2; // E2 F1: 2 windows
eq('tally', tallyGrid(grid), { windows: 5, doors: 1, items: 6 });

// preloadRows — W1..Wn / D1..Dn per floor, carrying elevation+floor
const rows = preloadRows(grid);
eq('preload count = items', rows.length, 6);
eq('preload first window', rows[0], { block: 'B1', elevation: 'E1', floor: 'GF', flat: '', item: 'W1', item_type: 'Window' });
eq('preload door after windows', rows[3], { block: 'B1', elevation: 'E1', floor: 'GF', flat: '', item: 'D1', item_type: 'Door' });
eq('preload E2 window', rows[4], { block: 'B1', elevation: 'E2', floor: 'F1', flat: '', item: 'W1', item_type: 'Window' });
// full codes derived from preload rows
eq('preload -> code', buildItemCode({ client: 'AXS', job: 'LAB', ...rows[0] }), 'AXS.LAB.B1.E1.GF.W1');

// empty grid -> no rows
eq('empty grid rows', preloadRows(buildGrid({ block: 'B1', nElevations: 1, nFloors: 1 })).length, 0);

// expandCouple
eq('couple 2', expandCouple('W3', 2), ['W3.1', 'W3.2']);
eq('couple upper', expandCouple('w3', 3), ['W3.1', 'W3.2', 'W3.3']);
eq('couple empty', expandCouple('', 2), []);

// mappingItemRecords — mirrors the office /mapping-items endpoint
const g2 = buildGrid({ block: 'B1', nElevations: 1, nFloors: 1 });
g2.elevations[0].floors[0].windows = 2; // E1 GF: W1, W2
g2.elevations[0].floors[0].doors = 1;   // E1 GF: D1
const recs = mappingItemRecords(g2, { client_code: 'AXS', job_code: 'LAB', tenant_id: 'T1', job_id: 'J1', createdBy: 'U1' });
eq('records count', recs.length, 3);
eq('record shape', recs[0], {
  kind: 'item', stage: 'scanned', block: 'B1', elevation: 'E1', floor: 'GF', flat: null,
  item_code: 'W1', item_type: 'Window', full_code: 'AXS.LAB.B1.E1.GF.W1', created_via: 'mapping',
  tenant_id: 'T1', job_id: 'J1', created_by: 'U1', scanned_by: 'U1',
});
eq('record door', recs[2].full_code, 'AXS.LAB.B1.E1.GF.D1');
eq('record door type', recs[2].item_type, 'Door');
// no createdBy -> no created_by/scanned_by keys
const recNoUser = mappingItemRecords(g2, { client_code: 'AXS', job_code: 'LAB' })[0];
eq('no createdBy omits keys', 'created_by' in recNoUser, false);
eq('no tenant omits key', 'tenant_id' in recNoUser, false);

console.log(`mapping.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
