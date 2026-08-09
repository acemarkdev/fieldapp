// "Promote to Monday": read a surveyed item from the canonical store, sync it to the
// job's Monday board, then record the Monday id and flip the item's stage to 'synced'.
import { Monday } from './monday';
import { upsertSurveyItem as upsertToMonday } from './syncItem';
import { getSurveyItem, getJob, getTeam, markItemSynced, listItemPhotos, downloadPhoto, setJobBoard } from './store';
import { effectiveRatePennies } from '@ace/shared';

export interface PromoteResult {
  mondayItemId: string;
  action: 'created' | 'updated';
  boardId: string;
}

export async function promoteItem(itemId: string): Promise<PromoteResult> {
  const item = await getSurveyItem(itemId);
  const job = await getJob(item.job_id);
  if (!job.monday_board_id) throw new Error(`Job ${job.client_code}.${job.job_code} has no Monday board linked.`);

  const team = await getTeam(item.team_id);
  const ratePennies = effectiveRatePennies(item, team ? [team] : []);
  const ratePounds = ratePennies != null ? ratePennies / 100 : null;

  const monday = new Monday();
  const res = await upsertToMonday(monday, job.monday_board_id, {
    item,
    ratePounds,
    teamName: team?.name ?? null, // sets the Fitters dropdown, matched by name
  });

  await markItemSynced(itemId, res.itemId);

  // Backfill the job's Monday account slug (once) so item links resolve to the right account.
  if (!(job as any).monday_account_slug) {
    try { const slug = await monday.getAccountSlug(); if (slug) await setJobBoard(job.id, job.monday_board_id, slug); }
    catch { /* best-effort */ }
  }

  // Push any 'sketch' photos (e.g. a snag's defect photo) to the board's Design Sketch column.
  try {
    const sketches = (await listItemPhotos(itemId)).filter((p) => p.kind === 'sketch');
    if (sketches.length) {
      const cols = await monday.getColumns(job.monday_board_id);
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const sketchCol = cols.find((c) => norm(c.title) === 'design sketch' && c.type === 'file');
      if (sketchCol) {
        for (const ph of sketches) {
          const bytes = await downloadPhoto(ph.storage_path);
          await monday.addFileToColumn(res.itemId, sketchCol.id, bytes, ph.storage_path.split('/').pop() ?? 'sketch.png');
        }
      }
    }
  } catch { /* fail-soft: the item is synced; photo is best-effort */ }

  return { mondayItemId: res.itemId, action: res.action, boardId: job.monday_board_id };
}
