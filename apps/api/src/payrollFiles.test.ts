// Run: npx tsx apps/api/src/payrollFiles.test.ts — made-up people and amounts in the layout of the accountant's files.
import { fileKind, parseList, parseZus, parsePit4, splitByGroup, buildPreview, personKey, type PayGroup } from './payrollFiles';
import { payrollView, type PayrollRow } from './finPayroll';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const HEAD = 'Lp. Nazwisko i imię Składniki\nwyn. op.\nŚwiadcz.\nopodatk.\nDo wypłaty Data i\npodpis\n';
const LIST = 'KPiR 26.06.C: 06.10.2026; godzina: 08:38; strona 1 / 2\nFirma: TEST SP ZOO\nLista płac za miesiąc wrzesień 2026\n' + HEAD
  + '1 NOWAK ANNA 2500,00 0,00 800,00 1000,00 340,00 52,00 86,00 58,00 300,00 3690,00 143,00 353,00 0,00 85,00 229,00 0,00 3400,00\n' + HEAD
  + '2 Kowalska-Wiśniewska Ewa 7000,00 0,00 0,00 0,00 726,00 111,00 182,00 124,00 300,00 6184,00 442,00 577,00 0,00 85,00 483,00 0,00 5300,00\n---\nstrona 2 / 2\n' + HEAD
  + '3 ZIELIŃSKI PIOTR 10000,00 0,00 0,00 500,00 975,00 149,00 244,00 166,00 250,00 8442,00 713,00 776,00 0,00 85,00 649,00 0,00 7100,00\n'
  + 'NARASTAJĄCO: 19500,00 0,00 800,00 1500,00\n0,00 2041,00 312,00 512,00 348,00 850,00 18316,00 1298,00 1706,00 0,00 255,00 1361,00 0,00\n0,00 15800,00\nData wypłaty: 10.10.2026';
const ZUS = 'nazwa odbiorcy\nwaluta kwota\n06\nPLN\nZakład Ubezpieczeń Społecznych\n16 600000020260016211842704\n9000,50\nNależności z tytułu składek ZUS\nZakład Ubezpieczeń Społecznych\n9000,50\n';
const PIT = '01. nazwa organu podatkowego\nP L N\n07\nUrząd Skarbowy Urząd Skarbowy Krotoszyn\n29 101000712222621184270400\n1200,00\n6211842704 M 2 6 M 0 9\nPIT4R POD.DOCH.ZA PRAC.\n';

ok('files recognised', fileKind(LIST) === 'list' && fileKind(ZUS) === 'zus' && fileKind(PIT) === 'pit4' && fileKind('invoice') === null);
const l = parseList(LIST);
ok('list: month, pay date, company', l.ok && l.list.year === 2026 && l.list.month === 9 && l.list.payDate === '2026-10-10' && l.list.company === 'TEST SP ZOO', l);
ok('list: people with gross (first 4 amounts) and net (last)', l.ok && l.list.people.length === 3 && l.list.people[0].gross === 4300 && l.list.people[0].net === 3400 && l.list.people[1].name === 'Kowalska-Wiśniewska Ewa' && l.list.people[2].gross === 10500, l.ok && l.list.people);
ok('list: totals match', l.ok && l.list.gross === 21800 && l.list.net === 15800);
ok('list: rows that do not add up to the totals are refused', !parseList(LIST.replace('7100,00\n', '7000,00\n')).ok);
ok('list without a month is refused', !parseList(LIST.replace('za miesiąc wrzesień 2026', '')).ok);
const z = parseZus(ZUS), p = parsePit4(PIT);
ok('ZUS amount', z.ok && z.amount === 9000.5, z);
ok('PIT-4 amount and period', p.ok && p.amount === 1200 && p.year === 2026 && p.month === 9, p);
ok('a transfer with two different amounts is refused', !parseZus(ZUS + '\n10,00\n').ok);
ok('person key ignores case and spaces', personKey('Kowalska  Ewa ') === personKey('KOWALSKA EWA'));

