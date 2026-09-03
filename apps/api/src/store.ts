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

// The optional programme date fields (six start/end pairs) shared by create + update.
export const JOB_DATE_FIELDS = [
  'programme_start','programme_end','mapping_start','mapping_end','survey_start','survey_end',
  'scaffold_erect_start','scaffold_erect_end','scaffold_dismantle_start','scaffold_dismantle_end',
  'fitting_start','fitting_end',
] as const;
export type JobDates = Partial<Record<(typeof JOB_DATE_FIELDS)[number], string | null>>;

export async function createJob(tenantId: string, j: { client_code: string; job_code: string; name: string; site_address?: string | null; postcode?: string | null; dates?: JobDates }): Promise<Job> {
  const row: Record<string, unknown> = { tenant_id: tenantId, client_code: j.client_code, job_code: j.job_code, name: j.name, site_address: j.site_address ?? null, postcode: j.postcode ?? null };
  for (const k of JOB_DATE_FIELDS) { const v = j.dates?.[k]; if (v !== undefined) row[k] = v || null; }
  const { data, error } = await db().from('jobs').insert(row).select().single();
  if (error) throw error;
  return data as Job;
}
export async function updateJobDetails(tenantId: string, jobId: string, fields: { name?: string; site_address?: string | null; postcode?: string | null; dates?: JobDates }): Promise<Job> {
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.site_address !== undefined) patch.site_address = fields.site_address;
  if (fields.postcode !== undefined) patch.postcode = fields.postcode;
  for (const k of JOB_DATE_FIELDS) { const v = fields.dates?.[k]; if (v !== undefined) patch[k] = v || null; }
  const { data, error } = await db().from('jobs').update(patch).eq('id', jobId).eq('tenant_id', tenantId).select().single();
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

// Delete many items (tenant-scoped). Snags/photos/pricing cascade via FKs. Returns rows removed.
export async function bulkDeleteItems(ids: string[], tenantId: string): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await db().from('survey_items').delete().in('id', ids).eq('tenant_id', tenantId).select('id');
  if (error) throw error;
  return (data ?? []).length;
}

