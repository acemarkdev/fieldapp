// Run: npx tsx src/lib/crewLogic.test.ts
import { officeUrl, addDays, dayLabel, signaturePath, segments, canHandOver, mapsUrl } from './crewLogic';
let fail = 0;
const ok = (n: string, c: boolean, g?: unknown) => { if (!c) { fail++; console.error('✗ ' + n, g === undefined ? '' : JSON.stringify(g)); } };
ok('office address', officeUrl(undefined, 'https://swvquulcchcwyyhpjfsm.supabase.co') === 'https://office.acemark.com.pl' && officeUrl(undefined, 'https://kmmnlbksxncdzlorobcc.supabase.co') === 'https://office-test.acemark.com.pl' && officeUrl('https://x.test/', '') === 'https://x.test');
ok('day labels', dayLabel('2026-10-22', '2026-10-22') === 'Today' && dayLabel('2026-10-23', '2026-10-22') === 'Tomorrow' && dayLabel('2026-10-26', '2026-10-22') === 'Mon 26/10' && addDays('2026-10-31', 1) === '2026-11-01');
ok('signature path', signaturePath([[{ x: 10.4, y: 10 }, { x: 20, y: 30.6 }], [{ x: 5, y: 5 }]], 320, 150) === 'svg:320x150:M10 10 L20 31' && signaturePath([], 320, 150) === null);
const sg = segments([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
ok('segments', sg.length === 2 && sg[0].len === 10 && sg[0].deg === 0 && sg[1].deg === 90 && sg[1].cx === 10 && sg[1].cy === 5);
ok('handover candidates', canHandOver('erecting') && canHandOver('booked') && !canHandOver('on_hire') && !canHandOver('down'));
ok('maps', mapsUrl('4-8 Tilbury Way, Brighton', true).startsWith('http://maps.apple.com/?q=4-8%20Tilbury') && mapsUrl('x', false).startsWith('https://www.google.com/maps/'));
if (fail) { console.error(fail + ' crew check(s) failed'); process.exit(1); }
console.log('crewLogic: all checks passed');
