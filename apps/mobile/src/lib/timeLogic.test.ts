// Run: npx tsx apps/mobile/src/lib/timeLogic.test.ts
import { groupTasks, clock, hoursToday, recentTasks, taskLabel, editableToday, editableRecent, taskName, isFree, shiftWithinDay, atTime, hhmm, editProblem, todayByTask, countToday, measured, qtyDefault, parseQty, typeLabel, doneLine, taskOrder, type ProdTask } from './timeLogic';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const T = (id: string, job: string, op: string): ProdTask => ({ id, job_ref: job, operation: op, alias: op, export_name: job.replace('.', '_') + '_' + op });
const tasks = [T('1', 'Z.394', 'ciecie'), T('2', 'Z.394', 'szklenie'), T('3', 'Z.410', 'szklenie'), T('4', 'Z.410', 'pakowanie'), T('5', 'Z.39', 'ciecie')];
ok('grouped by job, newest job first, tasks A–Z', JSON.stringify(groupTasks(tasks, '').map((g) => [g.job, g.tasks.map((t) => t.operation)])) === JSON.stringify([['Z.410', ['pakowanie', 'szklenie']], ['Z.394', ['ciecie', 'szklenie']], ['Z.39', ['ciecie']]]));
ok('search by job number with or without the dot, and by operation', groupTasks(tasks, '394').length === 1 && groupTasks(tasks, 'z394 szkl')[0].tasks.length === 1 && groupTasks(tasks, 'szklenie').length === 2 && groupTasks(tasks, 'Z.394').length === 1);
ok('clock', clock(3909000) === '1:05:09' && clock(0) === '0:00:00' && clock(-5) === '0:00:00');
const now = new Date(2026, 9, 14, 12, 0, 0);
const iso = (h: number, m = 0) => new Date(2026, 9, 14, h, m).toISOString();
ok('hours today: finished plus running, yesterday ignored', hoursToday([{ id: 'a', task_id: null, task_name: null, started_at: iso(6), ended_at: iso(8, 30) }, { id: 'b', task_id: null, task_name: null, started_at: iso(11), ended_at: null }, { id: 'c', task_id: null, task_name: null, started_at: new Date(2026, 9, 13, 10).toISOString(), ended_at: new Date(2026, 9, 13, 14).toISOString() }], now) === 3.5);

// Moje zadania
const E = (id: string, task: string, h: number) => ({ id, task_id: task, task_name: null, started_at: new Date(2026, 9, 14, h).toISOString(), ended_at: null });
const rec = recentTasks([E('a', '1', 6), E('b', '2', 7), E('c', '1', 8), E('d', '9', 9), E('e', '3', 10)], tasks, 2);
ok('recent tasks: newest first, each once, only open tasks, at most n', rec.map((t) => t.id).join() === '3,1', rec.map((t) => t.id));
ok('task label carries the Z number', taskLabel(tasks[1]) === 'Z.394 · szklenie');
ok('no second Z number when the name already starts with the job', taskLabel({ job_ref: 'Z.437', operation: 'Z_437_cnc_Poz_1_cor_70_ind_ho_012_w1' }) === 'Z_437_cnc_Poz_1_cor_70_ind_ho_012_w1' && taskLabel({ job_ref: 'Z.43', operation: 'Z_437_cnc' }) === 'Z.43 · Z_437_cnc' && taskLabel({ job_ref: 'Z.437', operation: 'cnc Z_437' }) === 'Z.437 · cnc Z_437');

// Correcting an entry
const day = new Date(2026, 9, 14, 7, 30);
ok('editable only on its own day', editableToday({ id: 'x', task_id: null, task_name: null, started_at: new Date(2026, 9, 14, 6).toISOString(), ended_at: null }, day) && !editableToday({ id: 'x', task_id: null, task_name: null, started_at: new Date(2026, 9, 13, 23).toISOString(), ended_at: null }, day));
ok('time moves within the day only', hhmm(shiftWithinDay(new Date(2026, 9, 14, 7, 30), 5)) === '07:35' && hhmm(shiftWithinDay(new Date(2026, 9, 14, 0, 3), -5)) === '00:00' && hhmm(shiftWithinDay(new Date(2026, 9, 14, 23, 58), 5)) === '23:59' && shiftWithinDay(new Date(2026, 9, 14, 23, 58), 5).getDate() === 14);
ok('typed time keeps the date', hhmm(atTime(day, '6:05')!) === '06:05' && atTime(day, '06.45')!.getDate() === 14 && atTime(day, '25:00') === null && atTime(day, 'abc') === null);
const now2 = new Date(2026, 9, 14, 12, 0);
ok('edit checks', editProblem(new Date(2026, 9, 14, 6), new Date(2026, 9, 14, 7), false, now2, '') === null && !!editProblem(new Date(2026, 9, 14, 8), new Date(2026, 9, 14, 7), false, now2, '') && !!editProblem(new Date(2026, 9, 14, 13), null, true, now2, '') && editProblem(new Date(2026, 9, 14, 6), null, true, now2, 'ok') === null && !!editProblem(new Date(2026, 9, 14, 6), new Date(2026, 9, 14, 7), false, now2, 'x'.repeat(101)) && !!editProblem(new Date(2026, 9, 14, 6), new Date(2026, 9, 14, 13), false, now2, ''));

