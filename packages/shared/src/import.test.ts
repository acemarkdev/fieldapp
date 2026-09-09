// Run: npx tsx packages/shared/src/import.test.ts
import { isRowComplete, missingRequired, toMm } from './import';

let pass = 0, fail = 0;
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
}

// A fully-specified row (flat set) is complete.
const full = {
  block: 'B3', elevation: 'E1', flat: '16A', floor: 'F2', room: 'BA', item: 'W2',
  material: 'PVC', item_type: 'Casement', glass: 'Stipolite', glazing: 'Double',
  width_mm: 640, height_mm: 560, open_in_out: 'Out',
};
eq('full row complete', isRowComplete(full), true);
eq('full row nothing missing', missingRequired(full), []);

// Floor alone (no flat) still satisfies the level requirement.
const floorOnly = { ...full, flat: '' };
eq('floor-only complete', isRowComplete(floorOnly), true);

// Neither flat nor floor ⇒ missing level.
const noLevel = { ...full, flat: '', floor: '' };
eq('no level incomplete', isRowComplete(noLevel), false);
eq('no level lists flat/floor', missingRequired(noLevel).includes('flat/floor'), true);

// Missing dimensions ⇒ unfinished (matches the budget warning).
const noDims = { ...full, width_mm: '', height_mm: null };
eq('no dims incomplete', isRowComplete(noDims), false);
eq('no dims lists width+height', missingRequired(noDims), ['width_mm', 'height_mm']);

// Missing a core spec field ⇒ unfinished.
const noMaterial = { ...full, material: '   ' };
eq('blank material incomplete', isRowComplete(noMaterial), false);

// Optional fields absent ⇒ still complete.
const optionalGone = { ...full, add_ons: '', coupled: '', transom1_mm: '', design_code: '', comments: '', safety_glass: '', glazing_bars: '', window_type: '', cill_depth: '' };
eq('optionals absent still complete', isRowComplete(optionalGone), true);

// toMm parses mm strings, plain numbers, blanks.
eq('toMm 640', toMm(640), 640);
eq('toMm "640mm"', toMm('640mm'), 640);
eq('toMm "1,240 mm"', toMm('1,240 mm'), 1240);
eq('toMm blank', toMm(''), null);
eq('toMm junk', toMm('abc'), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
