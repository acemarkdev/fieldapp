// "Promote to Monday": read a surveyed item from the canonical store, sync it to the
// job's Monday board, then record the Monday id and flip the item's stage to 'synced'.
import { Monday } from './monday';
import { upsertSurveyItem as upsertToMonday } from './syncItem';
import { getSurveyItem, getJob, getTeam, markItemSynced, listItemPhotos, downloadPhoto, setJobBoard, markPhotoPushed, markStyleSketchPushed } from './store';
import { sketchToPush, readStyleSketch } from './styleSketch';
import { effectiveRatePennies } from '@ace/shared';

export interface PromoteResult {
  mondayItemId: string;
  action: 'created' | 'updated';
  boardId: string;
  photosPushed?: number;
  photoError?: string;
  sketchPushed?: string;   // style code whose drawing was uploaded to Design Sketch in this sync
  sketchError?: string;
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

  // Push field photos to the right Monday file column, once each — the monday_pushed flag
  // stops re-syncs from piling up duplicate files. Routing by photo kind:
  //   before  -> "Picture Before"   (scanner / surveyor)
  //   after   -> "Picture After"    (fitter)
  //   survey / sketch -> "Design Sketch"  (legacy mobile survey shots & snag sketches)
  const COLUMN_FOR_KIND: Record<string, string> = {
    before: 'picture before', after: 'picture after', survey: 'design sketch', sketch: 'design sketch',
  };
  let photosPushed = 0; let photoError: string | undefined;
  try {
    const pending = (await listItemPhotos(itemId)).filter((p) => COLUMN_FOR_KIND[p.kind] && !p.monday_pushed);
    if (pending.length) {
      const cols = await monday.getColumns(job.monday_board_id);
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const fileCol = (title: string) => cols.find((c) => norm(c.title) === title && c.type === 'file');
      const missing = new Set<string>();
      for (const ph of pending) {
        const wantTitle = COLUMN_FOR_KIND[ph.kind];
        const col = fileCol(wantTitle);
        if (!col) { missing.add(wantTitle); continue; }
        const bytes = await downloadPhoto(ph.storage_path);
        await monday.addFileToColumn(res.itemId, col.id, bytes, ph.storage_path.split('/').pop() ?? 'photo.jpg');
        await markPhotoPushed(ph.id);
        photosPushed++;
      }
      if (missing.size) {
        const pretty = [...missing].map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join('", "');
        photoError = `No file column(s) named "${pretty}" on board ${job.monday_board_id}.`;
      }
    }
  } catch (e: any) {
    photoError = e?.message ?? String(e);
    console.warn(`[promote] photo push failed for ${itemId}: ${photoError}`);
  }

  // Style drawing -> "Design Sketch", once per item and style (see styleSketch.ts). Best-effort:
  // a failure here never fails the sync itself.
  let sketchPushed: string | undefined; let sketchError: string | undefined;
  try {
    const key = sketchToPush(item as any);
    if (key) {
      const cols = await monday.getColumns(job.monday_board_id);
      const col = cols.find((c) => c.title.trim().toLowerCase().replace(/\s+/g, ' ') === 'design sketch' && c.type === 'file');
      if (!col) sketchError = `No file column named "Design Sketch" on board ${job.monday_board_id}.`;
      else {
        await monday.addFileToColumn(res.itemId, col.id, readStyleSketch(key), `Style ${key}.png`, 'image/png');
        await markStyleSketchPushed(itemId, key);
        sketchPushed = key;
      }
    }
  } catch (e: any) {
    sketchError = e?.message ?? String(e);
    console.warn(`[promote] style sketch push failed for ${itemId}: ${sketchError}`);
  }

  return { mondayItemId: res.itemId, action: res.action, boardId: job.monday_board_id, photosPushed, photoError, sketchPushed, sketchError };
}
