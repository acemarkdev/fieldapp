// Sync an item's snags to Monday. A snag is recorded as a DUPLICATE of the original
// board item, with:
//   - name  = "<original name> — <snag comment>"
//   - Install Status = "Snag"
//   - Labour Cost cleared (a snag carries no labour cost)
// Everything else (the survey spec) is copied from the original by the duplicate.
// Idempotent: matched by the snag item's name, so re-running updates instead of duplicating.
import { Monday, type MondayColumn } from './monday';
import { getSurveyItem, getJob, listSnagsForItem, markSnagSynced, downloadPhoto } from './store';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
function findCol(cols: MondayColumn[], title: string, types: string[]): MondayColumn | undefined {
  return cols.find((c) => norm(c.title) === norm(title) && types.includes(c.type));
}

export interface SnagSyncResult { created: number; updated: number; total: number; photos: number }

export async function syncSnagsForItem(itemId: string): Promise<SnagSyncResult> {
  const item = await getSurveyItem(itemId);
  if (!item.monday_item_id) throw new Error('Item is not on Monday yet — promote it first.');
  const job = await getJob(item.job_id);
  if (!job.monday_board_id) throw new Error('Job has no Monday board linked.');
  const boardId = job.monday_board_id;

  const monday = new Monday();
  const cols = await monday.getColumns(boardId);
  const installCol = findCol(cols, 'Install Status', ['status', 'color']);
  const labourCol = findCol(cols, 'Labour Cost', ['numbers', 'numeric']);
  const sketchCol = findCol(cols, 'Design Sketch', ['file']);

  const originalName = item.full_code ?? '';
  const snags = await listSnagsForItem(itemId);

  let created = 0, updated = 0, photos = 0;
  for (const snag of snags) {
    const snagName = `${originalName} — ${snag.description}`.slice(0, 255);
    const values: Record<string, unknown> = {};
    if (installCol) values[installCol.id] = { label: 'Snag' };
    if (labourCol) values[labourCol.id] = ''; // clear Labour Cost on the snag copy

    const existingId = await monday.findItemIdByName(boardId, snagName);
    let snagItemId: string;
    if (existingId) {
      await monday.changeColumnValues(boardId, existingId, values);
      snagItemId = existingId;
      updated++;
    } else {
      snagItemId = await monday.duplicateItem(boardId, item.monday_item_id);
      await monday.changeColumnValues(boardId, snagItemId, { name: snagName, ...values });
      created++;
    }

    // snag photo -> Design Sketch column
    if (snag.photo_path && sketchCol) {
      try {
        const bytes = await downloadPhoto(snag.photo_path);
        const fileName = snag.photo_path.split('/').pop() ?? 'snag.png';
        await monday.addFileToColumn(snagItemId, sketchCol.id, bytes, fileName);
        photos++;
      } catch (e: any) {
        console.warn(`   (photo upload skipped for snag ${snag.id}: ${e?.message ?? e})`);
      }
    }

    await markSnagSynced(snag.id, snagItemId); // stores the snag copy's Monday item id
  }
  return { created, updated, total: snags.length, photos };
}