// split: ZUS + PIT-4 by share of gross; Other is kept apart
const people = l.ok ? l.list.people.map((x, i) => ({ ...x, group: (['Production', 'Office', 'Other'] as PayGroup[])[i] })) : [];
const s = splitByGroup(people, 9000.5, 1200);
ok('net per group', s.Production.net === 3400 && s.Office.net === 5300 && s.Other.net === 7100 && s.Sales.net === 0, s);
ok('taxes split by gross and add up to the cent', Math.round((s.Production.taxes + s.Office.taxes + s.Other.taxes + s.Sales.taxes) * 100) === 1020050 && s.Other.taxes === 4913.08, s);

// preview: all three files, any order; a mismatched PIT-4 period is a warning
const b = buildPreview([{ name: 'p.pdf', text: PIT }, { name: 'l.pdf', text: LIST }, { name: 'z.pdf', text: ZUS }], new Map([[personKey('Nowak Anna'), 'Production' as PayGroup]]));
ok('preview: totals, transfers, known people', b.ok && b.preview.zus === 9000.5 && b.preview.pit === 1200 && b.preview.people[0].group === 'Production' && b.preview.people[0].known && b.preview.people[1].group === null && !b.preview.warnings.length, b);
ok('preview: a missing file is named', (() => { const r = buildPreview([{ name: 'l.pdf', text: LIST }], new Map()); return !r.ok && /ZUS/.test(r.error) && /PIT-4/.test(r.error); })());
ok('preview: PIT-4 for another month → warning', (() => { const r = buildPreview([{ name: 'l', text: LIST }, { name: 'z', text: ZUS }, { name: 'p', text: PIT.replace('M 0 9', 'M 0 8') }], new Map()); return r.ok && r.preview.warnings.length === 1; })());

// the Payroll view: lump sums on top of salaries, never on taxes
const R: PayrollRow[] = ['Office', 'Sales', 'Production'].map((d) => ({ period_year: 2026, period_month: 9, department: d, salaries: 1000, taxes: 300, actual: true, source: 'files', lump: d === 'Sales' ? 500 : null, lump_note: d === 'Sales' ? 'bonus' : null }));
const v = payrollView(R, { year: 2026, month: 10 });
ok('lump sum added to salaries, taxes untouched, month marked as from files', v[0].files && v[0].depts.Sales.salaries === 1500 && v[0].depts.Sales.base === 1000 && v[0].depts.Sales.lump === 500 && v[0].depts.Sales.taxes === 300 && v[0].depts.Office.salaries === 1000, v[0]);
ok('the estimate after it counts the lump sum', v[1].depts.Sales.salaries === 1500 && v[1].depts.Sales.salariesStatus === 'forecast', v[1]);

// 2026 files from the other payroll programs (Acemark PL, January and April) and the letter-by-letter ZUS form
const BOXED = ['Lista PŁAC za: Styczeń 2026 Nr01/2026',
  '│ 0.0 h 50%│ inne (+) 0.00 │ Dni chorobowych 0 │ Zaliczka na podatek 257.00│ KWOTA DO WYPŁATY: │ fundusz pracy: 139.27 │',
  '├────────────┘ Rycz Samoch 0.00 │ Opieki 0 │ (─) multisport 46.61│ 4,194.95 │ suma składek: 1,164.17 │',
  '│ WYNAGRODZENIE (brutto) 5,684.40 │Nieobecnności kwota 0.00 │ (─) Zaliczki 0.00├──────┴──┤',
  '├───── U b e z p i e c z o n y ──────┼────┤ (─) PPK Pracownik 0.00│ Pracownik: BIELAWNY MICHAŁ │',
  '│ Emerytalne 554.80 ┌───────────┼───┘ Porodowy 0.00│ Kwituję odbiór │ │', '│ Rentowe 85.27 │ S U M A │Składka Zdrowotna 441.46 Wychowawczy 0.00│ kwoty w dniu: │ │', '│ Chorobowe 139.27 │ 779.34 │Koszty Uzyskania 300.00 Pielęgnacyjny 0.00│ 2026-02-10 │ │',
  '├────────────┘ Rycz Samoch 0.00 │ Opieki 0 │ (─) multisport 46.61│ 5,827.07 │ suma składek: 1,654.52 │',
  '│ WYNAGRODZENIE (brutto) 8,078.71 │Nieobecnności kwota 0.00 │ (─) Zaliczki 0.00├────┴──┤',
  '├───── U b e z p i e c z o n y ──────┼────┤ (─) PPK Pracownik 0.00│ Pracownik: CEGŁA ROMAN │',
  '└────── RAZEM WYNAGRODZENIE BRUTTO ( 1 do 7 ) 13,763.11 │'].join('\n');
