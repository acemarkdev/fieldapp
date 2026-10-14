// Run: npx tsx apps/mobile/src/lib/timeLogic.test.ts
import { groupTasks, clock, hoursToday, type ProdTask } from './timeLogic';

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

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('timeLogic: all passed');
