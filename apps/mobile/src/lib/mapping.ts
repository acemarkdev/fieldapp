// Mobile mapping data layer — brings the office "Mapping ▸ Build elevations & floors" bulk
// create to the field app. Uses the shared mapping model (grid → records) and writes straight
// to Supabase (RLS scopes to the signed-in user's tenant), so iPad/iPhone produce items
// identical to the office app. Offline queueing of a preload is handled separately (#105).
import { supabase } from './supabase';
import { enqueueItem } from './offline';
import { mappingItemRecords, tallyGrid, type MappingGrid } from './mappingModel';
import { importItemRecords, type ImportRow } from './importModel';

const localId = () => 'map-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

/**
 * Insert records, or — if the device is offline (or the batch hits a duplicate) — queue them so
 * they sync automatically next time the app is online. Returns how many went in vs were queued.
 */
async function insertOrQueue(records: Record<string, any>[], jobId: string): Promise<{ inserted: number; queued: number; error?: string }> {
  try {
    const { error } = await supabase.from('survey_items').insert(records);
    if (!error) return { inserted: records.length, queued: 0 };
    // A duplicate somewhere in the batch — re-queue per row so the queue inserts the non-dupes
    // and silently drops the dupes (23505) on flush.
    if ((error as any).code === '23505') {
      for (const r of records) await enqueueItem({ localId: localId(), job_id: jobId, full_code: r.full_code, payload: r });
      return { inserted: 0, queued: records.length };
    }
    return { inserted: 0, queued: 0, error: error.message };
  } catch {
    // Network down — queue everything for later.
    for (const r of records) await enqueueItem({ localId: localId(), job_id: jobId, full_code: r.full_code, payload: r });
    return { inserted: 0, queued: records.length };
  }
}

export interface MapJob {
  id: string;
  tenant_id: string;
  client_code: string;
  job_code: string;
  name?: string | null;
  status?: string | null;
  programme_end?: string | null;
}

export interface Me {
  id: string | null;
  tenant_id: string | null;
  role: string | null;
  team_id: string | null;
}

export interface PreloadResult {
  inserted: number;
  queued: number; // saved offline; will sync when back online
  skipped: number; // already existed (duplicate full codes)
  error?: string;
}

/** Resolve the signed-in user's app_users row (id used for created_by/scanned_by). */
export async function getMe(): Promise<Me> {
  const { data: sess } = await supabase.auth.getUser();
  const uid = sess?.user?.id;
  if (!uid) return { id: null, tenant_id: null, role: null, team_id: null };
  const { data } = await supabase
    .from('app_users')
    .select('id,tenant_id,role,team_id')
    .eq('auth_user_id', uid)
    .maybeSingle();
  return {
    id: data?.id ?? null,
    tenant_id: data?.tenant_id ?? null,
    role: data?.role ?? null,
    team_id: data?.team_id ?? null,
  };
}

/** Existing full codes for a job — used to skip duplicates on preload. */
export async function existingFullCodes(jobId: string): Promise<Set<string>> {
  const { data } = await supabase.from('survey_items').select('full_code').eq('job_id', jobId);
  return new Set((data ?? []).map((r: any) => r.full_code).filter(Boolean));
}

/**
 * Preload a whole grid into items for a job. Builds records via the shared model, skips any
 * whose full code already exists, and inserts the rest. Returns how many were created/skipped.
 */
export async function preloadMappingItems(job: MapJob, grid: MappingGrid): Promise<PreloadResult> {
  const me = await getMe();
  const records = mappingItemRecords(grid, {
    client_code: job.client_code,
    job_code: job.job_code,
    tenant_id: job.tenant_id,
    job_id: job.id,
    createdBy: me.id,
  });
  if (!records.length) return { inserted: 0, queued: 0, skipped: 0, error: 'Enter windows or doors on at least one floor.' };

  const existing = await existingFullCodes(job.id);
  const fresh = records.filter((r) => !existing.has(r.full_code));
  const skipped = records.length - fresh.length;
  if (!fresh.length) return { inserted: 0, queued: 0, skipped };

  const r = await insertOrQueue(fresh, job.id);
  return { inserted: r.inserted, queued: r.queued, skipped, error: r.error };
}

/** Convenience: live totals for a grid (Windows · Doors · Items). */
export function gridTotals(grid: MappingGrid) {
  return tallyGrid(grid);
}

export interface ImportResult {
  inserted: number;
  queued: number; // saved offline; will sync when back online
  unfinished: number; // of the inserted, how many are Unfinished
  skipped: number; // already existed
  error?: string;
}

/**
 * Commit reviewed import rows as items (Upload to Items). Builds records via the shared import
 * model (Unfinished flag derived per row), skips full codes that already exist, inserts the rest.
 */
export async function commitImportRows(job: MapJob, rows: ImportRow[]): Promise<ImportResult> {
  const me = await getMe();
  const records = importItemRecords(rows, {
    client_code: job.client_code, job_code: job.job_code,
    tenant_id: job.tenant_id, job_id: job.id, createdBy: me.id,
  });
  if (!records.length) return { inserted: 0, queued: 0, unfinished: 0, skipped: 0, error: 'No item rows to upload.' };

  const existing = await existingFullCodes(job.id);
  const fresh = records.filter((r) => !existing.has(r.full_code));
  const skipped = records.length - fresh.length;
  if (!fresh.length) return { inserted: 0, queued: 0, unfinished: 0, skipped };

  const unfinished = fresh.filter((r) => r.incomplete).length;
  const r = await insertOrQueue(fresh, job.id);
  return { inserted: r.inserted, queued: r.queued, unfinished, skipped, error: r.error };
}

/**
 * Delete items previously imported from Excel for a job. Items already synced to monday.com
 * are kept (matches the office "Delete items imported to this job").
 */
export async function deleteImportedItems(jobId: string): Promise<{ deleted: number; error?: string }> {
  // Count first (so we can report how many went); then delete the same set.
  const { data: rows } = await supabase
    .from('survey_items')
    .select('id')
    .eq('job_id', jobId)
    .eq('from_import', true)
    .is('monday_item_id', null);
  const ids = (rows ?? []).map((r: any) => r.id);
  if (!ids.length) return { deleted: 0 };
  const { error } = await supabase.from('survey_items').delete().in('id', ids);
  if (error) return { deleted: 0, error: error.message };
  return { deleted: ids.length };
}

/**
 * Jobs available to map — those with no items yet — for the mapping job picker (#102).
 * Sorted newest-first; the picker can group by `status`.
 */
export async function mappingJobs(): Promise<MapJob[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,tenant_id,client_code,job_code,name,status,programme_end,survey_items(count)')
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? [])
    .filter((j: any) => (j.survey_items?.[0]?.count ?? 0) === 0)
    .map((j: any) => ({
      id: j.id, tenant_id: j.tenant_id, client_code: j.client_code,
      job_code: j.job_code, name: j.name ?? null, status: j.status ?? null,
      programme_end: j.programme_end ?? null,
    }));
}
