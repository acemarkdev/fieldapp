// Batch-promote every surveyed item of a job from the canonical store to Monday.
//
// Run:  node --env-file=.env --import tsx apps/api/src/promote-all.ts [CLIENT.JOB] [boardId]
//   e.g. node --env-file=.env --import tsx apps/api/src/promote-all.ts AXS.LAB
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env.

import { getJobByCode, listSurveyItems, setJobBoard } from './store';
import { promoteItem } from './promote';

const PRODUCTION_BOARD = '18410303410'; // never write here from a dev run
const TEST_BOARD = '18424137545';

const arg = process.argv[2] ?? 'AXS.LAB';
const boardId = process.argv[3] ?? TEST_BOARD;
const [clientCode, jobCode] = arg.split('.');
if (!clientCode || !jobCode) { console.error('Usage: promote-all.ts CLIENT.JOB [boardId]'); process.exit(1); }

if (boardId === PRODUCTION_BOARD) {
  console.error('Refusing to run against the production board. Pass a test board id.');
  process.exit(1);
}

const job = await getJobByCode(clientCode, jobCode);
await setJobBoard(job.id, boardId); // dev safety: point at the given (test) board

const items = await listSurveyItems(job.id);
const ready = items.filter((it) => it.stage === 'surveyed' || it.stage === 'synced');

console.log(`Promoting ${ready.length} surveyed item(s) of ${arg} to board ${boardId}...\n`);
let ok = 0;
for (const it of ready) {
  try {
    const r = await promoteItem(it.id);
    console.log(`  ✓ ${r.action.padEnd(7)} ${it.full_code}`);
    ok++;
  } catch (e: any) {
    console.log(`  ✗ ${it.full_code} — ${e?.message ?? e}`);
  }
}
console.log(`\nDone. ${ok}/${ready.length} synced to Monday. (${items.length - ready.length} still scanned / not surveyed.)`);
