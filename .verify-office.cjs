var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// apps/api/src/office.ts
var import_node_http = require("node:http");
var import_node_fs = require("node:fs");
var import_node_url = require("node:url");
var import_node_path = require("node:path");
var import_supabase_js2 = require("@supabase/supabase-js");

// apps/api/src/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");
var client = null;
function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only).");
  }
  client = (0, import_supabase_js.createClient)(url, key, { auth: { persistSession: false } });
  return client;
}
var ACE_TENANT = "00000000-0000-0000-0000-0000000000ac";

// apps/api/src/store.ts
async function getJobByCode(clientCode, jobCode) {
  const { data, error } = await db().from("jobs").select("*").eq("client_code", clientCode).eq("job_code", jobCode).single();
  if (error) throw error;
  return data;
}
async function createJob(tenantId, j) {
  const { data, error } = await db().from("jobs").insert({ tenant_id: tenantId, client_code: j.client_code, job_code: j.job_code, name: j.name, site_address: j.site_address ?? null }).select().single();
  if (error) throw error;
  return data;
}
async function getJob(id) {
  const { data, error } = await db().from("jobs").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function setJobBoard(jobId, boardId, slug) {
  const patch = { monday_board_id: boardId };
  if (boardId === null) patch.monday_account_slug = null;
  else if (slug !== void 0) patch.monday_account_slug = slug;
  const { error } = await db().from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}
async function insertSurveyItem(fields) {
  const { data, error } = await db().from("survey_items").insert(fields).select().single();
  if (error) throw error;
  return data;
}
async function listChildSnags(parentId) {
  const { data, error } = await db().from("survey_items").select("*").eq("parent_item_id", parentId).order("full_code");
  if (error) throw error;
  return data ?? [];
}
async function createSnagItem(parentId, opts) {
  const parent = await getSurveyItem(parentId);
  const kids = await listChildSnags(parentId);
  const taken = new Set(kids.map((k) => k.full_code));
  let n = 1;
  while (taken.has(`${parent.full_code}-S${n}`)) n++;
  const full_code = `${parent.full_code}-S${n}`;
  const row = {
    tenant_id: parent.tenant_id,
    job_id: parent.job_id,
    kind: "snag",
    parent_item_id: parentId,
    block: parent.block,
    elevation: parent.elevation,
    flat: parent.flat,
    room_code: parent.room_code,
    item_code: parent.item_code,
    floor: parent.floor,
    full_code,
    material: parent.material,
    item_type: parent.item_type,
    glass: parent.glass,
    safety_glass: parent.safety_glass,
    glazing: parent.glazing,
    width_mm: parent.width_mm,
    height_mm: parent.height_mm,
    stage: "surveyed",
    install_status: "snag",
    snag_comment: opts.comment,
    comments: opts.comment,
    team_id: opts.team_id ?? null,
    rate_override_pennies: opts.rate_override_pennies ?? null
  };
  const { data, error } = await db().from("survey_items").insert(row).select().single();
  if (error) throw error;
  return data;
}
async function addItemPhoto(tenantId, itemId, kind, storagePath) {
  const { error } = await db().from("item_photos").insert({ tenant_id: tenantId, item_id: itemId, kind, storage_path: storagePath });
  if (error) throw error;
}
async function markPhotoPushed(id) {
  const { error } = await db().from("item_photos").update({ monday_pushed: true }).eq("id", id);
  if (error) throw error;
}
async function listItemPhotos(itemId) {
  const { data, error } = await db().from("item_photos").select("*").eq("item_id", itemId).order("created_at");
  if (error) throw error;
  return data ?? [];
}
async function signedPhotoUrl(path, seconds = 3600) {
  const { data, error } = await db().storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
async function filterItemIdsByTenant(ids, tenantId) {
  const { data, error } = await db().from("survey_items").select("id").in("id", ids).eq("tenant_id", tenantId);
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}
async function bulkUpdateItems(ids, patch, tenantId) {
  const { data, error } = await db().from("survey_items").update(patch).in("id", ids).eq("tenant_id", tenantId).select("id");
  if (error) throw error;
  return (data ?? []).length;
}
async function bulkDeleteItems(ids, tenantId) {
  if (!ids.length) return 0;
  const { data, error } = await db().from("survey_items").delete().in("id", ids).eq("tenant_id", tenantId).select("id");
  if (error) throw error;
  return (data ?? []).length;
}
async function countItemsForJob(jobId) {
  const { count, error } = await db().from("survey_items").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  if (error) throw error;
  return count ?? 0;
}
async function deleteJob(id, tenantId) {
  const { error } = await db().from("jobs").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function getSurveyItem(id) {
  const { data, error } = await db().from("survey_items").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function getTeam(id) {
  if (!id) return null;
  const { data, error } = await db().from("fitter_teams").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function listJobs(tenantId) {
  const { data, error } = await db().from("jobs").select("*").eq("tenant_id", tenantId).order("job_code");
  if (error) throw error;
  return data ?? [];
}
async function insertAuditLog(e) {
  const { error } = await db().from("audit_log").insert(e);
  if (error) throw error;
}
async function listAuditLog(tenantId, limit = 300) {
  const { data, error } = await db().from("audit_log").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}
async function codeExists(tenantId, fullCode, exceptId) {
  const { data, error } = await db().from("survey_items").select("id").eq("tenant_id", tenantId).eq("full_code", fullCode).neq("id", exceptId).limit(1);
  if (error) throw error;
  return !!(data && data.length);
}
async function setJobMappingDate(id, date, tenantId) {
  const { error } = await db().from("jobs").update({ mapping_start_date: date, status: date ? "pending_mapping" : "new" }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function bulkInsertSurveyItems(rows) {
  if (!rows.length) return 0;
  const { data, error } = await db().from("survey_items").upsert(rows, { onConflict: "tenant_id,full_code", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
async function listSurveyItems(jobId) {
  const { data, error } = await db().from("survey_items").select("*").eq("job_id", jobId).order("full_code", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
async function listPricingRules(tenantId) {
  const { data, error } = await db().from("pricing_rules").select("*").eq("tenant_id", tenantId).order("name");
  if (error) throw error;
  return data ?? [];
}
async function getPricingRule(id, tenantId) {
  const { data, error } = await db().from("pricing_rules").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
async function createPricingRule(tenantId, r) {
  const { data, error } = await db().from("pricing_rules").insert({ tenant_id: tenantId, name: r.name, customer: r.customer ?? null, model: r.model ?? "axs_flat_v1", params: r.params ?? {} }).select().single();
  if (error) throw error;
  return data;
}
async function updatePricingRule(id, tenantId, patch) {
  const { error } = await db().from("pricing_rules").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function deletePricingRule(id, tenantId) {
  const { error } = await db().from("pricing_rules").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function getJobRuleId(jobId) {
  const { data } = await db().from("job_pricing").select("pricing_rule_id").eq("job_id", jobId).maybeSingle();
  return data?.pricing_rule_id ?? null;
}
async function setJobRuleId(jobId, tenantId, ruleId) {
  const { error } = await db().from("job_pricing").upsert({ job_id: jobId, tenant_id: tenantId, pricing_rule_id: ruleId, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "job_id" });
  if (error) throw error;
}
async function listItemPricing(itemIds) {
  if (!itemIds.length) return [];
  const { data, error } = await db().from("item_pricing").select("item_id,is_variation,variation_amount_pennies").in("item_id", itemIds);
  if (error) throw error;
  return data ?? [];
}
async function setItemPricing(itemId, tenantId, patch) {
  const { error } = await db().from("item_pricing").upsert({ item_id: itemId, tenant_id: tenantId, ...patch, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "item_id" });
  if (error) throw error;
}
async function latestTestResults(tenantId, appVersion) {
  const { data, error } = await db().from("test_results").select("scenario_code,status,comment,tested_by,created_at").eq("tenant_id", tenantId).eq("app_version", appVersion).order("created_at", { ascending: false });
  if (error) throw error;
  const latest = {};
  for (const r of data ?? []) if (!latest[r.scenario_code]) latest[r.scenario_code] = r;
  return latest;
}
async function insertTestResult(tenantId, r) {
  const { error } = await db().from("test_results").insert({ tenant_id: tenantId, ...r });
  if (error) throw error;
}
async function allTestResults(tenantId, appVersion) {
  const { data, error } = await db().from("test_results").select("scenario_code,status,comment,tested_by,created_at").eq("tenant_id", tenantId).eq("app_version", appVersion).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
async function listScheduledItems(tenantId) {
  const { data, error } = await db().from("survey_items").select("id,full_code,room_code,item_code,install_status,planned_install_date,team_id,job_id, jobs(client_code,job_code,name)").eq("tenant_id", tenantId).not("planned_install_date", "is", null).order("planned_install_date");
  if (error) throw error;
  return data ?? [];
}
async function listTeams(tenantId) {
  const { data, error } = await db().from("fitter_teams").select("*").eq("tenant_id", tenantId);
  if (error) throw error;
  return data ?? [];
}
async function roomCodeCounts(tenantId) {
  const { data, error } = await db().from("survey_items").select("room_code").eq("tenant_id", tenantId);
  if (error) throw error;
  const out = {};
  for (const r of data ?? []) {
    const c = String(r.room_code ?? "").trim().toUpperCase();
    if (c) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}
async function listAppUsers(tenantId) {
  const { data, error } = await db().from("app_users").select("id,tenant_id,auth_user_id,name,email,role,active,team_id,client_code").eq("tenant_id", tenantId).order("name");
  if (error) throw error;
  return data ?? [];
}
async function getAppUser(id) {
  const { data, error } = await db().from("app_users").select("id,tenant_id,auth_user_id,name,email,role,active,team_id,client_code").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
async function updateAppUser(id, patch, tenantId) {
  const { error } = await db().from("app_users").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function applyMondayPull(id, patch, tenantId) {
  const a = await db().from("survey_items").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (a.error) throw a.error;
  const b = await db().from("survey_items").update({ needs_resync: false }).eq("id", id).eq("tenant_id", tenantId);
  if (b.error) throw b.error;
}
async function createTeam(tenantId, name, ratePennies) {
  const { data, error } = await db().from("fitter_teams").insert({ tenant_id: tenantId, name, default_rate_pennies: ratePennies }).select().single();
  if (error) throw error;
  return data;
}
async function updateTeam(id, patch) {
  const { error } = await db().from("fitter_teams").update(patch).eq("id", id);
  if (error) throw error;
}
async function countItemsUsingTeam(teamId) {
  const { count, error } = await db().from("survey_items").select("id", { count: "exact", head: true }).eq("team_id", teamId);
  if (error) throw error;
  return count ?? 0;
}
async function deleteTeam(id) {
  const { error } = await db().from("fitter_teams").delete().eq("id", id);
  if (error) throw error;
}
async function markItemSynced(id, mondayItemId) {
  const { error } = await db().from("survey_items").update({ monday_item_id: mondayItemId, stage: "synced", needs_resync: false }).eq("id", id);
  if (error) throw error;
}
var PHOTO_BUCKET = "photos";
async function ensurePhotoBucket() {
  const { data } = await db().storage.getBucket(PHOTO_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(PHOTO_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}
async function uploadPhoto(path, bytes, contentType = "image/png") {
  const { error } = await db().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}
async function downloadPhoto(path) {
  const { data, error } = await db().storage.from(PHOTO_BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
var PLAN_BUCKET = "plans";
async function ensurePlanBucket() {
  const { data } = await db().storage.getBucket(PLAN_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(PLAN_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}
async function uploadPlan(path, bytes, contentType = "image/png") {
  const { error } = await db().storage.from(PLAN_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}
async function signedPlanUrl(path, seconds = 3600) {
  const { data, error } = await db().storage.from(PLAN_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
async function downloadPlan(path) {
  const { data, error } = await db().storage.from(PLAN_BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
async function listJobPlans(jobId) {
  const { data, error } = await db().from("job_plans").select("id,tenant_id,job_id,name,storage_path,sort").eq("job_id", jobId).order("sort").order("created_at");
  if (error) throw error;
  return data ?? [];
}
async function createJobPlan(tenantId, jobId, name, storagePath, sort = 0) {
  const { data, error } = await db().from("job_plans").insert({ tenant_id: tenantId, job_id: jobId, name, storage_path: storagePath, sort }).select().single();
  if (error) throw error;
  return data;
}
async function deleteJobPlan(id, tenantId) {
  const { error } = await db().from("job_plans").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
var JOBFILE_BUCKET = "jobfiles";
async function ensureJobFileBucket() {
  const { data } = await db().storage.getBucket(JOBFILE_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(JOBFILE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}
async function uploadJobFile(path, bytes, contentType) {
  const { error } = await db().storage.from(JOBFILE_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}
async function signedJobFileUrl(path, seconds = 3600) {
  const { data, error } = await db().storage.from(JOBFILE_BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
async function insertJobFile(row) {
  const { data, error } = await db().from("job_files").insert(row).select().single();
  if (error) throw error;
  return data;
}
async function listJobFiles(jobId) {
  const { data, error } = await db().from("job_files").select("*").eq("job_id", jobId).order("created_at");
  if (error) throw error;
  return data ?? [];
}
async function getJobFile(id) {
  const { data, error } = await db().from("job_files").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
async function deleteJobFile(id, tenantId) {
  const f = await getJobFile(id);
  if (f) {
    try {
      await db().storage.from(JOBFILE_BUCKET).remove([f.storage_path]);
    } catch {
    }
  }
  const { error } = await db().from("job_files").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function listPinnedItems(jobId) {
  const { data, error } = await db().from("survey_items").select("id,full_code,room_code,item_code,kind,install_status,plan_id,plan_x,plan_y").eq("job_id", jobId).order("full_code");
  if (error) throw error;
  return data ?? [];
}
async function setItemPin(id, planId, x, y, tenantId) {
  const { error } = await db().from("survey_items").update({ plan_id: planId, plan_x: x, plan_y: y }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
async function getPinsMultiPlan(tenantId) {
  const { data } = await db().from("tenants").select("pins_multi_plan").eq("id", tenantId).maybeSingle();
  return !!data?.pins_multi_plan;
}
async function setPinsMultiPlan(tenantId, value) {
  const { error } = await db().from("tenants").update({ pins_multi_plan: value }).eq("id", tenantId);
  if (error) throw error;
}

// apps/api/src/office.ts
var import_shared5 = require("@ace/shared");

// apps/api/src/reportPdf.ts
var import_pdfkit = __toESM(require("pdfkit"), 1);
var import_shared = require("@ace/shared");
var PRIMARY = "#3a2b72";
var MAGENTA = "#e6187e";
var INK = "#1e1b2e";
var MUTED = "#6b6880";
var LINE = "#d9d6e6";
function statusColor(s2) {
  if (s2 === "installed_no_snag") return "#16a34a";
  if (s2 === "snag" || s2 === "installed_snag" || s2 === "misfit") return MAGENTA;
  if (s2) return "#d97706";
  return "#8b88a3";
}
var STATUS_LABEL = {
  scheduled: "Scheduled",
  installed_no_snag: "Installed",
  installed_snag: "Installed + snag",
  snag: "Snag",
  misfit: "MisFit",
  delayed: "Delayed"
};
var dim = (it) => it.width_mm || it.height_mm ? `${it.width_mm ?? "\u2014"} \xD7 ${it.height_mm ?? "\u2014"}` : "\u2014";
var s = (v) => v == null || v === "" ? "\u2014" : String(v);
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var shortDate = (iso) => {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : "\u2014";
};
function renderReportPdf(data) {
  const doc = new import_pdfkit.default({
    size: "A4",
    margin: 40,
    info: {
      Title: `${data.job.client_code}.${data.job.job_code} \u2014 ${data.type === "survey" ? "Survey" : "Install"} report`,
      Author: "ACE Field"
    }
  });
  const chunks = [];
  const done = new Promise((resolve) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;
  const parents = data.items.filter((i) => (i.kind ?? "item") !== "snag");
  const snags = data.items.filter((i) => (i.kind ?? "item") === "snag");
  let pinCounter = 0;
  const pinNoByCode = /* @__PURE__ */ new Map();
  doc.rect(0, 0, doc.page.width, 84).fill(PRIMARY);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(`${data.job.client_code}.${data.job.job_code}`, M, 20);
  doc.font("Helvetica").fontSize(11).fillColor("#e8e5f5").text(data.job.name || "", M, 46, { width: contentW - 170 });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff").text(data.type === "survey" ? "SURVEY REPORT" : "INSTALL REPORT", right - 170, 24, { width: 170, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#e8e5f5").text(data.generatedAt.toLocaleString("en-GB"), right - 170, 44, { width: 170, align: "right" });
  doc.y = 100;
  doc.fillColor(INK);
  if (data.job.site_address) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(data.job.site_address, M, doc.y);
  }
  const isInstall = data.type !== "survey";
  const hideRates = data.type === "customer_install";
  const counts = {};
  let labour = 0;
  for (const it of data.items) {
    const st = it.install_status || "unset";
    counts[st] = (counts[st] ?? 0) + 1;
    const rate = (0, import_shared.effectiveRatePennies)(it, data.teams);
    if (rate != null) labour += rate;
  }
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`${parents.length} item${parents.length === 1 ? "" : "s"}` + (snags.length ? `  \xB7  ${snags.length} snag${snags.length === 1 ? "" : "s"}` : "") + (hideRates ? "" : `  \xB7  labour ${(0, import_shared.formatPennies)(labour)}`), M, doc.y);
  if (isInstall) {
    const chips = Object.entries(counts).filter(([k]) => k !== "unset").map(([k, v]) => `${v} ${STATUS_LABEL[k] ?? k}`).join("   ");
    if (chips) doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(chips, { width: contentW });
    const dates = parents.map((it) => it.planned_install_date).filter(Boolean).sort();
    const unscheduled = parents.filter((it) => !it.planned_install_date).length;
    if (dates.length) {
      const range2 = dates[0] === dates[dates.length - 1] ? shortDate(dates[0]) : `${shortDate(dates[0])} \u2013 ${shortDate(dates[dates.length - 1])}`;
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`Scheduled ${range2}${unscheduled ? `   \xB7   ${unscheduled} not scheduled` : ""}`, { width: contentW });
    } else {
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("No install dates scheduled yet (pull them from Monday).", { width: contentW });
    }
  }
  doc.moveDown(0.6);
  hr(doc, M, right);
  for (const plan of data.plans) {
    ensureSpace(doc, 260);
    heading(doc, `Plan \u2014 ${plan.name}`, M);
    try {
      const img = doc.openImage(plan.bytes);
      const maxW = contentW, maxH = 360;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale, h = img.height * scale;
      const x0 = M, y0 = doc.y;
      doc.image(img, x0, y0, { width: w, height: h });
      doc.rect(x0, y0, w, h).strokeColor(LINE).lineWidth(0.8).stroke();
      plan.pins.forEach((pin) => {
        const n = ++pinCounter;
        if (pin.code) {
          const arr = pinNoByCode.get(pin.code) ?? [];
          arr.push(n);
          pinNoByCode.set(pin.code, arr);
        }
        const px = x0 + pin.x * w, py = y0 + pin.y * h;
        const r = 6;
        doc.fillOpacity(0.55).circle(px, py, r).fill(statusColor(pin.status));
        doc.fillOpacity(1);
        doc.circle(px, py, r).lineWidth(0.75).strokeColor("#ffffff").stroke();
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7).text(String(n), px - r, py - 3.3, { width: r * 2, align: "center" });
        doc.fillColor(INK);
      });
      doc.y = y0 + h + 8;
      if (plan.pins.length) {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("Numbered pins match the # column in the items table below.", M, doc.y, { width: contentW });
      }
    } catch {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor(MUTED).text("(plan image could not be embedded)", M, doc.y);
    }
    doc.moveDown(0.6);
    doc.fillColor(INK);
  }
  ensureSpace(doc, 120);
  heading(doc, data.type === "survey" ? "Items & specification" : "Items & install status", M);
  const cols = data.type === "survey" ? [
    { k: "pin", t: "#", w: 0.05 },
    { k: "code", t: "Code", w: 0.28 },
    { k: "room", t: "Room / Item", w: 0.12 },
    { k: "type", t: "Type", w: 0.14 },
    { k: "size", t: "W \xD7 H (mm)", w: 0.13 },
    { k: "glass", t: "Glass", w: 0.14 },
    { k: "design", t: "Design", w: 0.14 }
  ] : hideRates ? [
    // customer install — no team/rate columns
    { k: "pin", t: "#", w: 0.05 },
    { k: "code", t: "Code", w: 0.34 },
    { k: "room", t: "Room / Item", w: 0.15 },
    { k: "type", t: "Type", w: 0.16 },
    { k: "sched", t: "Scheduled", w: 0.13 },
    { k: "status", t: "Install", w: 0.17 }
  ] : [
    { k: "pin", t: "#", w: 0.05 },
    { k: "code", t: "Code", w: 0.27 },
    { k: "room", t: "Room / Item", w: 0.11 },
    { k: "type", t: "Type", w: 0.11 },
    { k: "sched", t: "Scheduled", w: 0.11 },
    { k: "team", t: "Team", w: 0.1 },
    { k: "rate", t: "Rate", w: 0.08 },
    { k: "status", t: "Install", w: 0.17 }
  ];
  const teamName = (id) => data.teams.find((t) => t.id === id)?.name ?? "\u2014";
  const rowsData = parents.map((it) => ({
    pin: (pinNoByCode.get(it.full_code) ?? []).join(", ") || "\u2014",
    code: s(it.full_code),
    room: `${s(it.room_code)} / ${s(it.item_code)}`,
    type: s(it.item_type || it.material),
    size: dim(it),
    glass: s(it.glass),
    design: s(it.design_code),
    team: teamName(it.team_id),
    rate: (0, import_shared.formatPennies)((0, import_shared.effectiveRatePennies)(it, data.teams)),
    sched: shortDate(it.planned_install_date),
    status: STATUS_LABEL[it.install_status] ?? s(it.install_status),
    _statusRaw: it.install_status ?? null
  }));
  table(doc, M, contentW, cols, rowsData);
  if (snags.length) {
    ensureSpace(doc, 90);
    heading(doc, `Snags (${snags.length})`, M);
    doc.font("Helvetica").fontSize(9.5).fillColor(INK);
    for (const sn of snags) {
      ensureSpace(doc, 34);
      const dot = statusColor(sn.install_status ?? "snag");
      doc.circle(M + 3, doc.y + 5, 3).fill(dot);
      doc.fillColor(INK);
      doc.font("Helvetica-Bold").fontSize(9.5).text(s(sn.full_code), M + 12, doc.y, { continued: true }).font("Helvetica").fillColor(MUTED).text("   " + (STATUS_LABEL[sn.install_status] ?? s(sn.install_status)));
      doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(s(sn.snag_comment || sn.comments), M + 12, doc.y, { width: contentW - 12 });
      doc.moveDown(0.5);
    }
  }
  if (data.photos.length) {
    doc.addPage();
    heading(doc, data.type === "survey" ? "Survey photos" : "Install photos", M);
    for (const grp of data.photos) {
      if (!grp.images.length) continue;
      ensureSpace(doc, 150);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(grp.label, M, doc.y);
      doc.moveDown(0.2);
      const gap = 8, per = 4, cellW = (contentW - gap * (per - 1)) / per, cellH = cellW * 0.75;
      let x = M, y = doc.y, col = 0;
      for (const buf of grp.images) {
        if (col === per) {
          col = 0;
          x = M;
          y += cellH + gap;
        }
        if (y + cellH > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = doc.y;
          x = M;
          col = 0;
        }
        try {
          doc.image(buf, x, y, { fit: [cellW, cellH], align: "center", valign: "center" });
          doc.rect(x, y, cellW, cellH).strokeColor(LINE).lineWidth(0.6).stroke();
        } catch {
        }
        x += cellW + gap;
        col++;
      }
      doc.y = y + cellH + 14;
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
      `${data.job.client_code}.${data.job.job_code} \xB7 ${data.type === "survey" ? "Survey" : "Install"} report \xB7 page ${i + 1} of ${range.count}`,
      M,
      doc.page.height - 28,
      { width: contentW, align: "center" }
    );
  }
  doc.end();
  return done;
}
function hr(doc, x0, x1) {
  doc.moveTo(x0, doc.y).lineTo(x1, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.5);
}
function heading(doc, text, x) {
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY).text(text, x, doc.y);
  doc.moveDown(0.3);
  doc.fillColor(INK);
}
function ensureSpace(doc, need) {
  if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage();
}
function table(doc, x, width, cols, rows) {
  const pad = 4, minRowH = 18;
  const widths = cols.map((c) => c.w * width);
  const xs = [];
  let cx = x;
  for (const w of widths) {
    xs.push(cx);
    cx += w;
  }
  const codeIdx = cols.findIndex((c) => c.k === "code");
  const drawHeader = () => {
    const hy = doc.y;
    doc.rect(x, hy, width, minRowH).fill("#efeaf9");
    doc.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(8.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + pad, hy + 5, { width: widths[i] - pad * 2, ellipsis: true, lineBreak: false }));
    doc.y = hy + minRowH;
    doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  };
  drawHeader();
  rows.forEach((r, ri) => {
    doc.font("Helvetica").fontSize(8.5);
    let rowH = minRowH;
    if (codeIdx >= 0) {
      const ch = doc.heightOfString(String(r.code ?? ""), { width: widths[codeIdx] - pad * 2 });
      rowH = Math.max(minRowH, Math.ceil(ch) + 8);
    }
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    if (ri % 2 === 1) doc.rect(x, doc.y, width, rowH).fill("#faf9fd").fillColor(INK);
    const y = doc.y;
    cols.forEach((c, i) => {
      if (c.k === "status" && r._statusRaw !== void 0) {
        doc.circle(xs[i] + pad + 3, y + 9, 3).fill(statusColor(r._statusRaw));
        doc.fillColor(INK);
        doc.font("Helvetica").fontSize(8.5).text(String(r[c.k] ?? ""), xs[i] + pad + 10, y + 5, { width: widths[i] - pad * 2 - 10, ellipsis: true, lineBreak: false });
      } else if (c.k === "code") {
        doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(String(r[c.k] ?? ""), xs[i] + pad, y + 5, { width: widths[i] - pad * 2, lineBreak: true });
      } else {
        doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(String(r[c.k] ?? ""), xs[i] + pad, y + 5, { width: widths[i] - pad * 2, ellipsis: true, lineBreak: false });
      }
    });
    doc.y = y + rowH;
    doc.moveTo(x, doc.y).lineTo(x + width, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  });
  doc.moveDown(0.4);
}
async function buildJobReportPdf(clientCode, jobCode, tenantId, type) {
  const job = await getJobByCode(clientCode, jobCode);
  if (job.tenant_id !== tenantId) throw new Error("forbidden");
  const items = await listSurveyItems(job.id);
  const teams = await listTeams(tenantId);
  const jobPlans = (await listJobPlans(job.id)).filter((pl) => pl.job_id === job.id);
  const plans = [];
  for (const pl of jobPlans) {
    let bytes;
    try {
      bytes = Buffer.from(await downloadPlan(pl.storage_path));
    } catch {
      continue;
    }
    const pins = items.filter((it) => it.plan_id === pl.id && it.plan_x != null && it.plan_y != null).map((it) => ({ x: it.plan_x, y: it.plan_y, label: it.item_code || it.full_code || "", code: it.full_code ?? null, status: it.install_status ?? null }));
    plans.push({ name: pl.name, bytes, pins });
  }
  const wantKinds = type === "survey" ? /* @__PURE__ */ new Set(["reference", "survey", "sketch"]) : /* @__PURE__ */ new Set(["install", "sketch"]);
  const PER_ITEM = 4, MAX_ITEMS = 40;
  const photos = [];
  let used = 0;
  for (const it of items) {
    if (used >= MAX_ITEMS) break;
    let rows;
    try {
      rows = await listItemPhotos(it.id);
    } catch {
      continue;
    }
    const pick = rows.filter((r) => wantKinds.has(r.kind)).slice(0, PER_ITEM);
    if (!pick.length) continue;
    const images = [];
    for (const r of pick) {
      try {
        images.push(Buffer.from(await downloadPhoto(r.storage_path)));
      } catch {
      }
    }
    if (images.length) {
      photos.push({ label: it.full_code || it.item_code || "item", images });
      used++;
    }
  }
  const buffer = await renderReportPdf({
    type,
    job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: job.site_address, monday_board_id: job.monday_board_id },
    items,
    teams,
    plans,
    photos,
    generatedAt: /* @__PURE__ */ new Date()
  });
  return { buffer, job };
}

// apps/api/src/pricingPdf.ts
var import_pdfkit2 = __toESM(require("pdfkit"), 1);
var import_shared2 = require("@ace/shared");
var PRIMARY2 = "#3a2b72";
var INK2 = "#1e1b2e";
var MUTED2 = "#6b6880";
var LINE2 = "#d9d6e6";
function renderPricePdf(data) {
  const doc = new import_pdfkit2.default({ size: "A4", margin: 40, info: { Title: `${data.job.client_code}.${data.job.job_code} \u2014 price breakdown`, Author: "ACE Group" } });
  const chunks = [];
  const done = new Promise((resolve) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;
  const b = data.breakdown;
  doc.rect(0, 0, doc.page.width, 84).fill(PRIMARY2);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text(`${data.job.client_code}.${data.job.job_code}`, M, 20);
  doc.font("Helvetica").fontSize(11).fillColor("#e8e5f5").text(data.job.name || "", M, 46, { width: contentW - 180 });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#fff").text("PRICE BREAKDOWN", right - 180, 24, { width: 180, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#e8e5f5").text(data.generatedAt.toLocaleDateString("en-GB"), right - 180, 44, { width: 180, align: "right" });
  doc.y = 100;
  doc.fillColor(INK2);
  if (data.job.site_address) doc.font("Helvetica").fontSize(10).fillColor(MUTED2).text(data.job.site_address, M, doc.y);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED2).text(`Customer: ${data.customer || "\u2014"}     Pricing: ${data.ruleName || "\u2014"}`, M, doc.y + (data.job.site_address ? 4 : 0));
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(PRIMARY2).text(`Customer price: ${(0, import_shared2.formatPennies)(b.saleTotal)}`, M, doc.y);
  doc.moveDown(0.5);
  doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE2).lineWidth(1).stroke();
  doc.moveDown(0.5);
  const cols = [
    { t: "Flat", w: 0.16, a: "left" },
    { t: "Windows", w: 0.14, a: "right" },
    { t: "Base", w: 0.18, a: "right" },
    { t: "Extra (biggest)", w: 0.18, a: "right" },
    { t: "Extra \xA3", w: 0.16, a: "right" },
    { t: "Flat total", w: 0.18, a: "right" }
  ];
  const xs = [];
  let cx = M;
  for (const c of cols) {
    xs.push(cx);
    cx += c.w * contentW;
  }
  const rowH = 18;
  const header = () => {
    const hy = doc.y;
    doc.rect(M, hy, contentW, rowH).fill("#efeaf9");
    doc.fillColor(PRIMARY2).font("Helvetica-Bold").fontSize(8.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + 4, hy + 5, { width: c.w * contentW - 8, align: c.a, lineBreak: false }));
    doc.y = hy + rowH;
    doc.font("Helvetica").fontSize(9).fillColor(INK2);
  };
  const line = (cells, bold = false, tint) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (tint) {
      doc.rect(M, y, contentW, rowH).fill(tint);
      doc.fillColor(INK2);
    }
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK2);
    cols.forEach((c, i) => doc.text(cells[i] ?? "", xs[i] + 4, y + 5, { width: c.w * contentW - 8, align: c.a, lineBreak: false }));
    doc.y = y + rowH;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE2).lineWidth(0.4).stroke();
  };
  const sumLine = (label, amount) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor(INK2);
    doc.text(label, xs[0] + 4, y + 5, { width: xs[5] - xs[0] - 8, lineBreak: false, ellipsis: true });
    doc.text(amount, xs[5] + 4, y + 5, { width: cols[5].w * contentW - 8, align: "right", lineBreak: false });
    doc.y = y + rowH;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE2).lineWidth(0.4).stroke();
  };
  header();
  b.flats.forEach((f, i) => line([
    f.flat,
    String(f.windows),
    (0, import_shared2.formatPennies)(f.base),
    f.extraWindows ? `${f.extraWindows} \xB7 ${f.extraM2} m\xB2` : "\u2014",
    f.extraAmount ? (0, import_shared2.formatPennies)(f.extraAmount) : "\u2014",
    (0, import_shared2.formatPennies)(f.total)
  ], false, i % 2 ? "#faf9fd" : void 0));
  if (b.doors.count) sumLine(`Doors \xD7 ${b.doors.count}`, (0, import_shared2.formatPennies)(b.doors.amount));
  if (b.communal.windows) sumLine(`Communal windows \xD7 ${b.communal.windows}  (${b.communal.m2} m\xB2)`, (0, import_shared2.formatPennies)(b.communal.amount));
  for (const v of b.variations) sumLine(`Variation ${v.code ?? ""}`.trim(), (0, import_shared2.formatPennies)(v.amount));
  const gy = doc.y;
  doc.rect(M, gy, contentW, rowH + 2).fill(PRIMARY2);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text("Customer price (total)", xs[0] + 4, gy + 5, { width: cols.slice(0, 5).reduce((s2, c) => s2 + c.w, 0) * contentW - 8, lineBreak: false });
  doc.text((0, import_shared2.formatPennies)(b.saleTotal), xs[5] + 4, gy + 5, { width: cols[5].w * contentW - 8, align: "right", lineBreak: false });
  doc.y = gy + rowH + 2;
  doc.fillColor(INK2);
  doc.moveDown(1);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED2).text("Prices exclude VAT unless stated. Snags are excluded from this breakdown; variations are billed at the agreed amounts shown.", M, doc.y, { width: contentW });
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED2).text(
      `${data.job.client_code}.${data.job.job_code} \xB7 price breakdown \xB7 ${data.generatedAt.toLocaleDateString("en-GB")} \xB7 page ${i + 1} of ${range.count}`,
      M,
      doc.page.height - 28,
      { width: contentW, align: "center" }
    );
  }
  doc.end();
  return done;
}
async function buildJobPricePdf(clientCode, jobCode, tenantId) {
  const job = await getJobByCode(clientCode, jobCode);
  if (job.tenant_id !== tenantId) throw new Error("forbidden");
  const ruleId = await getJobRuleId(job.id);
  const rule = ruleId ? await getPricingRule(ruleId, tenantId) : null;
  if (!rule || !rule.params?.sale) return null;
  const items = await listSurveyItems(job.id);
  const ipMap = new Map((await listItemPricing(items.map((i) => i.id))).map((r) => [r.item_id, r]));
  const priceItems = items.map((it) => {
    const f = ipMap.get(it.id);
    return {
      id: it.id,
      full_code: it.full_code,
      kind: it.kind,
      category: (0, import_shared2.classifyCategory)({ item_type: it.item_type, item_code: it.item_code }),
      width_mm: it.width_mm,
      height_mm: it.height_mm,
      flat: it.flat,
      is_variation: !!f?.is_variation,
      variation_amount: f?.variation_amount_pennies ?? 0
    };
  });
  const breakdown = (0, import_shared2.priceJob)(priceItems, rule);
  const buffer = await renderPricePdf({
    job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: job.site_address },
    customer: rule.customer ?? null,
    ruleName: rule.name,
    breakdown,
    generatedAt: /* @__PURE__ */ new Date()
  });
  return { buffer, job };
}

// apps/api/src/adminUser.ts
async function createOrLinkUser(email, password) {
  const admin = db().auth.admin;
  let userId = null;
  let created = false;
  const { data } = await admin.createUser({ email, password, email_confirm: true });
  if (data?.user) {
    userId = data.user.id;
    created = true;
  } else {
    const list = await admin.listUsers();
    const found = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) throw new Error("Could not create or find the auth user");
    userId = found.id;
    await admin.updateUserById(userId, { password });
  }
  const { data: appUser, error } = await db().from("app_users").update({ auth_user_id: userId }).eq("email", email).select("id").maybeSingle();
  if (error) throw error;
  return { id: userId, created, linked: !!appUser };
}
async function inviteUser(tenantId, email, name, role, password) {
  const existing = await db().from("app_users").select("id").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
  let appUserId;
  if (existing.data) {
    appUserId = existing.data.id;
    await db().from("app_users").update({ name, role, active: true }).eq("id", appUserId);
  } else {
    const ins = await db().from("app_users").insert({ tenant_id: tenantId, email, name, role }).select("id").single();
    if (ins.error) throw ins.error;
    appUserId = ins.data.id;
  }
  const link = await createOrLinkUser(email, password);
  return { created: link.created, appUserId };
}
async function updateAuthEmail(authUserId, email) {
  await db().auth.admin.updateUserById(authUserId, { email, email_confirm: true });
}
async function findAuthUserIdByEmail(email) {
  const admin = db().auth.admin;
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Could not list logins: " + error.message);
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (users.length < 200) break;
  }
  return null;
}
async function resetUserPassword(email, password, authUserId) {
  const admin = db().auth.admin;
  let userId = authUserId ?? null;
  if (!userId) userId = await findAuthUserIdByEmail(email);
  if (userId) {
    const { error: error2 } = await admin.updateUserById(userId, { password });
    if (error2) throw new Error("Could not set the new password: " + error2.message);
    return;
  }
  const { data, error } = await admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error("Could not create a login: " + (error?.message ?? "unknown error"));
  const link = await db().from("app_users").update({ auth_user_id: data.user.id }).eq("email", email);
  if (link.error) throw new Error("Password set but linking the account failed: " + link.error.message);
}

// apps/api/src/monday.ts
var MONDAY_URL = "https://api.monday.com/v2";
var Monday = class {
  token;
  constructor(token = process.env.MONDAY_API_TOKEN ?? "") {
    if (!token) throw new Error("MONDAY_API_TOKEN is not set (server environment only).");
    this.token = token;
  }
  async gql(query, variables = {}) {
    const res = await fetch(MONDAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.token,
        "API-Version": "2024-10"
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (json.errors) throw new Error("Monday API error: " + JSON.stringify(json.errors));
    return json.data;
  }
  /** The token's Monday account slug (e.g. "ace189144") — the subdomain in board/item URLs. */
  async getAccountSlug() {
    const d = await this.gql(`query { account { slug } }`);
    return d.account?.slug ?? null;
  }
  /** Board columns, with settings parsed — used to match survey fields by title. */
  async getColumns(boardId) {
    const d = await this.gql(
      `query ($b: [ID!]) { boards(ids: $b) { columns { id title type settings_str } } }`,
      { b: [boardId] }
    );
    return (d.boards?.[0]?.columns ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      settings: c.settings_str ? JSON.parse(c.settings_str) : {}
    }));
  }
  /** Idempotency: find an existing item on the board by its (exact) name = full code.
   *  Scans the board and matches in JS — robust across Monday schema versions.
   *  (In production we store monday_item_id after the first create, so this is only a fallback.) */
  async findItemIdByName(boardId, name) {
    const d = await this.gql(
      `query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 500) { items { id name } } } }`,
      { b: [boardId] }
    );
    const items = d.boards?.[0]?.items_page?.items ?? [];
    const hit = items.find((i) => i.name === name);
    return hit ? hit.id : null;
  }
  /** Read one column's text for every item on a board (paged). Used to pull the Fitters
   *  (team) assignment back from Monday. Returns each item's id, name (= full code) and the
   *  column's display text (e.g. "Team P01"), or null when unset. */
  async getColumnTextForItems(boardId, columnId) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 50; page++) {
      const d = cursor ? await this.gql(
        `query ($c: String!, $col: [String!]) { next_items_page(cursor: $c, limit: 200) { cursor items { id name column_values(ids: $col) { text } } } }`,
        { c: cursor, col: [columnId] }
      ) : await this.gql(
        `query ($b: [ID!], $col: [String!]) { boards(ids: $b) { items_page(limit: 200) { cursor items { id name column_values(ids: $col) { text } } } } }`,
        { b: [boardId], col: [columnId] }
      );
      const pageData = cursor ? d.next_items_page : d.boards?.[0]?.items_page;
      const items = pageData?.items ?? [];
      for (const i of items) out.push({ id: i.id, name: i.name, text: i.column_values?.[0]?.text ?? null });
      cursor = pageData?.cursor ?? null;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }
  async createItem(boardId, name, columnValues) {
    const d = await this.gql(
      `mutation ($b: ID!, $n: String!, $cv: JSON!) {
         create_item(board_id: $b, item_name: $n, column_values: $cv, create_labels_if_missing: false) { id }
       }`,
      { b: boardId, n: name, cv: JSON.stringify(columnValues) }
    );
    return d.create_item.id;
  }
  /** Create a new column on a board (used to auto-provision required columns on link). */
  async createColumn(boardId, title, columnType) {
    const d = await this.gql(
      `mutation ($b: ID!, $t: String!, $ct: ColumnType!) {
         create_column(board_id: $b, title: $t, column_type: $ct) { id }
       }`,
      { b: boardId, t: title, ct: columnType }
    );
    return d.create_column.id;
  }
  /** Duplicate an item on the same board (used for snags); returns the new item id. */
  async duplicateItem(boardId, itemId, withUpdates = false) {
    const d = await this.gql(
      `mutation ($b: ID!, $i: ID!, $u: Boolean) {
         duplicate_item(board_id: $b, item_id: $i, with_updates: $u) { id }
       }`,
      { b: boardId, i: itemId, u: withUpdates }
    );
    return d.duplicate_item.id;
  }
  async changeColumnValues(boardId, itemId, columnValues) {
    await this.gql(
      `mutation ($b: ID!, $i: ID!, $cv: JSON!) {
         change_multiple_column_values(board_id: $b, item_id: $i, column_values: $cv) { id }
       }`,
      { b: boardId, i: itemId, cv: JSON.stringify(columnValues) }
    );
  }
  /** Upload a file into a file column (e.g. Design Sketch). Uses Monday's multipart file endpoint. */
  async addFileToColumn(itemId, columnId, bytes, fileName, contentType = "image/png") {
    const form = new FormData();
    form.append(
      "query",
      `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`
    );
    form.append("variables[file]", new Blob([bytes], { type: contentType }), fileName);
    const res = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: { Authorization: this.token },
      body: form
    });
    const json = await res.json();
    if (json.errors) throw new Error("Monday file upload error: " + JSON.stringify(json.errors));
    return json.data.add_file_to_column.id;
  }
};

// apps/api/src/mapItem.ts
var INSTALL_STATUS_LABEL = {
  scheduled: "Scheduled",
  installed_no_snag: "Installed no snag",
  installed_snag: "Installed + snag",
  snag: "Snag",
  misfit: "MisFit",
  delayed: "Delayed"
};
var norm = (s2) => s2.trim().toLowerCase().replace(/\s+/g, " ");
var REQUIRED_MONDAY_COLUMNS = [
  { title: "Block", type: "text" },
  { title: "Elevation", type: "text" },
  { title: "Flat / Plot No.", type: "text" },
  { title: "Room", type: "text" },
  { title: "Item", type: "text" },
  { title: "Floor", type: "text" },
  { title: "Item Type", type: "text" },
  { title: "Window Type", type: "text" },
  { title: "Design Code", type: "text" },
  { title: "Glass", type: "text" },
  { title: "Safety Glass", type: "text" },
  { title: "Glazing", type: "text" },
  { title: "Glazing Bars", type: "text" },
  { title: "Open In / Open Out", type: "text" },
  { title: "Add-Ons Required", type: "text" },
  { title: "Coupled", type: "text" },
  { title: "Comments", type: "long_text" },
  { title: "Full Location Ref", type: "long_text" },
  { title: "Width", type: "numbers" },
  { title: "Height (inc Cill)", type: "numbers" },
  { title: "Cill Depth", type: "text" },
  { title: "Transom 1 (from top)", type: "numbers" },
  { title: "Transom 2 (from top)", type: "numbers" },
  { title: "Transom Equal", type: "checkbox" },
  { title: "Mullion 1 (from left)", type: "numbers" },
  { title: "Mullion 2 (from left)", type: "numbers" },
  { title: "Mullion Equal", type: "checkbox" },
  { title: "Labour Cost", type: "numbers" },
  { title: "Material", type: "dropdown" },
  { title: "Fitters", type: "dropdown" },
  { title: "Install Status", type: "status" },
  { title: "Picture Before", type: "file" },
  { title: "Picture After", type: "file" },
  { title: "Design Sketch", type: "file" }
];
var NON_WRITABLE = /* @__PURE__ */ new Set([
  "mirror",
  "lookup",
  "formula",
  "button",
  "subtasks",
  "board_relation",
  "dependency",
  "progress",
  "auto_number",
  "name",
  "file",
  "doc",
  "creation_log",
  "last_updated",
  "item_id",
  "vote",
  "time_tracking"
]);
function byTitle(cols) {
  const m = /* @__PURE__ */ new Map();
  for (const c of cols) {
    if (NON_WRITABLE.has(c.type)) continue;
    const key = norm(c.title);
    if (!m.has(key)) m.set(key, c);
  }
  return m;
}
function labelList(col) {
  const s2 = col.settings?.labels;
  if (Array.isArray(s2)) return s2.map((x) => typeof x === "string" ? x : x.name ?? x.label).filter(Boolean);
  if (s2 && typeof s2 === "object") return Object.values(s2).filter((v) => typeof v === "string");
  return [];
}
function matchLabel(col, wanted) {
  const hit = labelList(col).find((l) => norm(l) === norm(wanted));
  return hit ?? wanted;
}
function buildColumnValues(cols, { item, teamName, ratePounds }) {
  const map = byTitle(cols);
  const out = {};
  const entries = [
    { title: "Block", value: item.block },
    { title: "Elevation", value: item.elevation },
    { title: "Flat / Plot No.", value: item.flat },
    { title: "Room", value: item.room_code },
    { title: "Item", value: item.item_code },
    { title: "Floor", value: item.floor },
    { title: "Material", value: item.material },
    { title: "Item Type", value: item.item_type },
    { title: "Window Type", value: item.window_type },
    { title: "Design Code", value: item.design_code },
    { title: "Glass", value: item.glass },
    { title: "Safety Glass", value: item.safety_glass },
    { title: "Glazing", value: item.glazing },
    { title: "Glazing Bars", value: item.glazing_bars },
    { title: "Width", value: item.width_mm },
    { title: "Height (inc Cill)", value: item.height_mm },
    { title: "Cill Depth", value: item.cill_depth ?? item.cill_depth_mm },
    { title: "Transom 1 (from top)", value: item.transom1_mm },
    { title: "Transom 2 (from top)", value: item.transom2_mm },
    { title: "Transom Equal", value: item.transom_equal },
    { title: "Mullion 1 (from left)", value: item.mullion1_mm },
    { title: "Mullion 2 (from left)", value: item.mullion2_mm },
    { title: "Mullion Equal", value: item.mullion_equal },
    { title: "Open In / Open Out", value: item.open_in_out },
    { title: "Add-Ons Required", value: item.add_ons },
    { title: "Coupled", value: item.coupled },
    { title: "Comments", value: item.comments },
    { title: "Full Location Ref", value: item.full_code },
    { title: "Fitters", value: teamName ?? null },
    { title: "Install Status", value: item.install_status ? INSTALL_STATUS_LABEL[item.install_status] : null },
    { title: "Labour Cost", value: ratePounds ?? null }
  ];
  for (const { title, value } of entries) {
    if (value == null || value === "") continue;
    const col = map.get(norm(title));
    if (!col) continue;
    switch (col.type) {
      case "dropdown":
        out[col.id] = { labels: [matchLabel(col, String(value))] };
        break;
      case "status":
      case "color":
        out[col.id] = { label: matchLabel(col, String(value)) };
        break;
      case "numbers":
      case "numeric":
        out[col.id] = String(value);
        break;
      case "checkbox":
        out[col.id] = value ? { checked: "true" } : { checked: "false" };
        break;
      default:
        out[col.id] = String(value);
    }
  }
  return out;
}

// apps/api/src/syncItem.ts
async function upsertSurveyItem(monday, boardId, inputs) {
  const fullCode = inputs.item.full_code;
  if (!fullCode) throw new Error("Item has no full_code \u2014 cannot sync.");
  const snagComment = inputs.item.snag_comment;
  const itemName = inputs.item.kind === "snag" && snagComment ? `${fullCode} \u2014 ${snagComment}`.slice(0, 255) : fullCode;
  const cols = await monday.getColumns(boardId);
  const columnValues = buildColumnValues(cols, inputs);
  const existingId = await monday.findItemIdByName(boardId, itemName);
  if (existingId) {
    await monday.changeColumnValues(boardId, existingId, columnValues);
    return { itemId: existingId, action: "updated", fullCode };
  }
  const itemId = await monday.createItem(boardId, itemName, columnValues);
  return { itemId, action: "created", fullCode };
}

// apps/api/src/promote.ts
var import_shared3 = require("@ace/shared");
async function promoteItem(itemId) {
  const item = await getSurveyItem(itemId);
  const job = await getJob(item.job_id);
  if (!job.monday_board_id) throw new Error(`Job ${job.client_code}.${job.job_code} has no Monday board linked.`);
  const team = await getTeam(item.team_id);
  const ratePennies = (0, import_shared3.effectiveRatePennies)(item, team ? [team] : []);
  const ratePounds = ratePennies != null ? ratePennies / 100 : null;
  const monday = new Monday();
  const res = await upsertSurveyItem(monday, job.monday_board_id, {
    item,
    ratePounds,
    teamName: team?.name ?? null
    // sets the Fitters dropdown, matched by name
  });
  await markItemSynced(itemId, res.itemId);
  if (!job.monday_account_slug) {
    try {
      const slug = await monday.getAccountSlug();
      if (slug) await setJobBoard(job.id, job.monday_board_id, slug);
    } catch {
    }
  }
  const COLUMN_FOR_KIND = {
    before: "picture before",
    after: "picture after",
    survey: "design sketch",
    sketch: "design sketch"
  };
  let photosPushed = 0;
  let photoError;
  try {
    const pending = (await listItemPhotos(itemId)).filter((p) => COLUMN_FOR_KIND[p.kind] && !p.monday_pushed);
    if (pending.length) {
      const cols = await monday.getColumns(job.monday_board_id);
      const norm2 = (s2) => s2.trim().toLowerCase().replace(/\s+/g, " ");
      const fileCol = (title) => cols.find((c) => norm2(c.title) === title && c.type === "file");
      const missing = /* @__PURE__ */ new Set();
      for (const ph of pending) {
        const wantTitle = COLUMN_FOR_KIND[ph.kind];
        const col = fileCol(wantTitle);
        if (!col) {
          missing.add(wantTitle);
          continue;
        }
        const bytes = await downloadPhoto(ph.storage_path);
        await monday.addFileToColumn(res.itemId, col.id, bytes, ph.storage_path.split("/").pop() ?? "photo.jpg");
        await markPhotoPushed(ph.id);
        photosPushed++;
      }
      if (missing.size) {
        const pretty = [...missing].map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join('", "');
        photoError = `No file column(s) named "${pretty}" on board ${job.monday_board_id}.`;
      }
    }
  } catch (e) {
    photoError = e?.message ?? String(e);
    console.warn(`[promote] photo push failed for ${itemId}: ${photoError}`);
  }
  return { mondayItemId: res.itemId, action: res.action, boardId: job.monday_board_id, photosPushed, photoError };
}

// apps/api/src/recognise.ts
var import_shared4 = require("@ace/shared");
function visionConfig() {
  const url = process.env.VISION_API_URL;
  const model = process.env.VISION_MODEL;
  if (!url || !model) {
    throw new Error("Vision assist is off \u2014 set VISION_API_URL and VISION_MODEL (+ VISION_API_KEY if required) in .env.");
  }
  return { url: url.replace(/\/+$/, ""), key: process.env.VISION_API_KEY ?? "", model };
}
async function recogniseImage(bytes, mime = "image/jpeg") {
  const { url, key, model } = visionConfig();
  const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...key ? { authorization: `Bearer ${key}` } : {} },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: import_shared4.RECOGNITION_PROMPT },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  return (0, import_shared4.parseRecognition)(typeof content === "string" ? content : JSON.stringify(content));
}
async function recogniseItemPhoto(itemId) {
  const photos = await listItemPhotos(itemId);
  if (photos.length === 0) throw new Error("This item has no photo to analyse yet.");
  const latest = photos[photos.length - 1];
  const bytes = await downloadPhoto(latest.storage_path);
  return recogniseImage(bytes);
}

// apps/api/src/office.ts
var import_shared6 = require("@ace/shared");
var import_meta = {};
var normTitle = (s2) => s2.toLowerCase().replace(/[^a-z0-9]/g, "");
function pickDateColumn(cols) {
  const dates = cols.filter((c) => c.type === "date");
  if (!dates.length) return null;
  const rank = (t) => {
    const n = normTitle(t);
    if (n.includes("install")) return 5;
    if (n.includes("fit")) return 4;
    if (n.includes("plan")) return 3;
    if (n.includes("schedule")) return 2;
    if (n.includes("due")) return 1;
    if (n.includes("date")) return 0;
    return -1;
  };
  const ranked = dates.map((c) => ({ c, r: rank(c.title) })).filter((x) => x.r >= 0).sort((a, b) => b.r - a.r);
  if (ranked.length) return ranked[0].c;
  return dates.length === 1 ? dates[0] : null;
}
function parseMondayDate(text) {
  const m = (text ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
var __dir = (0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(import_meta.url));
var STYLES_DIR = (0, import_node_path.join)(__dir, "../../mobile/assets/styles");
var STYLE_META = (() => {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(__dir, "styleMeta.generated.json"), "utf8"));
  } catch {
    return {};
  }
})();
var STYLE_IMAGE_CODES = (() => {
  try {
    return new Set((0, import_node_fs.readdirSync)(STYLES_DIR).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, "")));
  } catch {
    return /* @__PURE__ */ new Set();
  }
})();
var TEST_SCENARIOS = (() => {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(__dir, "testScenarios.json"), "utf8"));
  } catch {
    return [];
  }
})();
var STYLE_CATALOGUE = Object.keys(STYLE_META).filter((code) => STYLE_IMAGE_CODES.has(code)).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b)).map((code) => ({ code, ...STYLE_META[code] }));
var genPassword = () => "ACE-" + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
var ROLES = [...import_shared6.ROLES];
var ROLE_MATRIX = { caps: import_shared6.CAPABILITIES, roles: import_shared6.ROLES, labels: import_shared6.ROLE_LABEL, matrix: import_shared6.ROLE_CAPS };
var PHOTO_KIND_LABEL = { reference: "Reference", survey: "Survey", sketch: "Sketch", install: "Install", before: "Picture Before", after: "Picture After" };
var PORT = Number(process.env.PORT ?? 3e3);
function authClient() {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env.");
  return (0, import_supabase_js2.createClient)(url, anon, { auth: { persistSession: false } });
}
var send = (res, code, data, type = "application/json") => {
  const headers = { "content-type": type };
  if (type === "application/json") headers["cache-control"] = "no-store";
  res.writeHead(code, headers);
  res.end(type === "application/json" ? JSON.stringify(data) : data);
};
var readJson = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => b += c);
  req.on("end", () => {
    try {
      resolve(b ? JSON.parse(b) : {});
    } catch {
      resolve({});
    }
  });
});
function parseMondayRef(input) {
  const s2 = String(input ?? "").trim();
  if (!s2) return { board: null, slug: null };
  const slug = s2.match(/https?:\/\/([a-z0-9-]+)\.monday\.com/i)?.[1] ?? null;
  let board = s2.match(/\/boards\/(\d+)/)?.[1] ?? null;
  if (!board) {
    if (/^\d{4,}$/.test(s2)) board = s2;
    else board = (s2.match(/\d{4,}/g) ?? []).sort((a, b) => b.length - a.length)[0] ?? null;
  }
  return { board, slug };
}
var mondayItemUrl = (job, itemId) => `https://${job.monday_account_slug ? job.monday_account_slug + ".monday.com" : "monday.com"}/boards/${job.monday_board_id}/pulses/${itemId}`;
async function dashboardData(tenantId) {
  const jobs = await listJobs(tenantId);
  const teams = await listTeams(tenantId);
  const INSTALLED = /* @__PURE__ */ new Set(["installed_no_snag", "installed_snag"]);
  const STATUS_ORDER = [
    ["scheduled", "Scheduled"],
    ["installed_no_snag", "Installed"],
    ["installed_snag", "Installed + snag"],
    ["snag", "Snag"],
    ["misfit", "MisFit"],
    ["delayed", "Delayed"],
    ["none", "No status"]
  ];
  const statusCounts = {};
  const perJob = await Promise.all(jobs.map(async (j) => {
    const items = await listSurveyItems(j.id);
    const snags = items.filter((it) => it.kind === "snag");
    const synced = items.filter((it) => it.monday_item_id).length;
    const installed = items.filter((it) => it.install_status && INSTALLED.has(it.install_status)).length;
    const openSnags = snags.filter((it) => !(it.install_status && INSTALLED.has(it.install_status))).length;
    const dirty = items.filter((it) => it.monday_item_id && it.needs_resync).length;
    const labourP = items.reduce((s2, it) => s2 + ((0, import_shared6.effectiveRatePennies)(it, teams) ?? 0), 0);
    for (const it of items) statusCounts[it.install_status ?? "none"] = (statusCounts[it.install_status ?? "none"] ?? 0) + 1;
    return {
      code: `${j.client_code}.${j.job_code}`,
      name: j.name,
      board: !!j.monday_board_id,
      items: items.length,
      windows: items.length - snags.length,
      snags: snags.length,
      synced,
      installed,
      openSnags,
      dirty,
      labour: (0, import_shared6.formatPennies)(labourP),
      labourP
    };
  }));
  const t = perJob.reduce((a, j) => ({
    items: a.items + j.items,
    synced: a.synced + j.synced,
    installed: a.installed + j.installed,
    snags: a.snags + j.snags,
    openSnags: a.openSnags + j.openSnags,
    dirty: a.dirty + j.dirty,
    labourP: a.labourP + j.labourP
  }), { items: 0, synced: 0, installed: 0, snags: 0, openSnags: 0, dirty: 0, labourP: 0 });
  const breakdown = STATUS_ORDER.map(([key, label]) => ({ key, label, count: statusCounts[key] ?? 0 })).filter((s2) => s2.count > 0);
  return {
    totals: {
      jobs: jobs.length,
      items: t.items,
      synced: t.synced,
      installed: t.installed,
      snags: t.snags,
      openSnags: t.openSnags,
      dirty: t.dirty,
      labour: (0, import_shared6.formatPennies)(t.labourP)
    },
    breakdown,
    jobs: perJob
  };
}
function levelSeg(v) {
  const s2 = String(v ?? "").trim().replace(/^F(?=[0-9])/i, "");
  if (!s2) return "";
  return /^[0-9]+$/.test(s2) ? `F${s2}` : s2.toUpperCase();
}
function buildItemCode(p) {
  const up = (v) => String(v ?? "").trim().toUpperCase();
  const level = p.flat != null && String(p.flat).trim() !== "" ? levelSeg(p.flat) : levelSeg(p.floor);
  return [p.client, p.job, up(p.block), up(p.elevation), level, up(p.room), up(p.item)].filter(Boolean).join(".");
}
var itemRow = (it, job, teams) => ({
  id: it.id,
  full_code: it.full_code,
  block: it.block ?? null,
  elevation: it.elevation ?? null,
  floor: it.floor ?? null,
  flat: it.flat,
  room: it.room_code,
  item: it.item_code,
  stage: it.stage,
  kind: it.kind ?? "item",
  snag_comment: it.snag_comment ?? null,
  install_status: it.install_status,
  team_id: it.team_id,
  rate_override_pennies: it.rate_override_pennies,
  effective_rate: (0, import_shared6.formatPennies)((0, import_shared6.effectiveRatePennies)(it, teams)),
  synced: !!it.monday_item_id,
  dirty: !!it.monday_item_id && !!it.needs_resync,
  monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null
});
async function context(req) {
  const h = String(req.headers["authorization"] ?? "");
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data } = await authClient().auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const cols = "id,tenant_id,role,name,active,email,client_code";
  let { data: rows } = await db().from("app_users").select(cols).eq("auth_user_id", user.id).order("created_at").limit(1);
  let u = rows && rows[0];
  if (!u && user.email) {
    const email = user.email.toLowerCase();
    const byEmail = await db().from("app_users").select(cols).eq("email", email).order("created_at").limit(1);
    u = byEmail.data && byEmail.data[0];
    if (u) await db().from("app_users").update({ auth_user_id: user.id }).eq("id", u.id);
  }
  if (!u || !u.active) return null;
  return u;
}
function audit(ctx, action, entity, entityId, summary) {
  insertAuditLog({ tenant_id: ctx.tenant_id, actor_user_id: ctx.id, actor_name: ctx.name, actor_role: ctx.role, action, entity, entity_id: entityId, summary }).catch((e) => console.warn("[audit]", e?.message ?? e));
}
var server = (0, import_node_http.createServer)(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const p = url.pathname;
    if (p === "/") {
      const html = PAGE.replaceAll("__APP_VERSION__", import_shared6.APP_VERSION).replace("__CHANGELOG_JSON__", () => JSON.stringify(import_shared6.CHANGELOG)).replace("__ROLE_MATRIX_JSON__", () => JSON.stringify(ROLE_MATRIX)).replaceAll("__SUPABASE_URL__", () => process.env.SUPABASE_URL ?? "").replaceAll("__SUPABASE_ANON_KEY__", () => process.env.SUPABASE_ANON_KEY ?? "").replaceAll("__SSO_ENABLED__", () => process.env.AZURE_SSO_ENABLED === "true" ? "true" : "false").replaceAll("__APP_ENV__", () => process.env.APP_ENV === "test" ? "test" : process.env.APP_ENV === "prod" ? "prod" : "");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (p.startsWith("/api/style-image/")) {
      const code = decodeURIComponent(p.slice("/api/style-image/".length));
      if (!STYLE_IMAGE_CODES.has(code)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      try {
        const bytes = (0, import_node_fs.readFileSync)((0, import_node_path.join)(STYLES_DIR, `${code}.png`));
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
      return;
    }
    if (p === "/api/styles") {
      send(res, 200, STYLE_CATALOGUE);
      return;
    }
    if (p === "/live") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(LIVE_PAGE);
      return;
    }
    if (p === "/api/live") {
      const want = process.env.LIVE_KEY ?? "";
      if (!want) {
        send(res, 503, { error: "Live view is off \u2014 set LIVE_KEY in .env to enable it." });
        return;
      }
      if ((url.searchParams.get("key") ?? "") !== want) {
        send(res, 401, { error: "Bad or missing key." });
        return;
      }
      send(res, 200, await dashboardData(ACE_TENANT));
      return;
    }
    if (p === "/api/login" && req.method === "POST") {
      const { email, password } = await readJson(req);
      const { data, error } = await authClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        send(res, 401, { error: "Invalid email or password" });
        return;
      }
      const { data: u } = await db().from("app_users").select("name,role,client_code").eq("auth_user_id", data.user.id).maybeSingle();
      send(res, 200, { token: data.session.access_token, name: u?.name ?? email, role: u?.role ?? "user", client_code: u?.client_code ?? null });
      return;
    }
    const ctx = await context(req);
    if (!ctx) {
      send(res, 401, { error: "Not authenticated" });
      return;
    }
    const allow = (cap) => {
      if ((0, import_shared6.can)(ctx.role, cap)) return true;
      send(res, 403, { error: `Your role (${ctx.role}) is not allowed to do that.` });
      return false;
    };
    if (p === "/api/me") {
      send(res, 200, { id: ctx.id, name: ctx.name, role: ctx.role, client_code: ctx.client_code ?? null });
      return;
    }
    if (ctx.role === "customer") {
      const allowedForCustomer = p === "/api/me" || p === "/api/customer/jobs" || p.startsWith("/api/job/") && p.endsWith("/report.pdf") && req.method === "GET";
      if (!allowedForCustomer) {
        send(res, 403, { error: "Not allowed." });
        return;
      }
    }
    if (p === "/api/customer/jobs" && req.method === "GET") {
      if (ctx.role !== "customer" || !ctx.client_code) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const jobs = (await listJobs(ctx.tenant_id)).filter((j) => j.client_code === ctx.client_code);
      send(res, 200, jobs.map((j) => ({ code: `${j.client_code}.${j.job_code}`, name: j.name })));
      return;
    }
    if (p === "/api/dashboard") {
      send(res, 200, await dashboardData(ctx.tenant_id));
      return;
    }
    if (p === "/api/calendar" && req.method === "GET") {
      if (!allow("dashboard.view")) return;
      const teams = await listTeams(ctx.tenant_id);
      const tname = new Map(teams.map((t) => [t.id, t.name]));
      const rows = await listScheduledItems(ctx.tenant_id);
      const items = rows.map((r) => ({
        id: r.id,
        full_code: r.full_code,
        room_code: r.room_code,
        item_code: r.item_code,
        install_status: r.install_status,
        date: r.planned_install_date,
        job: r.jobs ? `${r.jobs.client_code}.${r.jobs.job_code}` : "",
        jobName: r.jobs?.name ?? "",
        team: r.team_id ? tname.get(r.team_id) ?? "" : "",
        team_id: r.team_id ?? ""
      }));
      send(res, 200, { items, teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })) });
      return;
    }
    if (p === "/api/pricing-rules" && req.method === "GET") {
      if (!allow("finance.view")) return;
      send(res, 200, await listPricingRules(ctx.tenant_id));
      return;
    }
    if (p === "/api/pricing-rules" && req.method === "POST") {
      if (!allow("finance.manage")) return;
      const b = await readJson(req);
      const name = String(b.name ?? "").trim();
      if (!name) {
        send(res, 400, { error: "A rule name is required." });
        return;
      }
      try {
        const created = await createPricingRule(ctx.tenant_id, { name, customer: b.customer ?? null, model: b.model || "axs_flat_v1", params: b.params ?? {} });
        send(res, 200, { ok: true, id: created.id });
      } catch (err) {
        if (err?.code === "23505") {
          send(res, 409, { error: `A rule called "${name}" already exists.` });
          return;
        }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith("/api/pricing-rules/") && req.method === "PUT") {
      if (!allow("finance.manage")) return;
      const id = p.split("/")[3] ?? "";
      const b = await readJson(req);
      const patch = {};
      if (b.name !== void 0) patch.name = String(b.name).trim();
      if (b.customer !== void 0) patch.customer = b.customer || null;
      if (b.model !== void 0) patch.model = b.model || "axs_flat_v1";
      if (b.params !== void 0) patch.params = b.params;
      if (b.active !== void 0) patch.active = !!b.active;
      try {
        await updatePricingRule(id, ctx.tenant_id, patch);
        send(res, 200, { ok: true });
      } catch (err) {
        if (err?.code === "23505") {
          send(res, 409, { error: "Another rule already has that name." });
          return;
        }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith("/api/pricing-rules/") && req.method === "DELETE") {
      if (!allow("finance.manage")) return;
      const id = p.split("/")[3] ?? "";
      await deletePricingRule(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/tests" && req.method === "GET") {
      if (!allow("dashboard.view")) return;
      const results = await latestTestResults(ctx.tenant_id, import_shared6.APP_VERSION);
      send(res, 200, { version: import_shared6.APP_VERSION, scenarios: TEST_SCENARIOS, results });
      return;
    }
    if (p === "/api/tests/result" && req.method === "POST") {
      if (!allow("dashboard.view")) return;
      const b = await readJson(req);
      const code = String(b.code ?? "").trim();
      const status = b.status === "ok" ? "ok" : b.status === "nok" ? "nok" : "";
      if (!code || !TEST_SCENARIOS.some((s2) => s2.code === code)) {
        send(res, 400, { error: "Unknown scenario." });
        return;
      }
      if (!status) {
        send(res, 400, { error: "Status must be ok or nok." });
        return;
      }
      await insertTestResult(ctx.tenant_id, {
        scenario_code: code,
        app_version: import_shared6.APP_VERSION,
        status,
        comment: (b.comment ?? "").toString().trim() || null,
        tested_by: ctx.name ?? null,
        tested_by_id: ctx.id ?? null
      });
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/tests/export.csv" && req.method === "GET") {
      if (!allow("dashboard.view")) return;
      const rows = await allTestResults(ctx.tenant_id, import_shared6.APP_VERSION);
      const esc = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
      const byCode = new Map(TEST_SCENARIOS.map((s2) => [s2.code, s2]));
      const lines = ["code,area,feature,status,comment,tested_by,at"];
      for (const r of rows) {
        const s2 = byCode.get(r.scenario_code) ?? {};
        lines.push([r.scenario_code, s2.area, s2.feature, r.status, r.comment, r.tested_by, r.created_at].map(esc).join(","));
      }
      res.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename="test-results-v${import_shared6.APP_VERSION}.csv"`, "cache-control": "no-store" });
      res.end(lines.join("\n"));
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/pricing") && req.method === "GET") {
      if (!allow("finance.view")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const rules = await listPricingRules(ctx.tenant_id);
      const ruleId = await getJobRuleId(job.id);
      const rule = ruleId ? await getPricingRule(ruleId, ctx.tenant_id) : null;
      let breakdown = null;
      let itemList = [];
      if (rule && rule.params?.sale) {
        const items = await listSurveyItems(job.id);
        const ipMap = new Map((await listItemPricing(items.map((i) => i.id))).map((r) => [r.item_id, r]));
        const priceItems = items.map((it) => {
          const f = ipMap.get(it.id);
          return {
            id: it.id,
            full_code: it.full_code,
            kind: it.kind,
            category: (0, import_shared5.classifyCategory)({ item_type: it.item_type, item_code: it.item_code }),
            width_mm: it.width_mm,
            height_mm: it.height_mm,
            flat: it.flat,
            is_variation: !!f?.is_variation,
            variation_amount: f?.variation_amount_pennies ?? 0
          };
        });
        breakdown = (0, import_shared5.priceJob)(priceItems, rule);
        itemList = priceItems.filter((it) => (it.kind ?? "item") !== "snag").map((it) => ({
          id: it.id,
          full_code: it.full_code,
          category: it.category,
          flat: it.flat ?? null,
          is_variation: !!it.is_variation,
          variation_amount: it.variation_amount ?? 0
        }));
      }
      send(res, 200, { rule_id: ruleId, rule_name: rule?.name ?? null, rules: rules.map((r) => ({ id: r.id, name: r.name })), breakdown, items: itemList });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/pricing") && req.method === "PUT") {
      if (!allow("finance.manage")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      await setJobRuleId(job.id, ctx.tenant_id, b.rule_id || null);
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/price.pdf") && req.method === "GET") {
      if (!allow("finance.view")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      try {
        const out = await buildJobPricePdf(c, j, ctx.tenant_id);
        if (!out) {
          send(res, 400, { error: "Assign a pricing rule to this job first." });
          return;
        }
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${c}.${j}-price-breakdown.pdf"`,
          "cache-control": "no-store"
        });
        res.end(out.buffer);
      } catch (e) {
        send(res, e?.message === "forbidden" ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }
    if (p.startsWith("/api/item/") && p.endsWith("/pricing") && req.method === "PUT") {
      if (!allow("finance.manage")) return;
      const id = p.split("/")[3] ?? "";
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const isVar = !!b.is_variation;
      const amt = b.variation_amount_pennies == null || b.variation_amount_pennies === "" ? null : Math.round(Number(b.variation_amount_pennies));
      await setItemPricing(id, ctx.tenant_id, { is_variation: isVar, variation_amount_pennies: isVar ? amt : null });
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/jobs" && req.method === "GET") {
      let jobs = await listJobs(ctx.tenant_id);
      if (ctx.role === "scanner") jobs = jobs.filter((j) => j.status === "pending_mapping");
      send(res, 200, jobs.map((j) => ({
        code: `${j.client_code}.${j.job_code}`,
        name: j.name,
        status: j.status ?? "new",
        mapping_start_date: j.mapping_start_date ?? null
      })));
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/mapping-date") && req.method === "POST") {
      if (!allow("jobs.manage")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const date = String(b.date ?? "").trim() || null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        send(res, 400, { error: "Use a valid date (YYYY-MM-DD)." });
        return;
      }
      await setJobMappingDate(job.id, date, ctx.tenant_id);
      send(res, 200, { ok: true, status: date ? "pending_mapping" : "new" });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/mapping-items") && req.method === "POST") {
      if (!allow("items.create")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const block = String(b.block ?? "").trim().toUpperCase() || null;
      const elevation = String(b.elevation ?? "").trim().toUpperCase() || null;
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) {
        send(res, 400, { error: "Nothing to save \u2014 preload some items first." });
        return;
      }
      const seen = /* @__PURE__ */ new Set();
      const fields = [];
      for (const r of rows) {
        const floor = levelSeg(String(r.floor ?? "").trim());
        const flat = String(r.flat ?? "").trim().replace(/^F(?=[0-9])/i, "");
        const item = String(r.item ?? "").trim().toUpperCase();
        if (!item) continue;
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, flat, floor, item });
        if (seen.has(full_code)) continue;
        seen.add(full_code);
        fields.push({
          tenant_id: ctx.tenant_id,
          job_id: job.id,
          stage: "scanned",
          block,
          elevation,
          floor: floor || null,
          flat: flat || null,
          item_code: item,
          item_type: String(r.item_type ?? "").trim() || null,
          full_code
        });
      }
      try {
        const inserted = await bulkInsertSurveyItems(fields);
        audit(ctx, "mapping.save", "job", code, `Mapped ${inserted} item(s) on ${code}${block ? " \xB7 " + block : ""}${elevation ? "/" + elevation : ""}`);
        send(res, 200, { ok: true, inserted, skipped: fields.length - inserted });
      } catch (err) {
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p === "/api/jobs" && req.method === "POST") {
      if (!allow("jobs.manage")) return;
      const b = await readJson(req);
      const client_code = String(b.client_code ?? "").trim().toUpperCase();
      const job_code = String(b.job_code ?? "").trim().toUpperCase();
      const name = String(b.name ?? "").trim();
      if (!client_code || !job_code) {
        send(res, 400, { error: "Client code and job code are required (they form the job code, e.g. AXS.LAB)." });
        return;
      }
      if (!name) {
        send(res, 400, { error: "A job name is required." });
        return;
      }
      try {
        const job = await createJob(ctx.tenant_id, { client_code, job_code, name, site_address: b.site_address || null });
        audit(ctx, "job.create", "job", `${job.client_code}.${job.job_code}`, `Created job ${job.client_code}.${job.job_code} \u2014 ${name}`);
        send(res, 200, { ok: true, code: `${job.client_code}.${job.job_code}` });
      } catch (err) {
        if (err?.code === "23505") {
          send(res, 409, { error: `Job ${client_code}.${job_code} already exists.` });
          return;
        }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith("/api/job/") && req.method === "DELETE" && p.split("/").length === 4) {
      if (!allow("jobs.manage")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const n = await countItemsForJob(job.id);
      if (n > 0) {
        send(res, 409, { error: `This job has ${n} item${n === 1 ? "" : "s"}. Delete or move them first \u2014 a job can only be removed when it's empty.` });
        return;
      }
      await deleteJob(job.id, ctx.tenant_id);
      audit(ctx, "job.delete", "job", code, `Deleted job ${code}`);
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/files") && req.method === "GET") {
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const files = await listJobFiles(job.id);
      const out = await Promise.all(files.map(async (f) => ({
        id: f.id,
        name: f.name,
        content_type: f.content_type,
        size_bytes: f.size_bytes,
        url: await signedJobFileUrl(f.storage_path)
      })));
      send(res, 200, out);
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/files") && req.method === "POST") {
      if (!allow("jobs.manage")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const files = Array.isArray(b.files) ? b.files : [];
      let saved = 0;
      const names = [];
      for (const f of files) {
        const name = String(f.name ?? "file").trim() || "file";
        const m = /^data:([^;]*);base64,(.+)$/.exec(String(f.dataUrl ?? ""));
        if (!m) continue;
        const contentType = m[1] || "application/octet-stream";
        const bytes = Buffer.from(m[2], "base64");
        if (bytes.length > 25 * 1024 * 1024) {
          send(res, 400, { error: `"${name}" is over 25MB.` });
          return;
        }
        const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
        const path = `${ctx.tenant_id}/${job.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
        try {
          await ensureJobFileBucket();
          await uploadJobFile(path, bytes, contentType);
          await insertJobFile({ tenant_id: ctx.tenant_id, job_id: job.id, name, storage_path: path, content_type: contentType, size_bytes: bytes.length });
          saved++;
          names.push(name);
        } catch (err) {
          send(res, 500, { error: "Upload failed: " + (err?.message ?? String(err)) });
          return;
        }
      }
      if (saved) audit(ctx, "job.files", "job", code, `Added ${saved} file(s) to ${code}: ${names.join(", ")}`);
      send(res, 200, { ok: true, saved });
      return;
    }
    if (p.startsWith("/api/job/") && p.includes("/files/") && req.method === "DELETE") {
      if (!(ctx.role === "admin" || ctx.role === "office")) {
        send(res, 403, { error: "Managers only" });
        return;
      }
      const parts = p.split("/");
      const code = decodeURIComponent(parts[3] ?? "");
      const fileId = parts[5];
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      await deleteJobFile(fileId, ctx.tenant_id);
      audit(ctx, "job.files.delete", "job", code, `Removed a file from ${code}`);
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/items" && req.method === "GET") {
      const code = url.searchParams.get("job") ?? "AXS.LAB";
      const teams = await listTeams(ctx.tenant_id);
      if (code === "ALL") {
        const jobs = await listJobs(ctx.tenant_id);
        const rows = [];
        for (const jb of jobs) {
          const items2 = await listSurveyItems(jb.id);
          for (const it of items2) rows.push(itemRow(it, jb, teams));
        }
        send(res, 200, { job: { code: "ALL", name: "All jobs", board: null }, teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })), items: rows, role: ctx.role });
        return;
      }
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const items = await listSurveyItems(job.id);
      send(res, 200, {
        job: { code, name: job.name, board: job.monday_board_id },
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        items: items.map((it) => itemRow(it, job, teams)),
        role: ctx.role
      });
      return;
    }
    if (p === "/api/items" && req.method === "POST") {
      if (!allow("items.create")) return;
      const b = await readJson(req);
      const [c, j] = String(b.job ?? "").split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const room = String(b.room ?? "").trim().toUpperCase();
      const item = String(b.item ?? "").trim().toUpperCase();
      if (!room || !item) {
        send(res, 400, { error: "Room and Item are required (they form the code)." });
        return;
      }
      const full_code = (0, import_shared6.assembleFullCode)({
        client: job.client_code,
        job: job.job_code,
        block: b.block,
        elevation: b.elevation,
        flat: b.flat,
        room,
        item,
        floor: b.floor
      });
      const num = (v) => v === "" || v == null ? null : Math.round(Number(v));
      const str = (v) => {
        const t = (v ?? "").toString().trim();
        return t === "" ? null : t;
      };
      const fields = {
        tenant_id: ctx.tenant_id,
        job_id: job.id,
        stage: "surveyed",
        block: b.block || null,
        elevation: b.elevation || null,
        flat: b.flat || null,
        room_code: room,
        item_code: item,
        floor: b.floor || null,
        full_code,
        material: str(b.material),
        item_type: str(b.item_type),
        window_type: str(b.window_type),
        glass: str(b.glass),
        safety_glass: str(b.safety_glass),
        glazing: str(b.glazing),
        width_mm: num(b.width_mm),
        height_mm: num(b.height_mm),
        cill_depth_mm: num(b.cill_depth_mm),
        transom1_mm: num(b.transom1_mm),
        transom2_mm: num(b.transom2_mm),
        transom3_mm: num(b.transom3_mm),
        mullion1_mm: num(b.mullion1_mm),
        mullion2_mm: num(b.mullion2_mm),
        mullion3_mm: num(b.mullion3_mm),
        open_in_out: str(b.open_in_out),
        add_ons: str(b.add_ons),
        coupled: str(b.coupled),
        design_code: str(b.design_code),
        comments: str(b.comments),
        team_id: b.team_id || null
      };
      try {
        const created = await insertSurveyItem(fields);
        audit(ctx, "item.create", "item", created.id, `Created ${full_code}`);
        send(res, 200, { ok: true, id: created.id, full_code });
      } catch (err) {
        if (err?.code === "23505") {
          send(res, 409, { error: `An item with code ${full_code} already exists.` });
          return;
        }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p === "/api/items/bulk" && req.method === "POST") {
      const { ids, action, value } = await readJson(req);
      if (!Array.isArray(ids) || ids.length === 0) {
        send(res, 400, { error: "No items selected." });
        return;
      }
      const allowed = await filterItemIdsByTenant(ids, ctx.tenant_id);
      if (allowed.length === 0) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (action === "team") {
        if (!allow("items.edit")) return;
        const n = await bulkUpdateItems(allowed, { team_id: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n });
        return;
      }
      if (action === "status") {
        if (!((0, import_shared6.can)(ctx.role, "items.fit") || (0, import_shared6.can)(ctx.role, "items.edit"))) {
          allow("items.fit");
          return;
        }
        const n = await bulkUpdateItems(allowed, { install_status: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n });
        return;
      }
      if (action === "block" || action === "elevation" || action === "floor" || action === "flat" || action === "room") {
        if (!allow("items.edit")) return;
        const raw = String(value ?? "").trim();
        const jobCache = {};
        let updated = 0, locked = 0, dupes = 0;
        for (const id of allowed) {
          const it = await getSurveyItem(id);
          if (it.monday_item_id) {
            locked++;
            continue;
          }
          const job = jobCache[it.job_id] || (jobCache[it.job_id] = await getJob(it.job_id));
          let block = it.block, elevation = it.elevation, flat = it.flat, floor = it.floor, room = it.room_code;
          if (action === "block") block = raw.toUpperCase() || null;
          else if (action === "elevation") elevation = raw.toUpperCase() || null;
          else if (action === "floor") {
            floor = levelSeg(raw) || null;
          } else if (action === "flat") {
            flat = raw.replace(/^F(?=[0-9])/i, "").toUpperCase() || null;
          } else if (action === "room") room = raw.toUpperCase() || null;
          const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, flat, floor, room, item: it.item_code });
          if (await codeExists(ctx.tenant_id, full_code, id)) {
            dupes++;
            continue;
          }
          const { error } = await db().from("survey_items").update({ block, elevation, flat, floor, room_code: room, full_code }).eq("id", id).eq("tenant_id", ctx.tenant_id);
          if (!error) updated++;
        }
        send(res, 200, { ok: true, updated, skipped: locked + dupes, locked, dupes });
        return;
      }
      if (action === "delete") {
        if (!(ctx.role === "admin" || ctx.role === "office")) {
          send(res, 403, { error: `Your role (${ctx.role}) can't delete items.` });
          return;
        }
        const n = await bulkDeleteItems(allowed, ctx.tenant_id);
        audit(ctx, "item.delete", "item", null, `Deleted ${n} item(s)`);
        send(res, 200, { ok: true, deleted: n });
        return;
      }
      if (action === "sync") {
        if (!allow("monday.sync")) return;
        let created = 0, updated = 0, failed = 0;
        const errors = [];
        for (const id of allowed) {
          try {
            const r = await promoteItem(id);
            r.action === "created" ? created++ : updated++;
          } catch (err) {
            failed++;
            if (errors.length < 3) errors.push(err?.message ?? String(err));
          }
        }
        audit(ctx, "item.sync", "item", null, `Synced ${created + updated} item(s) to Monday${failed ? " (" + failed + " failed)" : ""}`);
        send(res, 200, { ok: true, total: allowed.length, created, updated, failed, errors });
        return;
      }
      send(res, 400, { error: "Unknown bulk action." });
      return;
    }
    if (p.startsWith("/api/recognise/") && req.method === "POST") {
      if (!allow("items.edit")) return;
      const id = p.split("/").pop();
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      try {
        const recognition = await recogniseItemPhoto(id);
        send(res, 200, { ok: true, recognition });
      } catch (e) {
        send(res, 200, { ok: false, error: e?.message ?? String(e) });
      }
      return;
    }
    if (p.startsWith("/api/item/") && p.endsWith("/detail") && req.method === "GET") {
      const id = p.split("/")[3];
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const [job, team, photos, childSnags, allTeams] = await Promise.all([
        getJob(it.job_id),
        getTeam(it.team_id),
        listItemPhotos(id),
        listChildSnags(id),
        listTeams(it.tenant_id)
      ]);
      const photoOut = await Promise.all(photos.map(async (ph) => ({
        kind: PHOTO_KIND_LABEL[ph.kind] ?? ph.kind,
        url: await signedPhotoUrl(ph.storage_path)
      })));
      const snagOut = childSnags.map((s2) => ({
        id: s2.id,
        full_code: s2.full_code,
        comment: s2.snag_comment ?? s2.comments,
        rate: (0, import_shared6.formatPennies)((0, import_shared6.effectiveRatePennies)(s2, allTeams)),
        team: allTeams.find((t) => t.id === s2.team_id)?.name ?? null,
        status: s2.install_status,
        synced: !!s2.monday_item_id,
        monday_url: s2.monday_item_id && job.monday_board_id ? mondayItemUrl(job, s2.monday_item_id) : null
      }));
      send(res, 200, {
        item: it,
        team: team?.name ?? null,
        teams: allTeams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        effective_rate: (0, import_shared6.formatPennies)((0, import_shared6.effectiveRatePennies)(it, team ? [team] : [])),
        monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
        photos: photoOut,
        snags: snagOut,
        is_snag: it.kind === "snag"
      });
      return;
    }
    if (p.startsWith("/api/item/") && p.endsWith("/snags") && req.method === "POST") {
      if (!allow("snags.raise")) return;
      const id = p.split("/")[3];
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (it.kind === "snag") {
        send(res, 400, { error: "You can't raise a snag against a snag." });
        return;
      }
      const b = await readJson(req);
      const description = String(b.description ?? "").trim();
      if (!description) {
        send(res, 400, { error: "A snag description is required." });
        return;
      }
      const rate_override_pennies = b.rate_pennies === "" || b.rate_pennies == null ? null : Math.round(Number(b.rate_pennies));
      const team_id = b.team_id || null;
      const snag = await createSnagItem(id, { comment: description, rate_override_pennies, team_id });
      if (b.photo) {
        try {
          const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.photo));
          if (m) {
            const bytes = Buffer.from(m[2], "base64");
            if (bytes.length <= 6 * 1024 * 1024) {
              const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
              const path = `snags/${snag.id}/${Date.now()}.${ext}`;
              await ensurePhotoBucket();
              await uploadPhoto(path, bytes, m[1]);
              await addItemPhoto(it.tenant_id, snag.id, "sketch", path);
            }
          }
        } catch {
        }
      }
      send(res, 200, { ok: true, id: snag.id, full_code: snag.full_code });
      return;
    }
    if (p.startsWith("/api/item/") && p.endsWith("/photo") && req.method === "POST") {
      if (!allow("photos.add")) return;
      const id = p.split("/")[3];
      const it = await getSurveyItem(id);
      if (!it || it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.photo ?? ""));
      if (!m) {
        send(res, 400, { error: "A photo is required." });
        return;
      }
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 6 * 1024 * 1024) {
        send(res, 400, { error: "Photo too large (max 6MB)." });
        return;
      }
      const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
      const path = `${it.tenant_id}/${it.id}/${Date.now()}.${ext}`;
      const kind = ctx.role === "fitter" ? "after" : "before";
      try {
        await ensurePhotoBucket();
        await uploadPhoto(path, bytes, m[1]);
        await addItemPhoto(it.tenant_id, it.id, kind, path);
      } catch (err) {
        send(res, 500, { error: "Upload failed: " + (err?.message ?? String(err)) });
        return;
      }
      send(res, 200, { ok: true, kind });
      return;
    }
    if (p.startsWith("/api/item/") && req.method === "PUT" && !p.endsWith("/pin") && !p.endsWith("/pricing")) {
      const id = p.split("/").pop();
      const body = await readJson(req);
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const SPEC_STR = ["material", "item_type", "window_type", "glass", "safety_glass", "glazing", "glazing_bars", "cill_depth", "open_in_out", "add_ons", "coupled", "design_code", "comments"];
      const SPEC_NUM = ["width_mm", "height_mm", "cill_depth_mm", "transom1_mm", "transom2_mm", "transom3_mm", "mullion1_mm", "mullion2_mm", "mullion3_mm"];
      const SPEC_BOOL = ["transom_equal", "mullion_equal"];
      const STAGES = ["scanned", "in_survey", "surveyed", "synced"];
      const touchesSpec = "rate_override_pennies" in body || "team_id" in body || "stage" in body || SPEC_STR.some((k) => k in body) || SPEC_NUM.some((k) => k in body) || SPEC_BOOL.some((k) => k in body);
      if (touchesSpec) {
        if (!allow("items.edit")) return;
      } else if ("install_status" in body) {
        if (!((0, import_shared6.can)(ctx.role, "items.fit") || (0, import_shared6.can)(ctx.role, "items.edit"))) {
          allow("items.fit");
          return;
        }
      }
      const patch = {};
      if ("rate_override_pennies" in body)
        patch.rate_override_pennies = body.rate_override_pennies === "" || body.rate_override_pennies == null ? null : Math.round(Number(body.rate_override_pennies));
      if ("install_status" in body) patch.install_status = body.install_status || null;
      if ("team_id" in body) patch.team_id = body.team_id || null;
      for (const k of SPEC_STR) if (k in body) patch[k] = String(body[k] ?? "").trim() || null;
      for (const k of SPEC_NUM) if (k in body) {
        const v = body[k];
        patch[k] = v === "" || v == null ? null : Math.round(Number(v));
      }
      for (const k of SPEC_BOOL) if (k in body) patch[k] = !!body[k];
      if ("stage" in body) {
        if (!STAGES.includes(String(body.stage))) {
          send(res, 400, { error: "Invalid stage." });
          return;
        }
        patch.stage = body.stage;
      }
      if ("flat" in body || "room" in body) {
        if (!allow("items.edit")) return;
        if (item.monday_item_id) {
          send(res, 400, { error: "This item is synced to Monday \u2014 its code is locked. Un-sync it first to change Flat/Room." });
          return;
        }
        const job = await getJob(item.job_id);
        const newFlat = "flat" in body ? String(body.flat ?? "").trim().replace(/^F(?=[0-9])/i, "") || null : item.flat ?? null;
        const newRoom = "room" in body ? String(body.room ?? "").trim().toUpperCase() || null : item.room_code ?? null;
        const newFloor = item.floor ?? null;
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block: item.block, elevation: item.elevation, flat: newFlat, floor: newFloor, room: newRoom, item: item.item_code });
        if (await codeExists(ctx.tenant_id, full_code, id)) {
          send(res, 409, { error: `Code ${full_code} already exists \u2014 pick a different Flat/Room.` });
          return;
        }
        patch.flat = newFlat;
        patch.room_code = newRoom;
        patch.floor = newFloor;
        patch.full_code = full_code;
      }
      const { error } = await db().from("survey_items").update(patch).eq("id", id);
      if (error) {
        send(res, 500, { error: error.message });
        return;
      }
      const fieldsChanged = Object.keys(patch);
      if (fieldsChanged.length) audit(ctx, "item.update", "item", id, `${patch.full_code || item.full_code}: ${fieldsChanged.join(", ")}`);
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith("/api/promote/") && req.method === "POST") {
      if (!allow("monday.sync")) return;
      const id = p.split("/").pop();
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const r = await promoteItem(id);
      audit(ctx, "item.sync", "item", id, `Synced ${item.full_code} to Monday (${r.action})`);
      send(res, 200, { ok: true, action: r.action, mondayItemId: r.mondayItemId, photosPushed: r.photosPushed, photoError: r.photoError });
      return;
    }
    if (p === "/api/logs" && req.method === "GET") {
      if (ctx.role !== "admin") {
        send(res, 403, { error: "Admins only" });
        return;
      }
      send(res, 200, await listAuditLog(ctx.tenant_id, 300));
      return;
    }
    if (p === "/api/room-stats" && req.method === "GET") {
      send(res, 200, await roomCodeCounts(ctx.tenant_id));
      return;
    }
    if (p === "/api/teams" && req.method === "GET") {
      const teams = await listTeams(ctx.tenant_id);
      const rows = await Promise.all(teams.map(async (t) => ({
        id: t.id,
        name: t.name,
        default_rate_pennies: t.default_rate_pennies,
        default_rate: (0, import_shared6.formatPennies)(t.default_rate_pennies),
        in_use: await countItemsUsingTeam(t.id),
        door_rate_pennies: t.door_rate_pennies,
        door_rate: (0, import_shared6.formatPennies)(t.door_rate_pennies),
        active: t.active
      })));
      send(res, 200, { teams: rows, canManage: (0, import_shared6.can)(ctx.role, "teams.manage"), role: ctx.role });
      return;
    }
    if (p === "/api/teams" && req.method === "POST") {
      if (!allow("teams.manage")) return;
      const { name, rate_pennies } = await readJson(req);
      if (!name || !String(name).trim()) {
        send(res, 400, { error: "Team name is required" });
        return;
      }
      const pennies = Math.round(Number(rate_pennies));
      if (!Number.isFinite(pennies) || pennies < 0) {
        send(res, 400, { error: "Rate must be a positive number" });
        return;
      }
      const t = await createTeam(ctx.tenant_id, String(name).trim(), pennies);
      send(res, 200, { ok: true, id: t.id });
      return;
    }
    if (p.startsWith("/api/teams/") && (req.method === "PUT" || req.method === "DELETE")) {
      if (!allow("teams.manage")) return;
      const id = p.split("/").pop();
      const team = await getTeam(id);
      if (!team || team.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const patch = {};
        if ("name" in body) {
          if (!String(body.name).trim()) {
            send(res, 400, { error: "Team name is required" });
            return;
          }
          patch.name = String(body.name).trim();
        }
        if ("rate_pennies" in body) {
          const v = Math.round(Number(body.rate_pennies));
          if (!Number.isFinite(v) || v < 0) {
            send(res, 400, { error: "Rate must be a positive number" });
            return;
          }
          patch.default_rate_pennies = v;
        }
        if ("door_rate_pennies" in body) {
          const v = Math.round(Number(body.door_rate_pennies));
          if (!Number.isFinite(v) || v < 0) {
            send(res, 400, { error: "Doors rate must be a positive number" });
            return;
          }
          patch.door_rate_pennies = v;
        }
        if ("active" in body) patch.active = !!body.active;
        await updateTeam(id, patch);
        send(res, 200, { ok: true });
        return;
      }
      const inUse = await countItemsUsingTeam(id);
      if (inUse > 0) {
        send(res, 409, { error: `Can't delete \u2014 ${inUse} item${inUse === 1 ? "" : "s"} still assigned to this team. Reassign them first.` });
        return;
      }
      await deleteTeam(id);
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/sync" && req.method === "GET") {
      const jobs = await listJobs(ctx.tenant_id);
      const rows = await Promise.all(jobs.map(async (j) => {
        const items = await listSurveyItems(j.id);
        const synced = items.filter((it) => it.monday_item_id).length;
        return {
          code: `${j.client_code}.${j.job_code}`,
          name: j.name,
          board: j.monday_board_id ?? null,
          slug: j.monday_account_slug ?? null,
          total: items.length,
          synced,
          unsynced: items.length - synced
        };
      }));
      send(res, 200, { jobs: rows, canManage: (0, import_shared6.can)(ctx.role, "monday.sync") });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/board") && req.method === "PUT") {
      if (!allow("monday.sync")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const { board } = await readJson(req);
      const { board: boardId, slug } = parseMondayRef(board);
      await setJobBoard(job.id, boardId, slug);
      let columnsCreated = [];
      let columnsError;
      if (boardId) {
        try {
          const monday = new Monday();
          const existing = await monday.getColumns(boardId);
          const have = new Set(existing.map((c2) => norm(c2.title)));
          for (const req2 of REQUIRED_MONDAY_COLUMNS) {
            if (have.has(norm(req2.title))) continue;
            try {
              await monday.createColumn(boardId, req2.title, req2.type);
              columnsCreated.push(req2.title);
            } catch (e) {
              columnsError = e?.message ?? String(e);
            }
          }
        } catch (e) {
          columnsError = e?.message ?? String(e);
        }
      }
      audit(ctx, "job.board", "job", code, boardId ? `Linked board ${boardId} to ${code}${columnsCreated.length ? " \xB7 " + columnsCreated.length + " columns created" : ""}` : `Unlinked board from ${code}`);
      send(res, 200, { ok: true, board: boardId, slug, columnsCreated, columnsError });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/sync") && req.method === "POST") {
      if (!allow("monday.sync")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (!job.monday_board_id) {
        send(res, 400, { error: "Link a Monday board for this job first." });
        return;
      }
      const items = await listSurveyItems(job.id);
      let created = 0, updated = 0, failed = 0;
      const errors = [];
      for (const it of items) {
        try {
          const r = await promoteItem(it.id);
          r.action === "created" ? created++ : updated++;
        } catch (err) {
          failed++;
          if (errors.length < 3) errors.push(`${it.full_code}: ${err?.message ?? err}`);
        }
      }
      send(res, 200, { ok: true, total: items.length, created, updated, failed, errors });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/pull-fitters") && req.method === "POST") {
      if (!allow("monday.sync")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (!job.monday_board_id) {
        send(res, 400, { error: "Link a Monday board for this job first." });
        return;
      }
      const mon = new Monday();
      const cols = await mon.getColumns(job.monday_board_id);
      const fittersCol = cols.find((col) => normTitle(col.title) === "fitters");
      if (!fittersCol) {
        send(res, 400, { error: 'No "Fitters" column found on this board.' });
        return;
      }
      const teams = await listTeams(ctx.tenant_id);
      const teamByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
      const rows = await mon.getColumnTextForItems(job.monday_board_id, fittersCol.id);
      const textByMondayId = new Map(rows.map((r) => [r.id, (r.text ?? "").trim()]));
      const dateCol = pickDateColumn(cols);
      const dateByMondayId = /* @__PURE__ */ new Map();
      if (dateCol) {
        const drows = await mon.getColumnTextForItems(job.monday_board_id, dateCol.id);
        for (const r of drows) dateByMondayId.set(r.id, parseMondayDate(r.text));
      }
      const items = await listSurveyItems(job.id);
      let assigned = 0, cleared = 0, datesSet = 0, datesCleared = 0, unchanged = 0;
      const unmatched = /* @__PURE__ */ new Set();
      for (const it of items) {
        if (!it.monday_item_id) {
          unchanged++;
          continue;
        }
        const patch = {};
        const text = textByMondayId.get(it.monday_item_id) ?? "";
        if (text) {
          const match = teamByName.get(text.toLowerCase());
          if (!match) unmatched.add(text);
          else if ((it.team_id ?? null) !== match) patch.team_id = match;
        } else if (it.team_id != null) {
          patch.team_id = null;
        }
        if (dateCol) {
          const nd = dateByMondayId.get(it.monday_item_id) ?? null;
          if (nd !== (it.planned_install_date ?? null)) patch.planned_install_date = nd;
        }
        if (Object.keys(patch).length === 0) {
          unchanged++;
          continue;
        }
        await applyMondayPull(it.id, patch, ctx.tenant_id);
        if ("team_id" in patch) patch.team_id ? assigned++ : cleared++;
        if ("planned_install_date" in patch) patch.planned_install_date ? datesSet++ : datesCleared++;
      }
      send(res, 200, {
        ok: true,
        total: items.length,
        assigned,
        cleared,
        datesSet,
        datesCleared,
        dateColumn: dateCol?.title ?? null,
        unchanged,
        unmatched: [...unmatched]
      });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/report.pdf") && req.method === "GET") {
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const qt = url.searchParams.get("type");
      const type = qt === "install" ? "install" : qt === "customer_install" ? "customer_install" : "survey";
      if (ctx.role === "customer") {
        if (type !== "customer_install" || c !== ctx.client_code) {
          send(res, 403, { error: "forbidden" });
          return;
        }
      } else if (!allow("dashboard.view")) return;
      try {
        const { buffer } = await buildJobReportPdf(c, j, ctx.tenant_id, type);
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${c}.${j}-${type}-report.pdf"`,
          "cache-control": "no-store"
        });
        res.end(buffer);
      } catch (e) {
        send(res, e?.message === "forbidden" ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/plans") && req.method === "GET") {
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const plans = await listJobPlans(job.id);
      const withUrls = await Promise.all(plans.map(async (pl) => ({ id: pl.id, name: pl.name, url: await signedPlanUrl(pl.storage_path) })));
      const items = await listPinnedItems(job.id);
      const multiPlan = await getPinsMultiPlan(ctx.tenant_id);
      send(res, 200, { plans: withUrls, items, multiPlan, canManage: (0, import_shared6.can)(ctx.role, "jobs.manage"), canPin: (0, import_shared6.can)(ctx.role, "items.edit") });
      return;
    }
    if (p.startsWith("/api/job/") && p.endsWith("/plans") && req.method === "POST") {
      if (!allow("jobs.manage")) return;
      const code = decodeURIComponent(p.split("/")[3] ?? "");
      const [c, j] = code.split(".");
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const name = String(b.name ?? "").trim() || "Plan";
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.image || ""));
      if (!m) {
        send(res, 400, { error: "A plan image is required." });
        return;
      }
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 15 * 1024 * 1024) {
        send(res, 400, { error: "Plan image too large (max 15 MB)." });
        return;
      }
      const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
      const path = `${ctx.tenant_id}/plans/${job.id}/${Date.now()}.${ext}`;
      await ensurePlanBucket();
      await uploadPlan(path, bytes, m[1]);
      const plan = await createJobPlan(ctx.tenant_id, job.id, name, path);
      send(res, 200, { ok: true, id: plan.id });
      return;
    }
    if (p.startsWith("/api/plans/") && req.method === "DELETE") {
      if (!allow("jobs.manage")) return;
      const id = p.split("/")[3];
      await deleteJobPlan(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith("/api/item/") && p.endsWith("/pin") && req.method === "PUT") {
      if (!allow("items.edit")) return;
      const id = p.split("/")[3];
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const planId = b.plan_id || null;
      if (planId && it.plan_id && it.plan_id !== planId) {
        if (!await getPinsMultiPlan(ctx.tenant_id)) {
          send(res, 409, { error: "This item is already pinned on another plan. Unpin it there first, or enable multi-plan in Plans settings." });
          return;
        }
      }
      const clamp = (v) => v == null || v === "" ? null : Math.max(0, Math.min(1, Number(v)));
      await setItemPin(id, planId, planId ? clamp(b.x) : null, planId ? clamp(b.y) : null, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/settings/pins-multi-plan" && req.method === "PUT") {
      if (!allow("jobs.manage")) return;
      const b = await readJson(req);
      await setPinsMultiPlan(ctx.tenant_id, !!b.value);
      send(res, 200, { ok: true });
      return;
    }
    if (p === "/api/users" && req.method === "GET") {
      if (ctx.role !== "admin") {
        send(res, 403, { error: "Admins only" });
        return;
      }
      const users = await listAppUsers(ctx.tenant_id);
      const teams = await listTeams(ctx.tenant_id);
      send(res, 200, {
        me: ctx.id,
        roles: ROLES,
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, has_login: !!u.auth_user_id, team_id: u.team_id, client_code: u.client_code ?? "" }))
      });
      return;
    }
    if (p === "/api/users" && req.method === "POST") {
      if (ctx.role !== "admin") {
        send(res, 403, { error: "Admins only" });
        return;
      }
      const b = await readJson(req);
      const email = String(b.email ?? "").trim().toLowerCase();
      const name = String(b.name ?? "").trim();
      const role = String(b.role ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        send(res, 400, { error: "A valid email is required." });
        return;
      }
      if (!name) {
        send(res, 400, { error: "Name is required." });
        return;
      }
      if (!ROLES.includes(role)) {
        send(res, 400, { error: "Pick a valid role." });
        return;
      }
      const password = String(b.password ?? "").trim() || genPassword();
      if (password.length < 8) {
        send(res, 400, { error: "Password must be at least 8 characters." });
        return;
      }
      try {
        const r = await inviteUser(ctx.tenant_id, email, name, role, password);
        send(res, 200, { ok: true, created: r.created, email, password });
      } catch (err) {
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith("/api/users/") && p.endsWith("/reset") && req.method === "POST") {
      if (ctx.role !== "admin") {
        send(res, 403, { error: "Admins only" });
        return;
      }
      const id = p.split("/")[3];
      const u = await getAppUser(id);
      if (!u || u.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const password = genPassword();
      await resetUserPassword(u.email, password, u.auth_user_id);
      send(res, 200, { ok: true, email: u.email, password });
      return;
    }
    if (p.startsWith("/api/users/") && req.method === "PUT") {
      if (ctx.role !== "admin") {
        send(res, 403, { error: "Admins only" });
        return;
      }
      const id = p.split("/").pop();
      const u = await getAppUser(id);
      if (!u || u.tenant_id !== ctx.tenant_id) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      const b = await readJson(req);
      const patch = {};
      if ("name" in b) {
        if (!String(b.name).trim()) {
          send(res, 400, { error: "Name is required." });
          return;
        }
        patch.name = String(b.name).trim();
      }
      if ("email" in b) {
        const email = String(b.email).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          send(res, 400, { error: "A valid email is required." });
          return;
        }
        if (u.auth_user_id) {
          try {
            await updateAuthEmail(u.auth_user_id, email);
          } catch (err) {
            send(res, 400, { error: "Login email update failed: " + (err?.message ?? err) });
            return;
          }
        }
        patch.email = email;
      }
      if ("role" in b) {
        if (!ROLES.includes(String(b.role))) {
          send(res, 400, { error: "Invalid role." });
          return;
        }
        if (id === ctx.id && b.role !== "admin") {
          send(res, 400, { error: "You can't remove your own admin role." });
          return;
        }
        patch.role = b.role;
      }
      if ("active" in b) {
        if (id === ctx.id && b.active === false) {
          send(res, 400, { error: "You can't deactivate yourself." });
          return;
        }
        patch.active = !!b.active;
      }
      if ("team_id" in b) patch.team_id = b.team_id || null;
      if ("client_code" in b) patch.client_code = String(b.client_code ?? "").trim().toUpperCase() || null;
      await updateAppUser(id, patch, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e?.message ?? String(e) });
  }
});
server.listen(PORT, () => {
  console.log(`
  ACE office app  \u2192  http://localhost:${PORT}`);
  console.log("  log in with the account you made via create-admin \xB7 Ctrl+C to stop\n");
});
var PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ACE \u2014 Office</title>
<style>
  :root{--purple:#3a2b72;--magenta:#e6187e;--ink:#1f1a3d;--muted:#6b6786;--line:#e4e2ee;--bg:#f4f3f9;
    --green:#16a34a;--green-soft:#e7f6ec;--amber:#d97706;--amber-soft:#fef3e2;--soft:#ecebf6}
  *{box-sizing:border-box;margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  body{background:var(--bg);color:var(--ink)}
  /* login */
  .login{min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#2e2159,#3a2b72 60%,#4a389a)}
  .card{background:#fff;border-radius:16px;padding:30px 28px;width:340px;box-shadow:0 18px 50px rgba(0,0,0,.25)}
  .card h1{font-size:22px;color:var(--purple)}.card h1 b{color:var(--magenta)}
  .card p{font-size:12px;color:var(--muted);margin:6px 0 18px}
  .card label{display:block;font-size:12px;font-weight:600;margin:10px 0 5px}
  .card input{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:14px}
  .card button{width:100%;margin-top:16px;background:var(--magenta);color:#fff;border:none;border-radius:11px;padding:12px;font-weight:700;font-size:14px;cursor:pointer}
  .err{color:#dc2626;font-size:12px;margin-top:10px;min-height:16px}
  .ordiv{display:flex;align-items:center;gap:10px;color:#a9a4c4;font-size:11px;margin:14px 0 12px}
  .ordiv:before,.ordiv:after{content:"";flex:1;height:1px;background:var(--line)}
  .msbtn{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;background:#fff;color:#2f2f2f;border:1px solid #d7d5e4;border-radius:11px;padding:11px;font-weight:600;font-size:14px;cursor:pointer}
  .msbtn:hover{background:#faf9fe}
  /* app */
  header{height:56px;background:var(--purple);color:#fff;display:flex;align-items:center;padding:0 22px;gap:12px}
  .brand{font-weight:800;font-size:17px}.brand b{color:#ff8fc8}.brand span{font-weight:500;font-size:12px;color:#cfc9ea}
  .verchip{margin-left:12px;background:rgba(255,255,255,.14);border:none;color:#cfc9ea;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;cursor:pointer}
  .verchip:hover{background:rgba(255,255,255,.24);color:#fff}
  .loginver{text-align:center;color:#a9a4c4;font-size:11px;margin-top:14px}
  .nav{display:flex;gap:4px;margin-left:26px}
  .tab{background:transparent;border:none;color:#cfc9ea;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer}
  .tab:hover{background:rgba(255,255,255,.1);color:#fff}
  .tab.on{background:rgba(255,255,255,.16);color:#fff}
  .who{margin-left:auto;font-size:12px;color:#cfc9ea}.who button{margin-left:12px;background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 12px;border-radius:9px;font-size:12px;cursor:pointer}
  #whoName{position:relative;cursor:default}
  #whoName[data-role]:hover::after{content:attr(data-role);position:absolute;top:150%;right:0;background:var(--purple);color:#fff;font-size:11px;font-weight:600;padding:5px 9px;border-radius:7px;white-space:nowrap;z-index:40;box-shadow:0 6px 18px rgba(0,0,0,.28)}
  #teamsView main{padding:22px 26px}
  .addrow{display:flex;gap:10px;align-items:center;margin-top:16px}
  .tinput{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px}
  .tinput:focus{outline:none;border-color:var(--magenta)}
  .pfx{display:flex;align-items:center;border:1px solid var(--line);border-radius:10px;padding-left:10px;background:#fff}
  .pfx span{color:var(--muted);font-size:13px}.pfx .rate2{border:none;width:90px;padding-left:6px}.pfx .rate2:focus{outline:none}
  .add{background:var(--magenta);color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer}
  input.trate{width:88px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px}
  input.tname{width:170px;border:1px solid transparent;border-radius:8px;padding:6px 8px;font-size:12.5px;font-weight:600;background:transparent}
  input.tname:hover,input.tname:focus{border-color:var(--line);background:#fff;outline:none}
  .del{background:#fff;color:#dc2626;border:1px solid #f1c4c4;border-radius:8px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer}
  .del[disabled]{color:#c8c6d4;border-color:var(--line);cursor:not-allowed}
  .count{font-size:11px;font-weight:700;color:var(--muted);background:var(--soft);padding:3px 9px;border-radius:999px}
  .count.green{background:var(--green-soft);color:var(--green)}.count.amber{background:var(--amber-soft);color:var(--amber)}
  #syncView main{padding:22px 26px}
  input.board{width:220px;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace}
  input.board:focus{outline:none;border-color:var(--magenta)}
  .syncall{background:var(--purple);color:#fff;border:none;border-radius:8px;padding:6px 13px;font-size:11px;font-weight:700;cursor:pointer}
  .syncall[disabled]{background:#cfcde0;cursor:not-allowed}
  #dashView main{padding:22px 26px}
  .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px}
  .statcard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px}
  .statval{font-size:26px;font-weight:800;color:var(--purple);line-height:1}
  .statlabel{font-size:12px;color:var(--muted);font-weight:600;margin-top:6px}
  .statsub{font-size:11px;color:#9a97ad;margin-top:3px}
  .jobcard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 17px;margin-top:12px}
  .jobtop{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px}
  .jobmeta{font-size:12px;color:var(--muted)}
  .barrow{display:flex;align-items:center;gap:10px;margin-top:7px}
  .barlabel{font-size:11px;color:var(--muted);width:66px}
  .bartrack{flex:1;height:8px;background:var(--soft);border-radius:999px;overflow:hidden}
  .barfill{height:100%;background:var(--magenta);border-radius:999px}
  .barfill.green{background:var(--green)}
  .barpct{font-size:11px;color:var(--ink);width:34px;text-align:right;font-weight:700}
  .statcard.clickable{cursor:pointer;transition:.12s}
  .statcard.clickable:hover{border-color:var(--magenta);box-shadow:0 4px 14px rgba(230,24,126,.12)}
  .jobcard.clickable{cursor:pointer}
  .jobcard.clickable:hover{border-color:var(--magenta)}
  .opensnag{font-size:12px;color:var(--amber);margin-top:7px;font-weight:700;cursor:pointer;display:inline-block}
  .opensnag:hover{text-decoration:underline}
  .chips{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:14px 0 4px}
  .chip{background:#fff;border:1px solid var(--line);color:var(--muted);font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer}
  .chip:hover{border-color:#cfc9ea}
  .chip.on{background:var(--purple);color:#fff;border-color:var(--purple)}
  .itemcount{font-size:11px;color:var(--muted);margin-left:4px}
  .titlerow{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  th.cbcell,td.cbcell{width:34px;text-align:center;padding-left:14px}
  .rowcb,#selAll{width:15px;height:15px;cursor:pointer;accent-color:var(--magenta)}
  .ro{color:var(--muted);font-size:13px}
  .bulkbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--purple);color:#fff;border-radius:12px;padding:9px 14px;margin:14px 0 10px}
  #bulkcount{font-size:12.5px;font-weight:700;margin-right:4px}
  .bulkrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
  .bulkrow+.bulkrow{margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.22)}
  .bulklabel{font-size:12px;font-weight:700;opacity:.92;margin-right:2px}
  .sheetfoot{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 22px;z-index:2;display:flex;gap:10px;align-items:center;box-shadow:0 -6px 16px rgba(0,0,0,.06)}
  .bulk{font-size:12px;font-weight:600;border-radius:8px;padding:7px 12px;border:none;cursor:pointer}
  .bulk.bapply{background:#fff;color:var(--purple);font-weight:800}
  .bulk.bsync{background:var(--magenta);color:#fff}
  .bulk.bsel{background:#fff;color:var(--ink);border:1px solid #cfc9ea}
  .bulk.bdel{background:#dc2626;color:#fff}
  .bulk.bclear{background:rgba(255,255,255,.16);color:#fff;margin-left:auto}
  .newbtn{background:var(--magenta);color:#fff;border:none;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap}
  .snagtag{font-size:9px;font-weight:800;letter-spacing:.03em;color:#fff;background:var(--magenta);padding:2px 5px;border-radius:5px;vertical-align:middle}
  a.codelink{font-size:10.5px;color:var(--purple);cursor:pointer;text-decoration:none;border-bottom:1px dashed #cfcde0}
  a.codelink:hover{color:var(--magenta);border-bottom-color:var(--magenta)}
  .overlay{position:fixed;inset:0;background:rgba(31,26,61,.45);display:grid;place-items:center;z-index:20;padding:20px}
  .sheet{background:#fff;border-radius:16px;width:640px;max-width:100%;max-height:calc(100vh - 60px);overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.3)}
  .sheethead{display:flex;align-items:center;justify-content:space-between;padding:17px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff;z-index:1}
  .sheethead h3{color:var(--purple);font-size:17px}.sheethead h3 .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}
  .x{border:none;background:var(--soft);border-radius:8px;width:30px;height:30px;cursor:pointer;color:var(--muted);font-size:13px}
  .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:13px;padding:20px 22px}
  .field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}
  .field label{font-size:11px;font-weight:700;color:var(--muted)}
  .field input,.field select,.field textarea{border:1px solid var(--line);border-radius:9px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fff}
  .field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--magenta)}
  .codeprev{grid-column:1/-1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:var(--purple);background:var(--soft);padding:11px 12px;border-radius:9px;word-break:break-all}
  .groupt{grid-column:1/-1;font-size:10px;font-weight:800;letter-spacing:.05em;color:#9a97ad;margin-top:4px}
  .foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--line);position:sticky;bottom:0;background:#fff}
  .foot .cancel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 15px;font-weight:600;font-size:13px;cursor:pointer;color:var(--muted)}
  .foot .save{background:var(--magenta);color:#fff;border:none;border-radius:10px;padding:9px 18px;font-weight:700;font-size:13px;cursor:pointer}
  .ferr{grid-column:1/-1;color:#dc2626;font-size:12px;min-height:15px}
  .dl{padding:6px 22px 20px}.drow{display:flex;padding:7px 0;border-top:1px solid #f2f0f8;font-size:13px}
  .drow dt{width:150px;color:var(--muted);font-weight:600;flex:none}.drow dd{color:var(--ink)}
  .drow dd .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:4px 22px 22px}
  .photos figure{margin:0}.photos img{width:100%;height:110px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
  .photos figcaption{font-size:10px;color:var(--muted);font-weight:700;margin-top:4px}
  .empty{padding:0 22px 22px;color:var(--muted);font-size:13px}
  .layout{display:flex;min-height:calc(100vh - 56px)}
  aside{width:220px;background:#fff;border-right:1px solid var(--line);padding:16px 0}
  .slabel{font-size:10px;font-weight:700;color:#9a97ad;letter-spacing:.05em;padding:8px 22px}
  .job{padding:9px 22px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--muted);cursor:pointer;border-left:4px solid transparent}
  .job.on{color:var(--purple);font-weight:700;background:var(--soft);border-left-color:var(--magenta)}
  main{flex:1;padding:22px 26px;overflow:auto}
  h2{font-size:19px;color:var(--purple)}h2 .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .sub{font-size:12px;color:var(--muted);margin:4px 0 16px}
  .card2{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .cedit{width:64px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:12px;text-transform:uppercase}
  .itable{min-width:1140px}
  .jobstoggle{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10px;color:#9a97ad;font-weight:700;padding:13px 12px 8px}
  .envbadge{display:none;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:6px;margin-left:8px;vertical-align:middle}
  .envbadge.test{display:inline-block;background:#d97706;color:#fff}
  .envbadge.prod{display:inline-block;background:var(--soft);color:var(--muted)}
  body.env-test header{box-shadow:inset 0 -3px 0 #d97706}
  .colfilter{margin-top:4px;font-size:11px;font-weight:600;color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:3px 4px;max-width:120px;background:#fff}
  td{padding:9px 12px;border-top:1px solid #f2f0f8;vertical-align:middle}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px}
  .scanned{background:#eef0f4;color:var(--muted)}.in_survey{background:var(--amber-soft);color:var(--amber)}
  .surveyed{background:var(--soft);color:var(--purple)}.synced{background:var(--green-soft);color:var(--green)}
  input.rate{width:74px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px}
  .planbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}
  .calbar{display:flex;gap:10px;align-items:center;margin:16px 0}
  .calnav{border:1px solid var(--line);background:#fff;border-radius:9px;width:34px;height:34px;font-size:18px;cursor:pointer;color:var(--purple)}
  .calmonth{font-size:16px;font-weight:800;color:var(--ink);min-width:150px;text-align:center}
  .calgridwrap{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px}
  .calweek{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:6px}
  .calweek span{text-align:center;font-size:10px;font-weight:700;color:#9a97ad}
  .calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
  .calcell{min-height:64px;border:1px solid var(--line);border-radius:10px;padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:4px;background:#fff}
  .calcell:hover{border-color:var(--purple)}
  .calcell.out{background:#fafafb}.calcell.out .caldd{color:#c9c6d8}
  .calcell.today{border-color:var(--purple);border-width:2px}
  .calcell.sel{background:var(--soft);border-color:var(--purple)}
  .caldd{font-size:12px;font-weight:700;color:var(--ink)}
  .calpill{align-self:flex-start;color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:1px 7px}
  .calsel-h{font-size:14px;font-weight:800;color:var(--ink);margin:18px 0 8px}
  .calitem{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:11px;background:#fff;margin-bottom:8px;cursor:pointer}
  .calitem:hover{border-color:var(--purple)}
  .caldot{width:10px;height:10px;border-radius:50%;flex:none}
  .calitem .cimain{flex:1;min-width:0}
  .calitem .ccode{font-size:12.5px;font-weight:700;color:var(--ink)}
  .calitem .cmeta{font-size:11.5px;color:var(--muted);margin-top:2px}
  .calitem .cstat{font-size:10px;font-weight:800;border:1px solid;border-radius:999px;padding:2px 8px;white-space:nowrap}
  .tarea{font-size:11px;font-weight:800;letter-spacing:.04em;color:#9a97ad;margin:16px 0 6px}
  .trow{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:8px}
  .tinfo{flex:1;min-width:0}
  .tcode{font-size:13px;font-weight:700;color:var(--ink)}
  .tsteps{font-size:12px;color:var(--ink);margin-top:4px}
  .texp{font-size:12px;color:var(--muted);margin-top:2px}
  .trole{color:var(--purple);font-weight:700}
  .tmeta{display:block;font-size:11px;color:var(--muted);margin-top:4px}
  .tbadge{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px}
  .tok{background:var(--green-soft);color:var(--green)} .tnok{background:#fde7f1;color:var(--magenta)} .tun{background:var(--soft);color:var(--muted)}
  .tact{display:flex;flex-direction:column;gap:6px;width:220px;flex:none}
  .tcomment{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:12px;font-family:inherit}
  .tbtns{display:flex;gap:6px}
  .tbtn{border:none;border-radius:8px;padding:7px 0;font-size:12px;font-weight:800;cursor:pointer;flex:1}
  .tokbtn{background:#16a34a;color:#fff} .tnokbtn{background:var(--magenta);color:#fff}
  .planarm{background:var(--purple);color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;margin-bottom:12px}
  .planwrap{display:flex;gap:16px;align-items:flex-start}
  .planstage{position:relative;flex:1;min-height:300px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .planstage img{display:block;width:100%;cursor:crosshair}
  #planPins{position:absolute;inset:0;pointer-events:none}
  .pin{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center}
  .pin .dot{width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)}
  .pin .lbl{font-size:9px;font-weight:800;background:#1f1a3d;color:#fff;padding:1px 5px;border-radius:5px;margin-top:2px;white-space:nowrap}
  .pin.sel .dot{outline:3px solid var(--magenta);outline-offset:1px}
  .planside{width:340px;flex-shrink:0}
  .planside-h{font-size:13px;font-weight:800;color:var(--ink);margin-bottom:8px}
  .planfilter{display:flex;gap:6px;margin-bottom:10px}
  .planfilter .chip{font-size:11px;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);cursor:pointer;font-weight:700}
  .planfilter .chip.on{background:var(--purple);color:#fff;border-color:var(--purple)}
  .planitems{max-height:66vh;overflow-y:auto;overflow-x:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}
  .pitem{display:flex;align-items:center;gap:9px;padding:10px 12px;border-top:1px solid #f2f0f8;cursor:pointer;font-size:12px}
  .pitem:first-child{border-top:none}
  .pitem:hover{background:#faf9fd}
  .pitem.armed{background:var(--soft)}
  .pitem .pdot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .pitem .pcode{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--ink);word-break:break-all;line-height:1.35}
  .pitem .pact{flex-shrink:0;white-space:nowrap;font-size:11px;font-weight:800}
  .pitem .pact.punpin{color:var(--magenta)}
  .pitem .pact.pplace{color:var(--muted)}
  select.sel{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;background:#fff}
  .sync{background:var(--purple);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer}
  .resync{background:#fff;color:var(--purple);border:1px solid #cfc9ea;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-left:6px}
  .resync:hover{border-color:var(--magenta);color:var(--magenta)}
  .resync.dirty{background:var(--amber-soft);color:var(--amber);border-color:#f3d19a}
  .chgtag{font-size:9px;font-weight:800;color:var(--amber);background:var(--amber-soft);padding:2px 6px;border-radius:5px;margin-left:5px;letter-spacing:.03em}
  a.mlink{color:var(--magenta);font-weight:600;font-size:11px;text-decoration:none}a.mlink:hover{text-decoration:underline}
  .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;font-size:13px;font-weight:600;padding:11px 18px;border-radius:12px;opacity:0;transition:.25s;z-index:9}
  .toast.show{opacity:1;transform:translateX(-50%)}
</style></head><body>
<div id="loginView" class="login"><div class="card">
  <h1>ACE<b>GROUP</b></h1><p>Office web app \u2014 sign in</p>
  <label>Email</label><input id="email" type="email" value="milosz@acegroup-uk.com">
  <label>Password</label><input id="password" type="password">
  <button onclick="login()">Sign in</button>
  <div id="ssoWrap" style="display:none">
    <div class="ordiv"><span>or</span></div>
    <button class="msbtn" onclick="loginMicrosoft()">
      <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
      Sign in with Microsoft
    </button>
  </div>
  <div class="err" id="loginErr"></div>
  <div class="loginver">v__APP_VERSION__<span class="envbadge" id="loginEnvBadge"></span></div>
</div></div>

<div id="appView" style="display:none">
  <header>
    <div class="brand">ACE<b>GROUP</b> <span>\xB7 Office</span><span class="envbadge" id="envBadge"></span></div>
    <button class="verchip" onclick="showChangelog()" title="What's new">v__APP_VERSION__</button>
    <nav class="nav">
      <button id="tabDash" class="tab on" onclick="showTab('dashboard')">Dashboard</button>
      <button id="tabItems" class="tab" onclick="showTab('items')">Items</button>
      <button id="tabMapping" class="tab" style="display:none" onclick="showTab('mapping')">Mapping</button>
      <button id="tabTeams" class="tab" onclick="showTab('teams')">Teams &amp; rates</button>
      <button id="tabSync" class="tab" onclick="showTab('sync')">Monday sync</button>
      <button id="tabPlans" class="tab" onclick="showTab('plans')">Plans</button>
      <button id="tabCal" class="tab" onclick="showTab('cal')">Calendar</button>
      <button id="tabBudget" class="tab" style="display:none" onclick="showTab('budget')">Budget</button>
      <button id="tabTests" class="tab" style="display:none" onclick="showTab('tests')">Test</button>
      <button id="tabUsers" class="tab" style="display:none" onclick="showTab('users')">Users</button>
      <button id="tabRoles" class="tab" style="display:none" onclick="showTab('roles')">Roles</button>
      <button id="tabLogs" class="tab" style="display:none" onclick="showTab('logs')">Logs</button>
    </nav>
    <div class="who"><span id="whoName"></span><button onclick="logout()">Sign out</button></div>
  </header>

  <div id="dashView" style="display:none">
    <main style="max-width:1000px">
      <h2>Dashboard</h2>
      <div class="sub">Live status across all jobs \u2014 straight from the store.</div>
      <div id="dashCards" class="statgrid"></div>
      <div id="dashBreakdown"></div>
      <div class="groupt" style="padding:16px 0 0">BY JOB</div>
      <div id="dashJobs"></div>
    </main>
  </div>

  <div id="itemsView" class="layout" style="display:none">
    <aside>
      <div class="slabel" style="display:flex;justify-content:space-between;align-items:center">JOBS
        <a id="newJobBtn" class="codelink" style="display:none" onclick="openNewJob()">+ New job</a>
      </div>
      <div id="jobs"></div>
    </aside>
    <main>
      <div class="titlerow">
        <div style="display:flex;gap:10px;align-items:center">
          <button class="jobstoggle" onclick="toggleJobs()" title="Show/hide the Jobs panel">\u2630 Jobs</button>
          <div><h2 id="title">\u2014</h2><div class="sub" id="subtitle"></div></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button id="filesBtn" class="jobstoggle" style="display:none" onclick="openJobFiles(current)">Files</button>
          <button id="delJobBtn" class="del" style="display:none" onclick="delJob()">Delete job</button>
          <button id="newBtn" class="newbtn" onclick="openCreate()">+ New item</button>
        </div>
      </div>
      <div id="itemFilters" class="chips">
        <button class="chip on" data-f="all" onclick="setFilter('all')">All</button>
        <button class="chip" data-f="synced" onclick="setFilter('synced')">Synced</button>
        <button class="chip" data-f="unsynced" onclick="setFilter('unsynced')">Not synced</button>
        <button class="chip" data-f="installed" onclick="setFilter('installed')">Installed</button>
        <button class="chip" data-f="dirty" onclick="setFilter('dirty')">Needs re-sync</button>
        <button class="chip" data-f="snags" onclick="setFilter('snags')">Snags</button>
        <button class="chip" data-f="open_snags" onclick="setFilter('open_snags')">Open snags</button>
        <span id="itemCount" class="itemcount"></span>
      </div>
      <div id="bulkbar" class="bulkbar" style="display:none">
        <div class="bulkrow">
          <span id="bulkcount">0 selected</span>
          <button class="bulk bsync" onclick="bulkSync()">Sync selected</button>
          <button id="bulkDelBtn" class="bulk bdel" style="display:none" onclick="bulkDelete()">Delete</button>
          <button class="bulk bclear" onclick="clearSel()">Clear selection</button>
        </div>
        <div class="bulkrow">
          <span class="bulklabel">Set on selected:</span>
          <select id="bulkField" class="bulk bsel" onchange="bulkFieldPick()">
            <option value="team">Team</option><option value="status">Install status</option>
            <option value="block">Block</option><option value="elevation">Elevation</option>
            <option value="floor">Floor</option><option value="flat">Flat</option><option value="room">Room</option>
          </select>
          <span id="bulkValWrap"></span>
          <button id="bulkApplyBtn" class="bulk bapply" onclick="bulkEditApply()">Apply</button>
        </div>
      </div>
      <div class="card2" style="overflow:auto"><table class="itable"><thead><tr>
        <th class="cbcell"><input type="checkbox" id="selAll" onclick="toggleAll(this)"></th>
        <th>FULL CODE</th>
        <th>BLOCK<br><select id="blockFilter" class="colfilter" onchange="setBlockFilter(this.value)"></select></th>
        <th>ELEV<br><select id="elevFilter" class="colfilter" onchange="setElevFilter(this.value)"></select></th>
        <th>FLAT<br><select id="flatFilter" class="colfilter" onchange="setFlatFilter(this.value)"></select></th>
        <th>FLOOR<br><select id="floorFilter" class="colfilter" onchange="setFloorFilter(this.value)"></select></th>
        <th>ROOM<br><select id="roomFilter" class="colfilter" onchange="setRoomFilter(this.value)"></select></th>
        <th>ITEM<br><select id="itemColFilter" class="colfilter" onchange="setItemColFilter(this.value)"></select></th>
        <th>STAGE<br><select id="stageFilter" class="colfilter" onchange="setStageFilter(this.value)"></select></th>
        <th>RATE (\xA3)</th>
        <th>INSTALL STATUS<br><select id="statusFilter" class="colfilter" onchange="setStatusFilter(this.value)"></select></th>
        <th>TEAM<br><select id="teamFilter" class="colfilter" onchange="setTeamFilter(this.value)"></select></th><th>MONDAY</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
    </main>
  </div>

  <div id="teamsView" style="display:none">
    <main style="max-width:760px">
      <h2>Fitter teams &amp; rates</h2>
      <div class="sub">Each team has a <b>Windows</b> rate and a <b>Doors</b> rate. Items inherit their team's rate for their category (doors are detected from the item type/code) unless a per-item override is set. The rate flows to Monday's <b>Labour Cost</b> column when an item is synced. A team with items assigned can't be deleted \u2014 <b>Retire</b> it instead: it stays on existing items and reports but disappears from new assignment lists, and can be reactivated anytime.</div>
      <div id="addTeam" class="addrow" style="display:none">
        <input id="newTeamName" class="tinput" placeholder="Team name (e.g. Team P03)">
        <div class="pfx" title="Windows rate"><span>W \xA3</span><input id="newTeamRate" class="tinput rate2" type="number" min="0" step="1" placeholder="80"></div>
        <button class="add" onclick="addTeam()">Add team</button>
      </div>
      <div id="teamsNote" class="sub" style="display:none">You're signed in as <b id="roleName"></b>. Only admins can add or edit teams.</div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>TEAM</th><th>WINDOWS RATE (\xA3)</th><th>DOORS RATE (\xA3)</th><th>ITEMS USING</th><th></th>
      </tr></thead><tbody id="teamRows"></tbody></table></div>
    </main>
  </div>

  <div id="syncView" style="display:none">
    <main style="max-width:900px">
      <h2>Monday sync</h2>
      <div class="sub">Link each job to its Monday board, then push its items across. Matching is by item name (the full code), so re-syncing updates in place \u2014 it never duplicates. Board id is the number in the board's URL: monday.com/boards/<b>18424137545</b>.</div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>JOB</th><th>MONDAY BOARD</th><th>ITEMS</th><th>SYNCED</th><th>TO SYNC</th><th></th>
      </tr></thead><tbody id="syncRows"></tbody></table></div>
    </main>
  </div>
  <div id="plansView" style="display:none">
    <main style="max-width:1200px">
      <h2>Plans</h2>
      <div class="sub">Upload a floor plan or elevation per job, then pin each item to its spot. Field staff see the pins on the phone. Click an item on the right, then click its location on the plan.</div>
      <div class="planbar">
        <select id="planJob" class="tinput" onchange="loadPlans()"></select>
        <select id="planSel" class="tinput" onchange="renderPlan()"></select>
        <button class="add" id="planUploadBtn" onclick="document.getElementById('planFile').click()">Upload plan</button>
        <input type="file" id="planFile" accept="image/*" style="display:none" onchange="uploadPlan(this)">
        <button class="del" id="planDelBtn" onclick="deletePlan()">Delete plan</button>
        <button class="add" id="rptSurveyBtn" onclick="downloadReport('survey')" title="Download a survey sheet PDF for this job">Survey PDF</button>
        <button class="add" id="rptInstallBtn" onclick="downloadReport('install')" title="Internal install report (includes teams and rates)">Internal install PDF</button>
        <button class="add" id="rptCustInstallBtn" onclick="downloadReport('customer_install')" title="Customer install report (no rates \u2014 safe to send the customer)">Customer install PDF</button>
        <span id="planMsg" style="font-size:12px;color:var(--muted)"></span>
        <label id="multiPlanWrap" style="display:none;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);margin-left:auto;cursor:pointer">
          <input type="checkbox" id="multiPlanChk" onchange="setMultiPlan(this.checked)" style="width:15px;height:15px;accent-color:var(--magenta)"> Item can be on multiple plans
        </label>
      </div>
      <div id="planArm" class="planarm" style="display:none"></div>
      <div class="planwrap">
        <div id="planStage" class="planstage">
          <div id="planEmpty" class="empty" style="padding:40px;text-align:center">No plan for this job yet. Upload a floor plan to start pinning.</div>
          <img id="planImg" style="display:none" onclick="planClick(event)">
          <div id="planPins"></div>
        </div>
        <div class="planside">
          <div class="planside-h">Items <span id="planCount" style="color:var(--muted);font-weight:400"></span></div>
          <div class="planfilter">
            <button class="chip on" data-pf="all" onclick="setPlanFilter('all')">All</button>
            <button class="chip" data-pf="unplaced" onclick="setPlanFilter('unplaced')">Unplaced</button>
            <button class="chip" data-pf="placed" onclick="setPlanFilter('placed')">Placed</button>
          </div>
          <div id="planItems" class="planitems"></div>
        </div>
      </div>
    </main>
  </div>

  <div id="calView" style="display:none">
    <main style="max-width:1100px">
      <h2>Install calendar</h2>
      <div class="sub">Every scheduled install across all jobs and teams. Dates come from Monday (Sync tab \u2192 Pull fitters + dates). Filter by team, page months, click a day to see what's on.</div>
      <div class="calbar">
        <button class="calnav" onclick="calShift(-1)">\u2039</button>
        <div class="calmonth" id="calMonth">\u2014</div>
        <button class="calnav" onclick="calShift(1)">\u203A</button>
        <select id="calTeam" class="tinput" onchange="renderCalendar()" style="margin-left:auto"></select>
        <span id="calMsg" class="itemcount"></span>
      </div>
      <div class="calgridwrap">
        <div class="calweek"></div>
        <div class="calgrid" id="calGrid"></div>
      </div>
      <div class="calsel-h" id="calSelHead"></div>
      <div id="calSel"></div>
    </main>
  </div>

  <div id="budgetView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>Budget &amp; pricing</h2><div class="sub">Customer pricing rules. Assign a rule to a job, and items are priced by it. Visible to admins and invoice managers only \u2014 no one else can see costs or prices.</div></div>
        <button class="newbtn" onclick="openRule()">+ New rule</button>
      </div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>RULE</th><th>CUSTOMER</th><th>MODEL</th><th>RATE / FLAT</th><th>RATE / DOOR</th><th>RATE / m\xB2</th><th></th>
      </tr></thead><tbody id="ruleRows"></tbody></table></div>

      <h3 style="margin-top:28px;color:var(--purple)">Job pricing</h3>
      <div class="sub">Assign a rule to a job, then see the budget cost and the customer price broken down by flat.</div>
      <div class="planbar">
        <select id="fpJob" class="tinput" onchange="loadJobPricing()"></select>
        <label style="font-size:12.5px;color:var(--muted)">Rule:
          <select id="fpRule" class="tinput" onchange="assignRule()"></select>
        </label>
        <button class="add" id="fpPdfBtn" onclick="downloadPricePdf()" title="Download the customer price breakdown (sale side only)">Customer price PDF</button>
        <span id="fpMsg" class="itemcount"></span>
      </div>
      <div id="fpBreak"></div>
    </main>
  </div>

  <div id="testsView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>QA test run</h2><div class="sub" id="testProg">\u2014</div></div>
        <button class="add" onclick="exportTests()" style="align-self:center">Export CSV</button>
      </div>
      <div class="chips" style="align-items:center">
        <select id="testArea" class="tinput" onchange="renderTests()"></select>
        <select id="testStatus" class="tinput" onchange="renderTests()">
          <option value="">All results</option><option value="ok">OK</option><option value="nok">NOK</option><option value="untested">Untested</option>
        </select>
      </div>
      <div id="testsList" style="margin-top:6px"></div>
    </main>
  </div>

  <div id="usersView" style="display:none">
    <main style="max-width:1080px">
      <h2>Users</h2>
      <div class="sub">Create logins for office and field staff, set their role, and deactivate anyone who leaves. Roles: <b>admin</b> (full access + this tab), <b>office</b>, <b>surveyor</b>, <b>scanner</b>, <b>fitter</b>, and <b>invoice manager</b> (budget/pricing only \u2014 no operational data).</div>
      <div class="addrow" style="flex-wrap:wrap">
        <input id="nuName" class="tinput" placeholder="Full name">
        <input id="nuEmail" class="tinput" type="email" placeholder="email@company.com" style="width:210px">
        <select id="nuRole" class="tinput"></select>
        <input id="nuPass" class="tinput" placeholder="password (blank = auto)" style="width:180px">
        <button class="add" onclick="addUser()">Add user</button>
      </div>
      <div class="ferr" id="userErr" style="padding:6px 2px 0"></div>
      <div class="card2" style="margin-top:14px;overflow-x:auto"><table style="min-width:1000px"><thead><tr>
        <th>NAME</th><th>EMAIL</th><th>ROLE</th><th>CLIENT</th><th>TEAM</th><th>LOGIN</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="userRows"></tbody></table></div>
      <div class="sub" style="margin-top:8px">A <b>fitter's</b> team decides which items they see in the phone app. Set it here; item\u2192team assignment itself comes from Monday (Sync tab \u2192 Pull fitters). A <b>customer</b> only signs in to a read-only portal \u2014 set their <b>CLIENT</b> code (e.g. AXS) to control which jobs they can see and download the rate-free install report for.</div>
    </main>
  </div>
  <div id="rolesView" style="display:none">
    <main style="max-width:920px">
      <h2>Roles &amp; access</h2>
      <div class="sub">What each role can do. This matrix is the single source of truth used by the office app, the mobile app, and the database. To change it, edit <code>packages/shared/src/permissions.ts</code>. Assign a role to someone in the <a href="#" onclick="showTab('users');return false">Users</a> tab.</div>
      <div class="card2" style="margin-top:14px;overflow:auto"><table id="rolesTable"><thead id="rolesHead"></thead><tbody id="rolesBody"></tbody></table></div>
      <div class="sub" style="margin-top:12px"><b>Data scope:</b> a <b>fitter</b> sees only items that are ready to fit; every other role sees all items in the tenant.</div>
    </main>
  </div>

  <div id="logsView" style="display:none">
    <main style="max-width:1000px">
      <h2>Activity log</h2>
      <div class="sub">Recent high-value actions across the tenant (most recent first). Search filters the list.</div>
      <div class="addrow" style="margin:4px 0 12px"><input id="logSearch" class="tinput" placeholder="Filter by user, action, entity or details\u2026" style="width:340px" oninput="renderLogs()"></div>
      <div class="card2" style="overflow:auto"><table style="min-width:760px"><thead><tr>
        <th>WHEN</th><th>USER</th><th>ROLE</th><th>ACTION</th><th>DETAILS</th>
      </tr></thead><tbody id="logRows"></tbody></table></div>
    </main>
  </div>

  <div id="mappingView" style="display:none">
    <main style="max-width:1000px">
      <h2>Mapping</h2>
      <div class="sub" id="mapSub">Pre-load a job's items floor by floor.</div>
      <div id="mapBody" style="margin-top:14px"></div>
    </main>
  </div>

  <div id="customerView" style="display:none">
    <main style="max-width:820px">
      <h2>Your installations</h2>
      <div class="sub" id="custSub">Download the installation report for each of your jobs.</div>
      <div id="custJobs" style="margin-top:16px"></div>
    </main>
  </div>
</div>
<div id="modal" class="overlay" style="display:none">
  <div class="sheet">
    <div class="sheethead"><h3 id="modalTitle">\u2014</h3><button class="x" onclick="closeModal()">\u2715</button></div>
    <div id="modalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  var STAGE={scanned:'Scanned',in_survey:'In survey',surveyed:'Surveyed',synced:'Synced'};
  var ISTATUS=[['','\u2014'],['scheduled','Scheduled'],['installed_no_snag','Installed no snag'],['installed_snag','Installed + snag'],['snag','Snag'],['misfit','MisFit'],['delayed','Delayed']];
  var ISTATUS_LABEL={};ISTATUS.forEach(function(s){ISTATUS_LABEL[s[0]]=s[1];});
  function teamName(id){for(var i=0;i<teams.length;i++){if(teams[i].id===id)return teams[i].name;}return '\u2014';}
  // Canonical room codes (kept in step with the phone app). The picker orders these by how
  // often each code has been used across all jobs (ROOM_STATS), most-used first.
  var ROOMS=[
    {name:'Living room',code:'LR'},{name:'Kitchen',code:'KT'},{name:'Bathroom',code:'BA'},
    {name:'Bedroom',code:'BD'},{name:'Dining room',code:'DR'},{name:'Hallway',code:'HW'},
    {name:'Home office',code:'HO'},{name:'Laundry room',code:'LA'},{name:'Pantry',code:'PA'},
    {name:'Storage room',code:'ST'},{name:'Garage',code:'GA'},{name:'Attic',code:'AT'},
    {name:'Basement',code:'BS'},{name:'Guest room',code:'GR'},{name:'Nursery',code:'NU'},
    {name:'Master bedroom',code:'MB'},{name:'Balcony',code:'BL'},{name:'Terrace',code:'TE'},
    {name:'Garden',code:'GD'},{name:'Office',code:'OF'},{name:'Common Room',code:'CR'},
    {name:'Common Way',code:'CW'},{name:'Lounge',code:'LG'},{name:'WC',code:'WC'}
  ];
  var ROOM_STATS={};
  function roomLabel(code){ if(!code)return '\u2014'; for(var i=0;i<ROOMS.length;i++){if(ROOMS[i].code===code)return ROOMS[i].name+' ('+code+')';} return code; }
  // Spec dropdown options (office item edit screen).
  var MATERIALS=['uPVC','Aluminium','Timber','Composite'];
  var WINDOW_TYPES=['Casement','Fixed','Tilt & Turn','Sash'];
  var GLASS_PANES=['Double','Triple'];
  var GLASS_TEXTURES=['Clear','Obscure','Contara','Satin','Stipolite'];
  var GLAZING_BARS=['None','Astragal','Georgian','Leaded','Diamonds'];
  var SAFETY_GLASS=['Toughened','Laminated'];
  var CILL_DEPTHS=['Stub','155mm','85mm','180mm'];
  function roomOptions(selected){
    var counts=ROOM_STATS||{};
    var list=ROOMS.slice();
    // include any historical codes not in the canonical list, so nothing is lost
    Object.keys(counts).forEach(function(c){ if(!list.some(function(r){return r.code===c;})) list.push({name:c,code:c}); });
    list.sort(function(a,b){var ca=counts[a.code]||0,cb=counts[b.code]||0; return (cb-ca)||a.name.localeCompare(b.name);});
    var out='<option value="">\u2014 pick room \u2014</option>';
    list.forEach(function(r){ out+='<option value="'+r.code+'"'+(r.code===selected?' selected':'')+'>'+esc(r.name)+' ('+r.code+')</option>'; });
    return out;
  }
  // Options for a team <select>: active teams only, plus the currently-picked team even if it's retired (labelled).
  function teamOptionList(selectedId){
    var out='';
    teams.forEach(function(t){
      if(t.active===false && t.id!==selectedId) return; // hide retired unless it's this item's current team
      out+=opt(t.id,(t.active===false?t.name+' (retired)':t.name),selectedId||'');
    });
    return out;
  }
  var token=sessionStorage.getItem('ace_token')||''; var teams=[]; var sel={};
  var current=sessionStorage.getItem('ace_job')||'AXS.LAB';
  var itemsData=null; var itemFilter=sessionStorage.getItem('ace_filter')||'all';
  var flatFilter='', statusFilter='', teamFilter='', blockFilter='', elevFilter='', floorFilter='', roomFilter='', stageFilter='', itemColFilter='';
  function restoreTab(){
    var t=sessionStorage.getItem('ace_tab')||(myRole==='scanner'?'mapping':'dashboard');
    var need={dashboard:'dashboard.view',teams:'teams.manage',sync:'monday.sync',plans:'dashboard.view',mapping:'items.create'};
    if((t==='users'||t==='roles'||t==='logs')&&myRole!=='admin')t='items';
    else if(need[t]&&!canCap(need[t]))t='items';
    return t;
  }
  var myRole=sessionStorage.getItem('ace_role')||''; var USER_ROLES=['admin','office','surveyor','scanner','fitter'];
  var myClientCode=sessionStorage.getItem('ace_client')||'';
  var CHANGELOG=__CHANGELOG_JSON__;
  var SSO_ENABLED=__SSO_ENABLED__; var SUPA_URL='__SUPABASE_URL__'; var SUPA_ANON='__SUPABASE_ANON_KEY__';
  var APP_ENV='__APP_ENV__';
  (function(){ if(!APP_ENV)return; var label=APP_ENV.toUpperCase();
    ['envBadge','loginEnvBadge'].forEach(function(id){var b=document.getElementById(id); if(b){b.textContent=label; b.className='envbadge '+APP_ENV;}});
    if(APP_ENV==='test')document.body.classList.add('env-test');
    document.title=(APP_ENV==='test'?'[TEST] ':'')+'ACE Office';
  })();
  function loginMicrosoft(){
    var redirect=window.location.origin+'/';
    window.location.href=SUPA_URL+'/auth/v1/authorize?provider=azure'
      +'&redirect_to='+encodeURIComponent(redirect)
      +'&scopes='+encodeURIComponent('openid profile email')
      +'&prompt=select_account'   // force the Microsoft account picker (don't silently reuse the last account)
      +'&apikey='+encodeURIComponent(SUPA_ANON);
  }
  async function bootstrapSession(){
    var r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}});
    if(r.ok){var me=await r.json();myRole=me.role||'';myClientCode=me.client_code||'';sessionStorage.setItem('ace_token',token);sessionStorage.setItem('ace_role',myRole);sessionStorage.setItem('ace_client',myClientCode);document.getElementById('whoName').textContent=me.name||'';showApp();}
    else{logout();document.getElementById('loginErr').textContent='No ACE account for this email \u2014 ask an admin to add you first.';}
  }
  function showChangelog(){
    var html='<div style="padding:16px 22px 20px">'+CHANGELOG.map(function(e){
      return '<div style="margin-bottom:15px"><div style="font-weight:800;color:var(--purple);font-size:14px">v'+esc(e.version)+' <span style="color:var(--muted);font-weight:500;font-size:12px">'+esc(e.date)+'</span></div>'
        +'<ul style="margin:6px 0 0 18px;padding:0;font-size:13px">'+e.changes.map(function(c){return '<li style="margin:3px 0">'+esc(c)+'</li>';}).join('')+'</ul></div>';
    }).join('')+'</div>';
    openModal('What\\'s new',html);
  }
  function tShow(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1600);}
  async function api(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json',Authorization:'Bearer '+token},opts.headers||{});var r=await fetch(path,opts);if(r.status===401){logout();throw new Error('unauth')}return r;}
  async function login(){
    var email=document.getElementById('email').value, password=document.getElementById('password').value;
    var r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    var d=await r.json();
    if(!r.ok){document.getElementById('loginErr').textContent=d.error||'Login failed';return;}
    token=d.token; myRole=d.role||''; myClientCode=d.client_code||''; sessionStorage.setItem('ace_token',token); sessionStorage.setItem('ace_role',myRole); sessionStorage.setItem('ace_client',myClientCode);
    document.getElementById('whoName').textContent=d.name;
    showApp();
  }
  function logout(){token='';myRole='';myClientCode='';sessionStorage.removeItem('ace_token');sessionStorage.removeItem('ace_role');sessionStorage.removeItem('ace_client');document.getElementById('appView').style.display='none';document.getElementById('loginView').style.display='grid';}
  async function showApp(){
    document.getElementById('loginView').style.display='none';document.getElementById('appView').style.display='block';applyRole();
    if(myRole==='customer'){await loadCustomer();return;}
    try{ROOM_STATS=await (await api('/api/room-stats')).json();}catch(e){ROOM_STATS={};}
    await loadJobs();await loadItems();showTab(restoreTab());
  }
  async function loadCustomer(){
    ['dashboard','items','teams','sync','plans','cal','budget','tests','users','roles'].forEach(function(n){var v=document.getElementById(n+'View');if(v)v.style.display='none';});
    document.getElementById('customerView').style.display='block';
    var box=document.getElementById('custJobs'); box.innerHTML='<div class="sub">Loading\u2026</div>';
    var jobs=[]; try{jobs=await (await api('/api/customer/jobs')).json();}catch(e){box.innerHTML='<div class="sub">Could not load your jobs.</div>';return;}
    if(!jobs.length){box.innerHTML='<div class="card2" style="padding:18px">No jobs are shared with you yet.</div>';return;}
    box.innerHTML=jobs.map(function(j){
      return '<div class="card2" style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;margin-bottom:10px">'
        +'<div><div style="font-weight:800">'+esc(j.name||j.code)+'</div><div class="sub" style="margin:2px 0 0">'+esc(j.code)+'</div></div>'
        +'<button class="add" onclick="downloadCustReport(\\''+esc(j.code)+'\\')">Download install report</button></div>';
    }).join('');
  }
  function downloadCustReport(code){
    var url='/api/job/'+encodeURIComponent(code)+'/report.pdf?type=customer_install';
    fetch(url,{headers:{Authorization:'Bearer '+token}}).then(function(r){
      if(!r.ok){tShow('Could not generate the report.');return null;}return r.blob();
    }).then(function(b){ if(!b)return; var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=code+'-install.pdf';document.body.appendChild(a);a.click();a.remove(); });
  }
  var JOB_STATUS={}, JOB_MAPDATE={};
  // ---- Mapping (scanner pre-load) ----
  function loadMapping(){
    var box=document.getElementById('mapBody');
    if(!current||current==='ALL'){ document.getElementById('mapSub').textContent='Pick a job from the left to start mapping.'; box.innerHTML='<div class="empty">Pick a job from the left.</div>'; return; }
    var status=JOB_STATUS[current]||'';
    document.getElementById('mapSub').innerHTML='Job <b>'+esc(current)+'</b> \xB7 status: <b>'+esc(status.replace('_',' '))+'</b>';
    if(status!=='pending_mapping'){
      if(canCap('jobs.manage')){
        box.innerHTML='<div class="card2" style="padding:16px;max-width:480px">'
          +'<div style="font-weight:800;margin-bottom:4px">Release this job for mapping</div>'
          +'<div class="sub" style="margin-bottom:10px">Assign a mapping start date to make this job visible to scanners.</div>'
          +'<div style="display:flex;gap:10px;align-items:center"><input type="date" id="mapDate" value="'+esc(JOB_MAPDATE[current]||'')+'"><button class="save" id="mapDateBtn">Assign date</button></div></div>';
        document.getElementById('mapDateBtn').addEventListener('click',assignMapDate);
      } else box.innerHTML='<div class="empty">This job isn\\'t ready for mapping yet \u2014 an admin needs to assign a mapping start date.</div>';
      return;
    }
    renderMapBuilder(box);
  }
  async function assignMapDate(){
    var date=document.getElementById('mapDate').value;
    if(!date){tShow('Pick a date');return;}
    var d=await (await api('/api/job/'+encodeURIComponent(current)+'/mapping-date',{method:'POST',body:JSON.stringify({date:date})})).json();
    if(d.ok){JOB_STATUS[current]='pending_mapping';JOB_MAPDATE[current]=date;tShow('Released for mapping');loadMapping();}
    else tShow(d.error||'Failed');
  }
  // Auto-prefix a letter only when the value is a plain number ("1"->"F1"); labels like GF stay as typed.
  function smartPfx(raw,p){
    raw=String(raw||'').toUpperCase();
    if(!p)return raw;
    if(/^[0-9]+$/.test(raw))return p+raw;
    if(new RegExp('^'+p+'[0-9]+$').test(raw))return raw;
    return raw;
  }
  function applyPfx(el,p){ var v=smartPfx(el.value,p); if(v!==el.value){el.value=v;try{el.setSelectionRange(v.length,v.length);}catch(_){}} }
  function mapWirePrefix(id,p){
    var el=document.getElementById(id);
    el.addEventListener('input',function(){ applyPfx(el,p); maybeRevealFloors(); });
  }
  function renderMapBuilder(box){
    box.innerHTML=''
      +'<div class="card2" style="padding:16px;margin-bottom:14px">'
      +'<div class="groupt" style="padding:0 0 8px">DEFAULTS FOR ALL ITEMS</div>'
      +'<div style="display:flex;gap:14px;flex-wrap:wrap">'
      +'<label style="font-size:12px;color:var(--muted)">Block<br><input id="map_block" placeholder="e.g. 1 &rarr; B1" style="width:130px"></label>'
      +'<label style="font-size:12px;color:var(--muted)">Elevation<br><input id="map_elev" placeholder="e.g. 1 &rarr; E1" style="width:130px"></label>'
      +'</div>'
      +'<div id="floorsWrap" style="margin-top:14px;display:none">'
      +'<div class="groupt" style="padding:0 0 6px">FLOORS &mdash; enter floor no., windows and doors (a new row opens as you fill each)</div>'
      +'<div id="floorRows"></div>'
      +'<div id="floorTotals" class="sub" style="margin-top:8px;font-weight:700"></div>'
      +'<button class="add" id="preloadBtn" style="margin-top:8px">Preload</button>'
      +'</div></div>'
      +'<div id="mapTableWrap"></div>'
      +'<div id="mapFooter" style="margin-top:12px;gap:12px;align-items:center;display:none">'
      +'<button class="save" id="mapSaveBtn">Save</button>'
      +'<button class="add" id="mapAddRowBtn">+ Add line</button>'
      +'<span class="sub" id="mapSaveNote"></span></div>';
    mapWirePrefix('map_block','B'); mapWirePrefix('map_elev','E');
    document.getElementById('preloadBtn').addEventListener('click',mapPreload);
    document.getElementById('mapSaveBtn').addEventListener('click',mapSave);
    document.getElementById('mapAddRowBtn').addEventListener('click',mapAddRow);
    maybeRevealFloors();
  }
  function getMapBE(){ return { block:(document.getElementById('map_block')||{}).value||'', elev:(document.getElementById('map_elev')||{}).value||'' }; }
  function updateFloorTotals(){
    var el=document.getElementById('floorTotals'); if(!el)return;
    var tw=0, td=0, nf=0;
    document.querySelectorAll('#floorRows .frow').forEach(function(div){
      var f=div.querySelector('.fr-floor').value.trim();
      var w=parseInt(div.querySelector('.fr-win').value,10)||0;
      var d=parseInt(div.querySelector('.fr-door').value,10)||0;
      if(f!==''&&(w>0||d>0)){ nf++; tw+=w; td+=d; }
    });
    el.textContent='Total: '+nf+' floor'+(nf===1?'':'s')+' \xB7 '+tw+' windows \xB7 '+td+' doors \xB7 '+(tw+td)+' items';
  }
  function maybeRevealFloors(){
    var bEl=document.getElementById('map_block'), eEl=document.getElementById('map_elev'); if(!bEl||!eEl)return;
    var w=document.getElementById('floorsWrap');
    if(bEl.value.trim()&&eEl.value.trim()){ w.style.display='block'; if(!document.querySelector('#floorRows .frow')) addFloorRow(); }
    else w.style.display='none';
  }
  function addFloorRow(){
    var wrap=document.getElementById('floorRows');
    var div=document.createElement('div'); div.className='frow'; div.style.cssText='display:flex;gap:8px;margin-bottom:6px;align-items:center';
    div.innerHTML='<input class="fr-floor" placeholder="Floor" style="width:90px">'
      +'<input class="fr-win" type="number" min="0" placeholder="Windows" style="width:110px">'
      +'<input class="fr-door" type="number" min="0" placeholder="Doors" style="width:110px">'
      +'<button class="del fr-del" title="Remove">&#10005;</button>';
    wrap.appendChild(div);
    div.querySelectorAll('input').forEach(function(inp){ inp.addEventListener('input',function(){ onFloorInput(div); }); });
    div.querySelector('.fr-del').addEventListener('click',function(){ if(document.querySelectorAll('#floorRows .frow').length>1) div.remove(); });
  }
  function onFloorInput(div){
    applyPfx(div.querySelector('.fr-floor'),'F'); // "1"->"F1", GF stays GF
    updateFloorTotals();
    var rows=document.querySelectorAll('#floorRows .frow');
    if(div!==rows[rows.length-1]) return;
    var f=div.querySelector('.fr-floor').value.trim(), w=div.querySelector('.fr-win').value.trim(), d=div.querySelector('.fr-door').value.trim();
    if(f!==''&&w!==''&&d!=='') addFloorRow();
  }
  // Floor segment: prefix F only for a plain number (1 -> F1); leave labels like GF as-is.
  function floorSeg(flat){ if(!flat) return ''; return /^[0-9]+$/.test(flat) ? ('F'+flat) : flat.toUpperCase(); }
  function levelOf(floor,flat){ return (flat&&String(flat).trim()!=='')?flat:floor; }
  function mapCode(block,elev,floor,flat,item){
    var parts=current.split('.');
    return [parts[0],parts[1],block,elev,floorSeg(levelOf(floor,flat)),item].filter(function(x){return x;}).join('.');
  }
  function stripF(v){ return String(v||'').trim().replace(/^F(?=[0-9])/i,''); } // "F1"->"1", "GF" stays
  function mapPreload(){
    var floors=[];
    document.querySelectorAll('#floorRows .frow').forEach(function(div){
      var f=div.querySelector('.fr-floor').value.trim(); // keep the F (F1, GF) \u2014 server normalises
      var w=parseInt(div.querySelector('.fr-win').value,10)||0;
      var d=parseInt(div.querySelector('.fr-door').value,10)||0;
      if(f!==''&&(w>0||d>0)) floors.push({floor:f,windows:w,doors:d});
    });
    if(!floors.length){tShow('Add at least one floor with windows or doors');return;}
    var rows=[];
    floors.forEach(function(fl){
      for(var i=1;i<=fl.windows;i++) rows.push({floor:fl.floor,flat:'',item:'W'+i,type:'Window'});
      for(var j=1;j<=fl.doors;j++) rows.push({floor:fl.floor,flat:'',item:'D'+j,type:'Door'});
    });
    renderMapRows(rows);
  }
  function renderMapRows(rows){
    var wrap=document.getElementById('mapTableWrap');
    var head='<tr><th>CODE</th><th>FLOOR</th><th>FLAT</th><th>ITEM</th><th>TYPE</th><th>COUPLE</th><th>#</th><th></th><th></th></tr>';
    wrap.innerHTML='<div class="groupt" style="padding:0 0 6px;display:flex;justify-content:space-between;align-items:center">'
      +'<span>PRELOADED ITEMS &mdash; review, edit, split couples, then Save</span>'
      +'<button class="del" id="mapClearBtn" title="Remove every row">Clear all</button></div>'
      +'<div class="card2" style="padding:0;overflow:auto"><table id="mapTable"><thead>'+head+'</thead><tbody id="mapTbody"></tbody></table></div>';
    var tb=document.getElementById('mapTbody');
    rows.forEach(function(r){ tb.appendChild(makeMapRow(r)); });
    document.getElementById('mapClearBtn').addEventListener('click',function(){ if(document.querySelectorAll('#mapTbody tr').length&&confirm('Clear all rows from the table?')){ document.getElementById('mapTbody').innerHTML=''; updateSaveCount(); } });
    document.getElementById('mapFooter').style.display='flex';
    updateSaveCount();
  }
  function makeMapRow(r){
    var be=getMapBE();
    var tr=document.createElement('tr');
    tr.innerHTML=''
      +'<td class="mono mapcode" style="font-size:11px;white-space:nowrap">'+esc(mapCode(be.block.trim(),be.elev.trim(),r.floor,r.flat,r.item))+'</td>'
      +'<td><input class="mr-floor" value="'+esc(r.floor||'')+'" style="width:58px" title="Floor"></td>'
      +'<td><input class="mr-flat" value="'+esc(r.flat||'')+'" style="width:58px" title="Flat / plot (optional \u2014 replaces floor in the code)"></td>'
      +'<td><input class="mr-item" value="'+esc(r.item||'')+'" style="width:90px"></td>'
      +'<td><select class="mr-type"><option'+(r.type==='Window'?' selected':'')+'>Window</option><option'+(r.type==='Door'?' selected':'')+'>Door</option></select></td>'
      +'<td style="text-align:center"><input type="checkbox" class="mr-couple"></td>'
      +'<td><input type="number" min="2" value="2" class="mr-n" style="width:52px" disabled></td>'
      +'<td><button class="add mr-split" disabled title="Split into couple lines">Add</button></td>'
      +'<td style="text-align:right"><button class="del mr-del" title="Delete line">&#10005;</button></td>';
    wireMapRow(tr);
    return tr;
  }
  function wireMapRow(tr){
    function recode(){ var be=getMapBE(); tr.querySelector('.mapcode').textContent=mapCode(be.block.trim(),be.elev.trim(),stripF(tr.querySelector('.mr-floor').value),stripF(tr.querySelector('.mr-flat').value),tr.querySelector('.mr-item').value.trim().toUpperCase()); }
    tr.querySelector('.mr-floor').addEventListener('input',function(){applyPfx(this,'F');recode();});
    tr.querySelector('.mr-flat').addEventListener('input',function(){applyPfx(this,'F');recode();});
    tr.querySelector('.mr-item').addEventListener('input',function(){var s=this.selectionStart;this.value=this.value.toUpperCase();try{this.setSelectionRange(s,s);}catch(_){}recode();});
    var cp=tr.querySelector('.mr-couple'), n=tr.querySelector('.mr-n'), sp=tr.querySelector('.mr-split');
    cp.addEventListener('change',function(){ n.disabled=!cp.checked; sp.disabled=!cp.checked; });
    sp.addEventListener('click',function(){ splitMapRow(tr); });
    tr.querySelector('.mr-del').addEventListener('click',function(){ tr.remove(); updateSaveCount(); });
  }
  function splitMapRow(tr){
    var n=parseInt(tr.querySelector('.mr-n').value,10)||0;
    if(n<2){tShow('Set a couple count of 2 or more');return;}
    var floor=tr.querySelector('.mr-floor').value.trim();
    var flat=tr.querySelector('.mr-flat').value.trim();
    var base=tr.querySelector('.mr-item').value.trim().toUpperCase();
    var type=tr.querySelector('.mr-type').value;
    if(!base){tShow('Enter an item code first');return;}
    for(var i=1;i<=n;i++){ tr.parentNode.insertBefore(makeMapRow({floor:floor,flat:flat,item:base+'.'+i,type:type}),tr); }
    tr.remove(); updateSaveCount();
  }
  function mapAddRow(){ var tb=document.getElementById('mapTbody'); if(!tb)return; tb.appendChild(makeMapRow({floor:'',flat:'',item:'',type:'Window'})); updateSaveCount(); }
  function updateSaveCount(){ var n=document.querySelectorAll('#mapTbody tr').length; var b=document.getElementById('mapSaveBtn'); if(b)b.textContent='Save '+n+' item'+(n===1?'':'s'); }
  async function mapSave(){
    var be=getMapBE(); var block=be.block.trim(), elev=be.elev.trim();
    var out=[];
    document.querySelectorAll('#mapTbody tr').forEach(function(tr){
      var floor=tr.querySelector('.mr-floor').value.trim(); // keep the F; server normalises
      var flat=stripF(tr.querySelector('.mr-flat').value);
      var item=tr.querySelector('.mr-item').value.trim().toUpperCase();
      var type=tr.querySelector('.mr-type').value;
      if(!item) return;
      var couple=tr.querySelector('.mr-couple').checked;
      var nn=parseInt(tr.querySelector('.mr-n').value,10)||0;
      if(couple&&nn>=2){ for(var i=1;i<=nn;i++) out.push({floor:floor,flat:flat,item:item+'.'+i,item_type:type}); }
      else out.push({floor:floor,flat:flat,item:item,item_type:type});
    });
    if(!out.length){tShow('Nothing to save');return;}
    tShow('Saving '+out.length+' item(s)\u2026');
    var d=await (await api('/api/job/'+encodeURIComponent(current)+'/mapping-items',{method:'POST',body:JSON.stringify({block:block,elevation:elev,rows:out})})).json();
    if(d.ok){ document.getElementById('mapSaveNote').textContent=d.inserted+' created'+(d.skipped?(', '+d.skipped+' already existed'):''); tShow(d.inserted+' item(s) created'); }
    else tShow(d.error||'Save failed');
  }

  async function loadJobs(){
    var jobs=await (await api('/api/jobs')).json(); var el=document.getElementById('jobs');el.innerHTML='';
    JOB_STATUS={}; JOB_MAPDATE={};
    jobs.forEach(function(j){ JOB_STATUS[j.code]=j.status||'pending_mapping'; JOB_MAPDATE[j.code]=j.mapping_start_date||''; });
    function mk(code,label){var d=document.createElement('div');d.className='job'+(code===current?' on':'');d.textContent=label;d.setAttribute('data-code',code);
      d.onclick=function(){current=code;itemFilter='all';flatFilter='';statusFilter='';teamFilter='';blockFilter='';elevFilter='';floorFilter='';roomFilter='';stageFilter='';itemColFilter='';document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)});if(sessionStorage.getItem('ace_tab')==='mapping')loadMapping();else loadItems();};
      if(code!=='ALL'){var b=document.createElement('span');b.textContent='\u22EF';b.title='Files';b.style.cssText='float:right;cursor:pointer;padding:0 6px;opacity:.7';b.onclick=function(ev){ev.stopPropagation();openJobFiles(code);};d.appendChild(b);}
      el.appendChild(d);}
    if(myRole!=='scanner')mk('ALL','\u25A6 All jobs');
    jobs.forEach(function(j){mk(j.code,j.code);});
    // Scanner (or an empty current) lands on the first available job.
    if((myRole==='scanner'||current==='ALL')&&jobs.length&&(current==='ALL'||!JOB_STATUS[current])){ current=jobs[0].code; document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)}); }
  }
  function opt(v,l,sel){return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+l+'</option>';}
  async function openNewJob(){
    var ruleField='';
    if(canCap('finance.manage')){
      var rules=[]; try{rules=await (await api('/api/pricing-rules')).json();}catch(e){}
      ruleField='<div class="field full"><label>Pricing rule (optional)</label><select id="nj_rule"><option value="">\u2014 none \u2014</option>'
        +rules.map(function(r){return '<option value="'+r.id+'">'+esc(r.name)+(r.customer?(' \xB7 '+esc(r.customer)):'')+'</option>';}).join('')+'</select></div>';
    }
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="njPrev">CLIENT.JOB</div>'
      +field('nj_client','Client code *','e.g. AXS')+field('nj_job','Job code *','e.g. LAB')
      +'<div class="field full"><label>Job name *</label><input id="nj_name" placeholder="e.g. Laburnum Road, Waterlooville"></div>'
      +'<div class="field full"><label>Site address</label><input id="nj_addr" placeholder="Full site address (optional)"></div>'
      +'<div class="field full"><label>Drawings / files (optional)</label><input id="nj_files" type="file" multiple accept="image/*,.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"><div class="sub" style="margin:4px 0 0">jpg, pdf or zip \xB7 up to 25MB each</div></div>'
      +ruleField
      +'<div class="ferr" id="njErr"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="saveJob()">Create job</button></div>';
    openModal('New job',html);
    ['nj_client','nj_job'].forEach(function(id){document.getElementById(id).addEventListener('input',njCode);});
    njCode();
  }
  function njCode(){var c=(document.getElementById('nj_client').value||'').trim().toUpperCase();var j=(document.getElementById('nj_job').value||'').trim().toUpperCase();document.getElementById('njPrev').textContent=(c||'CLIENT')+'.'+(j||'JOB');}
  async function saveJob(){
    var client=(document.getElementById('nj_client').value||'').trim();
    var job=(document.getElementById('nj_job').value||'').trim();
    var name=(document.getElementById('nj_name').value||'').trim();
    if(!client||!job){document.getElementById('njErr').textContent='Client code and job code are required.';return;}
    if(!name){document.getElementById('njErr').textContent='Job name is required.';return;}
    var r=await api('/api/jobs',{method:'POST',body:JSON.stringify({client_code:client,job_code:job,name:name,site_address:(document.getElementById('nj_addr').value||'').trim()})});
    var d=await r.json();
    if(r.ok&&d.ok){
      var rsel=document.getElementById('nj_rule');
      if(rsel&&rsel.value){ try{await api('/api/job/'+encodeURIComponent(d.code)+'/pricing',{method:'PUT',body:JSON.stringify({rule_id:rsel.value})});}catch(e){} }
      var fl=document.getElementById('nj_files'); var picked=fl&&fl.files?fl.files.length:0;
      if(picked){ document.getElementById('njErr').textContent=''; tShow('Uploading '+picked+' file(s)\u2026'); try{ await uploadJobFiles(d.code, fl.files); }catch(e){ tShow('Job created, but a file upload failed'); } }
      closeModal();tShow('Created '+d.code);loadJobs();
    }
    else document.getElementById('njErr').textContent=d.error||'Could not create job';
  }
  // ---- job file attachments ----
  async function uploadJobFiles(code,fileList){
    var arr=[];
    for(var i=0;i<fileList.length;i++){ var f=fileList[i]; if(f.size>25*1024*1024){tShow('"'+f.name+'" is over 25MB \u2014 skipped');continue;} arr.push({name:f.name,dataUrl:await fileToDataUrl(f)}); }
    if(!arr.length)return;
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/files',{method:'POST',body:JSON.stringify({files:arr})})).json();
    if(!d.ok)throw new Error(d.error||'upload failed');
  }
  function fmtSize(n){ if(!n)return''; if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
  async function openJobFiles(code){
    if(!code||code==='ALL'){tShow('Pick a job first');return;}
    openModal('Files \xB7 '+esc(code),'<div class="empty" style="padding:22px">Loading\u2026</div>');
    var files; try{files=await (await api('/api/job/'+encodeURIComponent(code)+'/files')).json();}catch(e){document.getElementById('modalBody').innerHTML='<div class="empty" style="padding:22px">Could not load files.</div>';return;}
    var isImg=function(ct){return /^image\\//.test(ct||'');}; var isPdf=function(ct){return /pdf/i.test(ct||'');};
    var canMng=canCap('jobs.manage');
    var body='<div style="padding:14px 20px 18px">';
    if(!files.length){ body+='<div class="empty">No files attached to this job yet.'+(canMng?' Add some below.':'')+'</div>'; }
    else{ body+=files.map(function(f){
      var thumb=isImg(f.content_type)?'<img src="'+(f.url||'')+'" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">':'<div style="width:52px;height:52px;border-radius:8px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--muted)">'+(isPdf(f.content_type)?'PDF':'FILE')+'</div>';
      var view=(isImg(f.content_type)||isPdf(f.content_type))?'View':'Open';
      var acts='<a class="add" target="_blank" rel="noopener" href="'+(f.url||'')+'">'+view+'</a> <a class="add" href="'+(f.url||'')+'" download="'+esc(f.name)+'">Download</a>'+(canMng?' <button class="del" onclick="delJobFile(\\''+code+'\\',\\''+f.id+'\\')">Delete</button>':'');
      return '<div class="card2" style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:10px">'+thumb
        +'<div style="flex:1;min-width:0"><div style="font-weight:700;word-break:break-all">'+esc(f.name)+'</div><div class="sub" style="margin:2px 0 0">'+esc(fmtSize(f.size_bytes))+'</div></div>'
        +'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+acts+'</div></div>';
    }).join(''); }
    if(canMng){ body+='<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      +'<input type="file" id="jf_add" multiple accept="image/*,.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed">'
      +'<button class="save" onclick="addJobFiles(\\''+code+'\\')">Upload</button></div>'; }
    body+='</div>';
    document.getElementById('modalBody').innerHTML=body;
  }
  async function addJobFiles(code){
    var fl=document.getElementById('jf_add'); if(!fl||!fl.files.length){tShow('Choose files first');return;}
    tShow('Uploading '+fl.files.length+' file(s)\u2026');
    try{ await uploadJobFiles(code,fl.files); tShow('Uploaded'); openJobFiles(code); }catch(e){ tShow('Upload failed'); }
  }
  async function delJobFile(code,id){
    if(!confirm('Delete this file?'))return;
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/files/'+id,{method:'DELETE'})).json();
    if(d.ok){tShow('Deleted');openJobFiles(code);}else tShow(d.error||'Delete failed');
  }
  async function loadItems(){
    var data=await (await api('/api/items?job='+encodeURIComponent(current))).json(); teams=data.teams; itemsData=data; applyJobsHidden();
    bulkFieldPick(); // render the bulk value control for the selected field
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> \u2014 '+data.job.name;
    document.getElementById('subtitle').textContent=(current==='ALL'?'All jobs \xB7 ':'Monday board: '+(data.job.board||'(not linked)')+' \xB7 ')+'edits save to the store; use Sync to push to Monday';
    document.getElementById('newBtn').style.display=(current==='ALL')?'none':'';
    document.getElementById('delJobBtn').style.display=(current!=='ALL'&&canCap('jobs.manage'))?'':'none';
    document.getElementById('filesBtn').style.display=(current!=='ALL')?'':'none';
    // header column filters: distinct flats (this job) + all statuses
    var flats=[]; (itemsData.items||[]).forEach(function(it){var f=it.flat||''; if(f&&flats.indexOf(f)<0)flats.push(f);});
    flats.sort(function(a,b){return (parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));});
    if(flatFilter&&flats.indexOf(flatFilter)<0)flatFilter='';
    document.getElementById('flatFilter').innerHTML='<option value="">All flats</option>'+flats.map(function(f){return '<option value="'+av(f)+'">'+esc(f)+'</option>';}).join('');
    document.getElementById('flatFilter').value=flatFilter;
    document.getElementById('statusFilter').innerHTML='<option value="">All statuses</option><option value="__none">\u2014 no status \u2014</option>'+ISTATUS.filter(function(s){return s[0];}).map(function(s){return '<option value="'+s[0]+'">'+esc(s[1])+'</option>';}).join('');
    document.getElementById('statusFilter').value=statusFilter;
    // team filter: distinct teams present on this job's items (plus "no team")
    var tids=[], hasNoTeam=false;
    (itemsData.items||[]).forEach(function(it){ if(it.team_id){ if(tids.indexOf(it.team_id)<0)tids.push(it.team_id); } else hasNoTeam=true; });
    tids.sort(function(a,b){return teamName(a).localeCompare(teamName(b));});
    if(teamFilter&&teamFilter!=='__none'&&tids.indexOf(teamFilter)<0)teamFilter='';
    if(teamFilter==='__none'&&!hasNoTeam)teamFilter='';
    document.getElementById('teamFilter').innerHTML='<option value="">All teams</option>'
      +(hasNoTeam?'<option value="__none">\u2014 no team \u2014</option>':'')
      +tids.map(function(id){return '<option value="'+av(id)+'">'+esc(teamName(id))+'</option>';}).join('');
    document.getElementById('teamFilter').value=teamFilter;
    // block / elevation / floor filters: distinct values on this job's items (+ "none")
    fillColFilter('blockFilter','block',function(v){blockFilter=v;},blockFilter,'All blocks');
    fillColFilter('elevFilter','elevation',function(v){elevFilter=v;},elevFilter,'All elevations');
    fillColFilter('floorFilter','floor',function(v){floorFilter=v;},floorFilter,'All floors');
    fillColFilter('roomFilter','room',function(v){roomFilter=v;},roomFilter,'All rooms');
    fillColFilter('itemColFilter','item',function(v){itemColFilter=v;},itemColFilter,'All items');
    // stage filter: distinct stages present, shown with their labels
    var stages=[]; (itemsData.items||[]).forEach(function(it){var st=it.stage||''; if(st&&stages.indexOf(st)<0)stages.push(st);});
    if(stageFilter&&stages.indexOf(stageFilter)<0)stageFilter='';
    document.getElementById('stageFilter').innerHTML='<option value="">All stages</option>'+stages.map(function(st){return '<option value="'+av(st)+'">'+esc(STAGE[st]||st)+'</option>';}).join('');
    document.getElementById('stageFilter').value=stageFilter;
    renderItems();
  }
  function setFlatFilter(v){flatFilter=v;renderItems();}
  function setStatusFilter(v){statusFilter=v;renderItems();}
  function setTeamFilter(v){teamFilter=v;renderItems();}
  function setBlockFilter(v){blockFilter=v;renderItems();}
  function setElevFilter(v){elevFilter=v;renderItems();}
  function setFloorFilter(v){floorFilter=v;renderItems();}
  function setRoomFilter(v){roomFilter=v;renderItems();}
  function setStageFilter(v){stageFilter=v;renderItems();}
  function setItemColFilter(v){itemColFilter=v;renderItems();}
  function fillColFilter(selId,field,setFn,cur,allLabel){
    var vals=[], hasNone=false;
    (itemsData.items||[]).forEach(function(it){ var v=it[field]||''; if(v){ if(vals.indexOf(v)<0)vals.push(v); } else hasNone=true; });
    vals.sort(function(a,b){return (parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));});
    if(cur&&cur!=='__none'&&vals.indexOf(cur)<0){ setFn(''); cur=''; }
    if(cur==='__none'&&!hasNone){ setFn(''); cur=''; }
    var sel=document.getElementById(selId); if(!sel)return;
    sel.innerHTML='<option value="">'+allLabel+'</option>'+(hasNone?'<option value="__none">\u2014 none \u2014</option>':'')
      +vals.map(function(v){return '<option value="'+av(v)+'">'+esc(v)+'</option>';}).join('');
    sel.value=cur;
  }
  var INSTALLED_SET={installed_no_snag:1,installed_snag:1};
  function matchFilter(r){
    switch(itemFilter){
      case 'synced':return !!r.synced;
      case 'unsynced':return !r.synced;
      case 'installed':return !!INSTALLED_SET[r.install_status];
      case 'dirty':return !!r.dirty;
      case 'open_snags':return r.kind==='snag' && !INSTALLED_SET[r.install_status];
      case 'snags':return r.kind==='snag';
      default:return true;
    }
  }
  function setFilter(f){itemFilter=f;renderItems();}
  function renderItems(){
    sel={};
    sessionStorage.setItem('ace_job',current); sessionStorage.setItem('ace_filter',itemFilter);
    document.querySelectorAll('#itemFilters .chip').forEach(function(c){c.classList.toggle('on',c.getAttribute('data-f')===itemFilter);});
    var all=(itemsData?itemsData.items:[]);
    var rows=all.filter(matchFilter).filter(function(r){
      if(flatFilter&&(r.flat||'')!==flatFilter)return false;
      if(statusFilter==='__none'){if(r.install_status)return false;}
      else if(statusFilter){if(r.install_status!==statusFilter)return false;}
      if(teamFilter==='__none'){if(r.team_id)return false;}
      else if(teamFilter){if(r.team_id!==teamFilter)return false;}
      if(blockFilter==='__none'){if(r.block)return false;} else if(blockFilter){if((r.block||'')!==blockFilter)return false;}
      if(elevFilter==='__none'){if(r.elevation)return false;} else if(elevFilter){if((r.elevation||'')!==elevFilter)return false;}
      if(floorFilter==='__none'){if(r.floor)return false;} else if(floorFilter){if((r.floor||'')!==floorFilter)return false;}
      if(roomFilter==='__none'){if(r.room)return false;} else if(roomFilter){if((r.room||'')!==roomFilter)return false;}
      if(stageFilter&&(r.stage||'')!==stageFilter)return false;
      if(itemColFilter==='__none'){if(r.item)return false;} else if(itemColFilter){if((r.item||'')!==itemColFilter)return false;}
      return true;
    });
    var canEdit=canCap('items.edit'), canFit=canCap('items.fit'), canSync=canCap('monday.sync');
    var canSelect=canEdit||canFit||canSync;
    // counters: how many shown (current filter) / total, plus how many changed (need re-sync) and not-yet-synced.
    var dirtyN=all.filter(function(x){return x.dirty;}).length;
    var unsyncedN=all.filter(function(x){return !x.synced;}).length;
    document.getElementById('itemCount').textContent=
      rows.length+(itemFilter==='all'?'':' of '+all.length)+' item'+(rows.length===1?'':'s')
      +(dirtyN?('  \xB7  '+dirtyN+' changed'):'')+(unsyncedN?('  \xB7  '+unsyncedN+' not synced'):'');
    document.getElementById('bulkDelBtn').style.display=canCap('jobs.manage')?'':'none';
    var tb=document.getElementById('rows');tb.innerHTML='';
    rows.forEach(function(r){
      var tr=document.createElement('tr');
      var curStatus=r.install_status?(ISTATUS_LABEL[r.install_status]||r.install_status):'\u2014';
      var statusSel=(canFit||canEdit)
        ?'<select class="sel" onchange="save(\\''+r.id+'\\',\\'install_status\\',this.value)">'+ISTATUS.map(function(s){return opt(s[0],s[1],r.install_status||'')}).join('')+'</select>'
        :'<span class="ro">'+curStatus+'</span>';
      var teamSel=canEdit
        ?'<select class="sel" onchange="save(\\''+r.id+'\\',\\'team_id\\',this.value)">'+opt('','\u2014',r.team_id||'')+teamOptionList(r.team_id||'')+'</select>'
        :'<span class="ro">'+teamName(r.team_id)+'</span>';
      var rateVal=r.rate_override_pennies!=null?(r.rate_override_pennies/100):'';
      var rateInput=canEdit
        ?'<input class="rate" type="number" placeholder="'+r.effective_rate.replace('\xA3','')+'" value="'+rateVal+'" onchange="saveRate(\\''+r.id+'\\',this.value)">'
        :'<span class="ro">'+r.effective_rate+'</span>';
      var monday=r.synced
        ?'<a class="mlink" target="_blank" href="'+r.monday_url+'">open \u2197</a>'+(canSync?' <button class="resync'+(r.dirty?' dirty':'')+'" onclick="syncItem(\\''+r.id+'\\')">Re-sync</button>'+(r.dirty?' <span class="chgtag">changed</span>':''):'')
        :(canSync?'<button class="sync" onclick="syncItem(\\''+r.id+'\\')">Sync</button>':'<span class="ro">not synced</span>');
      var snagTag=r.kind==='snag'?'<span class="snagtag">SNAG</span> ':'';
      // Flat & Room are editable until the item is synced to Monday (editing rebuilds the code).
      var editable=canEdit&&!r.synced;
      var flatCell=editable?'<input class="cedit" value="'+(r.flat||'')+'" placeholder="\u2014" onchange="saveCode(\\''+r.id+'\\',\\'flat\\',this.value)">':(r.flat||'\u2014');
      var roomCell=editable?'<select class="sel" style="min-width:150px" onchange="saveCode(\\''+r.id+'\\',\\'room\\',this.value)">'+roomOptions(r.room||'')+'</select>':roomLabel(r.room);
      tr.innerHTML='<td class="cbcell">'+(canSelect?'<input type="checkbox" class="rowcb" data-id="'+r.id+'"'+(sel[r.id]?' checked':'')+' onclick="toggleRow(\\''+r.id+'\\',this)">':'')+'</td>'+
        '<td>'+snagTag+'<a class="codelink mono" onclick="openDetail(\\''+r.id+'\\')">'+(r.full_code||'')+'</a></td>'+
        '<td>'+(r.block||'\u2014')+'</td><td>'+(r.elevation||'\u2014')+'</td><td>'+flatCell+'</td><td>'+(r.floor||'\u2014')+'</td><td>'+roomCell+'</td><td>'+(r.item||'\u2014')+'</td>'+
        '<td><span class="pill '+r.stage+'">'+(STAGE[r.stage]||r.stage)+'</span></td>'+
        '<td>'+rateInput+'</td><td>'+statusSel+'</td><td>'+teamSel+'</td><td>'+monday+'</td>';
      tb.appendChild(tr);
    });
    document.getElementById('selAll').checked=false;
    renderBar();
  }
  function openItemsFiltered(job,filter){
    current=job;itemFilter=filter;
    document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)});
    showTab('items');loadItems();
  }
  async function save(id,field,value){var b={};b[field]=value;await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(b)});tShow('Saved');}
  async function saveRate(id,value){await api('/api/item/'+id,{method:'PUT',body:JSON.stringify({rate_override_pennies:value===''?null:Math.round(Number(value)*100)})});tShow('Rate saved');}
  function toggleJobs(){
    var a=document.querySelector('#itemsView aside'); if(!a)return;
    var hide=a.style.display!=='none'; a.style.display=hide?'none':'';
    sessionStorage.setItem('ace_jobs_hidden',hide?'1':'0');
  }
  function applyJobsHidden(){
    var a=document.querySelector('#itemsView aside'); if(a)a.style.display=(sessionStorage.getItem('ace_jobs_hidden')==='1')?'none':'';
  }
  async function saveCode(id,field,value){
    var body=field==='flat'?{flat:value}:{room:value};
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(body)})).json();
    if(d.ok)tShow('Code updated'); else tShow(d.error||'Update failed');
    loadItems(); // refresh full code + Floor column
  }
  async function syncItem(id){tShow('Syncing\u2026');try{var d=await (await api('/api/promote/'+id,{method:'POST'})).json();if(d.ok){var m='Synced to Monday'+(d.photosPushed?' \xB7 '+d.photosPushed+' photo'+(d.photosPushed>1?'s':''):'');tShow(d.photoError?('Synced \xB7 photo issue: '+d.photoError):m);loadItems();}else tShow(d.error||'Sync failed');}catch(e){tShow('Sync failed')}}

  // ---- bulk selection / multi-line processing ----
  function selectedIds(){return Object.keys(sel);}
  function renderBar(){
    var n=selectedIds().length;
    document.getElementById('bulkbar').style.display=n?'flex':'none';
    document.getElementById('bulkcount').textContent=n+' selected';
  }
  function toggleRow(id,cb){if(cb.checked)sel[id]=true;else delete sel[id];
    var all=document.querySelectorAll('.rowcb'),on=document.querySelectorAll('.rowcb:checked');
    document.getElementById('selAll').checked=all.length>0&&all.length===on.length;renderBar();}
  function toggleAll(cb){document.querySelectorAll('.rowcb').forEach(function(x){x.checked=cb.checked;var id=x.getAttribute('data-id');if(cb.checked)sel[id]=true;else delete sel[id];});renderBar();}
  function clearSel(){sel={};document.querySelectorAll('.rowcb').forEach(function(x){x.checked=false;});document.getElementById('selAll').checked=false;renderBar();}
  async function bulkSync(){
    var ids=selectedIds();if(!ids.length)return;
    tShow('Syncing '+ids.length+' item(s)\u2026');
    try{var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:'sync'})})).json();
      if(d.ok)tShow(d.created+' created, '+d.updated+' updated'+(d.failed?', '+d.failed+' failed':''));else tShow(d.error||'Bulk sync failed');
    }catch(e){tShow('Bulk sync failed');}
    loadItems();
  }
  function bulkFieldPick(){
    var sel=document.getElementById('bulkField'); if(!sel)return;
    var f=sel.value; var w=document.getElementById('bulkValWrap');
    if(f==='team') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">\u2014 team \u2014</option>'+teamOptionList('')+'</select>';
    else if(f==='status') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">\u2014 status \u2014</option>'+ISTATUS.filter(function(s){return s[0]}).map(function(s){return opt(s[0],s[1],'')}).join('')+'</select>';
    else w.innerHTML='<input id="bulkVal" class="bulk" placeholder="'+(f.charAt(0).toUpperCase()+f.slice(1))+' value" style="width:130px;text-transform:uppercase">';
  }
  async function bulkEditApply(){
    var f=document.getElementById('bulkField').value;
    var vEl=document.getElementById('bulkVal'); var value=vEl?vEl.value:'';
    var ids=selectedIds(); if(!ids.length){tShow('Select some items first');return;}
    var action=(f==='status')?'status':f;
    var btn=document.getElementById('bulkApplyBtn'); var label=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='Applying\u2026';}
    tShow('Applying to '+ids.length+' item(s)\u2026');
    try{
      var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:action,value:value})})).json();
      if(vEl&&vEl.tagName==='INPUT')vEl.value='';
      if(d.ok){tShow((d.updated||0)+' updated'+(d.skipped?(' \xB7 '+d.skipped+' skipped (synced/dupe)'):''));loadItems();}else tShow(d.error||'Update failed');
    }catch(e){tShow('Update failed');}
    finally{ if(btn){btn.disabled=false;btn.textContent=label||'Apply';} }
  }
  async function bulkDelete(){
    var ids=selectedIds();if(!ids.length)return;
    if(!confirm('Delete '+ids.length+' item'+(ids.length===1?'':'s')+'? This also removes their snags, photos and pricing. This cannot be undone.'))return;
    try{var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:'delete'})})).json();
      if(d.ok){tShow(d.deleted+' item(s) deleted');loadItems();}else tShow(d.error||'Delete failed');
    }catch(e){tShow('Delete failed');}
  }
  async function delJob(){
    if(current==='ALL')return;
    if(!confirm('Delete job '+current+'? Only allowed if it has no items.'))return;
    try{var r=await api('/api/job/'+encodeURIComponent(current),{method:'DELETE'});var d=await r.json();
      if(r.ok&&d.ok){tShow('Job '+current+' deleted');current='ALL';await loadJobs();loadItems();}
      else tShow(d.error||'Could not delete job');
    }catch(e){tShow('Could not delete job');}
  }

  // ---- teams & rates ----
  var canManage=false;
  function showTab(name){
    sessionStorage.setItem('ace_tab',name);
    document.getElementById('dashView').style.display=name==='dashboard'?'block':'none';
    document.getElementById('itemsView').style.display=name==='items'?'flex':'none';
    document.getElementById('mappingView').style.display=name==='mapping'?'block':'none';
    document.getElementById('teamsView').style.display=name==='teams'?'block':'none';
    document.getElementById('syncView').style.display=name==='sync'?'block':'none';
    document.getElementById('plansView').style.display=name==='plans'?'block':'none';
    document.getElementById('calView').style.display=name==='cal'?'block':'none';
    document.getElementById('budgetView').style.display=name==='budget'?'block':'none';
    document.getElementById('testsView').style.display=name==='tests'?'block':'none';
    document.getElementById('usersView').style.display=name==='users'?'block':'none';
    document.getElementById('rolesView').style.display=name==='roles'?'block':'none';
    document.getElementById('logsView').style.display=name==='logs'?'block':'none';
    document.getElementById('tabDash').classList.toggle('on',name==='dashboard');
    document.getElementById('tabItems').classList.toggle('on',name==='items');
    document.getElementById('tabMapping').classList.toggle('on',name==='mapping');
    document.getElementById('tabTeams').classList.toggle('on',name==='teams');
    document.getElementById('tabSync').classList.toggle('on',name==='sync');
    document.getElementById('tabPlans').classList.toggle('on',name==='plans');
    document.getElementById('tabCal').classList.toggle('on',name==='cal');
    document.getElementById('tabBudget').classList.toggle('on',name==='budget');
    document.getElementById('tabTests').classList.toggle('on',name==='tests');
    document.getElementById('tabUsers').classList.toggle('on',name==='users');
    document.getElementById('tabRoles').classList.toggle('on',name==='roles');
    document.getElementById('tabLogs').classList.toggle('on',name==='logs');
    if(name==='items')loadItems(); // always refresh (e.g. after saving in Mapping)
    if(name==='dashboard')loadDashboard();
    if(name==='mapping')loadMapping();
    if(name==='teams')loadTeams();
    if(name==='sync')loadSync();
    if(name==='plans')loadPlansTab();
    if(name==='cal')loadCalendar();
    if(name==='budget')loadBudget();
    if(name==='tests')loadTests();
    if(name==='users')loadUsers();
    if(name==='roles')loadRoles();
    if(name==='logs')loadLogs();
  }
  var ROLE_MATRIX=__ROLE_MATRIX_JSON__;
  function canCap(cap){if(myRole==='admin')return true;return (ROLE_MATRIX.matrix[myRole]||[]).indexOf(cap)>=0;}
  var LOGS=[];
  async function loadLogs(){
    var tb=document.getElementById('logRows'); tb.innerHTML='<tr><td colspan="5" style="padding:16px;color:var(--muted)">Loading\u2026</td></tr>';
    try{ LOGS=await (await api('/api/logs')).json(); }catch(e){ tb.innerHTML='<tr><td colspan="5" style="padding:16px;color:var(--muted)">Could not load logs.</td></tr>'; return; }
    renderLogs();
  }
  function fmtWhen(iso){ try{var d=new Date(iso);return d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}catch(e){return iso||'';} }
  function renderLogs(){
    var q=(document.getElementById('logSearch').value||'').trim().toLowerCase();
    var rows=(LOGS||[]).filter(function(l){
      if(!q)return true;
      return [l.actor_name,l.actor_role,l.action,l.entity,l.entity_id,l.summary].join(' ').toLowerCase().indexOf(q)>=0;
    });
    var tb=document.getElementById('logRows');
    if(!rows.length){ tb.innerHTML='<tr><td colspan="5" style="padding:16px;color:var(--muted)">No activity'+(q?' matches your search':' yet')+'.</td></tr>'; return; }
    tb.innerHTML=rows.map(function(l){
      return '<tr><td style="white-space:nowrap;color:var(--muted)">'+esc(fmtWhen(l.created_at))+'</td>'
        +'<td>'+esc(l.actor_name||'\u2014')+'</td>'
        +'<td><span class="count">'+esc(l.actor_role||'')+'</span></td>'
        +'<td><span class="mono" style="font-size:11px">'+esc(l.action||'')+'</span></td>'
        +'<td>'+esc(l.summary||'')+'</td></tr>';
    }).join('');
  }
  function loadRoles(){
    var m=ROLE_MATRIX;
    var head='<tr><th style="text-align:left">CAPABILITY</th>'+m.roles.map(function(r){return '<th>'+esc(m.labels[r]||r)+'</th>';}).join('')+'</tr>';
    document.getElementById('rolesHead').innerHTML=head;
    var body=m.caps.map(function(c){
      var cells=m.roles.map(function(r){
        var ok=(r==='admin')||(m.matrix[r]||[]).indexOf(c.key)>=0;
        return '<td style="text-align:center;font-size:15px">'+(ok?'<span style="color:var(--green,#16a34a)">\u2713</span>':'<span style="color:var(--muted);opacity:.4">\u2013</span>')+'</td>';
      }).join('');
      return '<tr><td style="text-align:left"><b>'+esc(c.label)+'</b><div style="color:var(--muted);font-size:12px">'+esc(c.desc)+'</div></td>'+cells+'</tr>';
    }).join('');
    document.getElementById('rolesBody').innerHTML=body;
  }
  function bar(label,pct,cls){return '<div class="barrow"><span class="barlabel">'+label+'</span><div class="bartrack"><div class="barfill '+(cls||'')+'" style="width:'+pct+'%"></div></div><span class="barpct">'+pct+'%</span></div>';}
  async function loadDashboard(){
    var d=await (await api('/api/dashboard')).json(); var t=d.totals;
    function pct(n,tot){return tot?Math.round(n/tot*100):0;}
    function card(label,val,sub,click){return '<div class="statcard'+(click?' clickable':'')+'"'+(click?' onclick="'+click+'"':'')+'><div class="statval">'+val+'</div><div class="statlabel">'+label+'</div>'+(sub?'<div class="statsub">'+sub+'</div>':'')+'</div>';}
    document.getElementById('dashCards').innerHTML=
      card('Jobs',t.jobs)+
      card('Items',t.items,'',"openItemsFiltered('ALL','all')")+
      card('Synced',t.synced,pct(t.synced,t.items)+'% of items',"openItemsFiltered('ALL','synced')")+
      card('Installed',t.installed,pct(t.installed,t.items)+'% of items',"openItemsFiltered('ALL','installed')")+
      card('Open snags',t.openSnags,t.snags+' raised',"openItemsFiltered('ALL','open_snags')")+
      card('Needs re-sync',t.dirty,t.dirty?'changed since sync':'all up to date',"openItemsFiltered('ALL','dirty')")+
      card('Labour',t.labour);
    var bd=d.breakdown||[];
    var bdHtml=bd.length?bd.map(function(s){var p=pct(s.count,t.items);return '<div class="barrow"><span class="barlabel" style="width:120px">'+esc(s.label)+'</span><div class="bartrack"><div class="barfill" style="width:'+p+'%"></div></div><span class="barpct">'+s.count+'</span></div>';}).join(''):'<div style="color:var(--muted);font-size:13px">No items yet.</div>';
    document.getElementById('dashBreakdown').innerHTML='<div class="groupt" style="padding:16px 0 0">INSTALL STATUS</div><div class="jobcard" style="cursor:default">'+bdHtml+'</div>';
    var jc=document.getElementById('dashJobs');jc.innerHTML='';
    d.jobs.forEach(function(j){
      var el=document.createElement('div');el.className='jobcard clickable';
      el.setAttribute('onclick',"openItemsFiltered('"+j.code+"','all')");
      el.innerHTML='<div class="jobtop"><div><b class="mono">'+esc(j.code)+'</b> <span style="color:var(--muted)">'+esc(j.name)+'</span></div>'
        +'<div class="jobmeta">'+(j.board?'<span class="count green">board linked</span>':'<span class="count amber">no board</span>')+' \xB7 '+j.items+' items \xB7 '+j.snags+' snags \xB7 labour '+esc(j.labour)+'</div></div>'
        +bar('Synced',pct(j.synced,j.items),'')+bar('Installed',pct(j.installed,j.items),'green')
        +(j.openSnags?'<div class="opensnag" onclick="event.stopPropagation();openItemsFiltered(\\''+j.code+'\\',\\'open_snags\\')">\u26A0 '+j.openSnags+' open snag'+(j.openSnags>1?'s':'')+' \u2192</div>':'');
      jc.appendChild(el);
    });
  }
  function applyRole(){
    var isAdmin=(myRole==='admin');
    // Hover the name (top-right) to see the signed-in role.
    var wn=document.getElementById('whoName'); if(wn){var lbl=(ROLE_MATRIX&&ROLE_MATRIX.labels&&ROLE_MATRIX.labels[myRole])||myRole; wn.setAttribute('data-role','Role: '+lbl); wn.title='Role: '+lbl;}
    function show(id,ok){var el=document.getElementById(id);if(el)el.style.display=ok?'block':'none';}
    var isCustomer=(myRole==='customer');
    var navEl=document.querySelector('#appView nav.nav'); if(navEl)navEl.style.display=isCustomer?'none':'flex';
    show('tabItems',!isCustomer);
    show('tabMapping',canCap('items.create')&&!isCustomer);
    show('tabUsers',isAdmin);
    show('tabRoles',isAdmin);
    show('tabLogs',isAdmin);
    show('tabDash',canCap('dashboard.view'));
    show('tabTeams',canCap('teams.manage'));
    show('tabSync',canCap('monday.sync'));
    show('tabPlans',canCap('dashboard.view'));
    show('tabCal',canCap('dashboard.view'));
    show('tabBudget',canCap('finance.view'));
    show('tabTests',canCap('dashboard.view'));
    var njb=document.getElementById('newJobBtn'); if(njb)njb.style.display=canCap('jobs.manage')?'inline':'none';
    var nb=document.getElementById('newBtn');if(nb)nb.style.display=canCap('items.create')?'':'none';
  }
  async function loadTeams(){
    var data=await (await api('/api/teams')).json(); canManage=data.canManage;
    document.getElementById('addTeam').style.display=canManage?'flex':'none';
    document.getElementById('teamsNote').style.display=canManage?'none':'block';
    document.getElementById('roleName').textContent=data.role||'user';
    var tb=document.getElementById('teamRows');tb.innerHTML='';
    data.teams.forEach(function(t){
      var tr=document.createElement('tr');
      var name=canManage?'<input class="tname" value="'+(t.name||'').replace(/"/g,'&quot;')+'" onchange="saveTeamName(\\''+t.id+'\\',this.value)">':'<b>'+(t.name||'')+'</b>';
      var rate=canManage?'<input class="trate" type="number" min="0" step="1" value="'+(t.default_rate_pennies/100)+'" onchange="saveTeamRate(\\''+t.id+'\\',this.value)">':t.default_rate;
      var drate=canManage?'<input class="trate" type="number" min="0" step="1" value="'+(((t.door_rate_pennies!=null?t.door_rate_pennies:t.default_rate_pennies))/100)+'" onchange="saveTeamDoorRate(\\''+t.id+'\\',this.value)">':(t.door_rate||'\u2014');
      var retired=(t.active===false);
      var actions='';
      if(canManage){
        if(retired){
          actions='<button class="add" style="padding:5px 11px;font-size:11px" onclick="setTeamActive(\\''+t.id+'\\',true)">Reactivate</button> ';
        } else {
          actions='<button class="del" onclick="setTeamActive(\\''+t.id+'\\',false)" title="Hide from new assignments; keeps existing items">Retire</button> ';
        }
        // Hard delete is only possible when nothing references the team.
        actions+='<button class="del" '+(t.in_use>0?'disabled title="Reassign its items first, or Retire instead"':'')+' onclick="delTeam(\\''+t.id+'\\','+t.in_use+')">Delete</button>';
      }
      var tag=retired?' <span class="count amber">retired</span>':'';
      if(retired)tr.style.opacity='0.6';
      tr.innerHTML='<td>'+name+tag+'</td><td>'+rate+'</td><td>'+drate+'</td><td><span class="count">'+t.in_use+'</span></td><td style="text-align:right;white-space:nowrap">'+actions+'</td>';
      tb.appendChild(tr);
    });
  }
  async function addTeam(){
    var name=document.getElementById('newTeamName').value.trim();
    var pounds=document.getElementById('newTeamRate').value;
    if(!name){tShow('Enter a team name');return;}
    if(pounds===''||Number(pounds)<0){tShow('Enter a valid rate');return;}
    var d=await (await api('/api/teams',{method:'POST',body:JSON.stringify({name:name,rate_pennies:Math.round(Number(pounds)*100)})})).json();
    if(d.ok){document.getElementById('newTeamName').value='';document.getElementById('newTeamRate').value='';tShow('Team added');loadTeams();}
    else tShow(d.error||'Could not add team');
  }
  async function saveTeamName(id,value){if(!value.trim()){tShow('Name required');loadTeams();return;}var d=await (await api('/api/teams/'+id,{method:'PUT',body:JSON.stringify({name:value.trim()})})).json();tShow(d.ok?'Saved':(d.error||'Failed'));}
  async function saveTeamRate(id,value){if(value===''||Number(value)<0){tShow('Invalid rate');loadTeams();return;}var d=await (await api('/api/teams/'+id,{method:'PUT',body:JSON.stringify({rate_pennies:Math.round(Number(value)*100)})})).json();tShow(d.ok?'Windows rate saved':(d.error||'Failed'));}
  async function saveTeamDoorRate(id,value){if(value===''||Number(value)<0){tShow('Invalid rate');loadTeams();return;}var d=await (await api('/api/teams/'+id,{method:'PUT',body:JSON.stringify({door_rate_pennies:Math.round(Number(value)*100)})})).json();tShow(d.ok?'Doors rate saved':(d.error||'Failed'));}
  async function setTeamActive(id,active){
    if(!active&&!confirm('Retire this team? It stays on existing items and reports but is hidden from new assignments. You can reactivate it later.'))return;
    var d=await (await api('/api/teams/'+id,{method:'PUT',body:JSON.stringify({active:active})})).json();
    if(d.ok){tShow(active?'Team reactivated':'Team retired');loadTeams();loadItems();}else tShow(d.error||'Failed');
  }
  async function delTeam(id,inUse){
    if(inUse>0){tShow('Reassign its '+inUse+' item(s) first, or Retire it instead');return;}
    if(!confirm('Delete this team?'))return;
    var r=await api('/api/teams/'+id,{method:'DELETE'});var d=await r.json();
    if(r.ok&&d.ok){tShow('Team deleted');loadTeams();}else tShow(d.error||'Could not delete');
  }

  // ---- Monday sync ----
  async function loadSync(){
    var data=await (await api('/api/sync')).json(); var manage=data.canManage;
    var tb=document.getElementById('syncRows');tb.innerHTML='';
    data.jobs.forEach(function(jb){
      var tr=document.createElement('tr');
      var bhost=(jb.slug?jb.slug+'.monday.com':'monday.com');
      var board=manage
        ? '<input class="board" placeholder="board id or URL" value="'+(jb.board||'')+'" onchange="saveBoard(\\''+jb.code+'\\',this.value)">'
        : (jb.board?'<a class="mlink" target="_blank" href="https://'+bhost+'/boards/'+jb.board+'">'+jb.board+' \u2197</a>':'<span style="color:var(--muted)">not linked</span>');
      var toSync=jb.unsynced>0?'<span class="count amber">'+jb.unsynced+'</span>':'<span class="count">0</span>';
      var canSync=jb.board&&jb.total>0;
      var btn='<button class="syncall" '+(canSync?'':'disabled')+' onclick="syncJob(\\''+jb.code+'\\',this)">Sync all</button>';
      var pull=manage?' <button class="syncall" style="background:#fff;color:var(--purple);border:1px solid #cfc9ea" '+(jb.board?'':'disabled')+' onclick="pullFitters(\\''+jb.code+'\\',this)" title="Read team assignments (Fitters column) and planned install dates (date column) back from Monday">Pull fitters + dates</button>':'';
      tr.innerHTML='<td class="mono"><b>'+jb.code+'</b><div style="font-size:11px;color:var(--muted);font-weight:400">'+(jb.name||'')+'</div></td>'+
        '<td>'+board+'</td><td>'+jb.total+'</td><td><span class="count green">'+jb.synced+'</span></td><td>'+toSync+'</td>'+
        '<td style="text-align:right;white-space:nowrap">'+btn+pull+'</td>';
      tb.appendChild(tr);
    });
  }
  async function saveBoard(code,value){var d=await (await api('/api/job/'+encodeURIComponent(code)+'/board',{method:'PUT',body:JSON.stringify({board:value})})).json();
    if(d.ok){
      var n=(d.columnsCreated||[]).length;
      tShow(d.board?('Board linked'+(n?(' \xB7 '+n+' column'+(n===1?'':'s')+' created'):' \xB7 columns OK')):'Board unlinked');
      loadSync();
    } else tShow(d.error||'Failed');}
  async function syncJob(code,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Syncing\u2026';tShow('Syncing '+code+'\u2026');
    try{var d=await (await api('/api/job/'+encodeURIComponent(code)+'/sync',{method:'POST'})).json();
      if(d.ok){tShow(code+': '+d.created+' created, '+d.updated+' updated'+(d.failed?', '+d.failed+' failed':''));loadSync();}
      else tShow(d.error||'Sync failed');
    }catch(e){tShow('Sync failed');}
    btn.textContent=old;btn.disabled=false;
  }
  async function pullFitters(code,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Pulling\u2026';tShow('Reading fitters from Monday\u2026');
    try{var d=await (await api('/api/job/'+encodeURIComponent(code)+'/pull-fitters',{method:'POST'})).json();
      if(d.ok){var msg=d.assigned+' assigned'+(d.cleared?', '+d.cleared+' cleared':'');
        if(d.datesSet||d.datesCleared)msg+=' \xB7 '+d.datesSet+' date'+(d.datesSet===1?'':'s')+' set'+(d.datesCleared?', '+d.datesCleared+' cleared':'')+(d.dateColumn?' (from "'+d.dateColumn+'")':'');
        else if(!d.dateColumn)msg+=' \xB7 no date column found';
        if(d.unmatched&&d.unmatched.length)msg+=' \xB7 unknown team'+(d.unmatched.length>1?'s':'')+': '+d.unmatched.join(', ');
        tShow(msg);loadItems();}
      else tShow(d.error||'Pull failed');
    }catch(e){tShow('Pull failed');}
    btn.textContent=old;btn.disabled=false;
  }

  // ---- Plans (plan view with item pins) ----
  var planData={plans:[],items:[],canManage:false,canPin:false}; var curPlanId=null; var armedItem=null; var planFilter='all';
  function statusColor(s){return s==='installed_no_snag'?'#16a34a':((s==='snag'||s==='installed_snag'||s==='misfit')?'#e6187e':(s?'#d97706':'#8b88a3'));}
  async function loadPlansTab(){
    var sel=document.getElementById('planJob');
    var jobs=await (await api('/api/jobs')).json();
    sel.innerHTML=jobs.map(function(j){return '<option value="'+j.code+'">'+esc(j.code)+' \u2014 '+esc(j.name)+'</option>';}).join('');
    if(current&&jobs.some(function(j){return j.code===current;}))sel.value=current;
    await loadPlans();
  }
  async function loadPlans(){
    var code=document.getElementById('planJob').value; if(!code)return;
    armedItem=null; document.getElementById('planArm').style.display='none';
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/plans')).json();
    planData=d;
    var ps=document.getElementById('planSel');
    ps.innerHTML=d.plans.map(function(pl){return '<option value="'+pl.id+'">'+esc(pl.name)+'</option>';}).join('');
    if(!d.plans.length)curPlanId=null;
    else if(!d.plans.some(function(pl){return pl.id===curPlanId;}))curPlanId=d.plans[0].id;
    ps.value=curPlanId||'';
    document.getElementById('planUploadBtn').style.display=d.canManage?'':'none';
    var mw=document.getElementById('multiPlanWrap');mw.style.display=d.canManage?'flex':'none';
    document.getElementById('multiPlanChk').checked=!!d.multiPlan;
    renderPlan(); renderPlanItems();
  }
  async function downloadReport(type){
    var code=document.getElementById('planJob').value; if(!code){tShow('Pick a job first');return;}
    var btnId=type==='install'?'rptInstallBtn':(type==='customer_install'?'rptCustInstallBtn':'rptSurveyBtn');
    var btn=document.getElementById(btnId); var was=btn.textContent; btn.textContent='Building\u2026'; btn.disabled=true;
    try{
      var r=await fetch('/api/job/'+encodeURIComponent(code)+'/report.pdf?type='+type,{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){var e={};try{e=await r.json();}catch(_){}tShow(e.error||'Report failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download=code+'-'+type+'-report.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000);
      tShow((type==='install'?'Install':'Survey')+' PDF downloaded');
    }catch(err){tShow('Report failed');}
    finally{btn.textContent=was; btn.disabled=false;}
  }
  async function setMultiPlan(v){
    var r=await (await api('/api/settings/pins-multi-plan',{method:'PUT',body:JSON.stringify({value:v})})).json();
    if(r.ok){planData.multiPlan=v;tShow(v?'Items can be on multiple plans':'One plan per item');renderPlanItems();}
    else{tShow(r.error||'Failed');document.getElementById('multiPlanChk').checked=!v;}
  }
  function planName(id){var p=(planData.plans||[]).find(function(x){return x.id===id;});return p?p.name:'another plan';}
  function currentPlan(){return planData.plans.find(function(p){return p.id===curPlanId;});}
  function renderPlan(){
    curPlanId=document.getElementById('planSel').value||curPlanId;
    var pl=currentPlan(); var img=document.getElementById('planImg'); var empty=document.getElementById('planEmpty');
    document.getElementById('planDelBtn').style.display=(planData.canManage&&curPlanId)?'':'none';
    if(!pl||!pl.url){img.style.display='none';empty.style.display='block';document.getElementById('planPins').innerHTML='';return;}
    empty.style.display='none';img.style.display='block';img.src=pl.url; renderPins();
  }
  function renderPins(){
    var host=document.getElementById('planPins');host.innerHTML='';
    planData.items.forEach(function(it){
      if(it.plan_id!==curPlanId||it.plan_x==null||it.plan_y==null)return;
      var d=document.createElement('div');d.className='pin'+(armedItem===it.id?' sel':'');
      d.style.left=(it.plan_x*100)+'%';d.style.top=(it.plan_y*100)+'%';
      d.innerHTML='<div class="dot" style="background:'+statusColor(it.install_status)+'"></div><div class="lbl">'+esc(it.item_code||it.full_code||'')+'</div>';
      d.onclick=function(e){e.stopPropagation(); if(armedItem)placePin(e); else openDetail(it.id);};
      host.appendChild(d);
    });
  }
  function planClick(e){ if(armedItem)placePin(e); }
  async function placePin(e){
    if(!armedItem||!curPlanId)return;
    var img=document.getElementById('planImg');var r=img.getBoundingClientRect();
    var x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    var y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
    var id=armedItem;
    var d=await (await api('/api/item/'+id+'/pin',{method:'PUT',body:JSON.stringify({plan_id:curPlanId,x:x,y:y})})).json();
    if(!d.ok){tShow(d.error||'Could not place pin');return;}
    var it=planData.items.find(function(i){return i.id===id;}); if(it){it.plan_id=curPlanId;it.plan_x=x;it.plan_y=y;}
    armedItem=null;document.getElementById('planArm').style.display='none';
    renderPins();renderPlanItems();tShow('Pin placed');
  }
  function armItem(id){
    if(!planData.canPin){tShow('Your role can\u2019t place pins');return;}
    if(!curPlanId){tShow('Upload a plan first');return;}
    var it=planData.items.find(function(i){return i.id===id;});
    if(it&&it.plan_id&&it.plan_id!==curPlanId&&!planData.multiPlan){tShow('Already on '+planName(it.plan_id)+' \u2014 unpin it there first');return;}
    armedItem=(armedItem===id)?null:id;
    var arm=document.getElementById('planArm');
    if(armedItem){var it=planData.items.find(function(i){return i.id===armedItem;});arm.style.display='block';arm.innerHTML='Click the plan to place <b>'+esc(it.item_code||it.full_code)+'</b>  \xB7  <a style="color:#fff;text-decoration:underline;cursor:pointer" onclick="armItem(\\''+id+'\\')">cancel</a>';}
    else arm.style.display='none';
    renderPins();renderPlanItems();
  }
  async function unpin(id,ev){ ev.stopPropagation(); await api('/api/item/'+id+'/pin',{method:'PUT',body:JSON.stringify({plan_id:null})}); var it=planData.items.find(function(i){return i.id===id;}); if(it){it.plan_id=null;it.plan_x=null;it.plan_y=null;} renderPins();renderPlanItems();tShow('Pin removed'); }
  function setPlanFilter(f){planFilter=f;document.querySelectorAll('#plansView .planfilter .chip').forEach(function(c){c.classList.toggle('on',c.getAttribute('data-pf')===f);});renderPlanItems();}
  function renderPlanItems(){
    var host=document.getElementById('planItems');
    var items=planData.items.filter(function(it){
      var placed=(it.plan_id===curPlanId&&it.plan_x!=null);
      if(planFilter==='placed')return placed;
      if(planFilter==='unplaced')return !it.plan_id; // not on ANY plan
      return true;
    });
    document.getElementById('planCount').textContent='('+items.length+')';
    host.innerHTML=items.map(function(it){
      var placed=(it.plan_id===curPlanId&&it.plan_x!=null);
      var elsewhere=(it.plan_id&&it.plan_id!==curPlanId);
      var action;
      if(placed) action='<span class="pact punpin" onclick="unpin(\\''+it.id+'\\',event)">unpin</span>';
      else if(elsewhere&&!planData.multiPlan) action='<span class="pact" style="color:var(--muted)">on '+esc(planName(it.plan_id))+'</span>';
      else action='<span class="pact pplace">place \u203A</span>';
      return '<div class="pitem'+(armedItem===it.id?' armed':'')+'" onclick="armItem(\\''+it.id+'\\')">'
        +'<span class="pdot" style="background:'+statusColor(it.install_status)+'"></span>'
        +'<span class="pcode">'+esc(it.full_code||it.item_code||'')+'</span>'
        +action
        +'</div>';
    }).join('')||'<div style="padding:14px;color:var(--muted);font-size:12px">No items.</div>';
  }
  async function uploadPlan(input){
    var f=input.files&&input.files[0]; input.value=''; if(!f)return;
    var code=document.getElementById('planJob').value;
    if(!code){tShow('Pick a job first');return;}
    if(!confirm('Add this plan to job '+code+'?\\n\\n(Plans belong to the job selected above \u2014 switch the job first if this is wrong.)'))return;
    var name=prompt('Plan name (e.g. Ground floor, Elevation E1):', f.name.replace(/\\.[^.]+$/,''))||'Plan';
    var reader=new FileReader();
    reader.onload=async function(){
      document.getElementById('planMsg').textContent='Uploading\u2026';
      var d=await (await api('/api/job/'+encodeURIComponent(code)+'/plans',{method:'POST',body:JSON.stringify({name:name,image:reader.result})})).json();
      document.getElementById('planMsg').textContent='';
      if(d.ok){curPlanId=d.id;await loadPlans();tShow('Plan uploaded');}else tShow(d.error||'Upload failed');
    };
    reader.readAsDataURL(f);
  }
  async function deletePlan(){
    if(!curPlanId||!confirm('Delete this plan? Item pins on it will be cleared.'))return;
    var d=await (await api('/api/plans/'+curPlanId,{method:'DELETE'})).json();
    if(d.ok){curPlanId=null;await loadPlans();tShow('Plan deleted');}else tShow(d.error||'Failed');
  }

  // ---- user management (admin only) ----
  var myId='';
  async function loadUsers(){
    var data=await (await api('/api/users')).json();
    var tb=document.getElementById('userRows');
    if(data.error){tb.innerHTML='<tr><td colspan="8" style="padding:16px;color:var(--muted)">'+esc(data.error)+'</td></tr>';return;}
    myId=data.me; var allTeams=data.teams||[];
    if(data.roles&&data.roles.length)USER_ROLES=data.roles; // single source of truth from the server (incl. invoice_manager)
    function roleLabel(r){return r==='invoice_manager'?'invoice manager':r;}
    var nr=document.getElementById('nuRole');
    nr.innerHTML=USER_ROLES.map(function(r){return '<option value="'+r+'"'+(r==='surveyor'?' selected':'')+'>'+roleLabel(r)+'</option>';}).join('');
    tb.innerHTML='';
    data.users.forEach(function(u){
      var self=u.id===myId;
      var attr=function(s){return esc(s).replace(/"/g,'&quot;');};
      var nameInput='<input class="tname" value="'+attr(u.name)+'" onchange="saveUserField(\\''+u.id+'\\',\\'name\\',this.value)">';
      var emailInput='<input class="tname" style="width:205px" value="'+attr(u.email)+'" onchange="saveUserField(\\''+u.id+'\\',\\'email\\',this.value)">';
      var roleSel='<select class="sel" '+(self?'disabled':'')+' onchange="saveUserField(\\''+u.id+'\\',\\'role\\',this.value)">'+USER_ROLES.map(function(r){return opt(r,roleLabel(r),u.role)}).join('')+'</select>';
      var teamOpts='<option value="">\u2014 none \u2014</option>'+allTeams.filter(function(t){return t.active!==false||t.id===u.team_id;}).map(function(t){return '<option value="'+t.id+'"'+(u.team_id===t.id?' selected':'')+'>'+esc(t.name)+(t.active===false?' (retired)':'')+'</option>';}).join('');
      var teamSel='<select class="sel" onchange="saveUserField(\\''+u.id+'\\',\\'team_id\\',this.value)">'+teamOpts+'</select>';
      var clientCell=(u.role==='customer')
        ? '<input class="tname" style="width:80px;text-transform:uppercase" placeholder="e.g. AXS" value="'+attr(u.client_code||'')+'" onchange="saveUserField(\\''+u.id+'\\',\\'client_code\\',this.value)">'
        : '<span style="color:var(--muted)">\u2014</span>';
      var login=u.has_login?'<span class="count green">yes</span>':'<span class="count">no</span>';
      var status=u.active?'<span class="count green">active</span>':'<span class="count amber">inactive</span>';
      var actions;
      if(self){actions='<span style="color:var(--muted);font-size:11px">you</span>';}
      else{
        actions='<button class="del" style="color:var(--purple);border-color:#cfc9ea" onclick="resetPw(\\''+u.id+'\\')">Reset password</button> '
          +(u.active?'<button class="del" onclick="toggleUserActive(\\''+u.id+'\\',false)">Deactivate</button>'
                    :'<button class="add" style="padding:5px 11px;font-size:11px" onclick="toggleUserActive(\\''+u.id+'\\',true)">Reactivate</button>');
      }
      var tr=document.createElement('tr');
      tr.innerHTML='<td>'+nameInput+'</td><td>'+emailInput+'</td><td>'+roleSel+'</td><td>'+clientCell+'</td><td>'+teamSel+'</td><td>'+login+'</td><td>'+status+'</td><td style="text-align:right;white-space:nowrap">'+actions+'</td>';
      tb.appendChild(tr);
    });
  }
  async function addUser(){
    var name=document.getElementById('nuName').value.trim(), email=document.getElementById('nuEmail').value.trim();
    var role=document.getElementById('nuRole').value, pass=document.getElementById('nuPass').value.trim();
    var errEl=document.getElementById('userErr');errEl.textContent='';
    if(!name||!email){errEl.textContent='Name and email are required.';return;}
    var d=await (await api('/api/users',{method:'POST',body:JSON.stringify({name:name,email:email,role:role,password:pass})})).json();
    if(d.ok){document.getElementById('nuName').value='';document.getElementById('nuEmail').value='';document.getElementById('nuPass').value='';showCreds(d.email,d.password,false);loadUsers();}
    else{errEl.textContent=d.error||'Could not add user';tShow('Could not add user');}
  }
  async function saveUserField(id,field,value){var b={};b[field]=value;var d=await (await api('/api/users/'+id,{method:'PUT',body:JSON.stringify(b)})).json();if(d.ok){tShow('Saved');if(field==='role')loadUsers();}else{tShow(d.error||'Update failed');loadUsers();}}
  async function toggleUserActive(id,active){var d=await (await api('/api/users/'+id,{method:'PUT',body:JSON.stringify({active:active})})).json();if(d.ok){tShow(active?'Reactivated':'Deactivated');loadUsers();}else tShow(d.error||'Failed');}
  async function resetPw(id){if(!confirm('Reset this user\\'s password?'))return;var d=await (await api('/api/users/'+id+'/reset',{method:'POST'})).json();if(d.ok)showCreds(d.email,d.password,true);else tShow(d.error||'Failed');}
  function showCreds(email,password,isReset){
    var html='<div style="padding:20px 22px">'
      +'<p style="font-size:13px;color:var(--muted);margin-bottom:14px">'+(isReset?'Password reset. ':'Login created. ')+'Share these securely \u2014 the password is shown only once.</p>'
      +'<div class="drow"><dt>Email</dt><dd class="mono">'+esc(email)+'</dd></div>'
      +'<div class="drow"><dt>Password</dt><dd class="mono"><b>'+esc(password)+'</b></dd></div></div>'
      +'<div class="foot"><button class="cancel" onclick="copyCreds(\\''+esc(email)+'\\',\\''+esc(password)+'\\')">Copy</button><button class="save" onclick="closeModal()">Done</button></div>';
    openModal(isReset?'New password':'Login created',html);
  }
  function copyCreds(email,password){if(navigator.clipboard)navigator.clipboard.writeText(email+'  '+password);tShow('Copied');}

  // ---- modal, create item, item detail ----
  function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function openModal(title,html){document.getElementById('modalTitle').innerHTML=title;document.getElementById('modalBody').innerHTML=html;document.getElementById('modal').style.display='grid';}
  function closeModal(){document.getElementById('modal').style.display='none';}
  function field(id,label,ph,type){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" placeholder="'+(ph||'')+'"></div>';}
  function openCreate(){
    var topts='<option value="">\u2014 no team \u2014</option>'+teamOptionList('');
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="codePrev">'+current+'</div>'
      +'<div class="groupt">LOCATION</div>'
      +field('f_block','Block','e.g. 1 \u2192 B1')+field('f_elev','Elevation','e.g. 1 \u2192 E1')
      +field('f_flat','Flat / plot','e.g. 21 \u2192 F21')+field('f_floor','Floor','e.g. 1 \u2192 F1')
      +'<div class="field"><label>Room *</label><select id="f_room">'+roomOptions('')+'</select></div>'+field('f_item','Item *','e.g. W02')
      +'<div class="groupt">SPECIFICATION</div>'
      +'<div class="field full"><label>Design code (Clearview style)</label>'
        +'<div style="display:flex;gap:8px;align-items:center">'
          +'<input id="f_design" type="text" placeholder="e.g. 27" style="flex:1" oninput="stylePreview()">'
          +'<button type="button" class="add" onclick="openStylePicker()">Choose style\u2026</button>'
          +'<img id="f_design_prev" alt="" style="display:none;width:46px;height:46px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff">'
        +'</div></div>'
      +field('f_material','Material','uPVC / Alu / Timber')+field('f_type','Item type','Window / Door')
      +field('f_wtype','Window type','e.g. Casement')+field('f_glass','Glass','e.g. 4-20-4')
      +field('f_safety','Safety glass','Toughened / Laminated')+field('f_glazing','Glazing','Double / Triple')
      +field('f_width','Width (mm)','','number')+field('f_height','Height inc cill (mm)','','number')
      +field('f_cill','Cill depth (mm)','','number')+field('f_openinout','Open in / out','In / Out')
      +field('f_t1','Transom 1 (mm)','','number')+field('f_t2','Transom 2 (mm)','','number')
      +field('f_t3','Transom 3 (mm)','','number')+field('f_m1','Mullion 1 (mm)','','number')
      +field('f_m2','Mullion 2 (mm)','','number')+field('f_m3','Mullion 3 (mm)','','number')
      +field('f_coupled','Coupled','e.g. to W03')+field('f_addons','Add-ons','Trickle vents / etc')
      +'<div class="field"><label>Team</label><select id="f_team">'+topts+'</select></div>'
      +'<div class="field full"><label>Comments</label><textarea id="f_comments" rows="2"></textarea></div>'
      +'<div class="ferr" id="createErr"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="submitCreate()">Create item</button></div>';
    openModal('New survey item',html);
    // The code-building location fields auto-capitalise as you type. Block / Elevation / Flat
    // also auto-prefix their letter (B / E / F) so you just type the number.
    var PFX={f_block:'B',f_elev:'E',f_flat:'F',f_floor:'F'};
    ['f_block','f_elev','f_flat','f_floor','f_item'].forEach(function(id){
      var el=document.getElementById(id);
      el.addEventListener('input',function(){
        var p=PFX[id];
        if(p){ applyPfx(el,p); } else { var u=el.value.toUpperCase(); if(u!==el.value){var s=el.selectionStart;el.value=u;try{el.setSelectionRange(s,s);}catch(_){}} }
        calcCode();
      });
    });
    document.getElementById('f_room').addEventListener('change',calcCode); // room is a picker
    calcCode();
  }
  function calcCode(){
    function g(id){return (document.getElementById(id).value||'').trim();}
    var flat=g('f_flat');flat=flat?('F'+flat.replace(/\\D/g,'')):'';
    var parts=[current].concat([g('f_block'),g('f_elev'),flat,g('f_room').toUpperCase(),g('f_item').toUpperCase(),g('f_floor')].filter(function(x){return x;}));
    document.getElementById('codePrev').textContent=parts.join('.');
  }
  async function submitCreate(){
    function g(id){return (document.getElementById(id).value||'').trim();}
    // Flat is shown with an F prefix for readability, but stored as the bare number (the code adds F).
    var flatVal=g('f_flat').replace(/^F/,'');
    var body={job:current,block:g('f_block'),elevation:g('f_elev'),flat:flatVal,floor:g('f_floor'),room:g('f_room'),item:g('f_item'),
      design_code:g('f_design'),material:g('f_material'),item_type:g('f_type'),window_type:g('f_wtype'),
      glass:g('f_glass'),safety_glass:g('f_safety'),glazing:g('f_glazing'),
      width_mm:g('f_width'),height_mm:g('f_height'),cill_depth_mm:g('f_cill'),open_in_out:g('f_openinout'),
      transom1_mm:g('f_t1'),transom2_mm:g('f_t2'),transom3_mm:g('f_t3'),
      mullion1_mm:g('f_m1'),mullion2_mm:g('f_m2'),mullion3_mm:g('f_m3'),
      coupled:g('f_coupled'),add_ons:g('f_addons'),
      comments:g('f_comments'),team_id:document.getElementById('f_team').value};
    if(!body.room||!body.item){document.getElementById('createErr').textContent='Room and Item are required.';return;}
    var r=await api('/api/items',{method:'POST',body:JSON.stringify(body)});var d=await r.json();
    if(r.ok&&d.ok){if(body.room)ROOM_STATS[body.room]=(ROOM_STATS[body.room]||0)+1;closeModal();tShow('Created '+d.full_code);loadItems();}
    else document.getElementById('createErr').textContent=d.error||'Could not create item';
  }
  // ---- Install calendar (office-wide) ----
  var CAL_DATA={items:[],teams:[]}; var calCursor=new Date(); calCursor.setDate(1); var calSel=null; var calTeamId='';
  function calIso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function calMonthGrid(cur){var first=new Date(cur.getFullYear(),cur.getMonth(),1);var back=(first.getDay()+6)%7;var start=new Date(first);start.setDate(1-back);var out=[];for(var i=0;i<42;i++){var d=new Date(start);d.setDate(start.getDate()+i);out.push(calIso(d));}return out;}
  async function loadCalendar(){
    document.querySelector('#calView .calweek').innerHTML=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(w){return '<span>'+w+'</span>';}).join('');
    try{CAL_DATA=await (await api('/api/calendar')).json();}catch(e){CAL_DATA={items:[],teams:[]};}
    var sel=document.getElementById('calTeam');
    sel.innerHTML='<option value="">All teams</option>'+CAL_DATA.teams.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join('');
    sel.value=calTeamId;
    if(!calSel)calSel=calIso(new Date());
    renderCalendar();
  }
  function calShift(n){calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()+n,1);renderCalendar();}
  function calFiltered(){return CAL_DATA.items.filter(function(it){return !calTeamId||it.team_id===calTeamId;});}
  function calByDay(){var m={};calFiltered().forEach(function(it){(m[it.date]=m[it.date]||[]).push(it);});return m;}
  function calDayColor(list){
    if(list.some(function(x){return x.install_status==='snag'||x.install_status==='misfit'||x.install_status==='installed_snag';}))return '#e6187e';
    if(list.every(function(x){return x.install_status==='installed_no_snag';}))return '#16a34a';
    return '#d97706';
  }
  function renderCalendar(){
    calTeamId=document.getElementById('calTeam').value;
    document.getElementById('calMonth').textContent=calCursor.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    var byDay=calByDay(); var todayIso=calIso(new Date()); var mo=calCursor.getMonth();
    document.getElementById('calGrid').innerHTML=calMonthGrid(calCursor).map(function(day){
      var list=byDay[day]||[]; var inMonth=Number(day.slice(5,7))===mo+1;
      var cls='calcell'+(inMonth?'':' out')+(day===todayIso?' today':'')+(day===calSel?' sel':'');
      var pill=list.length?'<span class="calpill" style="background:'+calDayColor(list)+'">'+list.length+'</span>':'';
      return '<div class="'+cls+'" onclick="calPick(\\''+day+'\\')"><span class="caldd">'+Number(day.slice(8,10))+'</span>'+pill+'</div>';
    }).join('');
    document.getElementById('calMsg').textContent=calFiltered().length+' scheduled';
    renderCalSel();
  }
  function calPick(day){calSel=day;renderCalendar();}
  function renderCalSel(){
    var head=document.getElementById('calSelHead');
    if(!calSel){head.textContent='';document.getElementById('calSel').innerHTML='';return;}
    var byDay=calByDay(); var list=(byDay[calSel]||[]).slice().sort(function(a,b){return (a.job+a.full_code).localeCompare(b.job+b.full_code);});
    var d=new Date(calSel+'T00:00:00');
    head.textContent=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})+(list.length?('  \\u00b7  '+list.length):'');
    document.getElementById('calSel').innerHTML=list.length?list.map(function(it){
      var col=statusColor(it.install_status);
      return '<div class="calitem" onclick="openDetail(\\''+it.id+'\\')"><span class="caldot" style="background:'+col+'"></span>'
        +'<div class="cimain"><div class="ccode">'+esc(it.full_code||'')+'</div>'
        +'<div class="cmeta">'+esc(it.job)+(it.jobName?(' \\u00b7 '+esc(it.jobName)):'')+' \\u00b7 '+esc(it.room_code||'\u2014')+'/'+esc(it.item_code||'\u2014')+(it.team?(' \\u00b7 '+esc(it.team)):'')+'</div></div>'
        +'<span class="cstat" style="color:'+col+';border-color:'+col+'">'+esc(istatLabel(it.install_status))+'</span></div>';
    }).join(''):'<div class="empty" style="padding:8px 0">Nothing scheduled this day.</div>';
  }

  // ---- Budget & pricing rules (admin / invoice_manager) ----
  var RULES=[];
  var DEFAULT_PARAMS={material:{window_frame_per_m2:13000,window_glass_per_m2:3000,door_frame_per_unit:34000,door_glass_per_unit:3000},labour:{window_per_unit:8000,door_per_unit:12000},sale:{rate_per_flat:315900,rate_per_door:135000,rate_per_m2_extra:32400,windows_included_per_flat:5}};
  function gbp(pennies){return '\xA3'+((pennies||0)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function av(s){return esc(s).replace(/"/g,'&quot;');}
  async function loadBudget(){
    try{RULES=await (await api('/api/pricing-rules')).json();}catch(e){RULES=[];}
    var tb=document.getElementById('ruleRows');
    tb.innerHTML=RULES.length?RULES.map(function(r){var s=(r.params&&r.params.sale)||{};
      return '<tr><td><b>'+esc(r.name)+'</b></td><td>'+esc(r.customer||'\u2014')+'</td><td class="ro">'+esc(r.model)+'</td>'
        +'<td>'+gbp(s.rate_per_flat)+'</td><td>'+gbp(s.rate_per_door)+'</td><td>'+gbp(s.rate_per_m2_extra)+'</td>'
        +'<td style="text-align:right"><a class="codelink" onclick="openRule(\\''+r.id+'\\')">Edit</a> &nbsp; <a class="codelink" onclick="delRule(\\''+r.id+'\\')">Delete</a></td></tr>';
    }).join(''):'<tr><td colspan="7" class="ro">No pricing rules yet \u2014 create one to price a customer\\'s jobs.</td></tr>';
    // job pricing selector
    var jsel=document.getElementById('fpJob');
    var jobs=await (await api('/api/jobs')).json();
    var keep=jsel.value;
    jsel.innerHTML=jobs.map(function(j){return '<option value="'+j.code+'">'+esc(j.code)+' \u2014 '+esc(j.name)+'</option>';}).join('');
    if(keep)jsel.value=keep;
    await loadJobPricing();
  }
  async function loadJobPricing(){
    var code=document.getElementById('fpJob').value; if(!code){document.getElementById('fpBreak').innerHTML='';return;}
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/pricing')).json();
    var rsel=document.getElementById('fpRule');
    rsel.innerHTML='<option value="">\u2014 none \u2014</option>'+(d.rules||[]).map(function(r){return '<option value="'+r.id+'">'+esc(r.name)+'</option>';}).join('');
    rsel.value=d.rule_id||'';
    renderBreak(d);
  }
  async function assignRule(){
    var code=document.getElementById('fpJob').value; var rid=document.getElementById('fpRule').value;
    var r=await api('/api/job/'+encodeURIComponent(code)+'/pricing',{method:'PUT',body:JSON.stringify({rule_id:rid||null})});
    var d=await r.json(); if(r.ok&&d.ok){tShow(rid?'Rule assigned':'Rule cleared');loadJobPricing();}else tShow(d.error||'Failed');
  }
  function renderBreak(d){
    var host=document.getElementById('fpBreak');
    if(!d.rule_id){host.innerHTML='<div class="ro" style="padding:14px 2px">No rule assigned to this job yet \u2014 pick one above to price it.</div>';return;}
    var b=d.breakdown;
    if(!b){host.innerHTML='<div class="ro" style="padding:14px 2px">The assigned rule has no parameters yet. Edit it above.</div>';return;}
    var marginPct=b.saleTotal?Math.round(b.margin/b.saleTotal*100):0;
    var card=function(v,l,s,warn){return '<div class="stat'+(warn?' warn':'')+'"><div class="v">'+v+'</div><div class="l">'+l+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';};
    var cards='<div class="statgrid" style="margin:14px 0">'
      +card(gbp(b.saleTotal),'Customer price','')
      +card(gbp(b.costTotal),'Our cost (budget)','')
      +card(gbp(b.margin),'Margin',marginPct+'%',b.margin<0)+'</div>';
    var rows=b.flats.map(function(f){
      return '<tr><td><b>'+esc(f.flat)+'</b></td><td>'+f.windows+'</td><td>'+gbp(f.base)+'</td>'
        +'<td>'+(f.extraWindows?(f.extraWindows+' \xB7 '+f.extraM2+' m\xB2'):'\u2014')+'</td>'
        +'<td>'+(f.extraAmount?gbp(f.extraAmount):'\u2014')+'</td><td><b>'+gbp(f.total)+'</b></td></tr>';
    }).join('');
    var extra='';
    if(b.doors.count)extra+='<tr><td colspan="5">Doors \xD7 '+b.doors.count+'</td><td><b>'+gbp(b.doors.amount)+'</b></td></tr>';
    if(b.communal.windows)extra+='<tr><td colspan="5">Communal windows \xD7 '+b.communal.windows+' ('+b.communal.m2+' m\xB2)</td><td><b>'+gbp(b.communal.amount)+'</b></td></tr>';
    if(b.variationsTotal)extra+='<tr><td colspan="5">Variations \xD7 '+b.variations.length+'</td><td><b>'+gbp(b.variationsTotal)+'</b></td></tr>';
    var table='<div class="card2"><table><thead><tr><th>FLAT</th><th>WINDOWS</th><th>BASE</th><th>EXTRA (biggest)</th><th>EXTRA \xA3</th><th>FLAT TOTAL</th></tr></thead><tbody>'
      +rows+extra
      +'<tr style="border-top:2px solid var(--line)"><td colspan="5" style="text-align:right"><b>Customer price</b></td><td><b>'+gbp(b.saleTotal)+'</b></td></tr></tbody></table></div>';
    var itemsHtml='';
    if(d.items&&d.items.length){
      itemsHtml='<h4 style="margin:22px 0 6px;color:var(--purple)">Variations</h4>'
        +'<div class="sub" style="margin-bottom:8px">Tick an item to price it as a variation (a manually-agreed amount). Variations are billed separately and leave the flat\\'s fixed scope.</div>'
        +'<div class="card2"><table><thead><tr><th>ITEM</th><th>TYPE</th><th>FLAT</th><th>VARIATION</th><th>AMOUNT (\xA3)</th></tr></thead><tbody>'
        +d.items.map(function(it){
          return '<tr><td class="mono">'+esc(it.full_code||'')+'</td><td class="ro">'+esc(it.category)+'</td><td>'+esc(it.flat||'\u2014')+'</td>'
            +'<td><input type="checkbox" id="var_'+it.id+'" '+(it.is_variation?'checked':'')+' onchange="saveItemVar(\\''+it.id+'\\')" style="width:15px;height:15px;accent-color:var(--magenta)"></td>'
            +'<td><input id="vamt_'+it.id+'" type="number" min="0" step="0.01" value="'+(it.is_variation&&it.variation_amount?(it.variation_amount/100):'')+'" '+(it.is_variation?'':'disabled')+' onchange="saveItemVar(\\''+it.id+'\\')" style="width:92px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px"></td></tr>';
        }).join('')+'</tbody></table></div>';
    }
    host.innerHTML=cards+table+itemsHtml;
  }
  async function downloadPricePdf(){
    var code=document.getElementById('fpJob').value; if(!code){tShow('Pick a job first');return;}
    var btn=document.getElementById('fpPdfBtn'); var was=btn.textContent; btn.textContent='Building\u2026'; btn.disabled=true;
    try{
      var r=await fetch('/api/job/'+encodeURIComponent(code)+'/price.pdf',{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){var e={};try{e=await r.json();}catch(_){}tShow(e.error||'Export failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download=code+'-price-breakdown.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000); tShow('Price PDF downloaded');
    }catch(err){tShow('Export failed');}
    finally{btn.textContent=was; btn.disabled=false;}
  }
  async function saveItemVar(id){
    var isVar=document.getElementById('var_'+id).checked;
    var amtEl=document.getElementById('vamt_'+id); amtEl.disabled=!isVar;
    var amt=(amtEl.value===''||isNaN(parseFloat(amtEl.value)))?null:Math.round(parseFloat(amtEl.value)*100);
    var r=await api('/api/item/'+id+'/pricing',{method:'PUT',body:JSON.stringify({is_variation:isVar,variation_amount_pennies:amt})});
    var d=await r.json();
    if(r.ok&&d.ok){tShow('Saved');loadJobPricing();}else tShow(d.error||'Failed');
  }
  function rMoney(id,label,pennies){return '<div class="field"><label>'+label+' (\xA3)</label><input id="'+id+'" type="number" min="0" step="0.01" value="'+((pennies||0)/100)+'"></div>';}
  function rNum(id,label,val){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="number" min="0" step="1" value="'+(val==null?'':val)+'"></div>';}
  function openRule(id){
    var r=id?RULES.find(function(x){return x.id===id;}):null;
    var p=(r&&r.params&&r.params.sale)?r.params:JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    var m=p.material||{},l=p.labour||{},sa=p.sale||{};
    var html='<div class="fgrid">'
      +'<div class="field full"><label>Rule name *</label><input id="r_name" value="'+av(r?r.name:'')+'" placeholder="e.g. Axis \u2014 standard"></div>'
      +'<div class="field full"><label>Customer</label><input id="r_customer" value="'+av(r?(r.customer||''):'')+'" placeholder="Customer / client name"></div>'
      +'<div class="groupt">MATERIAL COST (our purchase)</div>'
      +rMoney('r_wfm','Windows \u2014 frame / m\xB2',m.window_frame_per_m2)+rMoney('r_wgm','Windows \u2014 glass / m\xB2',m.window_glass_per_m2)
      +rMoney('r_dfu','Single door \u2014 frame / unit',m.door_frame_per_unit)+rMoney('r_dgu','Single door \u2014 glass / unit',m.door_glass_per_unit)
      +'<div class="groupt">LABOUR COST \u2014 rip-out (budget, not fitter pay)</div>'
      +rMoney('r_wl','Window / unit',l.window_per_unit)+rMoney('r_dl','Single door / unit',l.door_per_unit)
      +'<div class="groupt">SALE RATES (customer price)</div>'
      +rMoney('r_rf','Rate per flat',sa.rate_per_flat)+rMoney('r_rd','Rate per door',sa.rate_per_door)
      +rMoney('r_rm','Rate per m\xB2 (communal / extra windows)',sa.rate_per_m2_extra)+rNum('r_wi','Windows included per flat',sa.windows_included_per_flat)
      +'<div class="ferr" id="ruleErr"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="saveRule(\\''+(id||'')+'\\')">Save rule</button></div>';
    openModal(id?'Edit pricing rule':'New pricing rule',html);
  }
  function pval(id){var v=parseFloat(document.getElementById(id).value);return isNaN(v)?0:Math.round(v*100);}
  function ival(id){var v=parseInt(document.getElementById(id).value,10);return isNaN(v)?0:v;}
  async function saveRule(id){
    var name=(document.getElementById('r_name').value||'').trim();
    if(!name){document.getElementById('ruleErr').textContent='Rule name is required.';return;}
    var params={material:{window_frame_per_m2:pval('r_wfm'),window_glass_per_m2:pval('r_wgm'),door_frame_per_unit:pval('r_dfu'),door_glass_per_unit:pval('r_dgu')},
      labour:{window_per_unit:pval('r_wl'),door_per_unit:pval('r_dl')},
      sale:{rate_per_flat:pval('r_rf'),rate_per_door:pval('r_rd'),rate_per_m2_extra:pval('r_rm'),windows_included_per_flat:ival('r_wi')}};
    var body={name:name,customer:(document.getElementById('r_customer').value||'').trim(),model:'axs_flat_v1',params:params};
    var r=id?await api('/api/pricing-rules/'+id,{method:'PUT',body:JSON.stringify(body)}):await api('/api/pricing-rules',{method:'POST',body:JSON.stringify(body)});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Rule saved');loadBudget();}
    else document.getElementById('ruleErr').textContent=d.error||'Could not save';
  }
  async function delRule(id){
    if(!confirm('Delete this pricing rule? Jobs using it will become unpriced.'))return;
    var r=await api('/api/pricing-rules/'+id,{method:'DELETE'});var d=await r.json();
    if(r.ok&&d.ok){tShow('Rule deleted');loadBudget();}else tShow(d.error||'Could not delete');
  }

  // ---- In-app QA test run ----
  var TESTS={scenarios:[],results:{},version:''};
  async function loadTests(){
    try{TESTS=await (await api('/api/tests')).json();}catch(e){TESTS={scenarios:[],results:{},version:''};}
    var areas=[]; TESTS.scenarios.forEach(function(s){if(areas.indexOf(s.area)<0)areas.push(s.area);});
    var av0=document.getElementById('testArea').value;
    document.getElementById('testArea').innerHTML='<option value="">All areas</option>'+areas.map(function(a){return '<option value="'+av(a)+'">'+esc(a)+'</option>';}).join('');
    document.getElementById('testArea').value=av0;
    renderTests();
  }
  function testCounts(){var ok=0,nok=0,un=0;TESTS.scenarios.forEach(function(x){var g=TESTS.results[x.code];if(!g)un++;else if(g.status==='ok')ok++;else nok++;});return {total:TESTS.scenarios.length,ok:ok,nok:nok,un:un};}
  function renderTests(){
    var area=document.getElementById('testArea').value, st=document.getElementById('testStatus').value;
    var c=testCounts();
    document.getElementById('testProg').innerHTML='v'+esc(TESTS.version)+' &middot; '+(c.ok+c.nok)+'/'+c.total+' tested &middot; <b style="color:#16a34a">'+c.ok+' OK</b> &middot; <b style="color:var(--magenta)">'+c.nok+' NOK</b> &middot; '+c.un+' untested';
    var list=TESTS.scenarios.filter(function(s){
      if(area&&s.area!==area)return false;
      var g=TESTS.results[s.code];
      if(st==='ok')return g&&g.status==='ok';
      if(st==='nok')return g&&g.status==='nok';
      if(st==='untested')return !g;
      return true;
    });
    var curArea='';
    document.getElementById('testsList').innerHTML=list.map(function(s){
      var g=TESTS.results[s.code];
      var badge=g?('<span class="tbadge '+(g.status==='ok'?'tok':'tnok')+'">'+(g.status==='ok'?'OK':'NOK')+'</span>'):'<span class="tbadge tun">untested</span>';
      var who=g?('<span class="tmeta">last: '+esc(g.tested_by||'')+' &middot; '+new Date(g.created_at).toLocaleString('en-GB')+(g.comment?(' &middot; "'+esc(g.comment)+'"'):'')+'</span>'):'';
      var head=(s.area!==curArea)?('<div class="tarea">'+esc(s.area)+'</div>'):''; curArea=s.area;
      return head+'<div class="trow">'
        +'<div class="tinfo"><div class="tcode">'+esc(s.code)+' &middot; '+esc(s.feature)+' '+badge+'</div>'
        +'<div class="tsteps"><b>Do:</b> '+esc(s.steps)+'</div>'
        +'<div class="texp"><b>Expect:</b> '+esc(s.expected)+' <span class="trole">['+esc(s.role)+']</span></div>'+who+'</div>'
        +'<div class="tact"><input id="tc_'+s.code+'" class="tcomment" placeholder="Comment (optional)" value="'+av(g&&g.comment?g.comment:'')+'">'
        +'<div class="tbtns"><button class="tbtn tokbtn" onclick="submitTest(\\''+s.code+'\\',\\'ok\\')">OK</button>'
        +'<button class="tbtn tnokbtn" onclick="submitTest(\\''+s.code+'\\',\\'nok\\')">NOK</button></div></div></div>';
    }).join('')||'<div class="empty" style="padding:20px">No scenarios match this filter.</div>';
  }
  async function exportTests(){
    try{var r=await fetch('/api/tests/export.csv',{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){tShow('Export failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download='test-results-v'+(TESTS.version||'')+'.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000);
    }catch(e){tShow('Export failed');}
  }
  async function submitTest(code,status){
    var el=document.getElementById('tc_'+code); var comment=el?el.value:'';
    try{var r=await api('/api/tests/result',{method:'POST',body:JSON.stringify({code:code,status:status,comment:comment})});var d=await r.json();
      if(r.ok&&d.ok){TESTS.results[code]={status:status,comment:comment,tested_by:(document.getElementById('whoName').textContent||'you'),created_at:new Date().toISOString()};tShow(code+' marked '+status.toUpperCase());renderTests();}
      else tShow(d.error||'Save failed');
    }catch(e){tShow('Save failed');}
  }

  // ---- Clearview style picker (mirrors the mobile picker) ----
  var STYLES_CACHE=null; var spFilter={type:'',wide:0,high:0,q:''};
  async function loadStyles(){ if(STYLES_CACHE)return STYLES_CACHE; try{STYLES_CACHE=await (await fetch('/api/styles')).json();}catch(e){STYLES_CACHE=[];} return STYLES_CACHE; }
  function spEnsureCss(){
    if(document.getElementById('spCss'))return;
    var st=document.createElement('style');st.id='spCss';
    st.textContent='.spover{position:fixed;inset:0;background:rgba(20,16,45,.55);z-index:60;display:none;align-items:center;justify-content:center;padding:20px}'
      +'.spbox{background:#fff;border-radius:16px;width:min(920px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)}'
      +'.sphead{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line);font-size:15px}'
      +'.spclose{cursor:pointer;color:var(--muted);font-size:18px;padding:4px 8px}'
      +'.spfilters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line)}'
      +'.spfilters input{border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;min-width:120px}'
      +'.spchip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--ink);margin:1px}'
      +'.spchip.on{background:var(--purple);color:#fff;border-color:var(--purple)}'
      +'.spgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;padding:16px;overflow:auto}'
      +'.spcell{border:1px solid var(--line);border-radius:10px;background:#fff;padding:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}'
      +'.spcell:hover{border-color:var(--purple)}'
      +'.spcell img{width:100%;height:74px;object-fit:contain}'
      +'.spcell span{font-size:11px;font-weight:700;color:var(--ink)}';
    document.head.appendChild(st);
  }
  function stylePreview(){
    var code=(document.getElementById('f_design').value||'').trim();
    var img=document.getElementById('f_design_prev'); if(!img)return;
    if(!code){img.style.display='none';return;}
    img.onerror=function(){img.style.display='none';};
    img.onload=function(){img.style.display='';};
    img.src='/api/style-image/'+encodeURIComponent(code);
  }
  function spRenderChips(){
    var styles=STYLES_CACHE||[];
    var types=[''].concat(Array.from(new Set(styles.map(function(s){return s.type;}))));
    document.getElementById('spTypes').innerHTML=types.map(function(t){return '<button class="spchip'+(spFilter.type===t?' on':'')+'" onclick="spSetType(\\''+t.replace(/'/g,"")+'\\')">'+(t||'All types')+'</button>';}).join('');
    document.getElementById('spWide').innerHTML=[0,1,2,3,4,5,6].map(function(w){return '<button class="spchip'+(spFilter.wide===w?' on':'')+'" onclick="spSetWide('+w+')">'+(w?('W'+w):'Any wide')+'</button>';}).join('');
    document.getElementById('spHigh').innerHTML=[0,1,2,3].map(function(h){return '<button class="spchip'+(spFilter.high===h?' on':'')+'" onclick="spSetHigh('+h+')">'+(h?('H'+h):'Any high')+'</button>';}).join('');
  }
  function renderStyleGrid(){
    var styles=STYLES_CACHE||[];
    var list=styles.filter(function(s){
      if(spFilter.type&&s.type!==spFilter.type)return false;
      if(spFilter.wide&&s.wide!==spFilter.wide)return false;
      if(spFilter.high&&s.high!==spFilter.high)return false;
      if(spFilter.q&&String(s.code).toLowerCase().indexOf(spFilter.q)===-1)return false;
      return true;
    });
    var g=document.getElementById('spGrid');
    g.innerHTML=list.map(function(s){return '<button class="spcell" onclick="pickStyle(\\''+s.code+'\\')"><img loading="lazy" src="/api/style-image/'+encodeURIComponent(s.code)+'"><span>'+esc(s.code)+'</span></button>';}).join('')||'<div class="empty" style="padding:24px">No styles match.</div>';
  }
  function spSetType(t){spFilter.type=t;spRenderChips();renderStyleGrid();}
  function spSetWide(w){spFilter.wide=w;spRenderChips();renderStyleGrid();}
  function spSetHigh(h){spFilter.high=h;spRenderChips();renderStyleGrid();}
  function spSetQ(v){spFilter.q=(v||'').trim().toLowerCase();renderStyleGrid();}
  function pickStyle(code){
    var f=document.getElementById('f_design'); if(f)f.value=code;
    var s=(STYLES_CACHE||[]).find(function(x){return String(x.code)===String(code);});
    // The style's product type (Window / Door) is the ITEM TYPE, not the window type.
    var it=document.getElementById('f_type'); if(s&&it&&!it.value)it.value=s.type||'';
    stylePreview(); closeStylePicker();
  }
  function closeStylePicker(){var w=document.getElementById('spOverlay');if(w)w.style.display='none';}
  async function openStylePicker(){
    spEnsureCss();
    var wrap=document.getElementById('spOverlay');
    if(!wrap){wrap=document.createElement('div');wrap.id='spOverlay';wrap.className='spover';wrap.onclick=function(e){if(e.target===wrap)closeStylePicker();};document.body.appendChild(wrap);}
    wrap.style.display='flex';
    wrap.innerHTML='<div class="spbox"><div class="sphead"><b>Choose a Clearview style</b><span class="spclose" onclick="closeStylePicker()">\u2715</span></div>'
      +'<div class="spfilters"><input id="spQ" placeholder="Search code\u2026" oninput="spSetQ(this.value)"><span id="spTypes"></span><span id="spWide"></span><span id="spHigh"></span></div>'
      +'<div class="spgrid" id="spGrid"></div></div>';
    await loadStyles(); spRenderChips(); renderStyleGrid();
  }
  function istatLabel(v){var m=ISTATUS.filter(function(s){return s[0]===(v||'')});return (m[0]||['','\u2014'])[1];}
  async function openDetail(id){
    openModal('Loading\u2026','<div class="empty">Loading\u2026</div>');
    var d=await (await api('/api/item/'+id+'/detail')).json(); var it=d.item;
    function row(k,v){return (v==null||v==='')?'':'<div class="drow"><dt>'+k+'</dt><dd>'+v+'</dd></div>';}
    function attr(v){return (v==null?'':esc(String(v))).replace(/"/g,'&quot;');}
    function fieldV(id,label,val,ph,type){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+attr(val)+'" placeholder="'+(ph||'')+'"></div>';}
    function selField(id,label,val,opts){var o='<option value="">\u2014</option>'+opts.map(function(x){return '<option'+(String(val==null?'':val)===x?' selected':'')+'>'+esc(x)+'</option>';}).join('');return '<div class="field"><label>'+label+'</label><select id="'+id+'">'+o+'</select></div>';}
    function chkField(id,label,checked){return '<div class="field"><label>'+label+'</label><label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:400;color:var(--ink)"><input type="checkbox" id="'+id+'"'+(checked?' checked':'')+'> equally spaced</label></div>';}
    var html='<dl class="dl">'
      +row('Full code','<span class="mono">'+esc(it.full_code)+'</span>')
      +row('Stage',esc(STAGE[it.stage]||it.stage))
      +row('Location',[it.block,it.elevation,(it.flat?('Flat '+it.flat):''),(it.floor?('Floor '+it.floor):''),it.room_code,it.item_code].filter(function(x){return x;}).map(esc).join(' \xB7 '))
      +row('Team',esc(d.team||'\u2014'))+row('Fitting rate',esc(d.effective_rate))
      +row('Install status',esc(istatLabel(it.install_status)))
      +row('Install date',esc(it.actual_install_date))
      +row('Monday',d.monday_url?'<a class="mlink" target="_blank" href="'+d.monday_url+'">open \u2197</a>':'not synced')
      +'</dl>';
    var specEditable=!d.is_snag&&canCap('items.edit');
    if(specEditable){
      html+='<div class="groupt" style="padding:12px 22px 0">SPECIFICATION</div><div class="fgrid" style="padding:6px 22px 12px">'
        +'<div class="field full"><label>Design code (Clearview style)</label><div style="display:flex;gap:8px;align-items:center">'
          +'<input id="f_design" type="text" value="'+attr(it.design_code)+'" placeholder="e.g. 27" style="flex:1" oninput="stylePreview()">'
          +'<button type="button" class="add" onclick="openStylePicker()">Choose style\u2026</button>'
          +'<img id="f_design_prev" alt="" style="display:none;width:46px;height:46px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff"></div></div>'
        +selField('f_material','Material',it.material,MATERIALS)+fieldV('f_type','Item type',it.item_type,'Window / Door')
        +selField('f_wtype','Window type',it.window_type,WINDOW_TYPES)
        +selField('f_glazing','Glass (panes)',it.glazing,GLASS_PANES)+selField('f_glass','Glass texture',it.glass,GLASS_TEXTURES)
        +selField('f_glazingbars','Glazing (bars)',it.glazing_bars,GLAZING_BARS)+selField('f_safety','Safety glass',it.safety_glass,SAFETY_GLASS)
        +'<div class="field full" style="background:#faf9fd;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:4px 0">'
          +'<label style="display:block;margin:0 0 7px;font-weight:600">Dimensions (mm)</label>'
          +'<div style="display:flex;gap:14px">'
            +'<div style="flex:1"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Width</div><input id="f_width" type="number" value="'+attr(it.width_mm)+'" style="width:100%;font-size:16px;font-weight:600;padding:9px 11px"></div>'
            +'<div style="flex:1"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Height inc cill</div><input id="f_height" type="number" value="'+attr(it.height_mm)+'" style="width:100%;font-size:16px;font-weight:600;padding:9px 11px"></div>'
          +'</div></div>'
        +selField('f_cilldepth','Cill depth',it.cill_depth,CILL_DEPTHS)+fieldV('f_openinout','Open in / out',it.open_in_out,'In / Out')
        +'<div class="field full" style="border-top:1px solid var(--line);margin:8px 0 2px"></div>'
        +chkField('f_teq','Transoms',it.transom_equal)
        +fieldV('f_t1','Transom 1 (mm)',it.transom1_mm,'','number')+fieldV('f_t2','Transom 2 (mm)',it.transom2_mm,'','number')+fieldV('f_t3','Transom 3 (mm)',it.transom3_mm,'','number')
        +'<div class="field full" style="border-top:1px solid var(--line);margin:8px 0 2px"></div>'
        +chkField('f_meq','Mullions',it.mullion_equal)
        +fieldV('f_m1','Mullion 1 (mm)',it.mullion1_mm,'','number')+fieldV('f_m2','Mullion 2 (mm)',it.mullion2_mm,'','number')+fieldV('f_m3','Mullion 3 (mm)',it.mullion3_mm,'','number')
        +'<div class="field full" style="border-top:1px solid var(--line);margin:8px 0 2px"></div>'
        +fieldV('f_coupled','Coupled (optional)',it.coupled,'e.g. to W03')+fieldV('f_addons','Add-ons (optional)',it.add_ons,'Trickle vents / etc')
        +'<div class="field full"><label>Comments</label><textarea id="f_comments" rows="2">'+esc(it.comments||'')+'</textarea></div>'
        +'</div>';
    }
    if(d.photos&&d.photos.length){
      html+='<div class="groupt" style="padding:0 22px">PHOTOS</div><div class="photos">'+d.photos.map(function(ph){return '<figure><img src="'+(ph.url||'')+'" alt=""><figcaption>'+esc(ph.kind)+'</figcaption></figure>';}).join('')+'</div>';
    } else { html+='<div class="groupt" style="padding:0 22px">PHOTOS</div><div class="empty">No photos yet \u2014 add one below, or they arrive from the mobile survey / install flow.</div>'; }
    if(canCap('photos.add')){
      var pcol=(myRole==='fitter')?'Picture After':'Picture Before';
      html+='<div style="padding:2px 22px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<input type="file" id="itemPhoto" accept="image/*" style="font-size:12px">'
        +'<button class="save" onclick="uploadItemPhoto(\\''+it.id+'\\')">Add photo</button>'
        +'<span style="font-size:11px;color:var(--muted)">\u2192 syncs to Monday <b>'+pcol+'</b></span></div>';
    }
    if(d.is_snag){
      html+='<div class="empty">This is a snag item \u2014 set its team and labour cost above, then sync and fit it like any item.</div>';
    } else if(myRole!=='surveyor'&&myRole!=='scanner'){
      html+='<div class="groupt" style="padding:10px 22px 0">SNAGS (remedial items)</div>';
      if(d.snags&&d.snags.length){
        html+='<div style="padding:2px 22px 0">'+d.snags.map(function(s){
          var st=s.synced?'<span class="count green">synced</span>':'<span class="count amber">not synced</span>';
          var link=s.monday_url?' \xB7 <a class="mlink" target="_blank" href="'+s.monday_url+'">Monday \u2197</a>':'';
          return '<div style="padding:10px 0;border-top:1px solid #f2f0f8">'
            +'<a class="codelink mono" style="font-size:11px;word-break:break-all" onclick="openDetail(\\''+s.id+'\\')">'+esc(s.full_code)+'</a>'
            +'<div style="font-size:13px;margin-top:4px">'+esc(s.comment||'')+'</div>'
            +'<div style="font-size:11px;color:var(--muted);margin-top:4px">'+st+' \xB7 rate '+esc(s.rate)+' \xB7 '+esc(s.team||'no team')+link+'</div>'
            +'</div>';
        }).join('')+'</div>';
      } else { html+='<div class="empty">No snags yet.</div>'; }
      var topts='<option value="">\u2014 team to fit (optional) \u2014</option>'+(d.teams||[]).map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join('');
      html+='<div style="padding:2px 22px 22px">'
        +'<textarea id="snagDesc" rows="2" placeholder="Describe the snag\u2026" style="width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 10px;font-size:13px;font-family:inherit"></textarea>'
        +'<div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">'
        +'<span style="font-size:12px;color:var(--muted)">\xA3</span><input id="snagRate" type="number" min="0" step="1" placeholder="labour (optional)" style="width:150px;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:12px">'
        +'<select id="snagTeam" class="sel">'+topts+'</select>'
        +'<input type="file" id="snagPhoto" accept="image/*" style="font-size:12px">'
        +'<button class="save" onclick="logSnag(\\''+it.id+'\\')">Raise snag</button>'
        +'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:6px">Creates a separate item ('+esc(it.full_code)+'-S\u2026) you can cost, assign a team, sync and fit like any other.</div>'
        +'</div>';
    }
    if(specEditable){ // sticky Save pinned to the bottom of the drawer, always visible while scrolling
      html+='<div class="sheetfoot"><button class="save" onclick="saveDetail(\\''+it.id+'\\')">Save details</button>'
        +'<button class="add" onclick="markSurveyed(\\''+it.id+'\\')">Save &amp; mark Surveyed</button>'
        +'<span class="sub" style="margin:0">Save keeps this open; changes mark the item to re-sync to Monday.</span></div>';
    }
    document.getElementById('modalTitle').innerHTML=(d.is_snag?'Snag ':'Item ')+'<span class="mono">'+esc(it.full_code)+'</span>';
    document.getElementById('modalBody').innerHTML=html;
    if(document.getElementById('f_design'))stylePreview(); // show the design sketch if a code is set
  }
  function collectDetail(){
    function g(x){var e=document.getElementById(x);return e?e.value:undefined;}
    function chk(x){var e=document.getElementById(x);return e?!!e.checked:undefined;}
    return {material:g('f_material'),item_type:g('f_type'),window_type:g('f_wtype'),
      glazing:g('f_glazing'),glass:g('f_glass'),glazing_bars:g('f_glazingbars'),safety_glass:g('f_safety'),
      open_in_out:g('f_openinout'),add_ons:g('f_addons'),coupled:g('f_coupled'),design_code:g('f_design'),comments:g('f_comments'),
      cill_depth:g('f_cilldepth'),width_mm:g('f_width'),height_mm:g('f_height'),
      transom1_mm:g('f_t1'),transom2_mm:g('f_t2'),transom3_mm:g('f_t3'),transom_equal:chk('f_teq'),
      mullion1_mm:g('f_m1'),mullion2_mm:g('f_m2'),mullion3_mm:g('f_m3'),mullion_equal:chk('f_meq')};
  }
  async function saveDetail(id){
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(collectDetail())})).json();
    if(d.ok){tShow('Details saved');loadItems();openDetail(id);}else tShow(d.error||'Save failed'); // stays open
  }
  async function markSurveyed(id){
    var body=collectDetail(); body.stage='surveyed';
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(body)})).json();
    if(d.ok){tShow('Saved \xB7 marked Surveyed');loadItems();closeModal();}else tShow(d.error||'Save failed');
  }
  function fileToDataUrl(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result)};r.onerror=rej;r.readAsDataURL(file);});}
  async function logSnag(id){
    var desc=(document.getElementById('snagDesc').value||'').trim(); if(!desc){tShow('Enter a snag comment');return;}
    var rate=document.getElementById('snagRate').value, team=document.getElementById('snagTeam').value;
    var f=document.getElementById('snagPhoto').files[0]; var photo=null;
    if(f){ if(f.size>4*1024*1024){tShow('Photo too large (max 4MB)');return;} photo=await fileToDataUrl(f); }
    tShow('Raising snag\u2026');
    var body={description:desc,rate_pennies:(rate===''?null:Math.round(Number(rate)*100)),team_id:team,photo:photo};
    var d=await (await api('/api/item/'+id+'/snags',{method:'POST',body:JSON.stringify(body)})).json();
    if(d.ok){tShow('Snag created: '+d.full_code);openDetail(id);loadItems();}
    else tShow(d.error||'Could not create snag');
  }
  async function uploadItemPhoto(id){
    var f=document.getElementById('itemPhoto').files[0];
    if(!f){tShow('Choose a photo first');return;}
    if(f.size>6*1024*1024){tShow('Photo too large (max 6MB)');return;}
    tShow('Uploading photo\u2026');
    var photo=await fileToDataUrl(f);
    var d=await (await api('/api/item/'+id+'/photo',{method:'POST',body:JSON.stringify({photo:photo})})).json();
    if(d.ok){tShow('Photo added');openDetail(id);}
    else tShow(d.error||'Upload failed');
  }
  document.getElementById('modal').addEventListener('click',function(e){if(e.target.id==='modal')closeModal();});
  if(SSO_ENABLED){var w=document.getElementById('ssoWrap');if(w)w.style.display='block';}
  // Returning from Microsoft OAuth: Supabase puts the session in the URL hash.
  if(window.location.hash.indexOf('access_token=')>=0){
    var hp=new URLSearchParams(window.location.hash.slice(1));
    var at=hp.get('access_token');
    history.replaceState(null,'',window.location.pathname);
    if(at){token=at;bootstrapSession();}
  } else if(token){document.getElementById('appView').style.display='block';document.getElementById('loginView').style.display='none';applyRole();loadJobs().then(loadItems).then(function(){showTab(restoreTab());}).catch(logout);}
</script></body></html>`;
var LIVE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ACE \u2014 Live</title>
<style>
  :root{--bg:#1b1533;--card:#251c47;--line:#3a2f63;--ink:#f4f3f9;--muted:#a9a4c4;--magenta:#e6187e;--green:#22c55e;--amber:#f59e0b}
  *{box-sizing:border-box;margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  body{background:var(--bg);color:var(--ink);min-height:100vh}
  .wrap{max-width:1240px;margin:0 auto;padding:26px 30px}
  header{display:flex;align-items:center;gap:14px;margin-bottom:20px}
  .brand{font-weight:800;font-size:24px}.brand b{color:#ff8fc8}.brand span{font-weight:500;font-size:14px;color:var(--muted)}
  .live{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--green);margin-left:6px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(34,197,94,.7);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)}70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
  .upd{margin-left:auto;font-size:12px;color:var(--muted)}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px}
  .stat .v{font-size:40px;font-weight:800;line-height:1}
  .stat .l{font-size:13px;color:var(--muted);font-weight:600;margin-top:8px}
  .stat .s{font-size:12px;color:#8f8ab0;margin-top:3px}
  .stat.warn .v{color:var(--amber)}
  .cols{display:grid;grid-template-columns:1.6fr 1fr;gap:16px;margin-top:18px}
  @media(max-width:820px){.cols{grid-template-columns:1fr}}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
  .panel h3{font-size:12px;letter-spacing:.06em;color:var(--muted);font-weight:800;margin-bottom:6px}
  .jrow{padding:12px 0;border-top:1px solid var(--line)}.jrow:first-of-type{border-top:none}
  .jtop{display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px}
  .jcode{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700}
  .jname{color:var(--muted);font-weight:500}
  .jmeta{font-size:12px;color:var(--muted)}
  .barrow{display:flex;align-items:center;gap:10px;margin-top:6px}
  .barlabel{font-size:11px;color:var(--muted);width:74px}
  .bartrack{flex:1;height:9px;background:#160f2b;border-radius:999px;overflow:hidden}
  .barfill{height:100%;background:var(--magenta);border-radius:999px;transition:width .5s}
  .barfill.green{background:var(--green)}
  .barpct{font-size:12px;font-weight:700;width:40px;text-align:right}
  .warnpill{color:var(--amber);font-weight:700;font-size:12px;margin-top:6px}
  .msg{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px;text-align:center;color:var(--muted);margin-top:30px}
  .msg code{color:#ff8fc8}
</style></head><body>
<div class="wrap">
  <header>
    <div class="brand">ACE<b>GROUP</b> <span>\xB7 Live</span></div>
    <div class="live"><span class="dot"></span>LIVE</div>
    <div class="upd" id="upd">\u2014</div>
  </header>
  <div id="content"></div>
</div>
<script>
  var KEY=new URLSearchParams(location.search).get('key')||'';
  function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function pct(n,t){return t?Math.round(n/t*100):0;}
  function bar(label,p,cls){return '<div class="barrow"><span class="barlabel">'+label+'</span><div class="bartrack"><div class="barfill '+(cls||'')+'" style="width:'+p+'%"></div></div><span class="barpct">'+p+'%</span></div>';}
  function stat(v,l,s,warn){return '<div class="stat'+(warn?' warn':'')+'"><div class="v">'+v+'</div><div class="l">'+l+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';}
  function render(d){
    var t=d.totals;
    var cards='<div class="stats">'
      +stat(t.jobs,'Jobs')+stat(t.items,'Items')
      +stat(t.synced,'Synced',pct(t.synced,t.items)+'% of items')
      +stat(t.installed,'Installed',pct(t.installed,t.items)+'% of items')
      +stat(t.openSnags,'Open snags',t.snags+' raised',t.openSnags>0)
      +stat(t.labour,'Labour')+'</div>';
    var jobs='<div class="panel"><h3>BY JOB</h3>'+(d.jobs.length?d.jobs.map(function(j){
      return '<div class="jrow"><div class="jtop"><div><span class="jcode">'+esc(j.code)+'</span> <span class="jname">'+esc(j.name)+'</span></div>'
        +'<div class="jmeta">'+j.items+' items \xB7 '+j.snags+' snags \xB7 '+esc(j.labour)+'</div></div>'
        +bar('Synced',pct(j.synced,j.items),'')+bar('Installed',pct(j.installed,j.items),'green')
        +(j.openSnags?'<div class="warnpill">\u26A0 '+j.openSnags+' open snag'+(j.openSnags>1?'s':'')+'</div>':'')+'</div>';
    }).join(''):'<div style="color:var(--muted);padding:8px 0">No jobs yet.</div>')+'</div>';
    var bd=d.breakdown||[];
    var brk='<div class="panel"><h3>INSTALL STATUS</h3>'+(bd.length?bd.map(function(s){
      return '<div class="barrow"><span class="barlabel" style="width:120px">'+esc(s.label)+'</span><div class="bartrack"><div class="barfill" style="width:'+pct(s.count,t.items)+'%"></div></div><span class="barpct">'+s.count+'</span></div>';
    }).join(''):'<div style="color:var(--muted);padding:8px 0">No items yet.</div>')+'</div>';
    document.getElementById('content').innerHTML=cards+'<div class="cols">'+jobs+brk+'</div>';
  }
  function showMsg(html){document.getElementById('content').innerHTML='<div class="msg">'+html+'</div>';}
  async function load(){
    if(!KEY){showMsg('Add your live key to the URL: <code>?key=YOUR_LIVE_KEY</code>');return;}
    try{
      var r=await fetch('/api/live?key='+encodeURIComponent(KEY));
      if(!r.ok){var e=await r.json().catch(function(){return{};});showMsg(esc(e.error||('Error '+r.status)));return;}
      render(await r.json());
      var n=new Date();document.getElementById('upd').textContent='updated '+n.toLocaleTimeString()+' \xB7 refreshes every 30s';
    }catch(err){showMsg('Can\\'t reach the office server. Is it running?');}
  }
  load(); setInterval(load, 30000);
</script></body></html>`;