export async function countItemsForJob(jobId: string): Promise<number> {
  const { count, error } = await db().from('survey_items').select('id', { count: 'exact', head: true }).eq('job_id', jobId);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteJob(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from('jobs').delete().eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
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

// ---- audit log (who did what) ----
export interface AuditEntry {
  tenant_id: string; actor_user_id?: string | null; actor_name?: string | null; actor_role?: string | null;
  action: string; entity?: string | null; entity_id?: string | null; summary?: string | null;
}
export async function insertAuditLog(e: AuditEntry): Promise<void> {
  const { error } = await db().from('audit_log').insert(e);
  if (error) throw error;
}
export async function listAuditLog(tenantId: string, limit = 300): Promise<any[]> {
  const { data, error } = await db().from('audit_log')
    .select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Does another item in this tenant already use this full_code? (excludes exceptId — the item being edited.)
export async function codeExists(tenantId: string, fullCode: string, exceptId: string): Promise<boolean> {
  const { data, error } = await db().from('survey_items')
    .select('id').eq('tenant_id', tenantId).eq('full_code', fullCode).neq('id', exceptId).limit(1);
  if (error) throw error;
  return !!(data && data.length);
}

// Admin assigns a mapping start date → job becomes 'pending_mapping' (visible to scanners).
export async function setJobMappingDate(id: string, date: string | null, tenantId: string): Promise<void> {
  const { error } = await db().from('jobs')
    .update({ mapping_start_date: date, status: date ? 'pending_mapping' : 'new' })
    .eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// Bulk-create mapping items. Existing codes are left untouched (ignoreDuplicates), so a
// re-save never overwrites items a surveyor may have already edited. Returns the count inserted.
export async function bulkInsertSurveyItems(rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await db().from('survey_items')
    .upsert(rows, { onConflict: 'tenant_id,full_code', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export async function listSurveyItems(jobId: string): Promise<SurveyItem[]> {
  const { data, error } = await db()
    .from('survey_items').select('*')
    .eq('job_id', jobId).order('full_code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SurveyItem[];
}

// ---- finance: pricing rules (admin / invoice_manager only; server-side gated) ----
export interface PricingRuleRow { id: string; tenant_id: string; name: string; customer: string | null; model: string; params: any; active: boolean }

export async function listPricingRules(tenantId: string): Promise<PricingRuleRow[]> {
  const { data, error } = await db().from('pricing_rules').select('*').eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data ?? []) as PricingRuleRow[];
}
export async function getPricingRule(id: string, tenantId: string): Promise<PricingRuleRow | null> {
  const { data, error } = await db().from('pricing_rules').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as PricingRuleRow | null;
}
export async function createPricingRule(tenantId: string, r: { name: string; customer?: string | null; model?: string; params?: any }): Promise<PricingRuleRow> {
  const { data, error } = await db().from('pricing_rules')
    .insert({ tenant_id: tenantId, name: r.name, customer: r.customer ?? null, model: r.model ?? 'axs_flat_v1', params: r.params ?? {} })
    .select().single();
  if (error) throw error;
  return data as PricingRuleRow;
}
export async function updatePricingRule(id: string, tenantId: string, patch: Partial<Pick<PricingRuleRow, 'name' | 'customer' | 'model' | 'params' | 'active'>>): Promise<void> {
  const { error } = await db().from('pricing_rules').update(patch).eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}
export async function deletePricingRule(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from('pricing_rules').delete().eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// job -> pricing rule link (finance-only)
export async function getJobRuleId(jobId: string): Promise<string | null> {
  const { data } = await db().from('job_pricing').select('pricing_rule_id').eq('job_id', jobId).maybeSingle();
  return (data as any)?.pricing_rule_id ?? null;
}
export async function setJobRuleId(jobId: string, tenantId: string, ruleId: string | null): Promise<void> {
  const { error } = await db().from('job_pricing')
    .upsert({ job_id: jobId, tenant_id: tenantId, pricing_rule_id: ruleId, updated_at: new Date().toISOString() }, { onConflict: 'job_id' });
  if (error) throw error;
}

// per-item finance flags (variations)
export interface ItemPricingRow { item_id: string; is_variation: boolean; variation_amount_pennies: number | null }
export async function listItemPricing(itemIds: string[]): Promise<ItemPricingRow[]> {
  if (!itemIds.length) return [];
  const { data, error } = await db().from('item_pricing').select('item_id,is_variation,variation_amount_pennies').in('item_id', itemIds);
  if (error) throw error;
  return (data ?? []) as ItemPricingRow[];
}
export async function setItemPricing(itemId: string, tenantId: string, patch: { is_variation?: boolean; variation_amount_pennies?: number | null }): Promise<void> {
  const { error } = await db().from('item_pricing')
    .upsert({ item_id: itemId, tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'item_id' });
  if (error) throw error;
}

// ---- in-app QA test results ----
export async function latestTestResults(tenantId: string, appVersion: string): Promise<Record<string, any>> {
  const { data, error } = await db().from('test_results')
    .select('scenario_code,status,comment,tested_by,created_at')
    .eq('tenant_id', tenantId).eq('app_version', appVersion)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest: Record<string, any> = {};
  for (const r of (data ?? []) as any[]) if (!latest[r.scenario_code]) latest[r.scenario_code] = r; // first = newest
  return latest;
}
export async function insertTestResult(tenantId: string, r: { scenario_code: string; app_version: string; status: string; comment: string | null; tested_by: string | null; tested_by_id: string | null }): Promise<void> {
  const { error } = await db().from('test_results').insert({ tenant_id: tenantId, ...r });
  if (error) throw error;
}
export async function allTestResults(tenantId: string, appVersion: string): Promise<any[]> {
  const { data, error } = await db().from('test_results')
    .select('scenario_code,status,comment,tested_by,created_at')
    .eq('tenant_id', tenantId).eq('app_version', appVersion).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

// All items across the tenant that have a planned install date (for the office calendar).
export async function listScheduledItems(tenantId: string): Promise<any[]> {
  const { data, error } = await db().from('survey_items')
    .select('id,full_code,room_code,item_code,install_status,planned_install_date,team_id,job_id, jobs(client_code,job_code,name)')
    .eq('tenant_id', tenantId).not('planned_install_date', 'is', null).order('planned_install_date');
  if (error) throw error;
  return data ?? [];
}

export async function listTeams(tenantId: string): Promise<FitterTeam[]> {
  const { data, error } = await db().from('fitter_teams').select('*').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data ?? []) as FitterTeam[];
}

// How many times each room code has been used across the tenant — drives the
// "most-used first" ordering of the room picker on the new-item form.
export async function roomCodeCounts(tenantId: string): Promise<Record<string, number>> {
  const { data, error } = await db().from('survey_items').select('room_code').eq('tenant_id', tenantId);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) {
    const c = String(r.room_code ?? '').trim().toUpperCase();
    if (c) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

// ---- user management (office Stage 3) ----
export interface AppUserRow {
  id: string; tenant_id: string; auth_user_id: string | null;
  name: string; email: string; role: string; active: boolean; team_id: string | null; client_code: string | null;
}

export async function listAppUsers(tenantId: string): Promise<AppUserRow[]> {
  const { data, error } = await db().from('app_users')
    .select('id,tenant_id,auth_user_id,name,email,role,active,team_id,client_code').eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return (data ?? []) as AppUserRow[];
}

export async function getAppUser(id: string): Promise<AppUserRow | null> {
  const { data, error } = await db().from('app_users')
    .select('id,tenant_id,auth_user_id,name,email,role,active,team_id,client_code').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as AppUserRow | null;
}

export async function updateAppUser(id: string, patch: Partial<Pick<AppUserRow, 'name' | 'email' | 'role' | 'active' | 'team_id' | 'client_code'>>, tenantId: string): Promise<void> {
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

// Apply a patch read FROM Monday (team, planned date, …) without leaving the item
// flagged for re-sync: set the fields, then clear the flag the trigger just raised.
export async function applyMondayPull(id: string, patch: Record<string, unknown>, tenantId: string): Promise<void> {
  const a = await db().from('survey_items').update(patch).eq('id', id).eq('tenant_id', tenantId);
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

export async function updateTeam(id: string, patch: { name?: string; default_rate_pennies?: number; door_rate_pennies?: number; active?: boolean }): Promise<void> {
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

// ---- plans (plan view with item pins) ----
export const PLAN_BUCKET = 'plans';
export interface JobPlan { id: string; tenant_id: string; job_id: string; name: string; storage_path: string; sort: number; }

export async function ensurePlanBucket(): Promise<void> {
  const { data } = await db().storage.getBucket(PLAN_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(PLAN_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function uploadPlan(path: string, bytes: Uint8Array, contentType = 'image/png'): Promise<void> {
  const { error } = await db().storage.from(PLAN_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

export async function signedPlanUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await db().storage.from(PLAN_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function downloadPlan(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(PLAN_BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

export async function listJobPlans(jobId: string): Promise<JobPlan[]> {
  const { data, error } = await db().from('job_plans')
    .select('id,tenant_id,job_id,name,storage_path,sort').eq('job_id', jobId).order('sort').order('created_at');
  if (error) throw error;
  return (data ?? []) as JobPlan[];
}

export async function createJobPlan(tenantId: string, jobId: string, name: string, storagePath: string, sort = 0): Promise<JobPlan> {
  const { data, error } = await db().from('job_plans')
    .insert({ tenant_id: tenantId, job_id: jobId, name, storage_path: storagePath, sort }).select().single();
  if (error) throw error;
  return data as JobPlan;
}

export async function deleteJobPlan(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from('job_plans').delete().eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// ---- job file attachments (drawings / PDFs / zips) ----
export const JOBFILE_BUCKET = 'jobfiles';
export interface JobFile { id: string; tenant_id: string; job_id: string; name: string; storage_path: string; content_type: string | null; size_bytes: number | null; created_at: string; }

export async function ensureJobFileBucket(): Promise<void> {
  const { data } = await db().storage.getBucket(JOBFILE_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(JOBFILE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}
export async function uploadJobFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await db().storage.from(JOBFILE_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}
export async function signedJobFileUrl(path: string, seconds = 3600): Promise<string | null> {
  const { data, error } = await db().storage.from(JOBFILE_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
export async function insertJobFile(row: Omit<JobFile, 'id' | 'created_at'>): Promise<JobFile> {
  const { data, error } = await db().from('job_files').insert(row).select().single();
  if (error) throw error;
  return data as JobFile;
}
export async function listJobFiles(jobId: string): Promise<JobFile[]> {
  const { data, error } = await db().from('job_files').select('*').eq('job_id', jobId).order('created_at');
  if (error) throw error;
  return (data ?? []) as JobFile[];
}
export async function getJobFile(id: string): Promise<JobFile | null> {
  const { data, error } = await db().from('job_files').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as JobFile | null;
}
export async function downloadJobFile(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(JOBFILE_BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
export async function deleteJobFile(id: string, tenantId: string): Promise<void> {
  const f = await getJobFile(id);
  if (f) { try { await db().storage.from(JOBFILE_BUCKET).remove([f.storage_path]); } catch { /* best effort */ } }
  const { error } = await db().from('job_files').delete().eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// Items pinned on a job's plans (for the viewer).
export async function listPinnedItems(jobId: string): Promise<any[]> {
  const { data, error } = await db().from('survey_items')
    .select('id,full_code,room_code,item_code,kind,install_status,plan_id,plan_x,plan_y').eq('job_id', jobId).order('full_code');
  if (error) throw error;
  return data ?? [];
}

export async function setItemPin(id: string, planId: string | null, x: number | null, y: number | null, tenantId: string): Promise<void> {
  const { error } = await db().from('survey_items')
    .update({ plan_id: planId, plan_x: x, plan_y: y }).eq('id', id).eq('tenant_id', tenantId);
  if (error) throw error;
}

// Tenant setting: allow an item to be pinned on more than one plan.
export async function getPinsMultiPlan(tenantId: string): Promise<boolean> {
  const { data } = await db().from('tenants').select('pins_multi_plan').eq('id', tenantId).maybeSingle();
  return !!(data as any)?.pins_multi_plan;
}
export async function setPinsMultiPlan(tenantId: string, value: boolean): Promise<void> {
  const { error } = await db().from('tenants').update({ pins_multi_plan: value }).eq('id', tenantId);
  if (error) throw error;
}
