// Offline verification of the field->column mapping.
// Fixture columns mirror the real ACE board; we assert the built column values
// exactly match what we verified live on the test board — no token required.
import assert from 'node:assert';
import { buildColumnValues } from './mapItem';
import { sampleSurveyItem } from './sampleItem';
import type { MondayColumn } from './monday';

const cols: MondayColumn[] = [
  { id: 'text_mm478htw', title: 'Block', type: 'text', settings: {} },
  { id: 'text_mm47nmaz', title: 'Elevation', type: 'text', settings: {} },
  { id: 'text_mm2tygmv', title: 'Flat / Plot No.', type: 'text', settings: {} },
  { id: 'text_mm473dcx', title: 'Room', type: 'text', settings: {} },
  { id: 'text_mm47qm0v', title: 'Item', type: 'text', settings: {} },
  { id: 'text_mm2taqfh', title: 'Floor', type: 'text', settings: {} },
  { id: 'dropdown_mm2t36sv', title: 'Material', type: 'dropdown', settings: { labels: [{ id: 3, label: 'PVC' }, { id: 8, label: 'Timber' }] } },
  { id: 'text_mm2vwx76', title: 'Item Type', type: 'text', settings: {} },
  { id: 'text_mm5d81wr', title: 'Glass', type: 'text', settings: {} },
  { id: 'text_mm2thyc4', title: 'Safety Glass', type: 'text', settings: {} },
  { id: 'numeric_mm2tv0dh', title: 'Width', type: 'numbers', settings: {} },
  { id: 'numeric_mm2tenbf', title: 'Height (inc Cill)', type: 'numbers', settings: {} },
  { id: 'text_mm3h4zh8', title: 'Cill Depth', type: 'text', settings: {} },
  { id: 'numeric_mm47tcx1', title: 'Transom 1 (from top)', type: 'numbers', settings: {} },
  { id: 'numeric_mm47j68k', title: 'Mullion 1 (from left)', type: 'numbers', settings: {} },
  { id: 'text_mm47zrn7', title: 'Open In / Open Out', type: 'text', settings: {} },
  { id: 'text_mm3hew2f', title: 'Add-Ons Required', type: 'text', settings: {} },
  { id: 'text_mm48en93', title: 'Coupled', type: 'text', settings: {} },
  { id: 'long_text_mm476bpn', title: 'Comments', type: 'long_text', settings: {} },
  { id: 'long_text_mm4mwg2f', title: 'Full Location Ref', type: 'long_text', settings: {} },
  { id: 'dropdown_mm4wd0nr', title: 'Fitters', type: 'dropdown', settings: { labels: [{ id: 1, label: 'Team P01' }, { id: 2, label: 'Team P02' }] } },
  { id: 'color_mm4ksrf6', title: 'Install Status', type: 'status', settings: { labels: { '0': 'Scheduled', '1': 'Installed no snag' } } },
  // Two read-only mirror columns ALSO titled "Install Status" — must be ignored.
  { id: 'lookup_mm495tn2', title: 'Install Status', type: 'mirror', settings: {} },
  { id: 'lookup_mm49jq7q', title: 'Install Status', type: 'mirror', settings: {} },
  { id: 'numeric_mm2sfm07', title: 'Labour Cost', type: 'numbers', settings: {} },
];

const out = buildColumnValues(cols, { item: sampleSurveyItem(), teamName: 'Team P01', ratePounds: 80 });

let n = 0;
const check = (id: string, expected: unknown) => {
  assert.deepStrictEqual(out[id], expected, `column ${id}`);
  n++; console.log('  ✓', id, '=', JSON.stringify(out[id]));
};

check('text_mm478htw', 'B1');                         // Block
check('text_mm2tygmv', '21');                         // Flat
check('text_mm473dcx', 'LR');                         // Room
check('dropdown_mm2t36sv', { labels: ['PVC'] });      // Material dropdown
check('numeric_mm2tv0dh', '1180');                    // Width
check('numeric_mm47tcx1', '450');                     // Transom 1
check('dropdown_mm4wd0nr', { labels: ['Team P01'] }); // Fitters dropdown (label matched case/space-insensitively)
check('color_mm4ksrf6', { label: 'Scheduled' });      // Install Status
check('long_text_mm4mwg2f', 'AXS.LAB.B1.E1.F21.LR.W02.F1'); // Full Location Ref
check('numeric_mm2sfm07', '80');                      // Labour Cost  <-- the money shot

// Titles not on the board must be skipped, not guessed.
assert.strictEqual(out['glazing'], undefined);
// Read-only mirror columns that share a title must never be written.
assert.strictEqual(out['lookup_mm495tn2'], undefined);
assert.strictEqual(out['lookup_mm49jq7q'], undefined);
console.log('  ✓ mirror "Install Status" columns correctly ignored');

console.log(`\nAll ${n} mapping assertions passed — output matches the live board.`);
