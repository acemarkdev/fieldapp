// Run: npx tsx apps/api/src/cortizo.test.ts
import { matchSymbol, matchCustomField, matchStock, refKeys, looksCortizo, stockFromAgent, barLengthMm, type StockRow } from './cortizo';

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
ok('Cortizo-looking leftovers are listed, other products are not', r.unmatched.length === 1 && r.unmatched[0].symbol === 'COR-9999', r.unmatched);

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
  ok('the custom field decides, unmatched custom fields are listed', r2.byRef.get('COR-2015')?.length === 1 && r2.byRef.get('240124')?.length === 1 && r2.unmatched.length === 1 && r2.unmatched[0].symbol === '270000', r2.unmatched.map((u) => u.symbol));
}

{
  const sup = (symbol: string): StockRow => ({ ...row(symbol, 1, 'ACE'), cortizo: true });
  const r3 = matchStock(['COR-2019', '202605'], [sup('2019 RAL 9006 CM 5000 mm'), sup('202605'), sup('9999 RAL 9010 1000 mm'), row('011230', 1)]);
  ok('a Cortizo-supplied product with no reference is listed; other suppliers are not', r3.byRef.size === 2 && r3.unmatched.length === 1 && r3.unmatched[0].symbol === '9999 RAL 9010 1000 mm', r3.unmatched.map((u) => u.symbol));
  ok('supplier flag from the agent', stockFromAgent({ id: 1, symbol: 'A', cortizo: 1 })?.cortizo === true && stockFromAgent({ id: 1, symbol: 'A', cortizo: 0 })?.cortizo === false);
}

if (fail) { console.error(`${fail} cortizo test(s) failed`); process.exit(1); }
console.log('All cortizo tests passed');
