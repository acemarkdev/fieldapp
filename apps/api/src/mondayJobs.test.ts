// Run: npx tsx apps/api/src/mondayJobs.test.ts
import { zNumber, zNumbersIn, planImport, boardItem, type BoardItem } from './mondayJobs';
import type { Budget } from './jobBudget';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// Z numbers, as written on the board and in Job costs
ok('board names → Z number', zNumber('Z.444 - EQ - L2025 10745') === 444 && zNumber('Z.004b (ref. 20 SIX)') === 4 && zNumber('Z.102_FAZA_2 - EQ24 415') === 102 && zNumber(' Z.445 -  OK PL203055') === 445 && zNumber('Z.453 -OK PL203173') === 453);
ok('no Z at the start → null', zNumber('OK PL203173 Z.12') === null && zNumber('') === null);
ok('Job costs references → all Z numbers', JSON.stringify(zNumbersIn('Z.262a, Z.262b, Z.263')) === '[262,263]' && JSON.stringify(zNumbersIn('Z.102 panele')) === '[102]' && JSON.stringify(zNumbersIn('Z.290 pop')) === '[290]');

// column texts → numbers
const bi = boardItem({ id: '1', name: 'Z.444 - EQ', group: '2 Operacje', created_at: '2026-09-30T03:12:51Z', cols: { numbers__1: '586354', numeric_mm6rgrgy: '675.7', dropdown0__1: 'ACEMARK GLAZING LTD' } });
ok('board item read', bi.value === 586354 && bi.hours === 675.7 && bi.customer === 'ACEMARK GLAZING LTD' && bi.created === '2026-09-30', bi);
ok('0 and empty count as not filled', boardItem({ id: '2', name: 'Z.446', group: null, cols: { numbers__1: '0', numeric_mm6rgrgy: '' } }).value === null);

// the plan
const it = (id: string, name: string, value: number | null = 1000, hours: number | null = 10): BoardItem => ({ id, name, group: null, created: '2026-10-01', value, hours, customer: null });
const B = (o: Partial<Budget> = {}): Budget => ({ offer_net: null, produce: {}, labour_hours: null, labour_rate: null, trade_supplier: null, trade_purchase: null, trade_transport: null, trade_other: null, note: null, decision: 'undecided', ...o });
const jobs = [
  { id: 'j414', reference: 'Z.414', reference_key: 'Z.414', locked: false },
  { id: 'j102', reference: 'Z.102 panele', reference_key: 'Z.102PANELE', locked: false },
  { id: 'j420', reference: 'Z.420', reference_key: 'Z.420', locked: true },
  { id: 'j421', reference: 'Z.421', reference_key: 'Z.421', locked: false },
  { id: 'j422', reference: 'Z.422', reference_key: 'Z.422', locked: false },
  { id: 'j263', reference: 'Z.262a, Z.262b, Z.263', reference_key: 'Z.262A,Z.262B,Z.263', locked: false },
];
const budgets = new Map<string, Budget>([['j421', B({ decision: 'produce', offer_net: 5 })], ['j422', B({ offer_net: 900 })]]);
const plan = planImport([
  it('a', 'Z.453 - OK PL203173'), it('b', 'Z.414 - x'), it('c', 'Z.102_FAZA_1'), it('d', 'Z.102_FAZA_2'), it('e', 'Z.214 - EQ'), it('f', 'Z.214.b - EQ'),
  it('g', 'Z.420'), it('h', 'Z.421'), it('i', 'Z.422'), it('k', 'Z.263 - y'), it('l', 'no number'), it('m', 'Z.452', null, null),
], jobs, budgets);
const P = (id: string) => plan.find((r) => r.id === id)!;
ok('not in Job costs → new, reference "Z.453"', P('a').status === 'new' && P('a').reference === 'Z.453', P('a'));
ok('in Job costs, no budget → fill both', P('b').status === 'in_office' && P('b').jobId === 'j414' && !!P('b').fill?.offer_net && !!P('b').fill?.labour_hours, P('b'));
ok('in Job costs under a longer reference → not filled automatically', P('c').status === 'in_office' && P('c').fill === null && P('d').fill === null, P('c'));
ok('Z twice on the board, not in Job costs → duplicate, never new', P('e').status === 'duplicate' && P('f').status === 'duplicate', P('e'));
ok('locked job → not filled', P('g').status === 'in_office' && P('g').fill === null && P('g').why === 'Job is locked');
ok('decided budget → not filled', P('h').fill === null && P('h').why === 'Budget is decided');
ok('only the empty field is filled', !!P('i').fill && P('i').fill!.offer_net === false && P('i').fill!.labour_hours === true, P('i'));
ok('one of several Z in a reference → in Job costs', P('k').status === 'in_office' && P('k').jobId === 'j263' && P('k').fill === null, P('k'));
ok('no Z → no_z', P('l').status === 'no_z');
ok('new without numbers is still new', P('m').status === 'new');

if (fail) { console.error(fail + ' check(s) failed'); process.exit(1); }
console.log('mondayJobs: all checks passed');
