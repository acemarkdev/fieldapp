// Idempotent "promote to Monday": create the item if it's new, otherwise update it.
// Keyed on the item name = full code, so re-running is safe (no duplicates).

import { Monday } from './monday';
import { buildColumnValues, type SyncInputs } from './mapItem';

export interface SyncResult {
  itemId: string;
  action: 'created' | 'updated';
  fullCode: string;
}

export async function upsertSurveyItem(
  monday: Monday,
  boardId: string,
  inputs: SyncInputs,
): Promise<SyncResult> {
  const fullCode = inputs.item.full_code;
  if (!fullCode) throw new Error('Item has no full_code — cannot sync.');

  const cols = await monday.getColumns(boardId);
  const columnValues = buildColumnValues(cols, inputs);

  const existingId = await monday.findItemIdByName(boardId, fullCode);
  if (existingId) {
    await monday.changeColumnValues(boardId, existingId, columnValues);
    return { itemId: existingId, action: 'updated', fullCode };
  }
  const itemId = await monday.createItem(boardId, fullCode, columnValues);
  return { itemId, action: 'created', fullCode };
}