// "dziś" per task and the count on the entries tab
const tbt = [{ id: 'a', task_id: '1', task_name: 'x', started_at: iso(7), ended_at: iso(8, 30), note: null }, { id: 'b', task_id: '1', task_name: 'x', started_at: iso(11), ended_at: null, note: null },
  { id: 'c', task_id: '2', task_name: 'y', started_at: new Date(2026, 9, 13, 23, 0).toISOString(), ended_at: iso(1), note: null }, { id: 'd', task_id: '3', task_name: 'z', started_at: new Date(2026, 9, 13, 8).toISOString(), ended_at: new Date(2026, 9, 13, 9).toISOString(), note: null }] as any;
const byTask = todayByTask(tbt, now);
ok('today per task: finished + running up to now; across midnight only the part after 00:00; yesterday not at all', byTask.get('1') === 2.5 * 3600000 && byTask.get('2') === 3600000 && !byTask.has('3'), [...byTask]);
ok('entries started today', countToday(tbt, now) === 2);
const ER = (d: Date) => ({ id: 'x', task_id: null, task_name: null, started_at: d.toISOString(), ended_at: null });
ok('editable for 7 days: today and the 6 days before; the 7th day back is locked', editableRecent(ER(new Date(2026, 9, 14, 6)), day) && editableRecent(ER(new Date(2026, 9, 8, 0, 30)), day) && !editableRecent(ER(new Date(2026, 9, 7, 23, 0)), day));
ok('own task name on the phone wins; empty or blank falls back', taskName({ id: 't', job_ref: 'Z.394', operation: 'szklenie' }, { t: 'Szyby kuchnia' }) === 'Szyby kuchnia' && taskName({ id: 't', job_ref: 'Z.394', operation: 'szklenie' }, { t: '  ' }) === 'Z.394 · szklenie' && taskName({ id: 'u', job_ref: 'Z.394', operation: 'szklenie' }, {}) === 'Z.394 · szklenie');

ok('free entry: no task and no job; a removed task keeps its job', isFree({ task_id: null, job_key: null }) && !isFree({ task_id: null, job_key: 'Z.437' }) && !isFree({ task_id: 't', job_key: 'Z.437' }));

// WEM: type at START, quantity at STOP, the order of the work
const W = (id: string, code: string, pos: string, planned: number | null): ProdTask => ({ ...T(id, 'WEM-2026-001', 'Poz. ' + pos + ' · ' + code), code, position: pos, planned_qty: planned, unit: 'szt. skrzydła', station: 'Czopiarka' });
const w = [W('a', 'OGL-INN-01', '', null), W('b', 'SAS-KPL-SK01', '1', 4), W('c', 'SAS-SKR-ST05', '1', 8), W('d', 'SAS-BOX-SB01', '1', 4), W('e', 'DOD-HRN-01', '1', 8), W('f', 'CAS-RAM-ST03', '2', 3), W('g', 'SAS-SKR-SK08', '1', 8)];
ok('WEM order: position, box, joinery, assembly, add-ons, downtime last', w.slice().sort(taskOrder).map((t) => t.id).join('') === 'dcbgefa', w.slice().sort(taskOrder).map((t) => t.code));
ok('measured: a code and a planned quantity', measured(w[1]) && !measured(w[0]) && !measured(tasks[0]) && !measured(null));
ok('quantity starts: work — what is left, setup 0, rework empty', qtyDefault('work', 8, 3) === '5' && qtyDefault('work', 8, 10) === '0' && qtyDefault('setup', 8, 0) === '0' && qtyDefault('rework', 8, 0) === '' && qtyDefault(null, 4, 1) === '3');
ok('quantity typed', parseQty('8') === 8 && parseQty(' 2,5 ') === 2.5 && parseQty('') === null && parseQty('-1') === null && parseQty('abc') === null && parseQty('0') === 0);
ok('labels', typeLabel('setup') === 'Przezbrojenie' && typeLabel(null) === '' && doneLine(w[2], 3) === 'zrobione 3 / 8 szt. skrzydła');

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('timeLogic: all passed');
