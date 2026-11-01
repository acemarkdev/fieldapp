// Idempotent "promote to Monday": create the item if it's new, otherwise update it.
// Keyed on the Monday row it was synced to, else on the item name = full code, so re-running is safe (no duplicates).

import { Monday } from './monday';
import { buildColumnValues, pickPlanDateColumn, type SyncInputs } from './mapItem';

export interface SyncResult {
  itemId: string;
  action: 'created' | 'updated';
  fullCode: string;
}

/** The Monday row's name: the full code; a snag also shows its defect text (the code stays the Full Location Ref). */
export function mondayItemName(fullCode: string, item: { kind?: string | null; snag_comment?: string | null }): string {
  return item.kind === 'snag' && item.snag_comment ? `${fullCode} — ${item.snag_comment}`.slice(0, 255) : fullCode;
}
/** Flat or Room changed on a synced item: its code changes, so the Monday row is renamed to match. */
export async function renameOnMonday(monday: Pick<Monday, 'changeColumnValues'>, boardId: string, mondayItemId: string, fullCode: string, item: { kind?: string | null; snag_comment?: string | null }): Promise<void> {
  await monday.changeColumnValues(boardId, mondayItemId, { name: mondayItemName(fullCode, item) });
}

export async function upsertSurveyItem(
  monday: Monday,
  boardId: string,
  inputs: SyncInputs,
): Promise<SyncResult> {
  const fullCode = inputs.item.full_code;
  if (!fullCode) throw new Error('Item has no full_code — cannot sync.');

  const itemName = mondayItemName(fullCode, inputs.item as any);

  const cols = await monday.getColumns(boardId);
  const columnValues = buildColumnValues(cols, inputs);

  // Already synced: update that row, also when the name has just changed (a search by the new name could miss it and
  // make a duplicate). If the row is gone from Monday, carry on by name.
  const stored = (inputs.item as any).monday_item_id;
  if (stored) {
    try {
      await monday.changeColumnValues(boardId, String(stored), { ...columnValues, name: itemName });
      return { itemId: String(stored), action: 'updated', fullCode };
    } catch { /* not on this board any more */ }
  }

  const existingId = await monday.findItemIdByName(boardId, itemName);
  if (existingId) {
    await monday.changeColumnValues(boardId, existingId, columnValues);
    return { itemId: existingId, action: 'updated', fullCode };
  }
  // A row that is new on Monday has no planned date there yet. If the app already holds one (set by
  // "Propose install plan" before the first sync), send it — otherwise the morning pull, which treats
  // Monday as the master for dates, would wipe it. Existing rows are left alone: Monday's date wins.
  const planned = String((inputs.item as any).planned_install_date ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(planned)) {
    const dc = pickPlanDateColumn(cols, true);
    if (dc) columnValues[dc.id] = { date: planned };
  }
  const itemId = await monday.createItem(boardId, itemName, columnValues);
  return { itemId, action: 'created', fullCode };
}
