// Store report — a quick CLI view of a job's survey items from the canonical store.
//
// Run:  node --env-file=.env --import tsx apps/api/src/report.ts [CLIENT.JOB]
//   e.g. node --env-file=.env --import tsx apps/api/src/report.ts AXS.LAB
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.

import { pathToFileURL } from 'node:url';
import { getJobByCode, listSurveyItems, listTeams } from './store';
import { effectiveRatePennies, formatPennies } from '@ace/shared';

const STAGE_LABEL: Record<string, string> = {
  scanned: 'Scanned', in_survey: 'In survey', surveyed: 'Surveyed', synced: 'Synced → Monday',
};

const pad = (s: unknown, n: number) => String(s ?? '—').padEnd(n);

export async function main(arg = process.argv[2] ?? 'AXS.LAB'): Promise<void> {
  const [clientCode, jobCode] = arg.split('.');
  if (!clientCode || !jobCode) {
    console.error('Usage: report.ts CLIENT.JOB   e.g. AXS.LAB');
    process.exit(1);
  }

  const job = await getJobByCode(clientCode, jobCode);
  const items = await listSurveyItems(job.id);
  const teams = await listTeams(job.tenant_id);

  console.log(`\n${job.client_code}.${job.job_code} — ${job.name}`);
  console.log(`Monday board: ${job.monday_board_id ?? '(not linked)'}\n`);

  console.log(
    pad('FULL CODE', 30) + pad('ROOM', 8) + pad('ITEM', 6) +
    pad('STAGE', 17) + pad('RATE', 9) + 'MONDAY',
  );
  console.log('─'.repeat(96));

  const counts: Record<string, number> = {};
  let totalPennies = 0;
  for (const it of items) {
    const rate = effectiveRatePennies(it, teams);
    if (rate != null) totalPennies += rate;
    const link = it.monday_item_id && job.monday_board_id
      ? `https://monday.com/boards/${job.monday_board_id}/pulses/${it.monday_item_id}`
      : '—';
    console.log(
      pad(it.full_code, 30) + pad(it.room_code, 8) + pad(it.item_code, 6) +
      pad(STAGE_LABEL[it.stage] ?? it.stage, 17) + pad(formatPennies(rate), 9) + link,
    );
    counts[it.stage] = (counts[it.stage] ?? 0) + 1;
  }

  console.log('─'.repeat(96));
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${STAGE_LABEL[k] ?? k}`).join(' · ') || 'no items';
  console.log(`${items.length} item(s)  ·  ${summary}  ·  labour total ${formatPennies(totalPennies)}\n`);
}

// Only run when executed directly (so the module can be imported/tested without side effects).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}
