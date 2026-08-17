// Canonical-store access — the survey item's home before (and after) it reaches Monday.
import { db } from './supabase';
import type { Job, SurveyItem, FitterTeam, Snag, ItemPhoto } from '@ace/shared';

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

// slug: string sets it, null clears it, undefined leaves it unchanged.
export async function setJobBoard(jobId: string, boardId: string | null, slug?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { monday_board_id: boardId };
  if (boardId === null) patch.monday_account_slug = null;      // unlinking clears the slug too
  else if (slug !== undefined) patch.monday_account_slug = slug;
  const { error } = await db().from('jobs').update(patch).eq('id', jobId);
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

// Insert a brand-new item (office "New item" form). Throws on duplicate full_code.
export async function insertSurveyItem(fields: Partial<SurveyItem>): Promise<SurveyItem> {
  const { data, error } = await db().from('survey_items').insert(fields).select().single();
  if (error) throw error;
  return data as SurveyItem;
}

// Snag items (kind='snag') raised against a parent item.
export async function listChildSnags(parentId: string): Promise<SurveyItem[]> {
  const { data, error } = await db().from('survey_items').select('*')
    .eq('parent_item_id', parentId).order('full_code');
  if (error) throw error;
  return (data ?? []) as SurveyItem[];
}

// Create a snag as its own survey item: copies the parent's location + spec, gets a
// "-S<n>" code suffix, install_status 'snag', and its own optional team / rate.
export async function createSnagItem(
  parentId: string,
  opts: { comment: string; rate_override_pennies?: number | null; team_id?: string | null },
): Promise<SurveyItem> {
  const parent = await getSurveyItem(parentId);
  const kids = await listChildSnags(parentId);
  const taken = new Set(kids.map((k) => k.full_code));
  let n = 1; while (taken.has(`${parent.full_code}-S${n}`)) n++;
  const full_code = `${parent.full_code}-S${n}`;
  const row: Record<string, unknown> = {
    tenant_id: parent.tenant_id, job_id: parent.job_id, kind: 'snag', parent_item_id: parentId,
    block: parent.block, elevation: parent.elevation, flat: parent.flat, room_code: parent.room_code,
    item_code: parent.item_code, floor: parent.floor, full_code,
    material: parent.material, item_type: parent.item_type, glass: parent.glass,
    safety_glass: parent.safety_glass, glazing: parent.glazing, width_mm: parent.width_mm, height_mm: parent.height_mm,
    stage: 'surveyed', install_status: 'snag', snag_comment: opts.comment, comments: opts.comment,
    team_id: opts.team_id ?? null, rate_override_pennies: opts.rate_override_pennies ?? null,
  };
  const { data, error } = await db().from('survey_items').insert(row).select().single();
  if (error) throw error;
  return data as SurveyItem;
}

export async function addItemPhoto(tenantId: string, itemId: string, kind: string, storagePath: string): Promise<void> {
  const { error } = await db().from('item_photos').insert({ tenant_id: tenantId, item_id: itemId, kind, storage_path: storagePath });
  if (error) throw error;
}

export async function markPhotoPushed(id: string): Promise<void> {
  const { error } = await db().from('item_photos').update({ monday_pushed: true }).eq('id', id);
  if (error) throw error;
}

export async function listItemPhotos(itemId: string): Promise<ItemPhoto[]> {
  const { data, error } = await db().from('item_photos').select('*').eq('item_id', itemId).order('created_at');
  if (error) throw error;
  return (data ?? []) as ItemPhoto[];
}

// Short-lived signed URL for a private-bucket photo (so the browser can render it).
export async function signedPhotoUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await db().storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// Return the subset of ids that belong to this tenant (guards bulk actions).
export async function filterItemIdsByTenant(ids: string[], tenantId: string): Promise<string[]> {
  const { data, error } = await db().from('survey_items').select('id').in('id', ids).eq('tenant_id', tenantId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.id as string);
}

// Apply one patch to many items at once (tenant-scoped). Returns how many rows changed.
export async function bulkUpdateItems(ids: string[], patch: Record<string, unknown>, tenantId: string): Promise<number> {
  const { data, error } = await db().from('survey_items').update(patch).in('id', ids).eq('tenant_id', tenantId).select('id');
  if (error) throw error;
  return (data ?? []).length;
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

export async function listJobs(tenantId: string): Promise<Job[]> {
  const { data, error } = await db().from('jobs').select('*').eq('tenant_id', tenantId).order('job_code');
  if (error) throw error;
  return (data ?? []) as Job[];
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

// ---- user management (office Stage 3) ----
export interface AppUserRow {
  id: string; tenant_id: string; auth_user_id: string | null;
  name: string; email: string; role: string; active: boolean; team_id: string | null;
}

export async function listAppUsers(tenantId: string): Promise<AppUserRow[]> {
  const { data, error } = await db().from('app_users')
    .select('id,tenant_id,auth_user_id,name,email,role,active,team_id').eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data ?? []) as AppUserRow[];
}

export async function getAppUser(id: string): Promise<AppUserRow | null> {
  const { data, error } = await db().from('app_users')
    .select('id,tenant_id,auth_user_id,name,email,role,active,team_id').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as AppUserRow | null;
}

export async function updateAppUser(id: string, patch: Partial<Pick<AppUserRow, 'name' | 'email' | 'role' | 'active' | 'team_id'>>, tenantId: string): Promise<void> {
  const { error } = await db().from('app_users').update(patch).eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// Set an item's team from the Monday pull WITHOUT re-flagging it for re-sync (we just read
// this value from Monday, so it doesn't need pushing back). Two steps: set the team (which the
// flag_resync trigger marks dirty), then clear the flag (a no-op update that the trigger ignores).
export async function setItemTeamFromMonday(id: string, teamId: string | null, tenantId: string): Promise<void> {
  const a = await db().from('survey_items').update({ team_id: teamId }).eq('id', id).eq('tenant_id', tenantId);
  if (a.error) throw a.error;
  const b = await db().from('survey_items').update({ needs_resync: false }).eq('id', id).eq('tenant_id', tenantId);
  if (b.error) throw b.error;
}

// ---- team management (office Stage 2) ----
export async function createTeam(tenantId: string, name: string, ratePennies: number): Promise<FitterTeam> {
  const { data, error } = await db().from('fitter_teams')
    .insert({ tenant_id: tenantId, name, default_rate_pennies: ratePennies })
    .select().single();
  if (error) throw error;
  return data as FitterTeam;
}

export async function updateTeam(id: string, patch: { name?: string; default_rate_pennies?: number }): Promise<void> {
  const { error } = await db().from('fitter_teams').update(patch).eq('id', id);
  if (error) throw error;
}

// How many survey items currently reference this team (used to block deletes that would orphan items).
export async function countItemsUsingTeam(teamId: string): Promise<number> {
  const { count, error } = await db().from('survey_items')
    .select('id', { count: 'exact', head: true }).eq('team_id', teamId);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await db().from('fitter_teams').delete().eq('id', id);
  if (error) throw error;
}

export async function markItemSynced(id: string, mondayItemId: string): Promise<void> {
  const { error } = await db()
    .from('survey_items')
    .update({ monday_item_id: mondayItemId, stage: 'synced', needs_resync: false })
    .eq('id', id);
  if (error) throw error;
}

export async function markItemInstalled(id: string, status: string, date: string): Promise<void> {
  const { error } = await db()
    .from('survey_items')
    .update({ install_status: status, actual_install_date: date })
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
