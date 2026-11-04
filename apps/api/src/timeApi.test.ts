// Run: npx tsx apps/api/src/timeApi.test.ts
import { parseQuery, polishDayStart, entryOut, rateLimited } from './timeApi';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const q = (s: string, company: any = null) => parseQuery(new URLSearchParams(s), { company });

ok('a month', JSON.stringify(q('from=2026-11-01&to=2026-11-30')) === JSON.stringify({ ok: true, from: '2026-11-01', to: '2026-11-30', company: null, offset: 0, limit: 1000 }), q('from=2026-11-01&to=2026-11-30'));
ok('one day when "to" is left out', (q('from=2026-11-03') as any).to === '2026-11-03');
ok('bad or missing dates', !q('').ok && !q('from=3.11.2026').ok && !q('from=2026-11-05&to=2026-11-01').ok);
ok('at most 93 days', q('from=2026-01-01&to=2026-04-03').ok && !q('from=2026-01-01&to=2026-04-04').ok);
ok('company filter', (q('from=2026-11-01&company=WEM') as any).company === 'wem' && !q('from=2026-11-01&company=xyz').ok);
ok('a key for one company reads only that one', (q('from=2026-11-01', 'wem') as any).company === 'wem' && !q('from=2026-11-01&company=acemark', 'wem').ok);
ok('limit and offset are bounded', (q('from=2026-11-01&limit=99999&offset=-5') as any).limit === 5000 && (q('from=2026-11-01&limit=99999&offset=-5') as any).offset === 0 && (q('from=2026-11-01&limit=abc') as any).limit === 1000);

ok('a Polish day starts at local midnight (winter / summer time)', polishDayStart('2026-11-04') === '2026-11-03T23:00:00.000Z' && polishDayStart('2026-07-01') === '2026-06-30T22:00:00.000Z', [polishDayStart('2026-11-04'), polishDayStart('2026-07-01')]);

const e = entryOut({ id: 'E1', company: 'wem', user_id: 'U1', user_name: 'Jan', user_email: 'jan@x', task_id: 'T1', task_name: 'Z_394_ciecie', job_key: 'Z.394', started_at: '2026-11-04T06:00:00.000Z', ended_at: '2026-11-04T08:30:00.000Z', time_type: 'work', qty_done: '12.50', note: null, source: 'app', created_at: '2026-11-04T06:00:01Z' },
  { job_ref: 'Z.394', operation: 'ciecie', op_id: 'A0002', code: null, station: 'Piła' });
ok('an entry: local date and times, hours, task and job, no money', e.date === '2026-11-04' && e.start_time === '07:00:00' && e.end_time === '09:30:00' && e.duration_hours === 2.5 && e.job_ref === 'Z.394' && e.task.operation === 'ciecie' && e.task.station === 'Piła' && e.qty_done === 12.5 && e.company === 'wem' && !('rate' in e) && !JSON.stringify(e).includes('rate'), e);
const run = entryOut({ id: 'E2', started_at: '2026-11-04T06:00:00.000Z', ended_at: null, company: null }, undefined);
ok('a running entry', run.running && run.ended_at === null && run.duration_hours === 0 && run.company === 'acemark' && run.task.name === null);

let limited = false; for (let i = 0; i < 121; i++) limited = rateLimited('K1');
ok('121st request in a minute is refused', limited && !rateLimited('K2'));

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('timeApi: all passed');
