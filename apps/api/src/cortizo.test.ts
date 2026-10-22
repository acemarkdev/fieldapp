// Run: npx tsx apps/api/src/cortizo.test.ts
import { matchSymbol, matchCustomField, matchStock, refKeys, looksCortizo, stockFromAgent, barLengthMm, ownRef, ignored, colourOf, plainName, ownDesc, pieceMm, rowMetres, ignorePattern, type StockRow } from './cortizo';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const keys = refKeys(['COR-3808', 'COR-3810', 'COR-381020', '770224', '801515', '331817', '15919', '10417', '1405', 'COR-2015', 'COR-3735', 'COR-3721', '240124', '212007', '1090', 'COR-1090']);
const m = (s: string) => matchSymbol(s, keys);

ok('the symbol is the reference', m('COR-3808') === 'COR-3808' && m('cor-3808') === 'COR-3808' && m(' COR-3808 ') === 'COR-3808' && m('770224') === '770224');
ok('reference + suffix after a separator', m('COR-3808-9016') === 'COR-3808' && m('COR-3808 RAL7016') === 'COR-3808' && m('770224/6,5') === '770224' && m('801515.6500') === '801515' && m('COR-3808_ANOD') === 'COR-3808');
ok('the longest reference wins', m('COR-381020') === 'COR-381020' && m('COR-381020-9016') === 'COR-381020');
ok('the dashes a symbol has are respected', m('COR-3810-20') === 'COR-3810', m('COR-3810-20'));
ok('without the dash', m('COR3808') === 'COR-3808' && m('COR 3808') === 'COR-3808');
ok('no match without a separator', m('COR-38089') === null && m('7702245') === null && m('COR-380') === null, [m('COR-38089'), m('7702245')]);
ok('no match for other products', m('USZCZELKA') === null && m('') === null);
ok('looks like Cortizo', looksCortizo('COR-9999') && looksCortizo('cor 1234') && !looksCortizo('011230') && !looksCortizo('ABC-1'));
// real Subiekt symbols (Acemark PL, October 2026)
ok('PVC references with colour and length', m('15919 RAL 7016 CM 4000 mm') === '15919' && m('15919 Kosć słoniowa - 22 GR 2500 mm') === '15919' && m('15919 RAL 7016 CM') === '15919' && m('10417 2000 mm') === '10417');
ok('a short numeric reference does not take a / suffix', m('1405/005025/IK') === null && m('1405-6500') === '1405', m('1405/005025/IK'));
ok('other suppliers\' codes', m('011230') === null && m('096525 12') === null && m('113000IM') === null && m('120928--R2000') === null);

const row = (symbol: string, qty: number, warehouse = 'MAG', cref: string | null = null): StockRow => ({ product_id: Math.floor(Math.random() * 1e9), warehouse, symbol, name: null, unit: 'm', qty, reserved: null, cref, cortizo: false });
const r = matchStock(['COR-3808', '770224'], [row('COR-3808', 12), row('COR-3808-9016', 6.5), row('COR-3808', 2, 'ORP'), row('COR-9999', 1), row('ŚRUBA', 100), row('011230', 3), row('770224', 0)]);
ok('stock grouped by reference', r.byRef.get('COR-3808')?.length === 3 && r.byRef.get('770224')?.length === 1);
ok('Cortizo-looking leftovers become own references, other products are not touched', r.unmatched.length === 0 && r.own.get('COR-9999')?.length === 1, r.unmatched);

ok('agent row', JSON.stringify(stockFromAgent({ id: 5, symbol: ' COR-3808 ', name: 'Junquillo', unit: 'mb', warehouse: 'MAG', qty: '12.5', reserved: null, cref: ' 3808 Czarny ' })) === JSON.stringify({ product_id: 5, symbol: 'COR-3808', warehouse: 'MAG', name: 'Junquillo', unit: 'mb', qty: 12.5, reserved: null, cref: '3808 Czarny', cortizo: false }));
ok('agent row without id or symbol is dropped', stockFromAgent({ symbol: 'X' }) === null && stockFromAgent({ id: 3, symbol: '' }) === null);
ok('missing warehouse is an empty string', stockFromAgent({ id: 3, symbol: 'A', qty: 1 })?.warehouse === '');

ok('bar length from the symbol', barLengthMm('15919 RAL 7016 CM 4000 mm') === 4000 && barLengthMm('10417 2000 mm') === 2000 && barLengthMm('15919 Kosć słoniowa - 22 GR 2500 mm') === 2500 && barLengthMm('15919 RAL 7016 CM', 'Zaślepka kanału 1,5m') === null && barLengthMm('096525 12', 'Wkręt DIN 965 A2 M5X16') === null && barLengthMm('X', 'Profil 6500mm') === 6500);

