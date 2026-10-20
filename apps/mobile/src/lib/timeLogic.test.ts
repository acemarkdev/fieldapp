// Run: npx tsx apps/mobile/src/lib/timeLogic.test.ts
import { groupTasks, clock, hoursToday, recentTasks, taskLabel, editableToday, shiftWithinDay, atTime, hhmm, editProblem, type ProdTask } from './timeLogic';

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

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('timeLogic: all passed');
