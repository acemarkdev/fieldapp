// Run: npx tsx apps/api/src/styleSketch.test.ts
import { styleSketchKey, sketchToPush, hasStyleSketch, readStyleSketch } from './styleSketch';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got ?? ''); } };
const has = (k: string) => k === '24' || k === '7';

ok('plain code', styleSketchKey('24') === '24');
ok('with the word Style', styleSketchKey('Style 24') === '24' && styleSketchKey('style24') === '24' && styleSketchKey('  STYLE  24 ') === '24');
ok('blank → none', styleSketchKey('') === null && styleSketchKey(null) === null && styleSketchKey('Style') === null);
ok('path tricks refused', styleSketchKey('../../etc/passwd') === null && styleSketchKey('a/b') === null && styleSketchKey('..') === null);

ok('first sync of a styled item → upload', sketchToPush({ kind: 'item', design_code: '24', style_sketch_pushed: null }, has) === '24');
ok('already sent for this style → nothing', sketchToPush({ kind: 'item', design_code: 'Style 24', style_sketch_pushed: '24' }, has) === null);
ok('style changed → upload the new one', sketchToPush({ kind: 'item', design_code: '7', style_sketch_pushed: '24' }, has) === '7');
ok('no style → nothing', sketchToPush({ kind: 'item', design_code: null, style_sketch_pushed: null }, has) === null);
ok('style not in the catalogue → nothing', sketchToPush({ kind: 'item', design_code: '999', style_sketch_pushed: null }, has) === null);
ok('snag rows never get a drawing', sketchToPush({ kind: 'snag', design_code: '24', style_sketch_pushed: null }, has) === null);
ok('tracking column missing (migration not run) → nothing, so re-syncs cannot pile up copies', sketchToPush({ kind: 'item', design_code: '24' }, has) === null);

// The real catalogue ships with the repo.
ok('catalogue has drawing 1 and it is a PNG', hasStyleSketch('1') && (() => { const b = readStyleSketch('1'); return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; })());
ok('catalogue has no drawing "nope"', !hasStyleSketch('nope'));

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All style-sketch tests passed.');