// Acemark PL writes aluminium profiles without COR- (rows from the Subiekt database, October 2026)
const cf = (c: string) => matchCustomField(c, keys);
ok('custom field: first word is the reference', cf('2015 White Powder Coating 9010') === 'COR-2015' && cf('3735 Standard painting P9010B / Standard painting 7016CM') === 'COR-3735' && cf('3721 Lak. Specjalny 1 9005CM') === 'COR-3721' && cf('240124 Czarny') === '240124' && cf('212007') === '212007' && cf(' 270000 Czarny  ') === null && cf('') === null);
ok('a number the catalogue has bare is read bare', cf('1090 X') === '1090' && m('15919 RAL 7016 CM 4000 mm') === '15919');
ok('symbol without COR-', m('2015 RAL 7016 CM 1000 mm') === 'COR-2015' && m('3735 RAL 7016 CM 4500 mm') === 'COR-3735' && m('2015') === 'COR-2015');
{
  const r2 = matchStock(['COR-2015', '240124'], [row('2015 RAL 7016 CM 1000 mm', 3, 'ACE', '2015 White Powder Coating 9010'), row('XYZ', 2, 'ACE', '240124 Czarny'), row('270000', 5, 'ACE', '270000 Czarny'), row('011230', 1, 'ACE')]);
  ok('the custom field decides, an unknown one becomes its own reference', r2.byRef.get('COR-2015')?.length === 1 && r2.byRef.get('240124')?.length === 1 && r2.own.get('270000')?.length === 1 && r2.unmatched.length === 0, r2.unmatched.map((u) => u.symbol));
}

{
  const sup = (symbol: string): StockRow => ({ ...row(symbol, 1, 'ACE'), cortizo: true });
  const r3 = matchStock(['COR-2019', '202605'], [sup('2019 RAL 9006 CM 5000 mm'), sup('202605'), sup('9999 RAL 9010 1000 mm'), row('011230', 1)]);
  ok('a Cortizo-supplied product with no reference becomes its own reference; other suppliers are not touched', r3.byRef.size === 2 && r3.own.get('COR-9999')?.length === 1 && r3.unmatched.length === 0, [...r3.own.keys()]);
  ok('supplier flag from the agent', stockFromAgent({ id: 1, symbol: 'A', cortizo: 1 })?.cortizo === true && stockFromAgent({ id: 1, symbol: 'A', cortizo: 0 })?.cortizo === false);
}

// the unmatched list from Subiekt (Acemark PL, 22 October 2026)
ok('COR- in front of a bare catalogue number', m('COR-15919 RAL 7016 CM') === '15919' && m('COR-10417') === '10417' && m('COR-15919 Kosć słoniowa - 22 GR') === '15919', m('COR-15919 RAL 7016 CM'));
ok('own references from the symbol', ownRef('COR-3820 RAL 7016 CM') === 'COR-3820' && ownRef('3830 RAL 7016 CM 4000 mm') === 'COR-3830' && ownRef('7621 1500 mm') === 'COR-7621' && ownRef('COR-8619 Brązowy anoda') === 'COR-8619'
  && ownRef('330304') === '330304' && ownRef('301025 - 9007') === '301025' && ownRef('771288 RAL 9005 CM') === '771288' && ownRef('3830 1500 mm') === 'COR-3830',
  ['COR-3820 RAL 7016 CM', '301025 - 9007', '3830 1500 mm'].map((x) => ownRef(x)));
ok('no own reference for other brands', ownRef('GN425 RAL 8019 CM') === null && ownRef('FAZE176') === null && ownRef('A.7016 CM') === null && ownRef('UM-2 112') === null && ownRef('Płaskownik 50 x 10 3000 mm') === null && ownRef('ACSZ841') === null && ownRef('3830X') === null);
ok('Not Cortizo patterns', ignored('GN425 RAL 8019 CM', ['GN*']) && ignored('gl724pl ral 7016 tc', ['GL*']) && ignored('A.7016 CM', ['a.7016 cm']) && !ignored('A.7016 CM 2', ['A.7016 CM']) && !ignored('COR-3820', ['GN*']) && !ignored('X', ['*']));
ok('pattern input', ignorePattern(' gn* ') === 'GN*' && ignorePattern('A.7016 CM') === 'A.7016 CM' && ignorePattern('*') === null && ignorePattern('*GN') === null && ignorePattern('G*N*') === null && ignorePattern('') === null);
const col = (x: string) => colourOf(x);
ok('colours', col('COR-3820 RAL 7016 CM') === 'RAL 7016 CM' && col('COR-4327 RAL 7044 M') === 'RAL 7044 M' && col('3830 RAL 7016 CM 4000 mm') === 'RAL 7016 CM' && col('3791 RAL 7021 TD 5000 mm') === 'RAL 7021 TD'
  && col('COR-3830 RAL 9010') === 'RAL 9010' && col('7621 1500 mm') === null && col('330304') === null && col('15919 RAL 7016 CM 4000 mm') === 'RAL 7016 CM',
  ['COR-3820 RAL 7016 CM', '7621 1500 mm'].map(col));
