// Run: npx tsx apps/mobile/src/lib/importModel.test.ts
import { parseImportAoa, importItemRecords, isRowComplete, missingRequired, toMm, roomToCode, normSafety } from './importModel';

let pass = 0, fail = 0;
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

// helpers
eq('toMm mm suffix', toMm('640mm'), 640);
eq('toMm blank', toMm(''), null);
eq('room name -> code', roomToCode('Living room'), 'LR');
eq('room code passthrough', roomToCode('ba'), 'BA');
eq('safety yes', normSafety('yes'), 'Yes');
eq('safety n/a', normSafety('N/A'), '');

// completeness
const fullRow = { block: 'B1', elevation: 'E1', flat: '', floor: 'GF', room: 'LR', item: 'W1', material: 'PVC', item_type: 'Casement', glass: 'Clear', glazing: 'Double', width_mm: '640', height_mm: '560', open_in_out: 'Out', design_code: '27' };
eq('full complete', isRowComplete(fullRow), true);
eq('missing style', missingRequired({ ...fullRow, design_code: '' }), ['design_code']);
eq('missing level', missingRequired({ ...fullRow, floor: '', flat: '' }), ['flat/floor']);

// parse an AOA (header row + example row + two data rows)
const aoa: any[][] = [
  ['Area/Council', 'Site', 'Block', 'Elevation', 'Flat/Plot no', 'Floor', 'Room', 'Item', 'Material', 'Item type', 'Glass', 'Glazing', 'Width', 'Height inc cill', 'Open in/open out', 'Design code'],
  ['e.g. AXS', 'e.g. LAB', 'B1', 'E1', '', 'GF', 'Living room', 'W1', 'PVC', 'Casement', 'Clear', 'Double', '640', '560', 'Out', '27'], // example row -> skipped
  ['AXS', 'LAB', 'B1', 'E1', '', 'GF', 'Living room', 'W1', 'PVC', 'Casement', 'Clear', 'Double', '640', '560', 'Out', '27'],
  ['AXS', 'LAB', 'B1', 'E1', '', 'F1', 'Bathroom', 'W2', 'PVC', 'Casement', '', 'Double', '', '560', 'Out', ''], // missing glass, width, design -> unfinished
  ['DER', 'SRE', 'B1', 'E1', '', 'GF', 'Kitchen', 'W3', 'PVC', 'Casement', 'Clear', 'Double', '600', '600', 'Out', '27'], // area mismatch
];
const parsed = parseImportAoa(aoa, { jobClient: 'AXS', jobCode: 'LAB' });
eq('parsed rows', parsed.rows.length, 3);
eq('parsed mismatch', parsed.mismatch, 1);
eq('parsed room mapped', parsed.rows[0].room, 'LR');
eq('example skipped (first is real W1)', parsed.rows[0].item, 'W1');

// records
const recs = importItemRecords(parsed.rows, { client_code: 'AXS', job_code: 'LAB', tenant_id: 'T1', job_id: 'J1', createdBy: 'U1' });
eq('records count', recs.length, 3);
eq('rec0 full code', recs[0].full_code, 'AXS.LAB.B1.E1.GF.LR.W1');
eq('rec0 complete', recs[0].incomplete, false);
eq('rec0 width parsed', recs[0].width_mm, 640);
eq('rec0 from_import', recs[0].from_import, true);
eq('rec1 unfinished', recs[1].incomplete, true);
eq('rec1 code', recs[1].full_code, 'AXS.LAB.B1.E1.F1.BA.W2');

// header not found
eq('no header error', !!parseImportAoa([['foo', 'bar']], { jobClient: 'AXS', jobCode: 'LAB' }).error, true);

console.log(`importModel.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
