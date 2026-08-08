// Install / completion: a fitter marks an item installed. Updates the canonical store
// and Monday — Install Status, Actual Install Date, and after-photo → Picture After.
import { Monday, type MondayColumn } from './monday';
import { getSurveyItem, getJob, markItemInstalled, downloadPhoto } from './store';
import { INSTALL_STATUS_LABEL } from './mapItem';
import type { InstallStatus } from '@ace/shared';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
function findCol(cols: MondayColumn[], title: string, types: string[]): MondayColumn | undefined {
  return cols.find((c) => norm(c.title) === norm(title) && types.includes(c.type));
}

export interface InstallOptions {
  snag?: boolean;       // installed with a snag?
  date?: string;        // YYYY-MM-DD (defaults to today)
  photoPath?: string;   // Supabase storage path of the after-install photo
}

export interface InstallResult {
  status: InstallStatus;
  date: string;
  photoUploaded: boolean;
  mondayItemId: string;
}

export async function installItem(itemId: string, opts: InstallOptions = {}): Promise<InstallResult> {
  const item = await getSurveyItem(itemId);
  if (!item.monday_item_id) throw new Error('Item is not on Monday yet — promote it first.');
  const job = await getJob(item.job_id);
  if (!job.monday_board_id) throw new Error('Job has no Monday board linked.');
  const boardId = job.monday_board_id;

  const status: InstallStatus = opts.snag ? 'installed_snag' : 'installed_no_snag';
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  // 1. canonical store
  await markItemInstalled(itemId, status, date);

  // 2. Monday: Install Status + Actual Install Date (matched by title)
  const monday = new Monday();
  const cols = await monday.getColumns(boardId);
  const statusCol = findCol(cols, 'Install Status', ['status', 'color']);
  const dateCol = findCol(cols, 'Actual Install Date', ['date']);
  const values: Record<string, unknown> = {};
  if (statusCol) values[statusCol.id] = { label: INSTALL_STATUS_LABEL[status] };
  if (dateCol) values[dateCol.id] = { date };
  await monday.changeColumnValues(boardId, item.monday_item_id, values);

  // 3. after-photo -> Picture After (file column)
  let photoUploaded = false;
  const pictureCol = findCol(cols, 'Picture After', ['file']);
  if (opts.photoPath && pictureCol) {
    try {
      const bytes = await downloadPhoto(opts.photoPath);
      const fileName = opts.photoPath.split('/').pop() ?? 'after.png';
      await monday.addFileToColumn(item.monday_item_id, pictureCol.id, bytes, fileName);
      photoUploaded = true;
    } catch (e: any) {
      console.warn(`   (after-photo upload failed, completion still recorded: ${e?.message ?? e})`);
    }
  }

  return { status, date, photoUploaded, mondayItemId: item.monday_item_id };
}