ok('two-colour profiles, however written', col('COR-3850 RAL 7016TD/9010 CM') === 'RAL 7016 TD / 9010 CM' && col('3850 RAL 9005CM/9010 4000 mm') === 'RAL 9005 CM / 9010' && col('3850 RAL 7016 TD/ 9010 CM 1500 mm') === 'RAL 7016 TD / 9010 CM'
  && col('3830 RAL 7016CM/ 9010 1000 mm') === 'RAL 7016 CM / 9010' && col('3822 RAL 9010/7021 CM 3500 mm') === 'RAL 9010 / 7021 CM' && col('4339 RAL 9010/7038 B 1500 mm') === 'RAL 9010 / 7038 B',
  ['COR-3850 RAL 7016TD/9010 CM', '3850 RAL 9005CM/9010 4000 mm', '3830 RAL 7016CM/ 9010 1000 mm'].map(col));
ok('named colours as written', col('COR-8619 Brązowy anoda') === 'Brązowy anoda' && col('4341 Kosć słoniowa - 22 GR 2000 mm') === 'Kosć słoniowa - 22 GR' && col('301025 - 9007') === 'RAL 9007' && col('GN090 RAL 804A12') === 'RAL 804A12', [col('4341 Kosć słoniowa - 22 GR 2000 mm'), col('301025 - 9007')]);
ok('plain names', plainName('Poprzeczka 60mm RAL7016 CM (6,5m)') === 'Poprzeczka 60mm' && plainName('Ościeżnica okienna RAL9005 CM (1,5 m)') === 'Ościeżnica okienna' && plainName('Skrzydło szerokie 74 mm 2 m') === 'Skrzydło szerokie 74 mm'
  && plainName('Zawias 3 skrzydełkowy wrębowy. Ciemny szary[Czarny - 9005]') === 'Zawias 3 skrzydełkowy wrębowy. Ciemny szary' && plainName('Poszerzenie ościeżnicy 20 mm 5,5m') === 'Poszerzenie ościeżnicy 20 mm',
  [plainName('Poprzeczka 60mm RAL7016 CM (6,5m)'), plainName('Skrzydło szerokie 74 mm 2 m'), plainName('Poszerzenie ościeżnicy 20 mm 5,5m')]);
const sr = (symbol: string, name: string, unit: string, qty = 1): StockRow => ({ product_id: 1, warehouse: 'ACE', symbol, name, unit, qty, reserved: null, cref: null, cortizo: true });
ok('description: the most common plain name', ownDesc([sr('COR-3850 RAL 7016 CM', 'Poprzeczka 60mm RAL7016 CM (6,5m)', 'x'), sr('3850 RAL 7016 CM 500 mm', 'Poprzeczka 60 mm (0,5 m)', 'x'), sr('3850 RAL 9010 500 mm', 'Poprzeczka 60 mm (0,5 m)', 'x')]) === 'Poprzeczka 60 mm');
ok('bar length: symbol, then a full-bar unit, then the name', pieceMm(sr('COR-3820 RAL 7016 CM', 'Skrzydło (6,5m)', 'sztanga(6500mm)')) === 6500 && pieceMm(sr('3830 RAL 7021 CM 4000 mm', 'Ościeżnica (6,5 m)', 'sztanga(6500mm)')) === 4000
  && pieceMm(sr('4342 RAL 7016 CM 2000 mm', 'Ościeżnica (1500mm)', 'szt')) === 2000 && pieceMm(sr('330304', 'Zamek', 'szt')) === null && pieceMm(sr('UM-2 112', 'Uszczelka', 'm')) === null);
ok('metres', rowMetres(sr('COR-3820 RAL 7016 CM', '', 'sztanga(6500mm)', 3)) === 19.5 && rowMetres(sr('3830 RAL 7016 CM 500 mm', '', 'szt.', 2)) === 1 && rowMetres(sr('UM-2 112', '', 'm', 400)) === 400 && rowMetres(sr('330304', '', 'szt', 9)) === null);
{
  const r4 = matchStock(['15919', 'COR-3821'], [sr('COR-15919 RAL 9005 CM', 'Zaslepka kanalu', 'sztanga(6500mm)'), sr('COR-3820 RAL 7016 CM', 'Skrzydło wąskie 50 mm', 'sztanga(6500mm)'), sr('3820 RAL 9005 CM 1500 mm', 'Skrzydło wąskie 50 mm', 'szt'),
    sr('GN425 RAL 8019 CM', 'Skrzydło', 'szt.'), sr('FAZE176', 'Fapim', 'szt.'), sr('A.7016 CM', 'Proszek', 'kg'), sr('UM-2 112', 'Uszczelka', 'm')], ['GN*', 'FAZE*']);
  ok('the list sorted out', r4.byRef.get('15919')?.length === 1 && r4.own.get('COR-3820')?.length === 2 && r4.ignored === 2 && r4.unmatched.map((u) => u.symbol).join() === 'A.7016 CM,UM-2 112', { own: [...r4.own.keys()], un: r4.unmatched.map((u) => u.symbol), ig: r4.ignored });
}

if (fail) { console.error(`${fail} cortizo test(s) failed`); process.exit(1); }
console.log('All cortizo tests passed');
