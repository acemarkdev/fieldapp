// Run: npx tsx apps/mobile/src/lib/demoClient.test.ts — the demo database behaves like Supabase for every screen
import { demoClient, resetDemoDb, demoDb } from './demoClient';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

(async () => {
  resetDemoDb();
  // the fitter schedule query
  const sch = await demoClient.from('survey_items').select('id,install_status,planned_install_date,jobs(client_code,job_code,name)').not('install_status', 'is', null).eq('team_id', 'demo-team-a');
  ok('schedule: items with a status, for the team, with their job attached', !sch.error && sch.data.length > 0 && sch.data.every((r: any) => r.install_status && r.jobs?.client_code === 'AXS'), sch);
  ok('schedule: something is planned for today', sch.data.some((r: any) => r.planned_install_date === today));
  // production time
  const tasks = await demoClient.from('prod_tasks').select('id,job_ref,operation').eq('active', true).order('job_ref');
  ok('production tasks for two jobs', tasks.data.length === 9 && tasks.data[0].job_ref === 'Z.394');
  const before = await demoClient.from('time_entries').select('*').order('started_at', { ascending: false }).limit(60);
  ok('entries newest first', before.data.length === 2 && before.data[0].id === 'demo-te2');
  await demoClient.rpc('prod_start', { p_task: 'demo-t410-3' });
  await demoClient.rpc('prod_start', { p_task: 'demo-t394-2' });
  const run = demoDb.time_entries.filter((e: any) => !e.ended_at);
  ok('starting a task stops the running one', run.length === 1 && run[0].task_id === 'demo-t394-2' && demoDb.time_entries.length === 4, demoDb.time_entries);
  await demoClient.rpc('prod_stop');
  ok('stop', demoDb.time_entries.every((e: any) => e.ended_at));
  await demoClient.rpc('prod_edit_entry', { p_entry: 'demo-te1', p_start: 'S', p_end: 'E', p_note: ' przerwa ' });
  ok('edit an entry', demoDb.time_entries.find((e: any) => e.id === 'demo-te1').note === 'przerwa');
  // in / is / delete
  const two = await demoClient.from('survey_items').select('id').in('id', ['demo-i1', 'demo-i2']);
  ok('in()', two.data.length === 2);
  await demoClient.from('survey_items').delete().in('id', ['demo-i1']);
  ok('delete()', !demoDb.survey_items.some((r: any) => r.id === 'demo-i1'));
  ok('reset brings the data back', (resetDemoDb(), demoDb.survey_items.some((r: any) => r.id === 'demo-i1')));
  if (fail) { console.error(fail + ' failed'); process.exit(1); }
  console.log('demoClient: all passed');
})();
