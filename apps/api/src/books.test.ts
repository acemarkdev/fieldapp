// Run: npx tsx apps/api/src/books.test.ts   (the lines are the real IPS statement for 01-01-2026 to 30-09-2026)
import { parseRzis, monthlyFromBooks } from './books';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const LINES = `Dane przedsiębiorstwa   RACHUNEK ZYSKÓW I STRAT
ACEMARK SPÓŁKA Z   wariant porównawczy
ODPOWIEDZIALNOŚCIĄ   za okres od 01-01-2026 do 30-09-2026
NIP:6211842704
poprzedni   01.01.2026-30.09.2026
A. Przychody netto ze sprzedaży i zrównane z nimi, w tym:   3 996 934,99
- od jednostek powiązanych
I. Przychody netto ze sprzedaży produktów   3 996 934,99
II. Zmiana stanu produktów (zwiększenie - wartość dodatnia, zmniejszenie - wartość ujemna)
III. Koszt wytworzenia produktów na własne potrzeby jednostki
IV. Przychody netto ze sprzedaży towarów
B. Koszty działalności operacyjnej   4 071 564,74
I. Amortyzacja   35 528,17
II. Zużycie materiałów i energii   2 537 868,17
III. Usługi obce   427 832,67
IV. Podatki i opłaty, w tym:   250,39
V. Wynagrodzenia   838 872,36
VI. Ubezpieczenia społeczne i inne świadczenia, w tym:   182 693,83
VII. Pozostałe koszty rodzajowe   48 519,15
VIII. Wartość sprzedanych towarów
C. Zysk (strata) ze sprzedaży (A - B)   -74 629,75
D. Pozostałe przychody operacyjne   652,47
IV. Inne przychody operacyjne   652,47
E. Pozostałe koszty operacyjne   28,87
III. Inne koszty operacyjne   28,87
F. Zysk (strata) z działalności operacyjnej (C + D - E)   -74 006,15
G. Przychody finansowe   2 572,03
I. Dywidendy i udziały w zyskach, w tym:
V. Inne   2 572,03
H. Koszty finansowe   49 653,82
I. Odsetki, w tym:   4 051,93
IV. Inne   45 601,89
I. Zysk (strata) brutto (F + G - H)   -121 087,94
J. Podatek dochodowy
K. Pozostałe obowiązkowe zmniejszenia zysku (zwiększenia straty)
L. Zysk (strata) netto (I - J - K)   -121 087,94`.split('\n');

const p = parseRzis(LINES);
ok('the statement is read', p.ok, p);
if (p.ok) {
  const v = p.st.values;
  ok('period and company', p.st.from === '2026-01-01' && p.st.to === '2026-09-30' && p.st.nip === '6211842704', p.st);
  ok('main lines', v.A === 3996934.99 && v.B === 4071564.74 && v.C === -74629.75 && v.F === -74006.15 && v.I === -121087.94 && v.L === -121087.94, v);
  ok('sub-lines', v['B.I'] === 35528.17 && v['B.V'] === 838872.36 && v['B.VI'] === 182693.83 && v['B.VIII'] === 0 && v['A.IV'] === 0 && v['H.I'] === 4051.93 && v['H.IV'] === 45601.89 && v.G === 2572.03 && v.D === 652.47, v);
  ok('"I. Odsetki" under H is not the letter I', v['H.I'] === 4051.93 && v.I === -121087.94);
}
ok('a balance sheet is refused', !parseRzis(['BILANS', 'AKTYWA']).ok && /balance sheet/.test((parseRzis(['BILANS']) as any).error));
const broken = LINES.map((l) => l.replace('-74 629,75', '-74 000,00'));
ok('a statement that does not add up is refused', !parseRzis(broken).ok);

// Monthly figures from cumulative statements
const sep = { to: '2026-09-30', values: { 'B.I': 35528.17, G: 2572.03, H: 49653.82 } };
const a = monthlyFromBooks(sep, []);
ok('first statement of the year: spread over January–September', a.year === 2026 && a.months.join() === '1,2,3,4,5,6,7,8,9' && a.depreciation[0] === 3947.57 && Math.abs(a.depreciation.reduce((s, x) => s + x, 0) - 35528.17) < 0.001 && Math.abs(a.financial_cost.reduce((s, x) => s + x, 0) - 47081.79) < 0.001, a);
const jun = { to: '2026-06-30', values: { 'B.I': 20000, G: 1000, H: 30000 } };
const b = monthlyFromBooks(sep, [jun, { to: '2025-12-31', values: { 'B.I': 1 } }]);
ok('a later statement: only the months after the earlier one, the difference', b.months.join() === '7,8,9' && Math.abs(b.depreciation.reduce((s, x) => s + x, 0) - 15528.17) < 0.001 && Math.abs(b.financial_cost.reduce((s, x) => s + x, 0) - 18081.79) < 0.001, b);
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('books: all passed');
