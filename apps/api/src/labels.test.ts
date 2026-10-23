// Run: npx tsx apps/api/src/labels.test.ts
import { parseCortizoList, isCortizoList, labelCopies, buildLabelsPdf, parseArchimede, labelPhoneKey, defaultLabelPhone } from './labels';
let fail = 0;
const ok = (n: string, c: boolean, g?: unknown) => { if (!c) { fail++; console.error('✗ ' + n, g === undefined ? '' : JSON.stringify(g)); } };
// lines as unpdf gives them for CortizoCad production lists (LP_0003 / LP_0078, October 2026)
const lines = [
  'PRODUCTION LIST NO:   ORDER:', 'LP 0003/10/2026   OK PL203092 - PCW - J034960P', 'Created: 01.10.2026 07:29:23   Qty of positions:update 15092026 Artur1   Surface [m2]:   9,5',
  'Client: Perfect Crystal Windows Ltd   Labor [hours]:constructions:   0,00   Weight [kg]:   80,5', 'OK PL203092 - PCW - J034960P update 15092026 Artur (1)   1 (5)   01.10.2026',
  'Quantity:   2', 'Pos. 1 Bi-Fold Plus;COR 80 Industrial - system "cieply" 80mm. (B=3 510,', 'Surface:   9,48 m2', 'H=2 700)', 'Circuit:   17,74 m',
  'Quantity:   1', 'Pos. 2 Cor Vision - szyna pojedyncza (B=1 980, H=1 925)   Surface:   3,81 m2',
  'Quantity:   1', 'Pos. 3 Something odd',
];
ok('recognised as a CortizoCad list', isCortizoList(lines) && !isCortizoList(['WYDRUK PRODUKCYJNY', 'Z.123.2026 Job']));
const s = parseCortizoList(lines);
ok('header', s.format === 'cortizo' && s.order === 'LP 0003/10/2026' && s.job === 'OK PL203092 - PCW - J034960P update 15092026 Artur' && s.date === '01.10.2026' && s.client === 'Perfect Crystal Windows Ltd', s);
ok('positions (a wrapped size bracket, quantities)', s.positions.length === 3 && s.positions[0].w === 3510 && s.positions[0].h === 2700 && s.positions[0].qty === 2 && s.positions[0].config === 'Bi-Fold Plus;COR 80 Industrial - system "cieply" 80mm.' && s.positions[1].w === 1980 && s.positions[1].h === 1925, s.positions);
ok('a position without a size is flagged', s.positions[2].w === null && s.warnings.length === 1 && /Pos\. 3/.test(s.warnings[0]), s.warnings);
ok('archimede still archimede', parseArchimede(['Z.12.2026 Job']).format === 'archimede');
ok('copies: default 2, 1–8', labelCopies(undefined) === 2 && labelCopies('3') === 3 && labelCopies(0) === 2 && labelCopies(20) === 8 && labelCopies(1) === 1);
const pageCount = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const ten = Array.from({ length: 5 }, () => ({ w: 1000, h: 1200, ref: '' }));
ok('copies decide the sheets: 5 × 2 = 10 labels = 2 pages; 5 × 1 = 1 page; 5 × 4 = 3 pages', pageCount(await buildLabelsPdf({ title: 'x', labels: ten, logo: false, company: true, layout: 'acemark' })) === 2
  && pageCount(await buildLabelsPdf({ title: 'x', labels: ten, logo: false, company: true, layout: 'acemark', copies: 1 })) === 1 && pageCount(await buildLabelsPdf({ title: 'x', labels: ten, logo: true, company: true, copies: 4 })) === 3);
ok('a phone per company', labelPhoneKey('acemark') === 'label_phone_acemark' && labelPhoneKey('wem') === 'label_phone' && labelPhoneKey(undefined) === 'label_phone' && defaultLabelPhone('acemark') === '' && defaultLabelPhone('wem') === '+48 510 744 727');
const withPhone = await buildLabelsPdf({ title: 'x', labels: [{ w: 1, h: 2, ref: '' }], logo: false, company: true, layout: 'acemark', phone: '600100200' });
ok('the Acemark label prints the phone when set', withPhone.length > (await buildLabelsPdf({ title: 'x', labels: [{ w: 1, h: 2, ref: '' }], logo: false, company: true, layout: 'acemark', phone: '' })).length);
if (fail) { console.error(fail + ' label check(s) failed'); process.exit(1); }
console.log('labels: all checks passed');
