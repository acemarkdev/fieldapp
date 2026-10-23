// Run: npx tsx apps/api/src/mondayOrders.test.ts
import { okCodeIn, planZLinks, type ZBoardItem, type ZOrder } from './mondayOrders';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// the OK code as written on the board
ok('OK after the Z', okCodeIn('Z.453 -OK PL203173 -PCW - J035030P') === 'OK PL203173', okCodeIn('Z.453 -OK PL203173 -PCW - J035030P'));
ok('underscores', okCodeIn('Z.455 - OK_PL203078_-_Lumio_Glass_Update_06102026TH') === 'OK PL203078', okCodeIn('Z.455 - OK_PL203078_-_Lumio_Glass_Update_06102026TH'));
ok('dash and suffix', okCodeIn('Z.374 - OK - DEPL20250805-1 - Dusseldorf Wacholderweg 18') === 'OK DEPL20250805-1', okCodeIn('Z.374 - OK - DEPL20250805-1 - Dusseldorf Wacholderweg 18'));
ok('letters run into the number', okCodeIn('Z.432 - OK DEFR202989-SSE- ID 32256') === 'OK DEFR202989', okCodeIn('Z.432 - OK DEFR202989-SSE- ID 32256'));
ok('no OK number → null', okCodeIn('Z.022 (JB0101) - Haywards Heath - Okna') === null && okCodeIn('Z.328 - EQ -  L2025 12133 - Balham') === null && okCodeIn('') === null);

// the plan
const it = (id: string, name: string): ZBoardItem => ({ id, name, created: '2026-10-01' });
const O = (id: string, order_ref: string, job_ref: string | null = null): ZOrder => ({ id, order_ref, job_ref, customer: 'C', status: 'accepted', rep_name: 'Tomasz' });
const orders = [
  O('o1', 'OK PL203173 - Kowalski'),
  O('o2', 'OK PL203175 -Nowak', 'Z.454'),
  O('o3', 'OK PL203158 -Wiśniewska', 'Z.400'),
  O('o4', 'OK PL203160 a'), O('o5', 'OK PL203160 b'),
  O('o6', 'OK PL203143 - phases'),
  O('o7', 'OK PL203139 -Lis'), O('o8', 'Z.450 old order', 'Z.450'),
  O('o9', 'OK PL202000 - Z.102 phases'),
  O('o10', 'ok-pl203078 Lumio', ''),
];
const rows = planZLinks([
  it('i1', 'Z.453 -OK PL203173 -PCW - J035030P'),
  it('i2', 'Z.454 - OK PL203175 PCW -J035034P'),
  it('i3', 'Z.451 - OK PL203158 - PCW - J035023P'),
  it('i4', 'Z.452 - OK PL203160 -PCW -J035025P'),
  it('i5', 'Z.449 - OK PL203143 - PCW - faza 1'), it('i6', 'Z.460 - OK PL203143 - PCW - faza 2'),
  it('i7', 'Z.450 - OK PL203139 PCW - J034994P'),
  it('i8', 'Z.102_FAZA_1 - OK PL202000'), it('i9', 'Z.102_FAZA_2 - EQ24 415'),
  it('i10', 'Z.455 - OK_PL203078_-_Lumio_Glass'),
  it('i11', 'Z.461 - OK PL299999 - nobody'),
  it('i12', 'Z.022 (JB0101) - Haywards Heath - Okna'),
], orders);
const st = (id: string) => rows.find((r) => r.id === id);
ok('one order, no Z yet → fill Z.453', st('i1')?.status === 'fill' && st('i1')?.orderId === 'o1' && st('i1')?.z === 'Z.453', st('i1'));
ok('already has this Z → same', st('i2')?.status === 'same', st('i2'));
ok('has a different Z → conflict, never overwritten', st('i3')?.status === 'conflict' && st('i3')?.current === 'Z.400', st('i3'));
ok('two orders with the code → several_orders', st('i4')?.status === 'several_orders', st('i4'));
ok('OK on two board items → several_items', st('i5')?.status === 'several_items' && st('i6')?.status === 'several_items', [st('i5'), st('i6')]);
ok('Z already on another order → z_taken', st('i7')?.status === 'z_taken', st('i7'));
ok('Z on the board twice → several_items', st('i8')?.status === 'several_items', st('i8'));
ok('empty-text Z counts as empty; lower-case ok- matches', st('i10')?.status === 'fill' && st('i10')?.orderId === 'o10', st('i10'));
ok('no order → no_order', st('i11')?.status === 'no_order', st('i11'));
ok('items without an OK code are not listed', !st('i9') && !st('i12'));

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('mondayOrders ok');
