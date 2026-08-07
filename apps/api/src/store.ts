// Canonical-store access — the survey item's home before (and after) it reaches Monday.
import { db } from './supabase';
import type { Job, SurveyItem, FitterTeam, Snag } from '@ace/shared';

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

// ---- snags ----
export async function listSnagsForItem(itemId: string): Promise<Snag[]> {
  const { data, error } = await db().from('snags').select('*').eq('item_id', itemId).order('created_at');
  if (error) throw error;
  return (data ?? []) as Snag[];
}

// No natural key on snags, so match on (item_id, description) for re-run safety.
export async function upsertSnag(snag: Partial<Snag>): Promise<Snag> {
  const found = await db().from('snags').select('id')
    .eq('item_id', snag.item_id!).eq('description', snag.description!).maybeSingle();
  if (found.data) {
    const { data, error } = await db().from('snags').update(snag).eq('id', found.data.id).select().single();
    if (error) throw error;
    return data as Snag;
  }
  const { data, error } = await db().from('snags').insert(snag).select().single();
  if (error) throw error;
  return data as Snag;
}

export async function markSnagSynced(id: string, subitemId: string): Promise<void> {
  const { error } = await db().from('snags').update({ monday_subitem_id: subitemId }).eq('id', id);
  if (error) throw error;
}

// ---- photo storage (Supabase Storage) ----
export const PHOTO_BUCKET = 'photos';

export async function ensurePhotoBucket(): Promise<void> {
  const { data } = await db().storage.getBucket(PHOTO_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(PHOTO_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function uploadPhoto(path: string, bytes: Uint8Array, contentType = 'image/png'): Promise<void> {
  const { error } = await db().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

export async function downloadPhoto(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(PHOTO_BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
