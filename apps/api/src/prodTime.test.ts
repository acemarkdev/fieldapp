// Run: npx tsx apps/api/src/prodTime.test.ts   (rows as in the real wejście / wyjście sheets)
import { jobRefOf, taskFromRow, labourByJob, exportRow, hms, hoursBetween, timesChanged } from './prodTime';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('job numbers', jobRefOf('Z_394') === 'Z.394' && jobRefOf('z 394') === 'Z.394' && jobRefOf('Z.394') === 'Z.394' && jobRefOf('Z_282_poprawka') === 'Z.282 poprawka' && jobRefOf('AKCESORIA') === 'AKCESORIA');
const t = taskFromRow(['Z_394_cnc_Poz_1_swietlik_staly_011_w0', 'UTWORZONO', 'Z_394', 'A0025', 'cnc swietlik staly', 'cnc swietlik staly']);
ok('a wejście row → a task', !!t && t.export_name === 'Z_394_cnc_Poz_1_swietlik_staly_011_w0' && t.job_ref === 'Z.394' && t.job_key === 'Z.394' && t.op_id === 'A0025' && t.operation === 'cnc swietlik staly', t);
ok('the header and empty rows are skipped', taskFromRow(['Eksport_Clockify', 'Status_Clockify', 'Zlecenie', 'ID_operacji', 'Operacja', 'Alias_operacji']) === null && taskFromRow(['', '', '', '', '', '']) === null && taskFromRow(['Z_1_x', '', 'Z_1', '', '', '']) === null);
ok('job taken from the task name when the Zlecenie column is empty', taskFromRow(['Z_400_szklenie', '', '', 'A0007', 'szklenie', ''])?.job_ref === 'Z.400');

// 12.37 h on Z_394 in the sample export
const E = (u: string, job: string, s: string, e: string | null) => ({ user_id: u, job_key: job, started_at: s, ended_at: e });
const entries = [E('gk', 'Z.394', '2026-08-18T04:43:23Z', '2026-08-18T06:49:26Z'), E('rc', 'Z.394', '2026-08-17T04:00:18Z', '2026-08-17T04:47:23Z'), E('kt', 'Z.394', '2026-08-04T04:18:15Z', '2026-08-04T04:45:32Z'), E('gk', 'Z.395', '2026-08-19T04:00:00Z', null)];
const lab = labourByJob(entries, new Map([['gk', 50], ['rc', 40]]), 45);
const z = lab.get('Z.394')!;
ok('hours and cost per job, each worker at their rate', z.hours === 3.34 && z.cost === 156.89 && z.unrated === 0.45, z);
ok('a running entry does not count yet', !lab.has('Z.395'));
ok('entries after a job was locked do not count', labourByJob(entries, new Map(), 45, new Map([['Z.394', '2026-08-10T00:00:00Z']])).get('Z.394')!.hours === 0.45);

ok('h:m:s', hms(0.21027) === '00:12:37' && hms(2.1) === '02:06:00' && hoursBetween('2026-08-18T04:43:23Z', '2026-08-18T06:49:26Z').toFixed(2) === '2.10');
const row = exportRow({ task_name: 'Z_394_pakowanie', user_name: 'G.kozlowski', user_email: 'g@x.pl', note: null, started_at: '2026-08-19T07:31:46Z', ended_at: '2026-08-19T07:44:23Z', created_at: '2026-08-19T07:44:23Z' }, 50);
ok('export row in the old layout, Polish time', row.join('|') === 'Produkcja|||Z_394_pakowanie||G.kozlowski||g@x.pl||Yes|2026-08-19|09:31:46|2026-08-19|09:44:23|00:12:37|0.21|50|10.51|2026-08-19', row.join('|'));

ok('only start or end changes count as a time edit', !timesChanged({ started_at: '2026-10-15T06:00:00Z', ended_at: '2026-10-15T07:00:00Z' }, { started_at: '2026-10-15T06:00:00.000Z', ended_at: '2026-10-15T07:00:00+00:00' })
  && timesChanged({ started_at: '2026-10-15T06:00:00Z', ended_at: '2026-10-15T07:00:00Z' }, { started_at: '2026-10-15T06:05:00Z', ended_at: '2026-10-15T07:00:00Z' })
  && timesChanged({ started_at: '2026-10-15T06:00:00Z', ended_at: null }, { started_at: '2026-10-15T06:00:00Z', ended_at: '2026-10-15T07:00:00Z' }) && timesChanged(null, { started_at: 'x' }));

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('prodTime: all passed');
