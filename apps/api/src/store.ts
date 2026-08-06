// Canonical-store access — the survey item's home before (and after) it reaches Monday.
import { db } from './supabase';
import type { Job, SurveyItem, FitterTeam } from '@ace/shared';

export async function getJobByCode(clientCode: string, jobCode: string): Promise<Job> {
  const { data, error } = await db()
    .from('jobs').select('*')
    .eq('client_code', clientCode).eq('job_code', jobCode).single();
  if (error) throw error;
  return data as Job;
}

export async function getJob(id: string): Promise<Job> {
  const { data, error } = await db().from('jobs').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Job;
}

export async function setJobBoard(jobId: string, boardId: string): Promise<void> {
  const { error } = await db().from('jobs').update({ monday_board_id: boardId }).eq('id', jobId);
  if (error) throw error;
}

// Insert or update by (tenant_id, full_code) — safe to re-run, never duplicates.
export async function upsertSurveyItem(item: Partial<SurveyItem>): Promise<SurveyItem> {
  const { data, error } = await db()
    .from('survey_items')
    .upsert(item, { onConflict: 'tenant_id,full_code' })
    .select().single();
  if (error) throw error;
  return data as SurveyItem;
}

export async function getSurveyItem(id: string): Promise<SurveyItem> {
  const { data, error } = await db().from('survey_items').select('*').eq('id', id).single();
  if (error) throw error;
  return data as SurveyItem;
}

export async function getTeam(id: string | null): Promise<FitterTeam | null> {
  if (!id) return null;
  const { data, error } = await db().from('fitter_teams').select('*').eq('id', id).single();
  if (error) throw error;
  return data as FitterTeam;
}

export async function listSurveyItems(jobId: string): Promise<SurveyItem[]> {
  const { data, error } = await db()
    .from('survey_items').select('*')
    .eq('job_id', jobId).order('full_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SurveyItem[];
}

export async function listTeams(tenantId: string): Promise<FitterTeam[]> {
  const { data, error } = await db().from('fitter_teams').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data ?? []) as FitterTeam[];
}

export async function markItemSynced(id: string, mondayItemId: string): Promise<void> {
  const { error } = await db()
    .from('survey_items')
    .update({ monday_item_id: mondayItemId, stage: 'synced' })
    .eq('id', id);
  if (error) throw error;
}
