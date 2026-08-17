// "Promote to Monday": read a surveyed item from the canonical store, sync it to the
// job's Monday board, then record the Monday id and flip the item's stage to 'synced'.
import { Monday } from './monday';
import { upsertSurveyItem as upsertToMonday } from './syncItem';
import { getSurveyItem, getJob, getTeam, markItemSynced, listItemPhotos, downloadPhoto, setJobBoard, markPhotoPushed } from './store';
import { effectiveRatePennies } from '@ace/shared';

export interface PromoteResult {
  mondayItemId: string;
  action: 'created' | 'updated';
  boardId: string;
  photosPushed?: number;
  photoError?: string;
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

  // Push field photos (survey shots + snag sketches) to the board's Design Sketch column,
  // once each — the monday_pushed flag stops re-syncs from piling up duplicate files.
  let photosPushed = 0; let photoError: string | undefined;
  try {
    const pending = (await listItemPhotos(itemId)).filter((p) => ['sketch', 'survey'].includes(p.kind) && !p.monday_pushed);
    if (pending.length) {
      const cols = await monday.getColumns(job.monday_board_id);
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const sketchCol = cols.find((c) => norm(c.title) === 'design sketch' && c.type === 'file');
      if (!sketchCol) {
        photoError = `No "Design Sketch" file column on board ${job.monday_board_id}.`;
      } else {
        for (const ph of pending) {
          const bytes = await downloadPhoto(ph.storage_path);
          await monday.addFileToColumn(res.itemId, sketchCol.id, bytes, ph.storage_path.split('/').pop() ?? 'photo.jpg');
          await markPhotoPushed(ph.id);
          photosPushed++;
        }
      }
    }
  } catch (e: any) {
    photoError = e?.message ?? String(e);
    console.warn(`[promote] photo push failed for ${itemId}: ${photoError}`);
  }

  return { mondayItemId: res.itemId, action: res.action, boardId: job.monday_board_id, photosPushed, photoError };
}
