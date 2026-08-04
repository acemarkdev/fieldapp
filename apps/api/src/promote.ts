// "Promote to Monday": read a surveyed item from the canonical store, sync it to the
// job's Monday board, then record the Monday id and flip the item's stage to 'synced'.
import { Monday } from './monday';
import { upsertSurveyItem as upsertToMonday } from './syncItem';
import { getSurveyItem, getJob, getTeam, markItemSynced } from './store';
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
  const res = await upsertToMonday(monday, job.monday_board_id, { item, ratePounds });

  await markItemSynced(itemId, res.itemId);
  return { mondayItemId: res.itemId, action: res.action, boardId: job.monday_board_id };
}
