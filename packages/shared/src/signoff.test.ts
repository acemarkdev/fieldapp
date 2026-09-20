// Rollup tests for the install sign-off model. Run: npx tsx packages/shared/src/signoff.test.ts
import { rollupFlats } from './signoff';

let fail = 0;
const ok = (label: string, cond: boolean) => { if (!cond) { fail++; console.error('✗ ' + label); } else console.log('✓ ' + label); };

const rows = [
  { flat: '1', kind: 'item', install_status: 'installed_no_snag' },
  { flat: '1', kind: 'item', install_status: 'installed_snag' },   // installed, but carries a snag
  { flat: '1', kind: 'item', install_status: 'scheduled' },        // outstanding
  { flat: '2', kind: 'item', install_status: 'installed_no_snag' },
  { flat: '2', kind: 'snag', install_status: 'snag' },             // pure snag row — not install scope
  { flat: 'COM', kind: 'item', install_status: 'installed_no_snag' },
];
const r = rollupFlats(rows);
const byFlat = Object.fromEntries(r.map((x) => [x.flat, x]));

ok('flat 1 total = 3', byFlat['1'].total === 3);
ok('flat 1 installed = 2', byFlat['1'].installed === 2);
ok('flat 1 outstanding = 1', byFlat['1'].outstanding === 1);
ok('flat 1 snags = 1', byFlat['1'].snags === 1);
ok('flat 1 NOT ready (1 outstanding)', byFlat['1'].ready === false);

ok('flat 2 total = 1 (snag row excluded from scope)', byFlat['2'].total === 1);
ok('flat 2 snags = 1', byFlat['2'].snags === 1);
ok('flat 2 ready', byFlat['2'].ready === true);

ok('COM ready', byFlat['COM'].ready === true);
ok('flats sorted numerically', r.map((x) => x.flat).join(',') === '1,2,COM');

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll sign-off rollup tests passed.');