const bx: any = parseList(BOXED);
ok('boxed list (January)', fileKind(BOXED) === 'list' && bx.ok && bx.list.month === 1 && bx.list.year === 2026 && bx.list.payDate === '2026-02-10' && bx.list.people.length === 2 && bx.list.people[0].name === 'BIELAWNY MICHAŁ' && bx.list.people[0].gross === 5684.4 && bx.list.people[0].net === 4194.95 && bx.list.gross === 13763.11, bx);
ok('boxed list: a wrong total is refused', !parseList(BOXED.replace('13,763.11', '13,000.00')).ok);
const VARICO = ['Wynagrodzenie za miesiąc kwiecień 2026 Data wypłaty: 10.05.2026', 'ROMAN CEGŁA Do wypłaty: 5379,59 podpis pracownika',
  'Wynagrodzenie 7504,59 Składki ZUS i podatek 2040,00 Pozostałe odliczenia 85,00 Parametry', 'multisport 63,75 ubezpieczenie emerytalne - płaci',
  'Wynagrodzenie za miesiąc kwiecień 2026 Data wypłaty: 10.05.2026', 'NATALIA CIELOCH Do wypłaty: 6003,64 podpis pracownika',
  'Wynagrodzenie 8420,31 Składki ZUS i podatek 2331,67 Pozostałe odliczenia 85,00 Parametry'].join('\n');
const vr: any = parseList(VARICO);
ok('Varico payslips (April): names turned round, pay checked', fileKind(VARICO) === 'list' && vr.ok && vr.list.month === 4 && vr.list.payDate === '2026-05-10' && vr.list.people.map((x: any) => x.name).join() === 'CEGŁA ROMAN,CIELOCH NATALIA' && vr.list.people[0].gross === 7504.59 && vr.list.people[0].net === 5379.59 && vr.list.net === 11383.23, vr);
ok('Varico: a slip that does not add up is refused', !parseList(VARICO.replace('Do wypłaty: 5379,59', 'Do wypłaty: 5000,00')).ok);
const ZUS2 = 'Z U S\nnazwa odbiorcy\nnr rachunku odbiorcy\nczt*zer*dwa*osi*czt*zł*dzi*czt*gr\nP L N\n0 6\n1 6 6 0 0 0 0 0 0 2 0 2 6 0 0 1 6 2 1 1 8 4 2 7 0 4\n4 0 2 8 4 , 9 4\nA C E M A R K S P . Z O . O .\nZ U S\nnazwa odbiorcy\n4 0 2 8 4 , 9 4\n';
const z2: any = parseZus(ZUS2);
ok('ZUS form printed letter by letter', fileKind(ZUS2) === 'zus' && z2.ok && z2.amount === 40284.94, z2);
const PIT2 = 'Urząd Skarbowy W KROTOSZYNIE\n5724,00\n6211842704 N 2 6 M 0 2\nPIT-4 PODATEK PIT-4\n';
const p2: any = parsePit4(PIT2);
ok('PIT-4 period after the NIP type ("N 2 6 M 0 2")', p2.ok && p2.year === 2026 && p2.month === 2 && p2.amount === 5724, p2);

if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('payrollFiles: all checks passed');
