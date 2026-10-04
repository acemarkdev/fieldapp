// ACE Office web app (Stage 1): real Supabase-Auth login, view jobs/items,
// edit fitting rate / install status / team, and push an item to Monday.
// The service-role key and Monday token stay on the server; the browser only
// ever holds the logged-in user's short-lived JWT.
//
// Run:  node --env-file=.env --import tsx apps/api/src/office.ts
// Then open http://localhost:3000. Needs SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env, and a login created via create-admin.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { db, ACE_TENANT } from './supabase';
import { listPricingRules, getPricingRule, createPricingRule, updatePricingRule, deletePricingRule,
  getJobRuleId, setJobRuleId, listItemPricing, setItemPricing,
  latestTestResults, insertTestResult, allTestResults, listTestVersions, listDemoLeads, listCustomers,
  listTenants, getTenant, setTenantRate, countItemsCreated } from './store';
import { priceJob, classifyCategory, type PriceItem } from '@ace/shared';
import { isRowComplete, missingRequired, FIELD_LABELS, toMm } from '@ace/shared';
import { buildItemCode, levelSeg } from '@ace/shared';
import { createJob, updateJobDetails, JOB_DATE_FIELDS, getConfig, setConfig, bulkDeleteItems, countItemsForJob, deleteJob, roomCodeCounts, setJobMappingDate, bulkInsertSurveyItems, codeExists, insertAuditLog, listAuditLog, countAuditAction, listItemActivity, userNames, getImportDraft, saveImportDraft, deleteImportDraft, deleteImportedItems, listItemCodesForJob, jobItemCounts } from './store';
import { getUserLanguage, getUserLanguages, setUserLanguage, USER_LANGUAGES } from './store';
import { ensureJobFileBucket, uploadJobFile, signedJobFileUrl, insertJobFile, listJobFiles, deleteJobFile, getJobFile, downloadJobFile } from './store';
import { listJobs, getJob, getJobByCode, getJobByRef, listSurveyItems, listTeams, jobTeamIds, listScheduledItems, getSurveyItem,
  getTeam, createTeam, updateTeam, deleteTeam, countItemsUsingTeam, setJobBoard,
  insertSurveyItem, listItemPhotos, signedPhotoUrl,
  filterItemIdsByTenant, bulkUpdateItems,
  listAppUsers, getAppUser, updateAppUser, setItemTeamFromMonday, applyMondayPull,
  listChildSnags, createSnagItem, addItemPhoto, uploadPhoto, ensurePhotoBucket,
  listJobPlans, createJobPlan, deleteJobPlan, listPinnedItems, setItemPin, uploadPlan, signedPlanUrl, ensurePlanBucket,
  getPinsMultiPlan, setPinsMultiPlan } from './store';
import { computeJobBreakdown, listInvoices, getInvoice, nextInvoiceNumber, createInvoice, updateInvoice, setInvoiceStatus, deleteInvoice } from './store';
import { listSignoffs, getSignoff, upsertSignoff, deleteSignoff, getQaChecklistTemplate, setQaChecklistTemplate, listFlatAfterPhotos } from './store';
import { listCustomerCards, getCustomerCard, getCustomerByCode, createCustomerCard, updateCustomerCard, deleteCustomerCard, countJobsForClientCode,
  listRequirementTypes, createRequirementType, updateRequirementType, deleteRequirementType,
  listCustomerRequirementIds, setCustomerRequirements, requirementNamesForClientCode } from './store';
import { listCostCentres, getCostCentre, createCostCentre, updateCostCentre, deleteCostCentre, parseEnquiryCostCentre, upsertEnquiryCostCentres } from './store';
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier, listPoRequests, getPoRequest, nextPoRequestNumber, createPoRequest, updatePoRequest, deletePoRequest, poSpendByCostCentre, PO_APPROVAL_THRESHOLD_PENNIES, ensurePoFileBucket, uploadPoFile, signedPoFileUrl, insertPoFile, listPoFiles, getPoFile, deletePoFile, upsertSuppliersFromImport, listApproverEmails, getAppUserEmail } from './store';
import { rollupFlats, QA_CHECKLIST_DEFAULT } from '@ace/shared';
import { buildJobReportPdf } from './reportPdf';
import { buildJobPricePdf } from './pricingPdf';
import { buildInvoicePdf } from './invoicePdf';
import { buildFlatSignoffPdf } from './signoffPdf';
import { notifyPoSubmitted, notifyPoDecision, notifyConfirmationApproved } from './notify';
import { parseLabelPdf, buildLabelsPdf } from './labels';
import { JOB_KINDS, JOB_KIND_LABEL, listJobs, getJob, createJob, updateJob, deleteJob, setJobLock, addJobItem, updateJobItem, deleteJobItem, importJobs, getLabourRate, setLabourRate, parseMoney as parseJobMoney } from './finJobs';
import { listPayroll, savePayrollMonth, payrollView, PAYROLL_DEPTS } from './finPayroll';
import { listSales, createSale, updateSale, deleteSale, importSales } from './finSales';
import { FIN_BOARD_DEFAULT, FIN_BOARD_PROD, listCosts, lastSyncRun, startCostSync, syncProgress, acceptCostChange, getAutoSyncSettings, setAutoSyncSettings, autoSyncTick, parseScope, scopeLabel, AUTO_SYNC_MONTHS, localDayHour, AUTO_SYNC_TZ } from './finCosts';
import { readReport, createConfirmation, listConfirmations, getConfirmation, getConfirmationByToken, loadConfirmationHtml, deleteConfirmation,
  mergeState, saveState, approveConfirmation, renderReportPage, renderFilledPage, renderWrapper, buildConfirmationPdf, REPORT_HEADERS, WRAPPER_HEADERS } from './confirmations';
import { buildJobPoPdf } from './poPdf';
import { inviteUser, resetUserPassword, updateAuthEmail } from './adminUser';
import { promoteItem } from './promote';
import { recogniseItemPhoto } from './recognise';
import { Monday } from './monday';
import { REQUIRED_MONDAY_COLUMNS, norm as normColTitle } from './mapItem';

// Normalise a column title for loose matching (Fitters pull, etc.).
const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Pick the Monday date column that most likely holds the planned install date.
// Ranks by title keyword (install > fit > plan > schedule > due > date). If several
// date columns exist and none matches a keyword we return null rather than guess.
function pickDateColumn(cols: { id: string; title: string; type: string }[]): { id: string; title: string } | null {
  const dates = cols.filter((c) => c.type === 'date');
  if (!dates.length) return null;
  const rank = (t: string) => {
    const n = normTitle(t);
    if (n.includes('install')) return 5;
    if (n.includes('fit')) return 4;
    if (n.includes('plan')) return 3;
    if (n.includes('schedule')) return 2;
    if (n.includes('due')) return 1;
    if (n.includes('date')) return 0;
    return -1;
  };
  const ranked = dates.map((c) => ({ c, r: rank(c.title) })).filter((x) => x.r >= 0).sort((a, b) => b.r - a.r);
  if (ranked.length) return ranked[0].c;
  return dates.length === 1 ? dates[0] : null;
}
// Monday date cells read back as "YYYY-MM-DD" (optionally with a time) — keep the date.
function parseMondayDate(text: string | null): string | null {
  const m = (text ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---- Clearview style catalogue (shared with the mobile picker) ----
// Sketch PNGs live in the mobile app's assets, keyed by design code; metadata is a
// generated JSON. The office serves both so desk staff get the same visual picker.
const __dir = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(__dir, '../../mobile/assets/styles');

// Extract the optional programme date fields (YYYY-MM-DD or null) from a request body.
function pickJobDates(b: any): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of JOB_DATE_FIELDS) {
    if (k in (b ?? {})) { const v = (b as any)[k]; out[k] = (v == null || v === '') ? null : String(v).slice(0, 10); }
  }
  return out;
}
interface StyleMetaRow { type: string; wide: number | null; high: number | null; opening: number | null; fixed: number | null }
const STYLE_META: Record<string, StyleMetaRow> = (() => {
  try { return JSON.parse(readFileSync(join(__dir, 'styleMeta.generated.json'), 'utf8')); } catch { return {}; }
})();
// Codes that actually have a sketch on disk (the picker only shows these).
const STYLE_IMAGE_CODES: Set<string> = (() => {
  try { return new Set(readdirSync(STYLES_DIR).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''))); }
  catch { return new Set<string>(); }
})();
// Catalogue rows = styles that have both metadata and a sketch, sorted numerically.
// In-app QA scenarios (the list the testers work through). Lives in code so it's versioned
// with the app; only results go to the database.
const TEST_SCENARIOS: any[] = (() => {
  try { return JSON.parse(readFileSync(join(__dir, 'testScenarios.json'), 'utf8')); } catch { return []; }
})();

const STYLE_CATALOGUE = Object.keys(STYLE_META)
  .filter((code) => STYLE_IMAGE_CODES.has(code))
  .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b))
  .map((code) => ({ code, ...STYLE_META[code] }));

const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const genPassword = () => 'ACE-' + Array.from(randomBytes(8), (x) => PW_CHARS[x % PW_CHARS.length]).join('');
import { effectiveRatePennies, formatPennies, assembleFullCode, APP_VERSION, CHANGELOG,
  CAPABILITIES, ROLES as SHARED_ROLES, ROLE_CAPS, ROLE_LABEL, can, type Capability } from '@ace/shared';

// Assignable roles = the single shared list (includes invoice_manager). Never hard-code.
const ROLES: string[] = [...SHARED_ROLES];
const ROLE_MATRIX = { caps: CAPABILITIES, roles: SHARED_ROLES, labels: ROLE_LABEL, matrix: ROLE_CAPS };

const PHOTO_KIND_LABEL: Record<string, string> = { reference: 'Reference', survey: 'Survey', sketch: 'Sketch', install: 'Install', before: 'Picture Before', after: 'Picture After' };

const PORT = Number(process.env.PORT ?? 3000);
// Labels savings estimate shown to admins: each processed PDF replaces ~1 hour of manual work.
const LABEL_HOURS_PER_PDF = 1, LABEL_PLN_PER_HOUR = 50;

function authClient() {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env.');
  return createClient(url, anon, { auth: { persistSession: false } });
}

const send = (res: any, code: number, data: unknown, type = 'application/json') => {
  const headers: Record<string, string> = { 'content-type': type };
  if (type === 'application/json') headers['cache-control'] = 'no-store'; // never cache API data
  res.writeHead(code, headers);
  res.end(type === 'application/json' ? JSON.stringify(data) : (data as string));
};
const readJson = (req: any): Promise<any> => new Promise((resolve) => {
  let b = ''; req.on('data', (c: any) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

// Pull a Monday board id + account slug from either a bare id or a full board URL.
// Handles the trap where the account subdomain (e.g. "ace189144") contains digits.
function parseMondayRef(input: unknown): { board: string | null; slug: string | null } {
  const s = String(input ?? '').trim();
  if (!s) return { board: null, slug: null };
  const slug = (s.match(/https?:\/\/([a-z0-9-]+)\.monday\.com/i)?.[1]) ?? null;
  let board = s.match(/\/boards\/(\d+)/)?.[1] ?? null;          // prefer the id right after /boards/
  if (!board) {
    if (/^\d{4,}$/.test(s)) board = s;                          // a bare board id
    else board = (s.match(/\d{4,}/g) ?? []).sort((a, b) => b.length - a.length)[0] ?? null; // longest digit run
  }
  return { board, slug };
}

// Build a Monday item link that resolves to the correct account.
const mondayItemUrl = (job: any, itemId: string) =>
  `https://${job.monday_account_slug ? job.monday_account_slug + '.monday.com' : 'monday.com'}/boards/${job.monday_board_id}/pulses/${itemId}`;

// Dashboard figures for a tenant (shared by the authed dashboard tab and the /live wallboard).
async function dashboardData(tenantId: string) {
  const jobs = await listJobs(tenantId);
  const teams = await listTeams(tenantId);
  const INSTALLED = new Set(['installed_no_snag', 'installed_snag']);
  const STATUS_ORDER: [string, string][] = [
    ['scheduled', 'Scheduled'], ['installed_no_snag', 'Installed'], ['installed_snag', 'Installed + snag'],
    ['snag', 'Snag'], ['misfit', 'MisFit'], ['delayed', 'Delayed'], ['none', 'No status'],
  ];
  const statusCounts: Record<string, number> = {};
  const perJob = await Promise.all(jobs.map(async (j) => {
    const items = await listSurveyItems(j.id);
    const snags = items.filter((it) => (it as any).kind === 'snag');
    const synced = items.filter((it) => it.monday_item_id).length;
    const installed = items.filter((it) => it.install_status && INSTALLED.has(it.install_status)).length;
    const openSnags = snags.filter((it) => !(it.install_status && INSTALLED.has(it.install_status))).length;
    const dirty = items.filter((it) => it.monday_item_id && (it as any).needs_resync).length;
    const labourP = items.reduce((s, it) => s + (effectiveRatePennies(it, teams) ?? 0), 0);
    for (const it of items) statusCounts[it.install_status ?? 'none'] = (statusCounts[it.install_status ?? 'none'] ?? 0) + 1;
    return {
      id: j.id, code: `${j.client_code}.${j.job_code}`, name: j.name, board: !!j.monday_board_id,
      items: items.length, windows: items.length - snags.length, snags: snags.length,
      synced, installed, openSnags, dirty, labour: formatPennies(labourP), labourP,
    };
  }));
  const t = perJob.reduce((a, j) => ({
    items: a.items + j.items, synced: a.synced + j.synced, installed: a.installed + j.installed,
    snags: a.snags + j.snags, openSnags: a.openSnags + j.openSnags, dirty: a.dirty + j.dirty, labourP: a.labourP + j.labourP,
  }), { items: 0, synced: 0, installed: 0, snags: 0, openSnags: 0, dirty: 0, labourP: 0 });
  const breakdown = STATUS_ORDER.map(([key, label]) => ({ key, label, count: statusCounts[key] ?? 0 })).filter((s) => s.count > 0);
  return {
    totals: { jobs: jobs.length, items: t.items, synced: t.synced, installed: t.installed,
      snags: t.snags, openSnags: t.openSnags, dirty: t.dirty, labour: formatPennies(t.labourP) },
    breakdown, jobs: perJob,
  };
}

// Item-code builder + level normaliser now live in @ace/shared (imported above) so the office
// web app and the iPad/iPhone apps all produce identical codes. See packages/shared/src/mapping.ts.

// One item row for the Items table (shared by single-job and All-jobs views).
const itemRow = (it: any, job: any, teams: any[]) => ({
  id: it.id, full_code: it.full_code, block: it.block ?? null, elevation: it.elevation ?? null, floor: it.floor ?? null,
  flat: it.flat, room: it.room_code, item: it.item_code, stage: it.stage,
  kind: it.kind ?? 'item', snag_comment: it.snag_comment ?? null, incomplete: !!it.incomplete,
  po_phase: it.po_phase ?? null, po_ready: !!it.po_ready_at,
  install_status: it.install_status, team_id: it.team_id, rate_override_pennies: it.rate_override_pennies,
  effective_rate: formatPennies(effectiveRatePennies(it, teams)),
  synced: !!it.monday_item_id,
  dirty: !!it.monday_item_id && !!it.needs_resync,
  monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
});

// Resolve the caller's app_users row from their bearer token.
async function context(req: any): Promise<{ id: string; tenant_id: string; role: string; name: string; client_code?: string | null; team_id?: string | null } | null> {
  const h = String(req.headers['authorization'] ?? '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const { data } = await authClient().auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const cols = 'id,tenant_id,role,name,active,email,client_code,team_id';
  // First try the linked auth id (password logins), then fall back to email (SSO / first login).
  let { data: rows } = await db().from('app_users').select(cols).eq('auth_user_id', user.id).order('created_at').limit(1);
  let u: any = rows && rows[0];
  if (!u && user.email) {
    const email = user.email.toLowerCase();
    const byEmail = await db().from('app_users').select(cols).eq('email', email).order('created_at').limit(1);
    u = byEmail.data && byEmail.data[0];
    if (u) await db().from('app_users').update({ auth_user_id: user.id }).eq('id', u.id); // link this identity (e.g. Microsoft SSO)
  }
  if (!u || !u.active) return null;
  return u as any;
}

// Fire-and-forget audit entry (never blocks or breaks the main request).
function audit(ctx: any, action: string, entity: string | null, entityId: string | null, summary: string | null, details?: any): void {
  insertAuditLog({ tenant_id: ctx.tenant_id, actor_user_id: ctx.id, actor_name: ctx.name, actor_role: ctx.role, action, entity, entity_id: entityId, summary, details: details ?? null })
    .catch((e) => console.warn('[audit]', e?.message ?? e));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const p = url.pathname;

    if (p === '/') {
      const html = PAGE
        .replaceAll('__APP_VERSION__', APP_VERSION)
        .replace('__CHANGELOG_JSON__', () => JSON.stringify(CHANGELOG))
        .replace('__ROLE_MATRIX_JSON__', () => JSON.stringify(ROLE_MATRIX))
        .replaceAll('__SUPABASE_URL__', () => process.env.SUPABASE_URL ?? '')
        .replaceAll('__SUPABASE_ANON_KEY__', () => process.env.SUPABASE_ANON_KEY ?? '')
        .replaceAll('__SSO_ENABLED__', () => (process.env.AZURE_SSO_ENABLED === 'true' ? 'true' : 'false'))
        .replaceAll('__APP_ENV__', () => (process.env.APP_ENV === 'test' ? 'test' : (process.env.APP_ENV === 'prod' ? 'prod' : '')));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html); return;
    }

    // Style sketch image (public: loaded via <img>, which can't send the bearer token;
    // the drawings are generic product sketches, not tenant data). Guards path traversal
    // by only serving codes we found on disk at startup.
    if (p.startsWith('/api/style-image/')) {
      const code = decodeURIComponent(p.slice('/api/style-image/'.length));
      if (!STYLE_IMAGE_CODES.has(code)) { res.writeHead(404); res.end('not found'); return; }
      try {
        const bytes = readFileSync(join(STYLES_DIR, `${code}.png`));
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
        res.end(bytes);
      } catch { res.writeHead(404); res.end('not found'); }
      return;
    }
    // Style catalogue metadata for the picker (code, type, wide, high). Non-sensitive.
    if (p === '/api/styles') { send(res, 200, STYLE_CATALOGUE); return; }

    // Self-hosted pdf.js (public: loaded as an ES module via dynamic import(), which can't attach
    // the bearer token). Whitelisted library files only — generic code, no tenant data. Used to
    // rasterise a multi-page PDF into one plan image per page, in the browser.
    if (p.startsWith('/vendor/pdfjs/')) {
      const fname = p.slice('/vendor/pdfjs/'.length);
      if (fname !== 'pdf.min.mjs' && fname !== 'pdf.worker.min.mjs') { res.writeHead(404); res.end('not found'); return; }
      try {
        const bytes = readFileSync(join(__dir, '../vendor/pdfjs', fname));
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' });
        res.end(bytes);
      } catch { res.writeHead(404); res.end('not found'); }
      return;
    }

    // Standalone auto-refreshing wallboard (pin it as a browser tab). Key-gated, no login.
    if (p === '/live') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(LIVE_PAGE); return; }
    if (p === '/api/live') {
      const want = process.env.LIVE_KEY ?? '';
      if (!want) { send(res, 503, { error: 'Live view is off — set LIVE_KEY in .env to enable it.' }); return; }
      if ((url.searchParams.get('key') ?? '') !== want) { send(res, 401, { error: 'Bad or missing key.' }); return; }
      send(res, 200, await dashboardData(ACE_TENANT));
      return;
    }

    // ---- Public report-confirmation links: /c/<token>[/state|/approve|/filled] (no login; the token is the key) ----
    const cm = p.match(/^\/c\/([A-Za-z0-9_-]{20,64})(?:\/(state|approve|filled|page))?\/?$/);
    if (cm) {
      const row = await getConfirmationByToken(cm[1]);
      const sub = cm[2] ?? '';
      const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
      if (!row) { if (sub) json(404, { error: 'Link nieaktywny. / Link not found.' }); else { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:40px">Ten link jest nieaktywny. / This link is no longer active.</p>'); } return; }
      if (!sub && req.method === 'GET') {
        res.writeHead(200, WRAPPER_HEADERS); res.end(renderWrapper(row, url.searchParams.get('print') === '1')); return;
      }
      if (sub === 'page' && req.method === 'GET') {
        const html = await loadConfirmationHtml(row.storage_path);
        res.writeHead(200, REPORT_HEADERS); res.end(renderReportPage(html, row, url.searchParams.get('print') === '1')); return;
      }
      if (sub === 'filled' && req.method === 'GET') {
        if (!row.filled_path) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not available.'); return; }
        const html = await loadConfirmationHtml(row.filled_path);
        res.writeHead(200, REPORT_HEADERS); res.end(renderFilledPage(html, url.searchParams.get('print') === '1')); return;
      }
      if (sub === 'state' && req.method === 'GET') { json(200, { state: row.state ?? null, status: row.status }); return; }
      if (sub === 'state' && req.method === 'PUT') {
        if (row.status !== 'pending') { json(409, { error: 'Raport jest już zatwierdzony. / Already approved.' }); return; }
        const b = await readJson(req);
        const next = mergeState(row.state, b.mode === 'set' ? 'set' : 'update', b.data);
        if (JSON.stringify(next).length > 5 * 1024 * 1024) { json(413, { error: 'Too large.' }); return; }
        await saveState(row, next); json(200, { ok: true }); return;
      }
      if (sub === 'approve' && req.method === 'POST') {
        if (row.status !== 'pending') { json(409, { error: 'Raport jest już zatwierdzony. / Already approved.' }); return; }
        const r = await approveConfirmation(row, await readJson(req));
        if (!r.ok) { json(400, { error: r.error, missing: r.missing ?? [] }); return; }
        (async () => { try { await notifyConfirmationApproved(r.row, await getAppUserEmail(r.row.created_by)); } catch (e) { console.error('confirmation notify failed', e); } })();
        json(200, { ok: true }); return;
      }
      json(405, { error: 'Method not allowed.' }); return;
    }

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase(), password = String(b.password ?? '');
      const { data, error } = await authClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        console.warn('[login] failed for', email, '-', error?.message ?? 'no session');
        const unconfirmed = /not confirmed/i.test(error?.message ?? '');
        send(res, 401, { error: unconfirmed ? 'This login\'s email isn\'t confirmed yet \u2014 ask an admin to reset your password.' : 'Invalid email or password' });
        return;
      }
      const { data: u } = await db().from('app_users').select('id,name,role,client_code,team_id').eq('auth_user_id', data.user.id).maybeSingle();
      send(res, 200, { token: data.session.access_token, name: u?.name ?? email, role: u?.role ?? 'user', client_code: u?.client_code ?? null, team_id: (u as any)?.team_id ?? null, language: u?.id ? await getUserLanguage((u as any).id) : null });
      return;
    }

    const ctx = await context(req);
    if (!ctx) { send(res, 401, { error: 'Not authenticated' }); return; }

    // Server-side role guard. The office server uses the service-role key (bypasses RLS),
    // so this is what actually stops a role from doing something the UI merely hides.
    // Returns true if allowed; otherwise sends 403 and returns false (caller must `return`).
    const allow = (cap: Capability): boolean => {
      if (can(ctx.role, cap)) return true;
      send(res, 403, { error: `Your role (${ctx.role}) is not allowed to do that.` });
      return false;
    };

    if (p === '/api/me') { send(res, 200, { id: ctx.id, name: ctx.name, role: ctx.role, client_code: ctx.client_code ?? null, team_id: (ctx as any).team_id ?? null, language: await getUserLanguage(ctx.id) }); return; }

    // ---- Customer portal (role 'customer' only): their own client's jobs + the rate-free PDF ----
    // A customer is confined to a strict whitelist; everything else is refused.
    if (ctx.role === 'customer') {
      const allowedForCustomer =
        p === '/api/me' ||
        p === '/api/customer/jobs' ||
        (p.startsWith('/api/job/') && p.endsWith('/report.pdf') && req.method === 'GET');
      if (!allowedForCustomer) { send(res, 403, { error: 'Not allowed.' }); return; }
    }
    // ---- Logistics: the Logistics menu only (labels, confirmations); everything else is refused ----
    if (ctx.role === 'logistics' && !(p === '/api/me' || p.startsWith('/api/labels/') || p === '/api/confirmations' || p.startsWith('/api/confirmations/'))) {
      send(res, 403, { error: 'Not allowed.' }); return;
    }
    // Read an Archimede production PDF → positions for the label sheet (nothing is stored).
    if (p === '/api/labels/parse' && req.method === 'POST') {
      if (!allow('labels.print')) return;
      const b = await readJson(req);
      const b64 = String(b.pdf ?? '').replace(/^data:[^,]*,/, '');
      const bytes = Buffer.from(b64, 'base64');
      if (!bytes.length) { send(res, 400, { error: 'No PDF received.' }); return; }
      if (bytes.length > 25 * 1024 * 1024) { send(res, 400, { error: 'PDF is too large (max 25 MB).' }); return; }
      if (bytes.subarray(0, 5).toString() !== '%PDF-') { send(res, 400, { error: 'That file is not a PDF.' }); return; }
      try { send(res, 200, await parseLabelPdf(new Uint8Array(bytes))); }
      catch (e: any) { send(res, 400, { error: 'Could not read the PDF: ' + (e?.message ?? String(e)) }); }
      return;
    }
    // Savings counter (admin only): label PDFs downloaded so far; 1 PDF = 1 hour saved = 50 PLN.
    if (p === '/api/labels/stats' && req.method === 'GET') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const count = await countAuditAction(ctx.tenant_id, 'labels.print');
      send(res, 200, { count, hours: count * LABEL_HOURS_PER_PDF, money: count * LABEL_HOURS_PER_PDF * LABEL_PLN_PER_HOUR, currency: 'PLN', hoursPerPdf: LABEL_HOURS_PER_PDF, ratePerHour: LABEL_PLN_PER_HOUR });
      return;
    }
    // Build the A4 label sheet (2 × 4 per page) from the reviewed rows.
    if (p === '/api/labels/pdf' && req.method === 'POST') {
      if (!allow('labels.print')) return;
      const b = await readJson(req);
      const rows = Array.isArray(b.labels) ? b.labels : [];
      if (!rows.length) { send(res, 400, { error: 'No labels selected.' }); return; }
      if (rows.length > 2000) { send(res, 400, { error: 'Too many labels (max 2000).' }); return; }
      const dim = (v: unknown) => String(v ?? '').replace(/[^0-9.,]/g, '').slice(0, 7);
      const labels = rows.map((r: any) => (r?.kind === 'hardware' ? { w: '', h: '', ref: '', kind: 'hardware' as const } : { w: dim(r?.w), h: dim(r?.h), ref: String(r?.ref ?? '').trim().slice(0, 40) }));
      const title = String(b.title ?? '').trim().slice(0, 200);
      const pdf = await buildLabelsPdf({ title, labels, logo: b.logo !== false, company: b.company !== false, skipRows: Number(b.skipRows) || 0 });
      // Awaited (not fire-and-forget): this row is what the admin savings counter counts.
      try { await insertAuditLog({ tenant_id: ctx.tenant_id, actor_user_id: ctx.id, actor_name: ctx.name, actor_role: ctx.role, action: 'labels.print', entity: null, entity_id: null, summary: `Printed ${labels.length * 2} label(s) (${labels.length} × 2) — ${title}`, details: null }); } catch (e: any) { console.warn('[audit]', e?.message ?? e); }
      const fname = ('Etykiety ' + (String(b.order ?? '').trim() || 'labels')).replace(/[^\w .-]/g, '_');
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fname}.pdf"`, 'cache-control': 'no-store' });
      res.end(pdf);
      return;
    }
    // ---- Acemark Finance: the Fin&Ops menu only; everything else is refused ----
    if (ctx.role === 'acemark_finance' && !(p === '/api/me' || p.startsWith('/api/finops/'))) {
      send(res, 403, { error: 'Not allowed.' }); return;
    }
    // ---- Fin&Ops ▸ Costs: purchase invoices synced from the monday board ----
    if (p === '/api/finops/costs' && req.method === 'GET') {
      if (!allow('finops.view')) return;
      const [rows, run, slug] = await Promise.all([listCosts(ctx.tenant_id), lastSyncRun(ctx.tenant_id), getConfig('monday_account_slug')]);
      const boardId = (await getConfig('fin_costs_board_id')) || FIN_BOARD_DEFAULT;
      send(res, 200, { rows, lastRun: run, sync: syncProgress(ctx.tenant_id), boardId, isTestBoard: boardId !== FIN_BOARD_PROD, slug: slug || 'ace189144', canManage: can(ctx.role, 'finops.manage'), auto: { ...(await getAutoSyncSettings()), months: AUTO_SYNC_MONTHS } });
      return;
    }
    if (p === '/api/finops/costs/sync' && req.method === 'POST') {
      if (!allow('finops.view')) return;
      const boardId = (await getConfig('fin_costs_board_id')) || FIN_BOARD_DEFAULT;
      const months = parseScope((await readJson(req)).months);
      const r = startCostSync(ctx.tenant_id, boardId, `${ctx.name} (${scopeLabel(months)})`, months);
      if (r.started) audit(ctx, 'finops.sync', 'fin_costs', null, `Started cost sync from monday — ${scopeLabel(months)}`);
      send(res, 200, { ok: true, started: r.started, sync: syncProgress(ctx.tenant_id) });
      return;
    }
    if (p === '/api/finops/costs/sync' && req.method === 'GET') {
      if (!allow('finops.view')) return;
      send(res, 200, { sync: syncProgress(ctx.tenant_id), lastRun: await lastSyncRun(ctx.tenant_id) });
      return;
    }
    // ---- Fin&Ops ▸ Job costs (sheet "Koszty"): P&L per job. Finance + admin edit; lock/unlock/delete/import = admin. ----
    if (p === '/api/finops/jobs' && req.method === 'GET') {
      if (!allow('finops.view')) return;
      send(res, 200, { jobs: await listJobs(ctx.tenant_id), kinds: JOB_KINDS.map((k) => ({ key: k, label: JOB_KIND_LABEL[k] })), labourRate: await getLabourRate(), canManage: can(ctx.role, 'finops.manage') });
      return;
    }
    if (p === '/api/finops/jobs' && req.method === 'POST') {
      if (!allow('finops.view')) return;
      const r = await createJob(ctx.tenant_id, ctx.name, await readJson(req));
      if (!r.ok) { send(res, r.status, { error: r.error }); return; }
      audit(ctx, 'finjob.create', 'fin_job', r.id, 'Created job cost record');
      send(res, 200, { ok: true, id: r.id }); return;
    }
    if (p === '/api/finops/jobs/import' && req.method === 'POST') {
      if (!allow('finops.manage')) return;
      const b = await readJson(req);
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 5000) : [];
      if (!rows.length) { send(res, 400, { error: 'Nothing to import.' }); return; }
      const r = await importJobs(ctx.tenant_id, ctx.name, rows);
      audit(ctx, 'finjob.import', 'fin_job', null, `Imported ${r.added} job(s), ${r.items} cost line(s); ${r.skipped.length} already existed`);
      send(res, 200, { ok: true, ...r }); return;
    }
    if (p === '/api/finops/labour-rate' && req.method === 'PUT') {
      if (!allow('finops.manage')) return;
      const rate = parseJobMoney((await readJson(req)).rate);
      if (rate === null || rate <= 0 || rate > 10000) { send(res, 400, { error: 'Enter a rate per hour.' }); return; }
      await setLabourRate(rate);
      audit(ctx, 'finjob.rate', 'fin_job', null, `Default labour rate set to ${rate.toFixed(2)}`);
      send(res, 200, { ok: true, labourRate: rate }); return;
    }
    if (p.startsWith('/api/finops/job-items/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!allow('finops.view')) return;
      const itemId = p.split('/')[4] ?? '';
      const r = req.method === 'PUT' ? await updateJobItem(ctx.tenant_id, itemId, await readJson(req)) : await deleteJobItem(ctx.tenant_id, itemId);
      if (!r.ok) { send(res, r.status, { error: r.error }); return; }
      audit(ctx, req.method === 'PUT' ? 'finjob.item.update' : 'finjob.item.delete', 'fin_job', null, `${req.method === 'PUT' ? 'Edited' : 'Deleted'} a cost line on ${r.reference}`);
      send(res, 200, { ok: true }); return;
    }
    if (p.startsWith('/api/finops/jobs/')) {
      const jobId = p.split('/')[4] ?? '', sub = p.split('/')[5] ?? '';
      if (!sub && req.method === 'GET') {
        if (!allow('finops.view')) return;
        const j = await getJob(ctx.tenant_id, jobId);
        if (!j) { send(res, 404, { error: 'Job not found.' }); return; }
        send(res, 200, j); return;
      }
      if (!sub && req.method === 'PUT') {
        if (!allow('finops.view')) return;
        const r = await updateJob(ctx.tenant_id, jobId, await readJson(req));
        if (!r.ok) { send(res, r.status, { error: r.error }); return; }
        audit(ctx, 'finjob.update', 'fin_job', jobId, 'Edited job cost record');
        send(res, 200, { ok: true }); return;
      }
      if (!sub && req.method === 'DELETE') {
        if (!allow('finops.manage')) return;
        const r = await deleteJob(ctx.tenant_id, jobId);
        if (!r.ok) { send(res, r.status, { error: r.error }); return; }
        audit(ctx, 'finjob.delete', 'fin_job', jobId, `Deleted job cost record ${r.reference}`);
        send(res, 200, { ok: true }); return;
      }
      if (sub === 'lock' && req.method === 'POST') {
        if (!allow('finops.manage')) return;
        const locked = (await readJson(req)).locked !== false;
        const r = await setJobLock(ctx.tenant_id, jobId, locked, ctx.name);
        if (!r.ok) { send(res, r.status, { error: r.error }); return; }
        audit(ctx, locked ? 'finjob.lock' : 'finjob.unlock', 'fin_job', jobId, `${locked ? 'Locked' : 'Unlocked'} job ${r.reference}`);
        send(res, 200, { ok: true }); return;
      }
      if (sub === 'items' && req.method === 'POST') {
        if (!allow('finops.view')) return;
        const r = await addJobItem(ctx.tenant_id, jobId, ctx.name, await readJson(req));
        if (!r.ok) { send(res, r.status, { error: r.error }); return; }
        audit(ctx, 'finjob.item.add', 'fin_job', jobId, `Added a cost line to ${r.reference}`);
        send(res, 200, { ok: true, id: r.id }); return;
      }
    }
    // ---- Fin&Ops ▸ Payroll: salaries + payroll tax per department per month; estimates until actuals are ticked. ----
    if (p === '/api/finops/payroll' && req.method === 'GET') {
      if (!allow('finops.view')) return;
      const [y, m] = localDayHour(new Date(), AUTO_SYNC_TZ).day.split('-').map(Number);
      send(res, 200, { months: payrollView(await listPayroll(ctx.tenant_id), { year: y, month: m }), departments: PAYROLL_DEPTS, now: { year: y, month: m } }); return;
    }
    if (p === '/api/finops/payroll' && req.method === 'PUT') {
      if (!allow('finops.view')) return;
      const r = await savePayrollMonth(ctx.tenant_id, ctx.name, await readJson(req));
      if (!r.ok) { send(res, r.status, { error: r.error }); return; }
      audit(ctx, 'finpayroll.save', 'fin_payroll', null, `Payroll ${r.year}-${String(r.month).padStart(2, '0')} saved${r.actual ? ' as actuals' : ' (estimate)'}`);
      send(res, 200, { ok: true }); return;
    }
    // ---- Fin&Ops ▸ Sales (sheet "Sprzedaż"): sales invoices, entered by hand; shown per job. Import = admin. ----
    if (p === '/api/finops/sales' && req.method === 'GET') {
      if (!allow('finops.view')) return;
      send(res, 200, { invoices: await listSales(ctx.tenant_id), canManage: can(ctx.role, 'finops.manage') }); return;
    }
    if (p === '/api/finops/sales' && req.method === 'POST') {
      if (!allow('finops.view')) return;
      const r = await createSale(ctx.tenant_id, ctx.name, await readJson(req));
      if (!r.ok) { send(res, r.status, { error: r.error }); return; }
      audit(ctx, 'finsale.create', 'fin_sale', r.id, 'Added a sales invoice');
      send(res, 200, { ok: true, id: r.id }); return;
    }
    if (p === '/api/finops/sales/import' && req.method === 'POST') {
      if (!allow('finops.manage')) return;
      const rows = (await readJson(req)).rows;
      if (!Array.isArray(rows) || !rows.length) { send(res, 400, { error: 'Nothing to import.' }); return; }
      const r = await importSales(ctx.tenant_id, ctx.name, rows.slice(0, 20000));
      audit(ctx, 'finsale.import', 'fin_sale', null, `Imported ${r.added} sales invoice(s); ${r.skipped} already existed, ${r.invalid} not invoices`);
      send(res, 200, { ok: true, ...r }); return;
    }
    if (p.startsWith('/api/finops/sales/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!allow('finops.view')) return;
      const sid = p.split('/')[4] ?? '';
      const r = req.method === 'PUT' ? await updateSale(ctx.tenant_id, sid, await readJson(req)) : await deleteSale(ctx.tenant_id, sid);
      if (!r.ok) { send(res, r.status, { error: r.error }); return; }
      audit(ctx, req.method === 'PUT' ? 'finsale.update' : 'finsale.delete', 'fin_sale', sid, `${req.method === 'PUT' ? 'Edited' : 'Deleted'} a sales invoice`);
      send(res, 200, { ok: true }); return;
    }
    // Automatic daily sync: on/off + hour (Poland time). Admin only.
    if (p === '/api/finops/auto-sync' && req.method === 'PUT') {
      if (!allow('finops.manage')) return;
      const b = await readJson(req);
      const hour = Number(b.hour);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) { send(res, 400, { error: 'Hour must be 0–23.' }); return; }
      await setAutoSyncSettings(b.enabled !== false, hour);
      audit(ctx, 'finops.autosync', 'fin_costs', null, `Automatic cost sync ${b.enabled !== false ? 'on at ' + String(hour).padStart(2, '0') + ':00' : 'off'}`);
      send(res, 200, { ok: true, auto: { ...(await getAutoSyncSettings()), months: AUTO_SYNC_MONTHS } });
      return;
    }
    if (p.startsWith('/api/finops/costs/') && p.endsWith('/accept') && req.method === 'POST') {
      if (!allow('finops.manage')) return;
      const boardId = (await getConfig('fin_costs_board_id')) || FIN_BOARD_DEFAULT;
      const id = p.split('/')[4] ?? '';
      const r = await acceptCostChange(ctx.tenant_id, id, boardId);
      if (!r.ok) { send(res, 400, { error: r.error }); return; }
      audit(ctx, 'finops.accept', 'fin_costs', id, `Accepted edited invoice as trusted — new Cost ID ${r.costId}`);
      send(res, 200, { ok: true, costId: r.costId });
      return;
    }
    // ---- Report confirmations (office): upload a report → shareable link; track approvals ----
    if (p === '/api/confirmations' && req.method === 'GET') {
      if (!allow('confirmations.manage')) return;
      send(res, 200, { confirmations: await listConfirmations(ctx.tenant_id) }); return;
    }
    if (p === '/api/confirmations' && req.method === 'POST') {
      if (!allow('confirmations.manage')) return;
      const b = await readJson(req);
      const html = String(b.html ?? '');
      if (!html) { send(res, 400, { error: 'No file received.' }); return; }
      if (html.length > 40 * 1024 * 1024) { send(res, 400, { error: 'File is too large (max 40 MB).' }); return; }
      const rep = readReport(html);
      if (!rep.ok) { send(res, 400, { error: rep.error }); return; }
      const fileName = String(b.fileName ?? '').slice(0, 250) || 'report.html';
      const title = (String(b.title ?? '').trim() || rep.title || fileName.replace(/\.html?$/i, '')).slice(0, 250);
      const row = await createConfirmation(ctx.tenant_id, { id: ctx.id, name: ctx.name }, fileName, html, title, rep.meta);
      audit(ctx, 'confirmation.create', 'confirmation', row.id, `Shared report “${title}”`);
      send(res, 200, { ok: true, id: row.id, token: row.token, autosave: rep.meta.autosave, items: rep.meta.items.length }); return;
    }
    if (p.startsWith('/api/confirmations/') && p.endsWith('/pdf') && req.method === 'GET') {
      if (!allow('confirmations.manage')) return;
      const row = await getConfirmation(p.split('/')[3] ?? '', ctx.tenant_id);
      if (!row) { send(res, 404, { error: 'Not found.' }); return; }
      const pdf = await buildConfirmationPdf(row);
      const fname = (row.title || 'report').replace(/[^\w .-]/g, '_').slice(0, 120);
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fname} - ${row.status === 'approved' ? 'zatwierdzony' : 'w toku'}.pdf"`, 'cache-control': 'no-store' });
      res.end(pdf); return;
    }
    if (p.startsWith('/api/confirmations/') && req.method === 'DELETE') {
      if (!allow('confirmations.manage')) return;
      const row = await getConfirmation(p.split('/')[3] ?? '', ctx.tenant_id);
      if (!row) { send(res, 404, { error: 'Not found.' }); return; }
      await deleteConfirmation(row);
      audit(ctx, 'confirmation.delete', 'confirmation', row.id, `Deleted shared report “${row.title}”`);
      send(res, 200, { ok: true }); return;
    }
    if (p === '/api/customer/jobs' && req.method === 'GET') {
      if (ctx.role !== 'customer' || !ctx.client_code) { send(res, 403, { error: 'forbidden' }); return; }
      const jobs = (await listJobs(ctx.tenant_id)).filter((j) => j.client_code === ctx.client_code);
      send(res, 200, jobs.map((j) => ({ code: `${j.client_code}.${j.job_code}`, name: j.name })));
      return;
    }

    if (p === '/api/dashboard') { send(res, 200, await dashboardData(ctx.tenant_id)); return; }

    // Install calendar: every scheduled item across all jobs/teams (office-wide planner).
    if (p === '/api/calendar' && req.method === 'GET') {
      if (!allow('calendar.view')) return;
      const teams = await listTeams(ctx.tenant_id);
      const tname = new Map(teams.map((t) => [t.id, t.name]));
      const rows = await listScheduledItems(ctx.tenant_id);
      const items = rows.map((r: any) => ({
        id: r.id, full_code: r.full_code, room_code: r.room_code, item_code: r.item_code,
        install_status: r.install_status, date: r.planned_install_date,
        job: r.jobs ? `${r.jobs.client_code}.${r.jobs.job_code}` : '', jobName: r.jobs?.name ?? '',
        team: r.team_id ? (tname.get(r.team_id) ?? '') : '', team_id: r.team_id ?? '',
      }));
      send(res, 200, { items, teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })) });
      return;
    }

    // ---- Finance: pricing rules (admin / invoice_manager only) ----
    if (p === '/api/pricing-rules' && req.method === 'GET') {
      if (!allow('finance.view')) return;
      send(res, 200, await listPricingRules(ctx.tenant_id));
      return;
    }
    if (p === '/api/pricing-rules' && req.method === 'POST') {
      if (!allow('finance.manage')) return;
      const b = await readJson(req);
      const name = String(b.name ?? '').trim();
      if (!name) { send(res, 400, { error: 'A rule name is required.' }); return; }
      try {
        const created = await createPricingRule(ctx.tenant_id, { name, customer: b.customer ?? null, model: b.model || 'axs_flat_v1', params: b.params ?? {} });
        send(res, 200, { ok: true, id: created.id });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: `A rule called "${name}" already exists.` }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith('/api/pricing-rules/') && req.method === 'PUT') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      const b = await readJson(req);
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = String(b.name).trim();
      if (b.customer !== undefined) patch.customer = b.customer || null;
      if (b.model !== undefined) patch.model = b.model || 'axs_flat_v1';
      if (b.params !== undefined) patch.params = b.params;
      if (b.active !== undefined) patch.active = !!b.active;
      try { await updatePricingRule(id, ctx.tenant_id, patch); send(res, 200, { ok: true }); }
      catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: 'Another rule already has that name.' }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith('/api/pricing-rules/') && req.method === 'DELETE') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      await deletePricingRule(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }

    // ---- In-app QA test tab ----
    if (p === '/api/tests' && req.method === 'GET') {
      if (!allow('dashboard.view')) return;
      const sel = (url.searchParams.get('version') || APP_VERSION).trim() || APP_VERSION;
      const results = await latestTestResults(ctx.tenant_id, sel);
      const versions = await listTestVersions(ctx.tenant_id);
      if (!versions.some((v) => v.version === APP_VERSION)) versions.unshift({ version: APP_VERSION, count: 0, last: '' });
      send(res, 200, { version: sel, current: APP_VERSION, scenarios: TEST_SCENARIOS, results, versions });
      return;
    }
    if (p === '/api/tests/result' && req.method === 'POST') {
      if (!allow('dashboard.view')) return;
      const b = await readJson(req);
      const code = String(b.code ?? '').trim();
      const status = b.status === 'ok' ? 'ok' : b.status === 'nok' ? 'nok' : '';
      if (!code || !TEST_SCENARIOS.some((s) => s.code === code)) { send(res, 400, { error: 'Unknown scenario.' }); return; }
      if (!status) { send(res, 400, { error: 'Status must be ok or nok.' }); return; }
      await insertTestResult(ctx.tenant_id, {
        scenario_code: code, app_version: APP_VERSION, status,
        comment: (b.comment ?? '').toString().trim() || null, tested_by: ctx.name ?? null, tested_by_id: ctx.id ?? null,
      });
      send(res, 200, { ok: true });
      return;
    }
    if (p === '/api/tests/export.csv' && req.method === 'GET') {
      if (!allow('dashboard.view')) return;
      const xv = (url.searchParams.get('version') || APP_VERSION).trim() || APP_VERSION;
      const rows = await allTestResults(ctx.tenant_id, xv);
      const esc = (v: any) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
      const byCode = new Map(TEST_SCENARIOS.map((s) => [s.code, s]));
      const lines = ['code,area,feature,status,comment,tested_by,at'];
      for (const r of rows) {
        const s: any = byCode.get(r.scenario_code) ?? {};
        lines.push([r.scenario_code, s.area, s.feature, r.status, r.comment, r.tested_by, r.created_at].map(esc).join(','));
      }
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="test-results-v${xv}.csv"`, 'cache-control': 'no-store' });
      res.end(lines.join('\n'));
      return;
    }

    // Job pricing: current rule + full budget/sale/margin breakdown (finance only).
    if (p.startsWith('/api/job/') && p.endsWith('/pricing') && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const rules = await listPricingRules(ctx.tenant_id);
      const ruleId = await getJobRuleId(job.id);
      const rule = ruleId ? await getPricingRule(ruleId, ctx.tenant_id) : null;
      let breakdown: unknown = null;
      let itemList: any[] = [];
      let missingDims = 0;
      const includeOmit = url.searchParams.get('includeOmit') === '1';
      let omitted = 0;
      if (rule && (rule.params as any)?.sale) {
        let items = await listSurveyItems(job.id);
        omitted = items.filter((it: any) => it.install_status === 'omit').length;
        if (!includeOmit) items = items.filter((it: any) => it.install_status !== 'omit');
        const ipMap = new Map((await listItemPricing(items.map((i) => i.id))).map((r) => [r.item_id, r]));
        const priceItems: PriceItem[] = items.map((it: any) => {
          const f = ipMap.get(it.id);
          return {
            id: it.id, full_code: it.full_code, kind: it.kind,
            category: classifyCategory({ item_type: it.item_type, item_code: it.item_code }),
            width_mm: it.width_mm, height_mm: it.height_mm, flat: it.flat,
            is_variation: !!f?.is_variation, variation_amount: f?.variation_amount_pennies ?? 0,
          };
        });
        breakdown = priceJob(priceItems, rule as any);
        // Windows with no dimensions can't be priced by m² (their extra-window / COM charge is £0).
        missingDims = priceItems.filter((it) => it.category === 'window' && (it.kind ?? 'item') !== 'snag' && !it.is_variation && !((it.width_mm || 0) > 0 && (it.height_mm || 0) > 0)).length;
        // Non-snag items with their variation state, so the UI can flag variations.
        itemList = priceItems.filter((it) => (it.kind ?? 'item') !== 'snag').map((it) => ({
          id: it.id, full_code: it.full_code, category: it.category, flat: it.flat ?? null,
          is_variation: !!it.is_variation, variation_amount: it.variation_amount ?? 0,
        }));
      }
      send(res, 200, { rule_id: ruleId, rule_name: rule?.name ?? null, rules: rules.map((r) => ({ id: r.id, name: r.name })), breakdown, items: itemList, missingDims, omitted, includeOmit });
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/pricing') && req.method === 'PUT') {
      if (!allow('finance.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      await setJobRuleId(job.id, ctx.tenant_id, b.rule_id || null);
      send(res, 200, { ok: true });
      return;
    }
    // Customer price-breakdown PDF (sale side only; finance-gated). Browser downloads it.
    if (p.startsWith('/api/job/') && p.endsWith('/price.pdf') && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      try {
        const out = await buildJobPricePdf(code, ctx.tenant_id, url.searchParams.get('includeOmit') === '1');
        if (!out) { send(res, 400, { error: 'Assign a pricing rule to this job first.' }); return; }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${out.job.client_code}.${out.job.job_code}-price-breakdown.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(out.buffer);
      } catch (e: any) {
        send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // Mark an item as a variation (with a manual amount) — finance only.
    if (p.startsWith('/api/item/') && p.endsWith('/pricing') && req.method === 'PUT') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const isVar = !!b.is_variation;
      const amt = b.variation_amount_pennies == null || b.variation_amount_pennies === '' ? null : Math.round(Number(b.variation_amount_pennies));
      await setItemPricing(id, ctx.tenant_id, { is_variation: isVar, variation_amount_pennies: isVar ? amt : null });
      send(res, 200, { ok: true });
      return;
    }

    // ---- Client invoicing (finance only) ----
    // List invoices (optionally filtered by status / job).
    if (p === '/api/invoices' && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const status = url.searchParams.get('status') || undefined;
      const jobId = url.searchParams.get('job') || undefined;
      const rows = await listInvoices(ctx.tenant_id, { status, jobId });
      // Outstanding = issued (sent) and not paid; overdue = past due & unpaid.
      const today = new Date(new Date().toDateString());
      const list = rows.map((r) => ({
        id: r.id, number: r.number, job_id: r.job_id, status: r.status,
        customer: r.customer, job_ref: r.snapshot?.job ? `${r.snapshot.job.client_code}.${r.snapshot.job.job_code}` : '',
        job_name: r.snapshot?.job?.name ?? '',
        subtotal_pennies: r.subtotal_pennies, vat_pennies: r.vat_pennies, total_pennies: r.total_pennies,
        issue_date: r.issue_date, due_date: r.due_date, paid_at: r.paid_at, paid_ref: r.paid_ref,
        overdue: r.status !== 'paid' && r.status !== 'void' && r.status !== 'draft' && r.due_date ? new Date(r.due_date) < today : false,
      }));
      const outstanding = list.filter((i) => i.status === 'sent').reduce((s, i) => s + i.total_pennies, 0);
      const paid = list.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total_pennies, 0);
      const overdueCount = list.filter((i) => i.overdue).length;
      send(res, 200, { invoices: list, summary: { outstanding, paid, overdueCount, count: list.length } });
      return;
    }
    // Create an invoice from a priced job (snapshots the breakdown + adds VAT).
    if (p === '/api/invoices' && req.method === 'POST') {
      if (!allow('finance.manage')) return;
      const b = await readJson(req);
      const ref = String(b.job_id ?? '').trim();
      if (!ref) { send(res, 400, { error: 'Pick a job to invoice.' }); return; }
      let job;
      try { job = await getJobByRef(ref); } catch { send(res, 404, { error: 'Job not found.' }); return; }
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const includeOmit = !!b.includeOmit;
      const priced = await computeJobBreakdown(job.id, ctx.tenant_id, includeOmit);
      if (!priced) { send(res, 400, { error: 'Assign a pricing rule to this job first (Budget tab).' }); return; }
      const subtotal = priced.breakdown.saleTotal;
      if (subtotal <= 0) { send(res, 400, { error: 'This job prices to £0 — nothing to invoice yet.' }); return; }
      let vatRate = Number(b.vat_rate);
      if (!isFinite(vatRate) || vatRate < 0) vatRate = 20;
      vatRate = Math.min(vatRate, 100);
      const vat = Math.round(subtotal * vatRate / 100);
      const total = subtotal + vat;
      const dueDays = Number(b.due_days);
      const issue = new Date();
      const issueDate = issue.toISOString().slice(0, 10);
      let dueDate: string | null = null;
      if (isFinite(dueDays) && dueDays >= 0) { const d = new Date(issue); d.setDate(d.getDate() + Math.round(dueDays)); dueDate = d.toISOString().slice(0, 10); }
      let sellerName = 'ACE Group';
      try { const t = await getTenant(ctx.tenant_id); if (t?.name) sellerName = t.name; } catch { /* default */ }
      const snapshot = {
        breakdown: priced.breakdown,
        job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: (job as any).site_address ?? null },
        ruleName: priced.rule.name, seller: { name: sellerName }, includeOmit,
      };
      const number = await nextInvoiceNumber(ctx.tenant_id);
      try {
        const created = await createInvoice(ctx.tenant_id, {
          job_id: job.id, number, snapshot, customer: (priced.rule as any).customer ?? null,
          bill_to: (b.bill_to ?? '').toString().trim() || null,
          subtotal_pennies: subtotal, vat_rate: vatRate, vat_pennies: vat, total_pennies: total,
          issue_date: issueDate, due_date: dueDate, notes: (b.notes ?? '').toString().trim() || null, created_by: ctx.name ?? null,
        });
        send(res, 200, { ok: true, id: created.id, number: created.number });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: 'That invoice number already exists — try again.' }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    // Get one invoice (full detail incl. snapshot breakdown).
    if (p.startsWith('/api/invoice/') && p.split('/').length === 4 && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const id = p.split('/')[3] ?? '';
      const inv = await getInvoice(id, ctx.tenant_id);
      if (!inv) { send(res, 404, { error: 'Invoice not found.' }); return; }
      send(res, 200, inv);
      return;
    }
    // Edit an invoice's billing address / notes / due date / VAT (VAT recomputes totals).
    if (p.startsWith('/api/invoice/') && p.split('/').length === 4 && req.method === 'PUT') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      const inv = await getInvoice(id, ctx.tenant_id);
      if (!inv) { send(res, 404, { error: 'Invoice not found.' }); return; }
      if (inv.status === 'void') { send(res, 400, { error: 'This invoice is void and can’t be edited.' }); return; }
      const b = await readJson(req);
      const patch: Record<string, unknown> = {};
      if (b.bill_to !== undefined) patch.bill_to = (b.bill_to ?? '').toString().trim() || null;
      if (b.notes !== undefined) patch.notes = (b.notes ?? '').toString().trim() || null;
      if (b.due_date !== undefined) patch.due_date = b.due_date || null;
      if (b.customer !== undefined) patch.customer = (b.customer ?? '').toString().trim() || null;
      if (b.vat_rate !== undefined) {
        let vatRate = Number(b.vat_rate); if (!isFinite(vatRate) || vatRate < 0) vatRate = 0; vatRate = Math.min(vatRate, 100);
        patch.vat_rate = vatRate;
        patch.vat_pennies = Math.round(inv.subtotal_pennies * vatRate / 100);
        patch.total_pennies = inv.subtotal_pennies + (patch.vat_pennies as number);
      }
      await updateInvoice(id, ctx.tenant_id, patch as any);
      send(res, 200, { ok: true });
      return;
    }
    // Delete a draft or void invoice (issued/paid ones must be voided, not deleted).
    if (p.startsWith('/api/invoice/') && p.split('/').length === 4 && req.method === 'DELETE') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      const inv = await getInvoice(id, ctx.tenant_id);
      if (!inv) { send(res, 404, { error: 'Invoice not found.' }); return; }
      if (inv.status !== 'draft' && inv.status !== 'void') { send(res, 400, { error: 'Only draft or void invoices can be deleted — void it first.' }); return; }
      await deleteInvoice(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    // Change invoice status: draft → sent → paid, or void; unpaid reverts paid → sent.
    if (p.startsWith('/api/invoice/') && p.endsWith('/status') && req.method === 'POST') {
      if (!allow('finance.manage')) return;
      const id = p.split('/')[3] ?? '';
      const inv = await getInvoice(id, ctx.tenant_id);
      if (!inv) { send(res, 404, { error: 'Invoice not found.' }); return; }
      const b = await readJson(req);
      const status = String(b.status ?? '');
      if (!['draft', 'sent', 'paid', 'void'].includes(status)) { send(res, 400, { error: 'Unknown status.' }); return; }
      await setInvoiceStatus(id, ctx.tenant_id, status as any, { paid_ref: (b.paid_ref ?? '').toString().trim() || null });
      send(res, 200, { ok: true });
      return;
    }
    // Invoice PDF (customer-facing, from the snapshot). Browser downloads it.
    if (p.startsWith('/api/invoice/') && p.endsWith('/pdf') && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const id = p.split('/')[3] ?? '';
      try {
        const out = await buildInvoicePdf(id, ctx.tenant_id);
        if (!out) { send(res, 404, { error: 'Invoice not found.' }); return; }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${out.number}.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(out.buffer);
      } catch (e: any) {
        send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- Install sign-off / QA (admin / office; qa.signoff) ----
    // The tenant's checklist template (admin edits it; everyone with qa.signoff reads it).
    if (p === '/api/qa-checklist' && req.method === 'GET') {
      if (!allow('qa.signoff')) return;
      send(res, 200, { checklist: await getQaChecklistTemplate(ctx.tenant_id), default: QA_CHECKLIST_DEFAULT });
      return;
    }
    if (p === '/api/qa-checklist' && req.method === 'PUT') {
      if (!allow('users.manage')) return;         // template is an admin-level setting
      const b = await readJson(req);
      const list = Array.isArray(b.checklist) ? b.checklist
        .map((c: any) => ({ key: String(c.key ?? '').trim(), label: String(c.label ?? '').trim() }))
        .filter((c: any) => c.key && c.label) : [];
      if (!list.length) { send(res, 400, { error: 'Add at least one checklist line.' }); return; }
      await setQaChecklistTemplate(ctx.tenant_id, list);
      send(res, 200, { ok: true });
      return;
    }
    // All flats of a job with install readiness + sign-off status.
    if (p.startsWith('/api/job/') && p.endsWith('/signoff') && p.split('/').length === 5 && req.method === 'GET') {
      if (!allow('qa.signoff')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const items = await listSurveyItems(job.id);
      const rollup = rollupFlats(items.map((it: any) => ({ flat: it.flat, kind: it.kind, install_status: it.install_status })));
      const soMap = new Map((await listSignoffs(job.id)).map((s) => [s.flat, s]));
      const flats = rollup.map((f) => {
        const so = soMap.get(f.flat);
        return { ...f, signoff: so ? { result: so.result, signed_by: so.signed_by, signed_at: so.signed_at } : null };
      });
      send(res, 200, { flats, template: await getQaChecklistTemplate(ctx.tenant_id) });
      return;
    }
    // One flat's sign-off detail (checklist prefilled, items, after-photos).
    if (p.includes('/flat/') && p.endsWith('/signoff') && p.split('/').length === 7 && req.method === 'GET') {
      if (!allow('qa.signoff')) return;
      const parts = p.split('/');
      const code = decodeURIComponent(parts[3] ?? '');
      const flat = decodeURIComponent(parts[5] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const template = await getQaChecklistTemplate(ctx.tenant_id);
      const saved = await getSignoff(job.id, flat);
      const savedByKey = new Map<string, any>((saved?.checklist ?? []).map((c: any) => [c.key, c]));
      // Prefill: saved answer if present, else default to OK (supervisor unticks any failure).
      const checklist = template.map((t) => {
        const s = savedByKey.get(t.key);
        return { key: t.key, label: t.label, ok: s ? !!s.ok : true, note: s?.note ?? '' };
      });
      const items = (await listSurveyItems(job.id))
        .filter((it: any) => (it.flat ?? '').trim() === flat && (it.kind ?? 'item') !== 'snag')
        .map((it: any) => ({ id: it.id, full_code: it.full_code, install_status: it.install_status }));
      const photos = await Promise.all((await listFlatAfterPhotos(job.id, flat)).map(async (m) => ({
        code: m.full_code, url: await signedPhotoUrl(m.storage_path),
      })));
      send(res, 200, {
        flat, checklist, items, photos,
        result: saved?.result ?? 'pass', notes: saved?.notes ?? '',
        signed_by: saved?.signed_by ?? null, signed_at: saved?.signed_at ?? null, exists: !!saved,
      });
      return;
    }
    // Save a flat's sign-off.
    if (p.includes('/flat/') && p.endsWith('/signoff') && p.split('/').length === 7 && req.method === 'PUT') {
      if (!allow('qa.signoff')) return;
      const parts = p.split('/');
      const code = decodeURIComponent(parts[3] ?? '');
      const flat = decodeURIComponent(parts[5] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const checklist = Array.isArray(b.checklist) ? b.checklist.map((c: any) => ({
        key: String(c.key ?? ''), label: String(c.label ?? ''), ok: !!c.ok, note: (c.note ?? '').toString().trim() || null,
      })) : [];
      const result = b.result === 'fail' ? 'fail' : 'pass';
      await upsertSignoff(ctx.tenant_id, job.id, flat, {
        result, checklist, notes: (b.notes ?? '').toString().trim() || null,
        signed_by: ctx.name ?? null, signed_by_id: ctx.id ?? null,
      });
      send(res, 200, { ok: true });
      return;
    }
    // Clear a flat's sign-off.
    if (p.includes('/flat/') && p.endsWith('/signoff') && p.split('/').length === 7 && req.method === 'DELETE') {
      if (!allow('qa.signoff')) return;
      const parts = p.split('/');
      const code = decodeURIComponent(parts[3] ?? '');
      const flat = decodeURIComponent(parts[5] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      await deleteSignoff(job.id, flat, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    // Flat sign-off certificate PDF.
    if (p.includes('/flat/') && p.endsWith('/signoff.pdf') && req.method === 'GET') {
      if (!allow('qa.signoff')) return;
      const parts = p.split('/');
      const code = decodeURIComponent(parts[3] ?? '');
      const flat = decodeURIComponent(parts[5] ?? '');
      try {
        const out = await buildFlatSignoffPdf(code, flat, ctx.tenant_id);
        if (!out) { send(res, 400, { error: 'Sign off this flat first.' }); return; }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${out.job.client_code}.${out.job.job_code}-flat-${flat}-signoff.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(out.buffer);
      } catch (e: any) {
        send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }

    // ---- Customer cards + contractual requirements (read: jobs.manage; write: customers.manage=admin) ----
    if (p === '/api/customers-master' && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      const cards = await listCustomerCards(ctx.tenant_id);
      const out = await Promise.all(cards.map(async (c) => ({
        id: c.id, code: c.code, name: c.name, active: c.active,
        contacts: (c.contacts || []).length, requirements: (await listCustomerRequirementIds(c.id)).length,
      })));
      send(res, 200, { customers: out, canManage: can(ctx.role, 'customers.manage') });
      return;
    }
    if (p === '/api/customers-master' && req.method === 'POST') {
      if (!allow('customers.manage')) return;
      const b = await readJson(req);
      const code = String(b.code ?? '').trim().toUpperCase();
      const name = String(b.name ?? '').trim();
      if (!/^[A-Z0-9]{2,4}$/.test(code)) { send(res, 400, { error: 'Customer code must be 2-4 letters/numbers, e.g. AXS.' }); return; }
      if (!name) { send(res, 400, { error: 'A customer name is required.' }); return; }
      try {
        const created = await createCustomerCard(ctx.tenant_id, { code, name, contacts: Array.isArray(b.contacts) ? b.contacts : [] });
        if (Array.isArray(b.requirement_ids)) await setCustomerRequirements(ctx.tenant_id, created.id, b.requirement_ids);
        audit(ctx, 'customer.create', 'customer', created.id, 'Created customer ' + code + ' - ' + name);
        send(res, 200, { ok: true, id: created.id });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: 'A customer with code "' + code + '" already exists.' }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith('/api/customers-master/') && p.split('/').length === 4 && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      const id = p.split('/')[3] ?? '';
      const c = await getCustomerCard(id, ctx.tenant_id);
      if (!c) { send(res, 404, { error: 'Customer not found.' }); return; }
      const types = await listRequirementTypes(ctx.tenant_id, true);
      const checked = new Set(await listCustomerRequirementIds(id));
      send(res, 200, {
        customer: { id: c.id, code: c.code, name: c.name, active: c.active, contacts: c.contacts || [] },
        requirements: types.map((t) => ({ id: t.id, name: t.name, active: t.active, checked: checked.has(t.id) })),
      });
      return;
    }
    if (p.startsWith('/api/customers-master/') && p.split('/').length === 4 && req.method === 'PUT') {
      if (!allow('customers.manage')) return;
      const id = p.split('/')[3] ?? '';
      const c = await getCustomerCard(id, ctx.tenant_id);
      if (!c) { send(res, 404, { error: 'Customer not found.' }); return; }
      const b = await readJson(req);
      const patch: any = {};
      if (b.name !== undefined) patch.name = String(b.name).trim();
      if (b.active !== undefined) patch.active = !!b.active;
      if (Array.isArray(b.contacts)) patch.contacts = b.contacts.map((x: any) => ({
        role: String(x.role ?? '').trim(), name: String(x.name ?? '').trim(), email: String(x.email ?? '').trim(), phone: String(x.phone ?? '').trim(),
      })).filter((x: any) => x.role || x.name || x.email || x.phone);
      if (b.code !== undefined) {
        const newCode = String(b.code).trim().toUpperCase();
        if (newCode !== c.code) {
          if (!/^[A-Z0-9]{2,4}$/.test(newCode)) { send(res, 400, { error: 'Customer code must be 2-4 letters/numbers.' }); return; }
          const inUse = await countJobsForClientCode(ctx.tenant_id, c.code);
          if (inUse > 0) { send(res, 400, { error: 'Cannot change the code - ' + inUse + ' job(s) already use ' + c.code + '.' }); return; }
          patch.code = newCode;
        }
      }
      try {
        await updateCustomerCard(id, ctx.tenant_id, patch);
        if (Array.isArray(b.requirement_ids)) await setCustomerRequirements(ctx.tenant_id, id, b.requirement_ids);
        audit(ctx, 'customer.update', 'customer', id, 'Updated customer ' + (patch.code || c.code));
        send(res, 200, { ok: true });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: 'Another customer already has that code.' }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }
    if (p.startsWith('/api/customers-master/') && p.split('/').length === 4 && req.method === 'DELETE') {
      if (!allow('customers.manage')) return;
      const id = p.split('/')[3] ?? '';
      const c = await getCustomerCard(id, ctx.tenant_id);
      if (!c) { send(res, 404, { error: 'Customer not found.' }); return; }
      const inUse = await countJobsForClientCode(ctx.tenant_id, c.code);
      if (inUse > 0) { send(res, 400, { error: 'Cannot delete - ' + inUse + ' job(s) use customer ' + c.code + '.' }); return; }
      await deleteCustomerCard(id, ctx.tenant_id);
      audit(ctx, 'customer.delete', 'customer', id, 'Deleted customer ' + c.code);
      send(res, 200, { ok: true });
      return;
    }
    if (p === '/api/requirement-types' && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      send(res, 200, { types: await listRequirementTypes(ctx.tenant_id, true), canManage: can(ctx.role, 'customers.manage') });
      return;
    }
    if (p === '/api/requirement-types' && req.method === 'POST') {
      if (!allow('customers.manage')) return;
      const b = await readJson(req);
      const name = String(b.name ?? '').trim();
      if (!name) { send(res, 400, { error: 'A requirement name is required.' }); return; }
      try { const t = await createRequirementType(ctx.tenant_id, name, Number(b.sort) || 0); send(res, 200, { ok: true, id: t.id }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: '"' + name + '" already exists.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/requirement-types/') && req.method === 'PUT') {
      if (!allow('customers.manage')) return;
      const id = p.split('/')[3] ?? '';
      const b = await readJson(req);
      const patch: any = {};
      if (b.name !== undefined) patch.name = String(b.name).trim();
      if (b.active !== undefined) patch.active = !!b.active;
      if (b.sort !== undefined) patch.sort = Number(b.sort) || 0;
      try { await updateRequirementType(id, ctx.tenant_id, patch); send(res, 200, { ok: true }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: 'Another requirement has that name.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/requirement-types/') && req.method === 'DELETE') {
      if (!allow('customers.manage')) return;
      const id = p.split('/')[3] ?? '';
      await deleteRequirementType(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }

    // ---- Cost centres (read: jobs.manage; write: purchasing.manage=admin) ----
    if (p === '/api/cost-centres' && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      send(res, 200, { costCentres: await listCostCentres(ctx.tenant_id, true), canManage: can(ctx.role, 'purchasing.manage') });
      return;
    }
    if (p === '/api/cost-centres' && req.method === 'POST') {
      if (!allow('purchasing.manage')) return;
      const b = await readJson(req);
      const code = String(b.code ?? '').trim();
      if (!code) { send(res, 400, { error: 'A cost centre code is required.' }); return; }
      const type = ['framework', 'enquiry', 'general'].includes(b.type) ? b.type : 'general';
      try { const c = await createCostCentre(ctx.tenant_id, { code, label: (b.label ?? '').toString().trim() || null, type, sort: Number(b.sort) || 0 }); send(res, 200, { ok: true, id: c.id }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: 'A cost centre "' + code + '" already exists.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/cost-centres/') && p.endsWith('/import-enquiries') && req.method === 'POST') {
      if (!allow('purchasing.manage')) return;
      const eqBoard = (await getConfig('eq_board_id')) || '5742141764';
      const EXCLUDE = new Set(['dead enquiries', 'cancelled jobs', 'archives', 'all subitems', 'holiday', 'complaints']);
      try {
        const monday = new Monday();
        const rowsAll = await monday.listItemNames(eqBoard);
        const rows: { eq_item_id: string; code: string; label: string }[] = [];
        let skipped = 0;
        for (const it of rowsAll) {
          if (it.group && EXCLUDE.has(it.group.toLowerCase())) continue;
          const parsed = parseEnquiryCostCentre(it.name);
          if (!parsed) { skipped++; continue; }
          rows.push({ eq_item_id: it.id, code: parsed.code, label: parsed.label });
        }
        const r = await upsertEnquiryCostCentres(ctx.tenant_id, rows);
        audit(ctx, 'costcentre.import', 'costcentre', null, `Imported enquiry cost centres: ${r.added} added, ${r.updated} updated`);
        send(res, 200, { ok: true, scanned: rowsAll.length, matched: rows.length, added: r.added, updated: r.updated, unparsed: skipped });
      } catch (e: any) { send(res, 500, { error: e?.message ?? String(e) }); }
      return;
    }
    if (p.startsWith('/api/cost-centres/') && req.method === 'PUT') {
      if (!allow('purchasing.manage')) return;
      const id = p.split('/')[3] ?? '';
      const b = await readJson(req);
      const patch: any = {};
      if (b.code !== undefined) patch.code = String(b.code).trim();
      if (b.label !== undefined) patch.label = (b.label ?? '').toString().trim() || null;
      if (b.type !== undefined && ['framework', 'enquiry', 'general'].includes(b.type)) patch.type = b.type;
      if (b.active !== undefined) patch.active = !!b.active;
      if (b.sort !== undefined) patch.sort = Number(b.sort) || 0;
      try { await updateCostCentre(id, ctx.tenant_id, patch); send(res, 200, { ok: true }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: 'Another cost centre has that code.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/cost-centres/') && req.method === 'DELETE') {
      if (!allow('purchasing.manage')) return;
      const id = p.split('/')[3] ?? '';
      await deleteCostCentre(id, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }

    // ---- Suppliers (read: purchasing.request; write: purchasing.manage=admin) ----
    if (p === '/api/suppliers' && req.method === 'GET') {
      if (!allow('purchasing.request')) return;
      send(res, 200, { suppliers: await listSuppliers(ctx.tenant_id, true), canManage: can(ctx.role, 'purchasing.manage') });
      return;
    }
    if (p === '/api/suppliers' && req.method === 'POST') {
      if (!allow('purchasing.manage')) return;
      const b = await readJson(req); const name = String(b.name ?? '').trim();
      if (!name) { send(res, 400, { error: 'Supplier name is required.' }); return; }
      try { const sup = await createSupplier(ctx.tenant_id, { name, contact: (b.contact??'').toString().trim()||null, email: (b.email??'').toString().trim()||null, phone: (b.phone??'').toString().trim()||null }); send(res, 200, { ok: true, id: sup.id }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: 'A supplier "' + name + '" already exists.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p === '/api/suppliers/import-monday' && req.method === 'POST') {
      if (!allow('purchasing.manage')) return;
      const boardId = (await getConfig('suppliers_board_id')) || '18428441176';
      try {
        const monday = new Monday();
        const items = await monday.listItemsWithColumnText(boardId, ['long_text_mm6mqary', 'email_mm6mqey8', 'phone_mm6mq61j']);
        const rows = items.filter((i) => (i.name || '').trim()).map((i) => ({
          name: i.name, contact: i.cols['long_text_mm6mqary'] || null, email: i.cols['email_mm6mqey8'] || null, phone: i.cols['phone_mm6mq61j'] || null,
        }));
        const r = await upsertSuppliersFromImport(ctx.tenant_id, rows);
        audit(ctx, 'supplier.import', 'supplier', null, `Imported suppliers from monday: ${r.added} added, ${r.updated} updated`);
        send(res, 200, { ok: true, scanned: items.length, added: r.added, updated: r.updated });
      } catch (e: any) { send(res, 500, { error: e?.message ?? String(e) }); }
      return;
    }
    if (p.startsWith('/api/suppliers/') && req.method === 'PUT') {
      if (!allow('purchasing.manage')) return;
      const id = p.split('/')[3] ?? ''; const b = await readJson(req); const patch: any = {};
      ['name','contact','email','phone'].forEach((k) => { if (b[k] !== undefined) patch[k] = (b[k] ?? '').toString().trim() || null; });
      if (b.active !== undefined) patch.active = !!b.active;
      try { await updateSupplier(id, ctx.tenant_id, patch); send(res, 200, { ok: true }); }
      catch (err: any) { if (err?.code === '23505') { send(res, 409, { error: 'Another supplier has that name.' }); return; } send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/suppliers/') && req.method === 'DELETE') {
      if (!allow('purchasing.manage')) return;
      await deleteSupplier(p.split('/')[3] ?? '', ctx.tenant_id); send(res, 200, { ok: true }); return;
    }

    // Purchasing notification settings (email from, base url) — admin only. Secrets (RESEND_API_KEY,
    // TEAMS_PO_WEBHOOK) live in the server env, never app_config, which is anon-readable.
    if (p === '/api/po-settings' && req.method === 'GET') {
      if (!allow('purchasing.manage')) return;
      send(res, 200, { teams_configured: !!process.env.TEAMS_PO_WEBHOOK, teams_dm_configured: !!process.env.TEAMS_PO_DM_WEBHOOK, po_email_from: (await getConfig('po_email_from')) || '', app_base_url: (await getConfig('app_base_url')) || '', email_configured: !!process.env.RESEND_API_KEY });
      return;
    }
    if (p === '/api/po-settings' && req.method === 'PUT') {
      if (!allow('purchasing.manage')) return;
      const b = await readJson(req);
      if (b.po_email_from !== undefined) await setConfig('po_email_from', String(b.po_email_from ?? '').trim());
      if (b.app_base_url !== undefined) await setConfig('app_base_url', String(b.app_base_url ?? '').trim());
      send(res, 200, { ok: true });
      return;
    }
    if (p === '/api/po-approvals-count' && req.method === 'GET') {
      if (!allow('purchasing.request')) return;
      const rows = await listPoRequests(ctx.tenant_id, { status: 'in_review' });
      send(res, 200, { awaiting: rows.length, canApprove: can(ctx.role, 'purchasing.manage') });
      return;
    }
    // ---- PO requests ----
    if (p === '/api/po-requests' && req.method === 'GET') {
      if (!allow('purchasing.request')) return;
      const status = url.searchParams.get('status') || undefined;
      const rows = await listPoRequests(ctx.tenant_id, { status });
      const list = rows.map((r: any) => ({
        id: r.id, number: r.number, title: r.title, status: r.status, requestor_name: r.requestor_name,
        cost_centre: r.cost_centres ? (r.cost_centres.code + (r.cost_centres.label ? ' — ' + r.cost_centres.label : '')) : null,
        cc_type: r.cost_centres ? r.cost_centres.type : null,
        team: (r.fitter_teams && r.fitter_teams.name) || null,
        supplier: (r.suppliers && r.suppliers.name) || r.new_supplier || null,
        amount_pennies: r.amount_pennies, currency: r.currency, delivery_date: r.delivery_date,
        approval_required: r.approval_required, approved_at: r.approved_at, po_number: r.po_number, created_at: r.created_at,
      }));
      const awaiting = list.filter((r) => r.status === 'in_review').length;
      send(res, 200, { requests: list, canApprove: can(ctx.role, 'purchasing.manage'), summary: { count: list.length, awaiting } });
      return;
    }
    if (p === '/api/po-requests' && req.method === 'POST') {
      if (!allow('purchasing.request')) return;
      const b = await readJson(req);
      const title = String(b.title ?? '').trim();
      if (!title) { send(res, 400, { error: 'A title / description is required.' }); return; }
      const amount_pennies = Math.round(Number(b.amount) * 100) || 0;
      const currency = ['GBP','PLN','EUR','USD'].includes(b.currency) ? b.currency : 'GBP';
      const number = await nextPoRequestNumber(ctx.tenant_id);
      try {
        const created = await createPoRequest(ctx.tenant_id, {
          number, title, status: 'in_review', requestor_id: ctx.id, requestor_name: ctx.name,
          cost_centre_id: b.cost_centre_id || null, supplier_id: b.supplier_id || null, new_supplier: (b.new_supplier ?? '').toString().trim() || null,
          amount_pennies, currency, delivery_date: b.delivery_date || null, delivery_location: (b.delivery_location ?? '').toString().trim() || null,
          site_contact: (b.site_contact ?? '').toString().trim() || null, remake: !!b.remake, special_instructions: (b.special_instructions ?? '').toString().trim() || null,
          qty_items: b.qty_items != null && b.qty_items !== '' ? Math.round(Number(b.qty_items)) : null,
          qty_snags: b.qty_snags != null && b.qty_snags !== '' ? Math.round(Number(b.qty_snags)) : null,
          service_start: b.service_start || null, service_end: b.service_end || null, team_id: b.team_id || null,
          approval_required: amount_pennies >= PO_APPROVAL_THRESHOLD_PENNIES, created_by: ctx.name,
        });
        audit(ctx, 'po.create', 'po_request', created.id, `Raised ${number} — ${title} (${(amount_pennies/100).toFixed(2)} ${currency})`);
        if (amount_pennies >= PO_APPROVAL_THRESHOLD_PENNIES) {
          (async () => {
            try {
              const full = await getPoRequest(created.id, ctx.tenant_id);
              const emails = await listApproverEmails(ctx.tenant_id);
              const cc = full?.cost_centres ? (full.cost_centres.code + (full.cost_centres.label ? ' — ' + full.cost_centres.label : '')) : null;
              const sup = (full?.suppliers && full.suppliers.name) || full?.new_supplier || null;
              await notifyPoSubmitted(full, emails, cc, sup);
            } catch (e) { console.error('PO submit notify failed', e); }
          })();
        }
        send(res, 200, { ok: true, id: created.id, number, approval_required: amount_pennies >= PO_APPROVAL_THRESHOLD_PENNIES });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p.startsWith('/api/po-requests/') && p.endsWith('/status') && req.method === 'POST') {
      if (!allow('purchasing.request')) return;
      const id = p.split('/')[3] ?? '';
      const cur = await getPoRequest(id, ctx.tenant_id);
      if (!cur) { send(res, 404, { error: 'Request not found.' }); return; }
      const b = await readJson(req);
      const status = String(b.status ?? '');
      const APPROVE = ['approved', 'rejected'];
      if (!['in_review','approved','rejected','po_sent','supplier_confirmed','part_delivered','delivered','cancelled'].includes(status)) { send(res, 400, { error: 'Unknown status.' }); return; }
      if (APPROVE.includes(status) && !can(ctx.role, 'purchasing.manage')) { send(res, 403, { error: 'Only a purchasing manager can approve or reject.' }); return; }
      const comment = String(b.comment ?? '').trim().slice(0, 2000);
      if (status === 'rejected' && !comment) { send(res, 400, { error: 'A comment is required to reject a request.' }); return; }
      const patch: any = { status };
      if (status === 'approved') { patch.approved_by = ctx.id; patch.approved_at = new Date().toISOString(); }
      if (APPROVE.includes(status)) { patch.decided_by_name = ctx.name; patch.decided_at = new Date().toISOString(); patch.decision_comment = comment || null; }
      if (status === 'po_sent' && b.po_number !== undefined) patch.po_number = (b.po_number ?? '').toString().trim() || null;
      await updatePoRequest(id, ctx.tenant_id, patch);
      audit(ctx, 'po.status', 'po_request', id, `${cur.number} → ${status}` + (comment && APPROVE.includes(status) ? ` — ${comment}` : ''));
      if ((status === 'approved' || status === 'rejected') && cur.status !== status) {
        (async () => { try { const email = await getAppUserEmail(cur.requestor_id); await notifyPoDecision(cur, status as any, ctx.name, email, comment || null); } catch (e) { console.error('PO decision notify failed', e); } })();
      }
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith('/api/po-requests/') && p.endsWith('/files') && req.method === 'POST') {
      if (!allow('purchasing.request')) return;
      const id = p.split('/')[3] ?? '';
      const cur = await getPoRequest(id, ctx.tenant_id);
      if (!cur) { send(res, 404, { error: 'Request not found.' }); return; }
      const b = await readJson(req);
      const files = Array.isArray(b.files) ? b.files : [];
      let saved = 0;
      for (const fl of files) {
        const name = String(fl.name ?? 'file').trim() || 'file';
        const kind = ['quote','po','order_ack','delivery','budget','other'].includes(fl.kind) ? fl.kind : 'other';
        const m = /^data:([^;]*);base64,(.+)$/.exec(String(fl.dataUrl ?? ''));
        if (!m) continue;
        const contentType = m[1] || 'application/octet-stream';
        const bytes = Buffer.from(m[2], 'base64');
        if (bytes.length > 25 * 1024 * 1024) { send(res, 400, { error: `"${name}" is over 25MB.` }); return; }
        const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
        const path = `${ctx.tenant_id}/${id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}-${safe}`;
        try { await ensurePoFileBucket(); await uploadPoFile(path, bytes, contentType); await insertPoFile({ tenant_id: ctx.tenant_id, po_request_id: id, kind, name, storage_path: path, content_type: contentType, size_bytes: bytes.length }); saved++; }
        catch (err: any) { send(res, 500, { error: 'Upload failed: ' + (err?.message ?? String(err)) }); return; }
      }
      send(res, 200, { ok: true, saved });
      return;
    }
    if (p.startsWith('/api/po-requests/') && p.split('/').length === 4 && req.method === 'GET') {
      if (!allow('purchasing.request')) return;
      const id = p.split('/')[3] ?? '';
      const r = await getPoRequest(id, ctx.tenant_id);
      if (!r) { send(res, 404, { error: 'Request not found.' }); return; }
      const files = await Promise.all((await listPoFiles(id)).map(async (fl: any) => ({ id: fl.id, kind: fl.kind, name: fl.name, url: await signedPoFileUrl(fl.storage_path) })));
      send(res, 200, { request: r, files, canApprove: can(ctx.role, 'purchasing.manage') });
      return;
    }
    if (p.startsWith('/api/po-requests/') && p.split('/').length === 4 && req.method === 'PUT') {
      if (!allow('purchasing.request')) return;
      const id = p.split('/')[3] ?? '';
      const cur = await getPoRequest(id, ctx.tenant_id);
      if (!cur) { send(res, 404, { error: 'Request not found.' }); return; }
      const b = await readJson(req); const patch: any = {};
      if (b.title !== undefined) patch.title = String(b.title).trim();
      if (b.cost_centre_id !== undefined) patch.cost_centre_id = b.cost_centre_id || null;
      if (b.supplier_id !== undefined) patch.supplier_id = b.supplier_id || null;
      if (b.new_supplier !== undefined) patch.new_supplier = (b.new_supplier ?? '').toString().trim() || null;
      if (b.currency !== undefined && ['GBP','PLN','EUR','USD'].includes(b.currency)) patch.currency = b.currency;
      if (b.amount !== undefined) { patch.amount_pennies = Math.round(Number(b.amount) * 100) || 0; patch.approval_required = patch.amount_pennies >= PO_APPROVAL_THRESHOLD_PENNIES; }
      ['delivery_location','site_contact','special_instructions'].forEach((k) => { if (b[k] !== undefined) patch[k] = (b[k] ?? '').toString().trim() || null; });
      if (b.delivery_date !== undefined) patch.delivery_date = b.delivery_date || null;
      if (b.service_start !== undefined) patch.service_start = b.service_start || null;
      if (b.service_end !== undefined) patch.service_end = b.service_end || null;
      if (b.team_id !== undefined) patch.team_id = b.team_id || null;
      if (b.remake !== undefined) patch.remake = !!b.remake;
      if (b.qty_items !== undefined) patch.qty_items = b.qty_items === '' || b.qty_items == null ? null : Math.round(Number(b.qty_items));
      if (b.qty_snags !== undefined) patch.qty_snags = b.qty_snags === '' || b.qty_snags == null ? null : Math.round(Number(b.qty_snags));
      await updatePoRequest(id, ctx.tenant_id, patch);
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith('/api/po-requests/') && p.split('/').length === 4 && req.method === 'DELETE') {
      if (!(ctx.role === 'admin' || ctx.role === 'office')) { send(res, 403, { error: 'Managers only' }); return; }
      await deletePoRequest(p.split('/')[3] ?? '', ctx.tenant_id); send(res, 200, { ok: true }); return;
    }
    if (p.startsWith('/api/po-file/') && req.method === 'DELETE') {
      if (!allow('purchasing.request')) return;
      await deletePoFile(p.split('/')[3] ?? '', ctx.tenant_id); send(res, 200, { ok: true }); return;
    }

    if (p === '/api/jobs' && req.method === 'GET') {
      let jobs = await listJobs(ctx.tenant_id);
      // Scanners only see jobs an admin has released for mapping.
      if (ctx.role === 'scanner') jobs = jobs.filter((j) => (j as any).status === 'pending_mapping');
      send(res, 200, jobs.map((j) => ({
        id: j.id, code: `${j.client_code}.${j.job_code}`, name: j.name, site_code: (j as any).site_code ?? null,
        status: (j as any).status ?? 'new', mapping_start_date: (j as any).mapping_start_date ?? null,
        programme_end: (j as any).programme_end ?? null,
      })));
      return;
    }

    // Jobs + their programme dates, for the Gantt on the Calendar tab.
    if (p === '/api/gantt' && req.method === 'GET') {
      if (!allow('calendar.view')) return;
      const jobs = await listJobs(ctx.tenant_id);
      const teams = await listTeams(ctx.tenant_id);
      const teamByJob = await jobTeamIds(ctx.tenant_id);
      send(res, 200, {
        jobs: jobs.map((j) => {
          const o: Record<string, unknown> = { code: `${j.client_code}.${j.job_code}`, name: j.name, team_ids: Array.from(teamByJob.get(j.id) ?? []) };
          for (const k of JOB_DATE_FIELDS) o[k] = (j as any)[k] ?? null;
          return o;
        }),
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: (t as any).active })),
      });
      return;
    }

    // Demo leads destination email (admin config). GET + PUT.
    if (p === '/api/config/demo-leads-email' && req.method === 'GET') {
      if (!allow('users.manage')) return;
      send(res, 200, { email: (await getConfig('demo_leads_email')) ?? '' });
      return;
    }
    if (p === '/api/config/demo-leads-email' && req.method === 'PUT') {
      if (!allow('users.manage')) return;
      const b = await readJson(req);
      const email = String(b.email ?? '').trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, { error: 'Enter a valid email address.' }); return; }
      await setConfig('demo_leads_email', email);
      audit(ctx, 'config.demo_leads_email', 'config', 'demo_leads_email', `Set demo leads email to ${email || '(cleared)'}`);
      send(res, 200, { ok: true });
      return;
    }

    // Admin assigns a mapping start date → releases the job to scanners (status 'pending_mapping').
    if (p.startsWith('/api/job/') && p.endsWith('/mapping-date') && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const date = String(b.date ?? '').trim() || null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { send(res, 400, { error: 'Use a valid date (YYYY-MM-DD).' }); return; }
      await setJobMappingDate(job.id, date, ctx.tenant_id);
      send(res, 200, { ok: true, status: date ? 'pending_mapping' : 'new' });
      return;
    }

    // Jobs available to map (0 items yet), grouped by programme status for the Mapping picker.
    if (p === '/api/mapping-jobs' && req.method === 'GET') {
      if (!allow('items.create')) return;
      const jobs = await listJobs(ctx.tenant_id);
      const counts = await jobItemCounts(ctx.tenant_id);
      const today = new Date().toISOString().slice(0, 10);
      const live: any[] = [], pending: any[] = [], done: any[] = [];
      for (const j of jobs) {
        if ((counts[j.id] ?? 0) > 0) continue;                 // only jobs with no items yet
        const pe = (j as any).programme_end || null;
        const e = { id: j.id, code: `${j.client_code}.${j.job_code}`, site_code: (j as any).site_code ?? null, name: j.name, programme_end: pe };
        if (!pe) pending.push(e);
        else if (pe < today) done.push(e);
        else live.push(e);
      }
      send(res, 200, { live, pending, done });
      return;
    }

    // Scanner mapping bulk-create: block/elevation + rows [{flat, item, item_type}] → items.
    if (p.startsWith('/api/job/') && p.endsWith('/mapping-items') && req.method === 'POST') {
      if (!allow('items.create')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const block = String(b.block ?? '').trim().toUpperCase() || null;
      const elevation = String(b.elevation ?? '').trim().toUpperCase() || null;
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) { send(res, 400, { error: 'Nothing to save — preload some items first.' }); return; }
      const seen = new Set<string>();
      const fields: Record<string, unknown>[] = [];
      for (const r of rows) {
        // Floor is stored WITH its F (1 -> F1, GF stays GF). Flat stays a bare number (feeds pricing).
        const floor = levelSeg(String(r.floor ?? '').trim());
        const flat = String(r.flat ?? '').trim().replace(/^F(?=[0-9])/i, '');
        const item = String(r.item ?? '').trim().toUpperCase();
        if (!item) continue;
        // A row may carry its own block/elevation (multi-elevation preload); otherwise use the batch default.
        const rBlock = (String(r.block ?? '').trim().toUpperCase() || block) || null;
        const rElev = (String(r.elevation ?? '').trim().toUpperCase() || elevation) || null;
        // Flat (if set) is the level segment in the code, else the mapping Floor. Both are stored.
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block: rBlock, elevation: rElev, flat, floor, item });
        if (seen.has(full_code)) continue; seen.add(full_code);
        fields.push({
          tenant_id: ctx.tenant_id, job_id: job.id, stage: 'scanned',
          block: rBlock, elevation: rElev, floor: floor || null, flat: flat || null, item_code: item,
          item_type: String(r.item_type ?? '').trim() || null, full_code,
          created_by: ctx.id, created_via: 'mapping', scanned_by: ctx.id,
        });
      }
      try {
        const inserted = await bulkInsertSurveyItems(fields);
        audit(ctx, 'mapping.save', 'job', code, `Mapped ${inserted} item(s) on ${code}${block ? ' · ' + block : ''}${elevation ? '/' + elevation : ''}`);
        send(res, 200, { ok: true, inserted, skipped: fields.length - inserted });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }

    // Excel import — staged draft grid (Operations ▸ Mapping ▸ Import from Excel). One per job,
    // held server-side so it survives and is visible to the whole team until committed.
    if (p.startsWith('/api/job/') && p.endsWith('/import-draft')) {
      if (!allow('items.create')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      if (req.method === 'GET') {
        const d = await getImportDraft(ctx.tenant_id, job.id);
        send(res, 200, { rows: d?.rows ?? [], filename: d?.filename ?? null, updated_at: d?.updated_at ?? null });
        return;
      }
      if (req.method === 'PUT') {
        const b = await readJson(req);
        const rows = Array.isArray(b.rows) ? b.rows : [];
        await saveImportDraft(ctx.tenant_id, job.id, rows, (b.filename ? String(b.filename) : null), ctx.id);
        send(res, 200, { ok: true, count: rows.length });
        return;
      }
      if (req.method === 'DELETE') {
        await deleteImportDraft(ctx.tenant_id, job.id);
        audit(ctx, 'import.clear', 'job', code, `Cleared Excel import draft on ${code}`);
        send(res, 200, { ok: true });
        return;
      }
    }

    // Excel import — existing item codes for this job (so the grid can flag duplicates live).
    if (p.startsWith('/api/job/') && p.endsWith('/item-codes') && req.method === 'GET') {
      if (!allow('items.create')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      send(res, 200, { codes: await listItemCodesForJob(ctx.tenant_id, job.id) });
      return;
    }

    // Excel import — remove items previously committed from an import for this job (skips synced).
    if (p.startsWith('/api/job/') && p.endsWith('/import-items') && req.method === 'DELETE') {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      try {
        const r = await deleteImportedItems(ctx.tenant_id, job.id);
        audit(ctx, 'import.delete_items', 'job', code, `Deleted ${r.deleted} imported item(s) on ${job.client_code}.${job.job_code}${r.skippedSynced ? ' · kept ' + r.skippedSynced + ' synced' : ''}`);
        send(res, 200, { ok: true, ...r });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }

    // Excel import — commit the staged grid into the Items table. Rows missing mandatory data are
    // still created, but flagged incomplete ('Unfinished') so they can be completed later.
    if (p.startsWith('/api/job/') && p.endsWith('/import-commit') && req.method === 'POST') {
      if (!allow('items.create')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) { send(res, 400, { error: 'Nothing to upload — import a sheet first.' }); return; }
      // When on (default), skip rows whose code already exists in this job, and in-sheet duplicates.
      const dupCheck = b.dupCheck !== false;
      const existing = new Set<string>();
      if (dupCheck) { for (const c of await listItemCodesForJob(ctx.tenant_id, job.id)) existing.add(c); }
      const up = (v: any) => String(v ?? '').trim().toUpperCase();
      const str = (v: any) => { const t = String(v ?? '').trim(); return t || null; };
      const seen = new Set<string>();
      const fields: Record<string, unknown>[] = [];
      // Per-input-row outcome, so the client can clear loaded rows and keep skipped ones with a note.
      const results: string[] = new Array(rows.length);
      let unfinished = 0, loaded = 0, exists = 0, dup = 0, noitem = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const item = up(r.item);
        if (!item) { results[i] = 'noitem'; noitem++; continue; }   // no item code ⇒ can't create a row
        const floor = levelSeg(String(r.floor ?? '').trim());
        const flat = String(r.flat ?? '').trim().replace(/^F(?=[0-9])/i, '');
        const room = up(r.room);
        const block = up(r.block) || null;
        const elevation = up(r.elevation) || null;
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, flat, floor, room, item });
        if (dupCheck && existing.has(full_code)) { results[i] = 'exists'; exists++; continue; }
        if (seen.has(full_code)) { results[i] = 'dup'; dup++; continue; }
        seen.add(full_code);
        const incomplete = !isRowComplete(r);
        if (incomplete) unfinished++;
        results[i] = 'loaded'; loaded++;
        fields.push({
          tenant_id: ctx.tenant_id, job_id: job.id, stage: 'scanned', incomplete, from_import: true,
          created_by: ctx.id, created_via: 'import',
          block, elevation, floor: floor || null, flat: flat || null, room_code: room || null, item_code: item,
          material: str(r.material), item_type: str(r.item_type), window_type: str(r.window_type),
          glass: str(r.glass), safety_glass: str(r.safety_glass), glazing: str(r.glazing), glazing_bars: str(r.glazing_bars),
          width_mm: toMm(r.width_mm), height_mm: toMm(r.height_mm), cill_depth: str(r.cill_depth),
          transom1_mm: toMm(r.transom1_mm), transom2_mm: toMm(r.transom2_mm), transom3_mm: toMm(r.transom3_mm),
          mullion1_mm: toMm(r.mullion1_mm), mullion2_mm: toMm(r.mullion2_mm), mullion3_mm: toMm(r.mullion3_mm),
          open_in_out: str(r.open_in_out), add_ons: str(r.add_ons), coupled: str(r.coupled),
          design_code: str(r.design_code), comments: str(r.comments), full_code,
        });
      }
      try {
        const inserted = await bulkInsertSurveyItems(fields);
        audit(ctx, 'import.commit', 'job', code, `Imported ${inserted} item(s) from Excel on ${job.client_code}.${job.job_code}${unfinished ? ' · ' + unfinished + ' unfinished' : ''}${exists ? ' · ' + exists + ' already existed' : ''}${dup ? ' · ' + dup + ' in-sheet dup' : ''}`);
        send(res, 200, { ok: true, inserted, unfinished, results, counts: { loaded, exists, dup, noitem } });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p === '/api/jobs' && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const b = await readJson(req);
      const client_code = String(b.client_code ?? '').trim().toUpperCase();
      const job_code = String(b.job_code ?? '').trim().toUpperCase();
      const name = String(b.name ?? '').trim();
      const postcode = String(b.postcode ?? '').trim();
      const site_address = String(b.site_address ?? '').trim();
      const delivery_address = String(b.delivery_address ?? '').trim();
      const delivery_postcode = String(b.delivery_postcode ?? '').trim();
      if (!client_code || !job_code) { send(res, 400, { error: 'Client code and job code are required (they form the job code, e.g. AXS.LAB).' }); return; }
      if (!name) { send(res, 400, { error: 'A job name is required.' }); return; }
      if (!site_address) { send(res, 400, { error: 'A site address is required.' }); return; }
      if (!postcode) { send(res, 400, { error: 'A site postcode is required.' }); return; }
      if (!delivery_address) { send(res, 400, { error: 'A delivery address is required.' }); return; }
      if (!delivery_postcode) { send(res, 400, { error: 'A delivery postcode is required.' }); return; }
      const customerCard = await getCustomerByCode(ctx.tenant_id, client_code);
      if (!customerCard) { send(res, 400, { error: `No customer card for "${client_code}". Create it first in Admin ▸ Customers, then add the job.` }); return; }
      const site_code = String(b.site_code ?? '').trim() || `${client_code}.${job_code}`;
      try {
        const job = await createJob(ctx.tenant_id, { client_code, job_code, name, site_address, postcode, site_code, delivery_address, delivery_postcode, multi_elevation: !!b.multi_elevation, dates: pickJobDates(b) });
        audit(ctx, 'job.create', 'job', job.id, `Created job ${job.client_code}.${job.job_code} — ${name} (site ${site_code})`);
        send(res, 200, { ok: true, id: job.id, code: `${job.client_code}.${job.job_code}`, site_code });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: `A job with site code "${site_code}" already exists. Give this one a different site code.` }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }

    // Get a job's editable details (managers) — for the Edit job dialog.
    if (p.startsWith('/api/job/') && req.method === 'GET' && p.split('/').length === 4) {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      { const dd: Record<string, unknown> = {}; for (const k of JOB_DATE_FIELDS) dd[k] = (job as any)[k] ?? null;
        send(res, 200, { id: job.id, code: `${job.client_code}.${job.job_code}`, name: job.name, site_address: (job as any).site_address ?? null, postcode: (job as any).postcode ?? null, site_code: (job as any).site_code ?? null, delivery_address: (job as any).delivery_address ?? null, delivery_postcode: (job as any).delivery_postcode ?? null, multi_elevation: !!(job as any).multi_elevation, ...dd }); }
      return;
    }
    // Edit a job's details (name / address / postcode) — managers only.
    if (p.startsWith('/api/job/') && req.method === 'PUT' && p.split('/').length === 4) {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const name = String(b.name ?? '').trim();
      const postcode = String(b.postcode ?? '').trim();
      const site_address = String(b.site_address ?? '').trim();
      const delivery_address = String(b.delivery_address ?? '').trim();
      const delivery_postcode = String(b.delivery_postcode ?? '').trim();
      if (!name) { send(res, 400, { error: 'Job name is required.' }); return; }
      if (!site_address) { send(res, 400, { error: 'Site address is required.' }); return; }
      if (!postcode) { send(res, 400, { error: 'Site postcode is required.' }); return; }
      if (!delivery_address) { send(res, 400, { error: 'Delivery address is required.' }); return; }
      if (!delivery_postcode) { send(res, 400, { error: 'Delivery postcode is required.' }); return; }
      const site_code = String(b.site_code ?? '').trim() || `${job.client_code}.${job.job_code}`;
      await updateJobDetails(ctx.tenant_id, job.id, { name, site_address, postcode, site_code, delivery_address, delivery_postcode, multi_elevation: !!b.multi_elevation, dates: pickJobDates(b) });
      audit(ctx, 'job.update', 'job', code, `Edited details for ${code}`);
      send(res, 200, { ok: true });
      return;
    }

    // Delete a job — only when it has no items.
    if (p.startsWith('/api/job/') && req.method === 'DELETE' && p.split('/').length === 4) {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const n = await countItemsForJob(job.id);
      if (n > 0) { send(res, 409, { error: `This job has ${n} item${n === 1 ? '' : 's'}. Delete or move them first — a job can only be removed when it's empty.` }); return; }
      await deleteJob(job.id, ctx.tenant_id);
      audit(ctx, 'job.delete', 'job', code, `Deleted job ${code}`);
      send(res, 200, { ok: true });
      return;
    }

    // ---- job file attachments (drawings / PDFs / zips) ----
    if (p.startsWith('/api/job/') && p.endsWith('/files') && req.method === 'GET') {
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const files = await listJobFiles(job.id);
      const out = await Promise.all(files.map(async (f) => ({
        id: f.id, name: f.name, content_type: f.content_type, size_bytes: f.size_bytes, url: await signedJobFileUrl(f.storage_path),
      })));
      send(res, 200, out);
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/files') && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const files = Array.isArray(b.files) ? b.files : [];
      let saved = 0; const names: string[] = [];
      for (const f of files) {
        const name = String(f.name ?? 'file').trim() || 'file';
        const m = /^data:([^;]*);base64,(.+)$/.exec(String(f.dataUrl ?? ''));
        if (!m) continue;
        const contentType = m[1] || 'application/octet-stream';
        const bytes = Buffer.from(m[2], 'base64');
        if (bytes.length > 25 * 1024 * 1024) { send(res, 400, { error: `"${name}" is over 25MB.` }); return; }
        const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
        const path = `${ctx.tenant_id}/${job.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
        try {
          await ensureJobFileBucket();
          await uploadJobFile(path, bytes, contentType);
          await insertJobFile({ tenant_id: ctx.tenant_id, job_id: job.id, name, storage_path: path, content_type: contentType, size_bytes: bytes.length });
          saved++; names.push(name);
        } catch (err: any) { send(res, 500, { error: 'Upload failed: ' + (err?.message ?? String(err)) }); return; }
      }
      if (saved) audit(ctx, 'job.files', 'job', code, `Added ${saved} file(s) to ${code}: ${names.join(', ')}`);
      send(res, 200, { ok: true, saved });
      return;
    }
    if (p.startsWith('/api/job/') && p.includes('/files/') && req.method === 'DELETE') {
      if (!(ctx.role === 'admin' || ctx.role === 'office')) { send(res, 403, { error: 'Managers only' }); return; }
      const parts = p.split('/'); const code = decodeURIComponent(parts[3] ?? ''); const fileId = parts[5];
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      await deleteJobFile(fileId, ctx.tenant_id);
      audit(ctx, 'job.files.delete', 'job', code, `Removed a file from ${code}`);
      send(res, 200, { ok: true });
      return;
    }

    if (p === '/api/items' && req.method === 'GET') {
      const code = url.searchParams.get('job') ?? 'AXS.LAB';
      const teams = await listTeams(ctx.tenant_id);
      if (code === 'ALL') {
        const jobs = await listJobs(ctx.tenant_id);
        const rows: any[] = [];
        for (const jb of jobs) { const items = await listSurveyItems(jb.id); for (const it of items) rows.push(itemRow(it, jb, teams)); }
        send(res, 200, { job: { code: 'ALL', name: 'All jobs', board: null }, teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })), items: rows, role: ctx.role });
        return;
      }
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const items = await listSurveyItems(job.id);
      send(res, 200, {
        job: { id: job.id, code: `${job.client_code}.${job.job_code}`, name: job.name, board: job.monday_board_id, postcode: (job as any).postcode ?? null, site_code: (job as any).site_code ?? null },
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        items: items.map((it) => itemRow(it, job, teams)), role: ctx.role,
      });
      return;
    }

    // Create a new survey item from the desk (populates a fresh board without the mobile app).
    if (p === '/api/items' && req.method === 'POST') {
      if (!allow('items.create')) return;
      const b = await readJson(req);
      const job = await getJobByRef(String(b.job ?? ''));
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const room = String(b.room ?? '').trim().toUpperCase();
      const item = String(b.item ?? '').trim().toUpperCase();
      if (!room || !item) { send(res, 400, { error: 'Room and Item are required (they form the code).' }); return; }
      const full_code = assembleFullCode({
        client: job.client_code, job: job.job_code,
        block: b.block, elevation: b.elevation, flat: b.flat, room, item, floor: b.floor,
      });
      const num = (v: any) => (v === '' || v == null ? null : Math.round(Number(v)));
      const str = (v: any) => { const t = (v ?? '').toString().trim(); return t === '' ? null : t; };
      const fields: Record<string, unknown> = {
        tenant_id: ctx.tenant_id, job_id: job.id, stage: 'surveyed',
        block: b.block || null, elevation: b.elevation || null, flat: b.flat || null,
        room_code: room, item_code: item, floor: b.floor || null, full_code,
        material: str(b.material), item_type: str(b.item_type), window_type: str(b.window_type),
        glass: str(b.glass), safety_glass: str(b.safety_glass), glazing: str(b.glazing),
        width_mm: num(b.width_mm), height_mm: num(b.height_mm), cill_depth_mm: num(b.cill_depth_mm),
        transom1_mm: num(b.transom1_mm), transom2_mm: num(b.transom2_mm), transom3_mm: num(b.transom3_mm),
        mullion1_mm: num(b.mullion1_mm), mullion2_mm: num(b.mullion2_mm), mullion3_mm: num(b.mullion3_mm),
        open_in_out: str(b.open_in_out), add_ons: str(b.add_ons), coupled: str(b.coupled),
        design_code: str(b.design_code),
        comments: str(b.comments), team_id: b.team_id || null,
        created_by: ctx.id, created_via: 'manual', surveyed_by: ctx.id,
      };
      // A desk-created item is Surveyed on creation, so it must have all required data (style included).
      {
        const cRow = { block: fields.block, elevation: fields.elevation, flat: fields.flat, floor: fields.floor, room: fields.room_code, item: fields.item_code,
          material: fields.material, item_type: fields.item_type, glass: fields.glass, glazing: fields.glazing, width_mm: fields.width_mm, height_mm: fields.height_mm, open_in_out: fields.open_in_out, design_code: fields.design_code };
        const cmiss = missingRequired(cRow);
        if (cmiss.length) { send(res, 400, { error: 'Can’t create the item — still missing: ' + cmiss.map((k) => FIELD_LABELS[k] || k).join(', ') }); return; }
      }
      try {
        const created = await insertSurveyItem(fields);
        audit(ctx, 'item.create', 'item', created.id, `Created ${full_code}`);
        send(res, 200, { ok: true, id: created.id, full_code });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: `An item with code ${full_code} already exists.` }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }

    // Bulk actions on many selected items (multi-line processing).
    if (p === '/api/items/bulk' && req.method === 'POST') {
      const { ids, action, value } = await readJson(req);
      if (!Array.isArray(ids) || ids.length === 0) { send(res, 400, { error: 'No items selected.' }); return; }
      const allowed = await filterItemIdsByTenant(ids, ctx.tenant_id);
      if (allowed.length === 0) { send(res, 403, { error: 'forbidden' }); return; }

      if (action === 'team') {
        if (!allow('items.edit')) return;
        const n = await bulkUpdateItems(allowed, { team_id: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      if (action === 'status') {
        if (!(can(ctx.role, 'items.fit') || can(ctx.role, 'items.edit'))) { allow('items.fit'); return; }
        const n = await bulkUpdateItems(allowed, { install_status: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      // Clear the 'Unfinished' flag on selected items whose mandatory fields are ALL complete.
      // Items still missing anything are left untouched (skipped) — validation, not a blind set.
      if (action === 'finish') {
        if (!allow('items.edit')) return;
        let updated = 0, skipped = 0;
        for (const id of allowed) {
          const it: any = await getSurveyItem(id);
          if ((it.kind ?? 'item') === 'snag') { skipped++; continue; }
          const row = { block: it.block, elevation: it.elevation, flat: it.flat, floor: it.floor, room: it.room_code, item: it.item_code,
            material: it.material, item_type: it.item_type, glass: it.glass, glazing: it.glazing, width_mm: it.width_mm, height_mm: it.height_mm, open_in_out: it.open_in_out, design_code: it.design_code };
          if (!isRowComplete(row)) { skipped++; continue; }               // still missing something -> don't promote
          const patch: any = { incomplete: false };
          if (it.stage !== 'synced') patch.stage = 'surveyed';            // promote to Surveyed; never downgrade a synced item
          const { error } = await db().from('survey_items').update(patch).eq('id', id).eq('tenant_id', ctx.tenant_id);
          if (!error) updated++;
        }
        send(res, 200, { ok: true, updated, skipped }); return;
      }
      // Spec text/enum fields — set on selected (blank clears). The resync trigger flags synced
      // items so the change re-pushes to Monday. Column name == action name.
      if (['glazing', 'glass', 'material', 'item_type', 'open_in_out', 'design_code'].includes(action)) {
        if (!allow('items.edit')) return;
        const n = await bulkUpdateItems(allowed, { [action]: String(value ?? '').trim() || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      // Numeric spec fields — Width / Height in mm (blank clears).
      if (action === 'width' || action === 'height') {
        if (!allow('items.edit')) return;
        const col = action === 'width' ? 'width_mm' : 'height_mm';
        const raw = String(value ?? '').trim();
        const num = raw === '' ? null : Math.round(Number(raw));
        if (raw !== '' && (!Number.isFinite(num as number) || (num as number) < 0)) { send(res, 400, { error: 'Width / Height must be a whole number of millimetres.' }); return; }
        const n = await bulkUpdateItems(allowed, { [col]: num }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      if (action === 'block' || action === 'elevation' || action === 'floor' || action === 'flat' || action === 'room' || action === 'item') {
        if (!allow('items.edit')) return;
        // Sets the field AND rebuilds each item's code — skipped for items already synced to Monday.
        const raw = String(value ?? '').trim();
        const jobCache: Record<string, any> = {};
        let updated = 0, locked = 0, dupes = 0;
        for (const id of allowed) {
          const it: any = await getSurveyItem(id);
          if (it.monday_item_id) { locked++; continue; } // code locked after sync
          const job = jobCache[it.job_id] || (jobCache[it.job_id] = await getJob(it.job_id));
          let block = it.block, elevation = it.elevation, flat = it.flat, floor = it.floor, room = it.room_code, item = it.item_code;
          if (action === 'block') block = raw.toUpperCase() || null;
          else if (action === 'elevation') elevation = raw.toUpperCase() || null;
          else if (action === 'floor') { floor = levelSeg(raw) || null; } // Floor and Flat are independent; don't clear the other
          else if (action === 'flat') { flat = raw.replace(/^F(?=[0-9])/i, '').toUpperCase() || null; }
          else if (action === 'room') room = raw.toUpperCase() || null;
          else if (action === 'item') item = raw.toUpperCase() || null;
          const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, flat, floor, room, item });
          if (await codeExists(it.job_id, full_code, id)) { dupes++; continue; }
          const { error } = await db().from('survey_items').update({ block, elevation, flat, floor, room_code: room, item_code: item, full_code }).eq('id', id).eq('tenant_id', ctx.tenant_id);
          if (!error) updated++;
        }
        send(res, 200, { ok: true, updated, skipped: locked + dupes, locked, dupes }); return;
      }
      if (action === 'po') {
        // Group items into a PO phase. Only Surveyed items accept a phase (others are skipped);
        // clearing (blank value) is allowed on any stage.
        if (!allow('items.edit')) return;
        const raw = String(value ?? '').trim();
        if (raw === '') { const n = await bulkUpdateItems(allowed, { po_phase: null }, ctx.tenant_id); send(res, 200, { ok: true, updated: n }); return; }
        const ph = Math.round(Number(raw));
        if (!Number.isFinite(ph) || ph < 1) { send(res, 400, { error: 'PO phase must be a whole number (1 or higher).' }); return; }
        let updated = 0, skipped = 0, locked = 0;
        for (const id of allowed) {
          const it: any = await getSurveyItem(id);
          if (it.stage !== 'surveyed' && it.stage !== 'synced') { skipped++; continue; }
          if (it.po_ready_at && ctx.role !== 'admin') { locked++; continue; }  // ready-for-PO lock
          const { error } = await db().from('survey_items').update({ po_phase: ph, po_ready_by: null, po_ready_at: null }).eq('id', id).eq('tenant_id', ctx.tenant_id);
          if (!error) updated++;
        }
        send(res, 200, { ok: true, updated, skipped: skipped + locked, locked }); return;
      }
      if (action === 'delete') {
        // Destructive — managers only (matches the DB delete policy: admin/office).
        if (!(ctx.role === 'admin' || ctx.role === 'office')) { send(res, 403, { error: `Your role (${ctx.role}) can't delete items.` }); return; }
        const n = await bulkDeleteItems(allowed, ctx.tenant_id);
        audit(ctx, 'item.delete', 'item', null, `Deleted ${n} item(s)`);
        send(res, 200, { ok: true, deleted: n }); return;
      }
      if (action === 'sync') {
        if (!allow('monday.sync')) return;
        let created = 0, updated = 0, failed = 0; const errors: string[] = [];
        for (const id of allowed) {
          try { const r = await promoteItem(id); r.action === 'created' ? created++ : updated++; }
          catch (err: any) { failed++; if (errors.length < 3) errors.push(err?.message ?? String(err)); }
        }
        audit(ctx, 'item.sync', 'item', null, `Synced ${created + updated} item(s) to Monday${failed ? ' (' + failed + ' failed)' : ''}`);
        send(res, 200, { ok: true, total: allowed.length, created, updated, failed, errors }); return;
      }
      send(res, 400, { error: 'Unknown bulk action.' }); return;
    }

    // Phase A recognition assist: analyse an item's photo with the vision model.
    if (p.startsWith('/api/recognise/') && req.method === 'POST') {
      if (!allow('items.edit')) return;
      const id = p.split('/').pop()!;
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      try { const recognition = await recogniseItemPhoto(id); send(res, 200, { ok: true, recognition }); }
      catch (e: any) { send(res, 200, { ok: false, error: e?.message ?? String(e) }); }
      return;
    }

    // Full item detail + photos (read-only drawer).
    if (p.startsWith('/api/item/') && p.endsWith('/detail') && req.method === 'GET') {
      const id = p.split('/')[3];
      const it: any = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const [job, team, photos, childSnags, allTeams] = await Promise.all([
        getJob(it.job_id), getTeam(it.team_id), listItemPhotos(id), listChildSnags(id), listTeams(it.tenant_id),
      ]);
      const photoOut = await Promise.all(photos.map(async (ph) => ({
        kind: PHOTO_KIND_LABEL[ph.kind] ?? ph.kind, url: await signedPhotoUrl(ph.storage_path),
      })));
      const snagOut = childSnags.map((s) => ({
        id: s.id, full_code: s.full_code, comment: (s as any).snag_comment ?? s.comments,
        rate: formatPennies(effectiveRatePennies(s, allTeams)),
        team: allTeams.find((t) => t.id === s.team_id)?.name ?? null,
        status: s.install_status, synced: !!s.monday_item_id,
        monday_url: s.monday_item_id && job.monday_board_id ? mondayItemUrl(job, s.monday_item_id) : null,
      }));
      const requirements = await requirementNamesForClientCode(ctx.tenant_id, job.client_code);
      send(res, 200, {
        item: it, team: team?.name ?? null, teams: allTeams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        effective_rate: formatPennies(effectiveRatePennies(it, team ? [team] : [])),
        monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
        photos: photoOut, snags: snagOut, is_snag: (it as any).kind === 'snag',
        customer_code: job.client_code, requirements,
      });
      return;
    }

    // Per-item activity timeline: creation (who/when/via) + every recorded change, newest first.
    if (p.startsWith('/api/item/') && p.endsWith('/activity') && req.method === 'GET') {
      const id = p.split('/')[3];
      const it: any = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      // Change rows (exclude item.create — the creation event is synthesised from the item row below,
      // so it's shown once with the created_via origin).
      const rows = (await listItemActivity(ctx.tenant_id, id)).filter((r: any) => r.action !== 'item.create');
      const names = await userNames([it.created_by, it.scanned_by, it.surveyed_by].filter(Boolean));
      const events = rows.map((r: any) => ({
        at: r.created_at, actor: r.actor_name ?? '—', role: r.actor_role ?? null,
        action: r.action, summary: r.summary ?? '', changes: Array.isArray(r.details) ? r.details : [],
      }));
      const created = {
        at: it.created_at, actor: (it.created_by && names[it.created_by]) || null,
        via: it.created_via || null,
      };
      send(res, 200, { created, events });
      return;
    }

    // Raise a snag as its own item (own labour cost + team), optionally with a defect photo.
    if (p.startsWith('/api/item/') && p.endsWith('/snags') && req.method === 'POST') {
      if (!allow('snags.raise')) return;
      const id = p.split('/')[3];
      const it: any = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      if (it.kind === 'snag') { send(res, 400, { error: "You can't raise a snag against a snag." }); return; }
      const b = await readJson(req);
      const description = String(b.description ?? '').trim();
      if (!description) { send(res, 400, { error: 'A snag description is required.' }); return; }
      const rate_override_pennies = (b.rate_pennies === '' || b.rate_pennies == null) ? null : Math.round(Number(b.rate_pennies));
      const team_id = b.team_id || null;
      const snag = await createSnagItem(id, { comment: description, rate_override_pennies, team_id });
      if (b.photo) {
        try {
          const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.photo));
          if (m) {
            const bytes = Buffer.from(m[2], 'base64');
            if (bytes.length <= 6 * 1024 * 1024) {
              const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
              const path = `snags/${snag.id}/${Date.now()}.${ext}`;
              await ensurePhotoBucket();
              await uploadPhoto(path, bytes, m[1]);
              await addItemPhoto(it.tenant_id, snag.id, 'sketch', path); // -> Design Sketch on sync
            }
          }
        } catch { /* photo is best-effort; the snag item is created regardless */ }
      }
      send(res, 200, { ok: true, id: snag.id, full_code: snag.full_code });
      return;
    }

    // Attach a photo to an item from the office (mirrors the mobile survey upload: bucket 'photos',
    // path tenant/item/..., kind 'survey' so it also pushes to Monday's Design Sketch on sync).
    if (p.startsWith('/api/item/') && p.endsWith('/photo') && req.method === 'POST') {
      if (!allow('photos.add')) return;
      const id = p.split('/')[3];
      const it: any = await getSurveyItem(id);
      if (!it || it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.photo ?? ''));
      if (!m) { send(res, 400, { error: 'A photo is required.' }); return; }
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > 6 * 1024 * 1024) { send(res, 400, { error: 'Photo too large (max 6MB).' }); return; }
      const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
      const path = `${it.tenant_id}/${it.id}/${Date.now()}.${ext}`;
      // Route by uploader role: fitters take "after" (install) photos → Picture After;
      // scanner / surveyor / office / admin take "before" photos → Picture Before.
      const kind = ctx.role === 'fitter' ? 'after' : 'before';
      try {
        await ensurePhotoBucket();
        await uploadPhoto(path, bytes, m[1]);
        await addItemPhoto(it.tenant_id, it.id, kind, path);
      } catch (err: any) { send(res, 500, { error: 'Upload failed: ' + (err?.message ?? String(err)) }); return; }
      send(res, 200, { ok: true, kind });
      return;
    }

    if (p.startsWith('/api/item/') && req.method === 'PUT' && !p.endsWith('/pin') && !p.endsWith('/pricing')) {
      const id = p.split('/').pop()!;
      const body = await readJson(req);
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      // Editable specification fields (mirrors the New-item / mobile form).
      const SPEC_STR = ['material', 'item_type', 'window_type', 'glass', 'safety_glass', 'glazing', 'glazing_bars', 'cill_depth', 'open_in_out', 'add_ons', 'coupled', 'design_code', 'comments'];
      const SPEC_NUM = ['width_mm', 'height_mm', 'cill_depth_mm', 'transom1_mm', 'transom2_mm', 'transom3_mm', 'mullion1_mm', 'mullion2_mm', 'mullion3_mm'];
      const SPEC_BOOL = ['transom_equal', 'mullion_equal'];
      const STAGES = ['scanned', 'in_survey', 'surveyed', 'synced'];
      // Spec/rate/team/stage edits need items.edit; a status-only change needs items.fit (or edit).
      const touchesSpec = ('rate_override_pennies' in body) || ('team_id' in body) || ('stage' in body) || ('po_phase' in body)
        || SPEC_STR.some((k) => k in body) || SPEC_NUM.some((k) => k in body) || SPEC_BOOL.some((k) => k in body);
      if (touchesSpec) { if (!allow('items.edit')) return; }
      else if ('install_status' in body) {
        if (!(can(ctx.role, 'items.fit') || can(ctx.role, 'items.edit'))) { allow('items.fit'); return; }
      }
      const patch: Record<string, unknown> = {};
      if ('rate_override_pennies' in body)
        patch.rate_override_pennies = (body.rate_override_pennies === '' || body.rate_override_pennies == null) ? null : Math.round(Number(body.rate_override_pennies));
      if ('install_status' in body) patch.install_status = body.install_status || null;
      if ('team_id' in body) patch.team_id = body.team_id || null;
      for (const k of SPEC_STR) if (k in body) patch[k] = (String(body[k] ?? '').trim()) || null;
      for (const k of SPEC_NUM) if (k in body) { const v = body[k]; patch[k] = (v === '' || v == null) ? null : Math.round(Number(v)); }
      for (const k of SPEC_BOOL) if (k in body) patch[k] = !!body[k];
      if ('stage' in body) { if (!STAGES.includes(String(body.stage))) { send(res, 400, { error: 'Invalid stage.' }); return; } patch.stage = body.stage; }
      // PO phase: a number grouping items into a purchase order. Assigning one is allowed only on
      // a Surveyed item (clearing it is always allowed). Uses the item's current stage unless this
      // same request is also promoting it to 'surveyed'.
      if ('po_phase' in body) {
        // A phase marked "ready for PO" is locked — only an admin can change items in it.
        if ((item as any).po_ready_at && ctx.role !== 'admin') { send(res, 400, { error: 'This PO phase is marked ready for PO and is locked — only an admin can change it.' }); return; }
        const raw = body.po_phase;
        if (raw === '' || raw == null) { patch.po_phase = null; patch.po_ready_by = null; patch.po_ready_at = null; }
        else {
          const n = Math.round(Number(raw));
          if (!Number.isFinite(n) || n < 1) { send(res, 400, { error: 'PO phase must be a whole number (1 or higher).' }); return; }
          const effectiveStage = (patch.stage as string) ?? item.stage;
          if (effectiveStage !== 'surveyed' && effectiveStage !== 'synced') { send(res, 400, { error: 'A PO phase can only be assigned once the item is Surveyed.' }); return; }
          patch.po_phase = n; patch.po_ready_by = null; patch.po_ready_at = null;
        }
      }
      // Editing Flat / Room rebuilds the item code — allowed only until it's synced to Monday.
      if ('flat' in body || 'room' in body) {
        if (!allow('items.edit')) return;
        if (item.monday_item_id) { send(res, 400, { error: 'This item is synced to Monday — its code is locked. Un-sync it first to change Flat/Room.' }); return; }
        const job = await getJob(item.job_id);
        const newFlat = 'flat' in body ? (String(body.flat ?? '').trim().replace(/^F(?=[0-9])/i, '').toUpperCase() || null) : (item.flat ?? null);
        const newRoom = 'room' in body ? (String(body.room ?? '').trim().toUpperCase() || null) : (item.room_code ?? null);
        // Floor and Flat are independent fields — keep the floor as-is (Flat is just what the code uses as its F-segment).
        const newFloor = item.floor ?? null;
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block: item.block, elevation: item.elevation, flat: newFlat, floor: newFloor, room: newRoom, item: item.item_code });
        if (await codeExists(item.job_id, full_code, id)) { send(res, 409, { error: `Code ${full_code} already exists in this job — pick a different Flat/Room.` }); return; }
        patch.flat = newFlat; patch.room_code = newRoom; patch.floor = newFloor; patch.full_code = full_code;
      }
      // The completeness of the item after this edit (used for the Unfinished flag and the Surveyed gate).
      {
        const m: any = { ...item, ...patch };
        const row = { block: m.block, elevation: m.elevation, flat: m.flat, floor: m.floor, room: m.room_code, item: m.item_code,
          material: m.material, item_type: m.item_type, glass: m.glass, glazing: m.glazing, width_mm: m.width_mm, height_mm: m.height_mm, open_in_out: m.open_in_out, design_code: m.design_code };
        // Can't move an item to 'Surveyed' while required data is still missing (style included).
        if (patch.stage === 'surveyed') {
          const miss = missingRequired(row).map((k) => FIELD_LABELS[k] || k);
          if (miss.length) { send(res, 400, { error: 'Can’t mark Surveyed — still missing: ' + miss.join(', ') }); return; }
        }
        // An item flagged 'Unfinished' (from an Excel import) clears itself once all required data is present.
        if (item.incomplete && isRowComplete(row)) patch.incomplete = false;
      }
      const { error } = await db().from('survey_items').update(patch).eq('id', id);
      if (error) { send(res, 500, { error: error.message }); return; }
      // Field-level before→after for the item's activity timeline (skip internal-only fields).
      const HIDE = new Set(['full_code', 'incomplete']);
      const before: any = item;
      const changes = Object.keys(patch).filter((k) => !HIDE.has(k)).map((k) => ({
        field: k, from: before[k] ?? null, to: (patch as any)[k] ?? null,
      })).filter((c) => String(c.from ?? '') !== String(c.to ?? ''));
      if (changes.length) {
        audit(ctx, 'item.update', 'item', id, `${(patch.full_code as string) || item.full_code}: ${changes.map((c) => c.field).join(', ')}`, changes);
      }
      send(res, 200, { ok: true });
      return;
    }

    if (p.startsWith('/api/promote/') && req.method === 'POST') {
      if (!allow('monday.sync')) return;
      const id = p.split('/').pop()!;
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const r = await promoteItem(id);
      audit(ctx, 'item.sync', 'item', id, `Synced ${item.full_code} to Monday (${r.action})`);
      send(res, 200, { ok: true, action: r.action, mondayItemId: r.mondayItemId, photosPushed: r.photosPushed, photoError: r.photoError });
      return;
    }

    // Audit log (admin only).
    if (p === '/api/leads' && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      send(res, 200, await listDemoLeads(500));
      return;
    }
    if (p === '/api/customers' && req.method === 'GET') {
      if (!allow('jobs.manage')) return;
      send(res, 200, await listCustomers(ctx.tenant_id));
      return;
    }

    // Usage billing: items created per tenant per month x per-item rate. Any admin sees their own
    // tenant; the Acemark (vendor) super-admin sees every tenant.
    if (p === '/api/billing' && req.method === 'GET') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const isSuper = ctx.tenant_id === ACE_TENANT;
      const mp = url.searchParams.get('month') || '';
      const month = /^\d{4}-\d{2}$/.test(mp) ? mp : new Date().toISOString().slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const fromISO = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      const toISO = new Date(Date.UTC(y, m, 1)).toISOString();
      const tenants = isSuper ? await listTenants() : [await getTenant(ctx.tenant_id)].filter(Boolean);
      const rows: any[] = []; let ti = 0, ta = 0;
      for (const t of tenants) {
        const items = await countItemsCreated(t.id, fromISO, toISO);
        const rate = (t as any).item_rate_pennies ?? 0;
        const amount = items * rate;
        rows.push({ tenant_id: t.id, name: t.name, rate_pennies: rate, items, amount_pennies: amount });
        ti += items; ta += amount;
      }
      send(res, 200, { month, superadmin: isSuper, rows, totals: { items: ti, amount_pennies: ta } });
      return;
    }
    // Set a tenant's per-item rate — vendor super-admin only.
    if (p.startsWith('/api/tenants/') && p.endsWith('/rate') && req.method === 'PUT') {
      if (!(ctx.role === 'admin' && ctx.tenant_id === ACE_TENANT)) { send(res, 403, { error: 'Super-admin only' }); return; }
      const id = p.split('/')[3] ?? '';
      const b = await readJson(req);
      let pennies = Math.round(Number(b.rate_pennies ?? 0));
      if (!Number.isFinite(pennies) || pennies < 0) pennies = 0;
      await setTenantRate(id, pennies);
      audit(ctx, 'tenant.rate', 'tenant', id, `Set per-item rate to £${(pennies / 100).toFixed(2)}`);
      send(res, 200, { ok: true });
      return;
    }
    if (p === '/api/logs' && req.method === 'GET') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      send(res, 200, await listAuditLog(ctx.tenant_id, 300));
      return;
    }

    // Room pick frequency (tenant-wide) — orders the new-item room picker, most-used first.
    if (p === '/api/room-stats' && req.method === 'GET') {
      send(res, 200, await roomCodeCounts(ctx.tenant_id));
      return;
    }

    // ---- teams & rates (office Stage 2) ----
    if (p === '/api/teams' && req.method === 'GET') {
      const teams = await listTeams(ctx.tenant_id);
      const rows = await Promise.all(teams.map(async (t) => ({
        id: t.id, name: t.name, default_rate_pennies: t.default_rate_pennies,
        default_rate: formatPennies(t.default_rate_pennies), in_use: await countItemsUsingTeam(t.id),
        door_rate_pennies: t.door_rate_pennies, door_rate: formatPennies(t.door_rate_pennies),
        active: t.active,
      })));
      send(res, 200, { teams: rows, canManage: can(ctx.role, 'teams.manage'), role: ctx.role });
      return;
    }

    if (p === '/api/teams' && req.method === 'POST') {
      if (!allow('teams.manage')) return;
      const { name, rate_pennies } = await readJson(req);
      if (!name || !String(name).trim()) { send(res, 400, { error: 'Team name is required' }); return; }
      const pennies = Math.round(Number(rate_pennies));
      if (!Number.isFinite(pennies) || pennies < 0) { send(res, 400, { error: 'Rate must be a positive number' }); return; }
      const t = await createTeam(ctx.tenant_id, String(name).trim(), pennies);
      send(res, 200, { ok: true, id: t.id });
      return;
    }

    if (p.startsWith('/api/teams/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!allow('teams.manage')) return;
      const id = p.split('/').pop()!;
      const team = await getTeam(id);
      if (!team || team.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }

      if (req.method === 'PUT') {
        const body = await readJson(req);
        const patch: { name?: string; default_rate_pennies?: number; door_rate_pennies?: number } = {};
        if ('name' in body) { if (!String(body.name).trim()) { send(res, 400, { error: 'Team name is required' }); return; } patch.name = String(body.name).trim(); }
        if ('rate_pennies' in body) { const v = Math.round(Number(body.rate_pennies)); if (!Number.isFinite(v) || v < 0) { send(res, 400, { error: 'Rate must be a positive number' }); return; } patch.default_rate_pennies = v; }
        if ('door_rate_pennies' in body) { const v = Math.round(Number(body.door_rate_pennies)); if (!Number.isFinite(v) || v < 0) { send(res, 400, { error: 'Doors rate must be a positive number' }); return; } patch.door_rate_pennies = v; }
        if ('active' in body) patch.active = !!body.active; // retire / reactivate
        await updateTeam(id, patch);
        send(res, 200, { ok: true });
        return;
      }

      // DELETE — block if any items still reference this team.
      const inUse = await countItemsUsingTeam(id);
      if (inUse > 0) { send(res, 409, { error: `Can't delete — ${inUse} item${inUse === 1 ? '' : 's'} still assigned to this team. Reassign them first.` }); return; }
      await deleteTeam(id);
      send(res, 200, { ok: true });
      return;
    }

    // ---- Monday sync tab (office Stage 2) ----
    if (p === '/api/sync' && req.method === 'GET') {
      const jobs = await listJobs(ctx.tenant_id);
      const rows = await Promise.all(jobs.map(async (j) => {
        const items = await listSurveyItems(j.id);
        const synced = items.filter((it) => it.monday_item_id).length;
        return {
          id: j.id, code: `${j.client_code}.${j.job_code}`, name: j.name, board: j.monday_board_id ?? null,
          slug: j.monday_account_slug ?? null,
          total: items.length, synced, unsynced: items.length - synced,
        };
      }));
      send(res, 200, { jobs: rows, canManage: can(ctx.role, 'monday.sync') });
      return;
    }

    // Link / unlink a job's Monday board. Accepts a board id or a full board URL.
    if (p.startsWith('/api/job/') && p.endsWith('/board') && req.method === 'PUT') {
      if (!allow('monday.sync')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const { board } = await readJson(req);
      const { board: boardId, slug } = parseMondayRef(board);
      await setJobBoard(job.id, boardId, slug);
      // On link, ensure the board has every required column — create any that are missing.
      let columnsCreated: string[] = []; let columnsError: string | undefined;
      if (boardId) {
        try {
          const monday = new Monday();
          const existing = await monday.getColumns(boardId);
          const have = new Set(existing.map((c) => normColTitle(c.title)));
          for (const req of REQUIRED_MONDAY_COLUMNS) {
            if (have.has(normColTitle(req.title))) continue;
            try { await monday.createColumn(boardId, req.title, req.type); columnsCreated.push(req.title); }
            catch (e: any) { columnsError = e?.message ?? String(e); }
          }
        } catch (e: any) { columnsError = e?.message ?? String(e); }
      }
      audit(ctx, 'job.board', 'job', code, boardId ? `Linked board ${boardId} to ${code}${columnsCreated.length ? ' · ' + columnsCreated.length + ' columns created' : ''}` : `Unlinked board from ${code}`);
      send(res, 200, { ok: true, board: boardId, slug, columnsCreated, columnsError });
      return;
    }

    // Batch-sync every item on a job to its board. Idempotent (create or update per item).
    if (p.startsWith('/api/job/') && p.endsWith('/sync') && req.method === 'POST') {
      if (!allow('monday.sync')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      if (!job.monday_board_id) { send(res, 400, { error: 'Link a Monday board for this job first.' }); return; }
      const items = await listSurveyItems(job.id);
      let created = 0, updated = 0, failed = 0; const errors: string[] = [];
      for (const it of items) {
        try { const r = await promoteItem(it.id); r.action === 'created' ? created++ : updated++; }
        catch (err: any) { failed++; if (errors.length < 3) errors.push(`${it.full_code}: ${err?.message ?? err}`); }
      }
      send(res, 200, { ok: true, total: items.length, created, updated, failed, errors });
      return;
    }

    // Pull the team assignment back FROM Monday (Monday is master for scheduling). Reads the
    // "Fitters" column for every synced item on the job and sets survey_items.team_id to the
    // matching team (by name). Doesn't re-flag items for re-sync (we just read this from Monday).
    if (p.startsWith('/api/job/') && p.endsWith('/pull-fitters') && req.method === 'POST') {
      if (!allow('monday.sync')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      if (!job.monday_board_id) { send(res, 400, { error: 'Link a Monday board for this job first.' }); return; }

      const mon = new Monday();
      const cols = await mon.getColumns(job.monday_board_id);
      const fittersCol = cols.find((col) => normTitle(col.title) === 'fitters');
      if (!fittersCol) { send(res, 400, { error: 'No "Fitters" column found on this board.' }); return; }

      const teams = await listTeams(ctx.tenant_id);
      const teamByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
      const rows = await mon.getColumnTextForItems(job.monday_board_id, fittersCol.id);
      const textByMondayId = new Map(rows.map((r) => [r.id, (r.text ?? '').trim()]));

      // Also pull the planned install date, if the board has a suitable date column.
      const dateCol = pickDateColumn(cols);
      const dateByMondayId = new Map<string, string | null>();
      if (dateCol) {
        const drows = await mon.getColumnTextForItems(job.monday_board_id, dateCol.id);
        for (const r of drows) dateByMondayId.set(r.id, parseMondayDate(r.text));
      }

      const items = await listSurveyItems(job.id);
      let assigned = 0, cleared = 0, datesSet = 0, datesCleared = 0, unchanged = 0; const unmatched = new Set<string>();
      for (const it of items) {
        if (!it.monday_item_id) { unchanged++; continue; }
        const patch: Record<string, unknown> = {};
        // team assignment
        const text = textByMondayId.get(it.monday_item_id) ?? '';
        if (text) {
          const match = teamByName.get(text.toLowerCase());
          if (!match) unmatched.add(text);                                   // unknown team name — leave as is
          else if ((it.team_id ?? null) !== match) patch.team_id = match;
        } else if (it.team_id != null) {
          patch.team_id = null;                                             // cleared on Monday
        }
        // planned install date
        if (dateCol) {
          const nd = dateByMondayId.get(it.monday_item_id) ?? null;
          if (nd !== ((it as any).planned_install_date ?? null)) patch.planned_install_date = nd;
        }
        if (Object.keys(patch).length === 0) { unchanged++; continue; }
        await applyMondayPull(it.id, patch, ctx.tenant_id);
        if ('team_id' in patch) (patch.team_id ? assigned++ : cleared++);
        if ('planned_install_date' in patch) (patch.planned_install_date ? datesSet++ : datesCleared++);
      }
      send(res, 200, {
        ok: true, total: items.length, assigned, cleared, datesSet, datesCleared,
        dateColumn: dateCol?.title ?? null, unchanged, unmatched: [...unmatched],
      });
      return;
    }

    // ---- Plans (plan view with item pins) ----
    // Per-job PDF: survey sheet or install report. Browser downloads it (authed via bearer).
    if (p.startsWith('/api/job/') && p.endsWith('/report.pdf') && req.method === 'GET') {
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const qt = url.searchParams.get('type');
      const type = (qt === 'install' ? 'install' : qt === 'customer_install' ? 'customer_install' : 'survey') as 'survey' | 'install' | 'customer_install';
      let job: any;
      try { job = await getJobByRef(code); } catch { send(res, 404, { error: 'Job not found' }); return; }
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      // Customers may ONLY pull the rate-free customer_install, and only for their own client.
      if (ctx.role === 'customer') {
        if (type !== 'customer_install' || job.client_code !== ctx.client_code) { send(res, 403, { error: 'forbidden' }); return; }
      } else if (!allow('dashboard.view')) return;
      try {
        const { buffer } = await buildJobReportPdf(code, ctx.tenant_id, type);
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${job.client_code}.${job.job_code}-${type}-report.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(buffer);
      } catch (e: any) {
        send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }
    // Mark a PO phase "ready for PO": stamps its Surveyed items with who/when and locks phase changes.
    if (p.startsWith('/api/job/') && p.endsWith('/po-ready') && req.method === 'POST') {
      if (!allow('items.edit')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const phase = Math.round(Number(url.searchParams.get('phase')));
      if (!Number.isFinite(phase) || phase < 1) { send(res, 400, { error: 'Pick a valid PO phase.' }); return; }
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const { data, error } = await db().from('survey_items')
        .update({ po_ready_by: ctx.id, po_ready_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenant_id).eq('job_id', job.id).eq('po_phase', phase).in('stage', ['surveyed','synced']).select('id');
      if (error) { send(res, 500, { error: error.message }); return; }
      const n = data?.length ?? 0;
      audit(ctx, 'po.ready', 'job', code, `Marked PO phase ${phase} ready for PO — ${n} item(s) locked`);
      send(res, 200, { ok: true, count: n });
      return;
    }
    // Unlock a PO phase (admin only): clears the ready stamp so items can be re-assigned.
    if (p.startsWith('/api/job/') && p.endsWith('/po-unlock') && req.method === 'POST') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Only an admin can unlock a PO phase.' }); return; }
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const phase = Math.round(Number(url.searchParams.get('phase')));
      if (!Number.isFinite(phase) || phase < 1) { send(res, 400, { error: 'Pick a valid PO phase.' }); return; }
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const { data, error } = await db().from('survey_items')
        .update({ po_ready_by: null, po_ready_at: null })
        .eq('tenant_id', ctx.tenant_id).eq('job_id', job.id).eq('po_phase', phase).select('id');
      if (error) { send(res, 500, { error: error.message }); return; }
      audit(ctx, 'po.unlock', 'job', code, `Unlocked PO phase ${phase} — ${data?.length ?? 0} item(s)`);
      send(res, 200, { ok: true, count: data?.length ?? 0 });
      return;
    }

    // Purchase-order PDF for one PO phase (Surveyed items only). Browser downloads it.
    if (p.startsWith('/api/job/') && p.endsWith('/po.pdf') && req.method === 'GET') {
      if (!allow('items.edit')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const phase = Math.round(Number(url.searchParams.get('phase')));
      if (!Number.isFinite(phase) || phase < 1) { send(res, 400, { error: 'Pick a valid PO phase.' }); return; }
      let job: any;
      try { job = await getJobByRef(code); } catch { send(res, 404, { error: 'Job not found' }); return; }
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const sortParam = String(url.searchParams.get('sort') || 'flat');
      const sort = (['flat', 'floor', 'item', 'code'].includes(sortParam) ? sortParam : 'flat') as any;
      try {
        const { buffer } = await buildJobPoPdf(code, ctx.tenant_id, phase, ctx.name, sort);
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${job.client_code}.${job.job_code}-PO-phase-${phase}.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(buffer);
      } catch (e: any) { send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) }); }
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/plans') && req.method === 'GET') {
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const plans = await listJobPlans(job.id);
      const withUrls = await Promise.all(plans.map(async (pl) => ({ id: pl.id, name: pl.name, url: await signedPlanUrl(pl.storage_path) })));
      const items = await listPinnedItems(job.id);
      const multiPlan = await getPinsMultiPlan(ctx.tenant_id);
      send(res, 200, { plans: withUrls, items, multiPlan, canManage: can(ctx.role, 'plans.manage'), canPin: can(ctx.role, 'plans.pin') });
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/plans') && req.method === 'POST') {
      if (!allow('plans.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const job = await getJobByRef(code);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const name = String(b.name ?? '').trim() || 'Plan';
      let bytes: Buffer; let contentType: string;
      if (b.job_file_id) {
        // Reuse a file already attached to this job (must be an image).
        const jf = await getJobFile(String(b.job_file_id));
        if (!jf || jf.tenant_id !== ctx.tenant_id || jf.job_id !== job.id) { send(res, 404, { error: 'That file is not on this job.' }); return; }
        if (!/^image\//.test(jf.content_type || '')) { send(res, 400, { error: 'Only image files can be used as a plan.' }); return; }
        try { bytes = Buffer.from(await downloadJobFile(jf.storage_path)); }
        catch { send(res, 500, { error: 'Could not read that file.' }); return; }
        contentType = jf.content_type || 'image/png';
      } else {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.image || ''));
        if (!m) { send(res, 400, { error: 'A plan image is required.' }); return; }
        bytes = Buffer.from(m[2], 'base64');
        contentType = m[1];
      }
      if (bytes.length > 15 * 1024 * 1024) { send(res, 400, { error: 'Plan image too large (max 15 MB).' }); return; }
      const ext = ((contentType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')) || 'png';
      const path = `${ctx.tenant_id}/plans/${job.id}/${Date.now()}.${ext}`;
      await ensurePlanBucket();
      await uploadPlan(path, bytes, contentType);
      const plan = await createJobPlan(ctx.tenant_id, job.id, name, path);
      audit(ctx, 'plan.add', 'job', code, `Added plan \"${name}\" to ${code}`);
      send(res, 200, { ok: true, id: plan.id });
      return;
    }
    if (p.startsWith('/api/plans/') && req.method === 'DELETE') {
      if (!allow('plans.manage')) return;
      const id = p.split('/')[3];
      await deleteJobPlan(id, ctx.tenant_id); // items pinned to it get plan_id NULL via FK
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith('/api/item/') && p.endsWith('/pin') && req.method === 'PUT') {
      if (!allow('plans.pin')) return;
      const id = p.split('/')[3];
      const it = await getSurveyItem(id);
      if (it.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const planId = b.plan_id || null;
      // One-plan-per-item unless the tenant allows multi-plan. Block re-pinning an item that's
      // already on a different plan (unpin there first).
      if (planId && (it as any).plan_id && (it as any).plan_id !== planId) {
        if (!(await getPinsMultiPlan(ctx.tenant_id))) { send(res, 409, { error: 'This item is already pinned on another plan. Unpin it there first, or enable multi-plan in Plans settings.' }); return; }
      }
      const clamp = (v: any) => (v == null || v === '' ? null : Math.max(0, Math.min(1, Number(v))));
      await setItemPin(id, planId, planId ? clamp(b.x) : null, planId ? clamp(b.y) : null, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }
    if (p === '/api/settings/pins-multi-plan' && req.method === 'PUT') {
      if (!allow('jobs.manage')) return;
      const b = await readJson(req);
      await setPinsMultiPlan(ctx.tenant_id, !!b.value);
      send(res, 200, { ok: true });
      return;
    }

    // ---- user management (office Stage 3, admin only) ----
    if (p === '/api/users' && req.method === 'GET') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const users = await listAppUsers(ctx.tenant_id);
      const teams = await listTeams(ctx.tenant_id);
      const langs = await getUserLanguages(ctx.tenant_id);
      send(res, 200, {
        me: ctx.id, roles: ROLES,
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, has_login: !!u.auth_user_id, team_id: u.team_id, client_code: u.client_code ?? '', language: langs[u.id] ?? '' })),
      });
      return;
    }

    if (p === '/api/users' && req.method === 'POST') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const name = String(b.name ?? '').trim();
      const role = String(b.role ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, { error: 'A valid email is required.' }); return; }
      if (!name) { send(res, 400, { error: 'Name is required.' }); return; }
      if (!ROLES.includes(role)) { send(res, 400, { error: 'Pick a valid role.' }); return; }
      const password = String(b.password ?? '').trim() || genPassword();
      if (password.length < 8) { send(res, 400, { error: 'Password must be at least 8 characters.' }); return; }
      try {
        const r = await inviteUser(ctx.tenant_id, email, name, role, password);
        send(res, 200, { ok: true, created: r.created, email, password });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }

    if (p.startsWith('/api/users/') && p.endsWith('/reset') && req.method === 'POST') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const id = p.split('/')[3];
      const u = await getAppUser(id);
      if (!u || u.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const password = genPassword();
      await resetUserPassword(u.id, u.email, password, u.auth_user_id);
      send(res, 200, { ok: true, email: u.email, password });
      return;
    }

    if (p.startsWith('/api/users/') && req.method === 'PUT') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const id = p.split('/').pop()!;
      const u = await getAppUser(id);
      if (!u || u.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const patch: Record<string, unknown> = {};
      if ('name' in b) { if (!String(b.name).trim()) { send(res, 400, { error: 'Name is required.' }); return; } patch.name = String(b.name).trim(); }
      if ('email' in b) {
        const email = String(b.email).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { send(res, 400, { error: 'A valid email is required.' }); return; }
        if (u.auth_user_id) { try { await updateAuthEmail(u.auth_user_id, email); } catch (err: any) { send(res, 400, { error: 'Login email update failed: ' + (err?.message ?? err) }); return; } }
        patch.email = email;
      }
      if ('role' in b) { if (!ROLES.includes(String(b.role))) { send(res, 400, { error: 'Invalid role.' }); return; }
        if (id === ctx.id && b.role !== 'admin') { send(res, 400, { error: "You can't remove your own admin role." }); return; }
        patch.role = b.role; }
      if ('active' in b) { if (id === ctx.id && b.active === false) { send(res, 400, { error: "You can't deactivate yourself." }); return; }
        patch.active = !!b.active; }
      if ('team_id' in b) patch.team_id = b.team_id || null; // fitter's team (for the mobile view)
      if ('client_code' in b) patch.client_code = String(b.client_code ?? '').trim().toUpperCase() || null; // which client a customer login sees
      if ('language' in b) {
        const lang = String(b.language ?? '').trim().toLowerCase();
        if (lang && !(USER_LANGUAGES as readonly string[]).includes(lang)) { send(res, 400, { error: 'Unknown language.' }); return; }
        try { await setUserLanguage(id, ctx.tenant_id, lang || null); } catch (err: any) { send(res, 400, { error: err?.message ?? String(err) }); return; }
      }
      if (Object.keys(patch).length) await updateAppUser(id, patch as any, ctx.tenant_id);
      send(res, 200, { ok: true });
      return;
    }

    send(res, 404, { error: 'not found' });
  } catch (e: any) {
    send(res, 500, { error: e?.message ?? String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  ACE office app  →  http://localhost:${PORT}`);
  console.log('  log in with the account you made via create-admin · Ctrl+C to stop\n');
});

// Fin&Ops automatic daily cost sync: check every 5 minutes whether today's run is due.
// (A sleeping free-plan instance has no timers — the catch-up rule runs it when it next wakes.)
if (process.env.SUPABASE_URL && process.env.MONDAY_API_TOKEN) {
  const tick = async () => {
    try {
      const boardId = (await getConfig('fin_costs_board_id')) || FIN_BOARD_DEFAULT;
      if (await autoSyncTick(ACE_TENANT, boardId)) console.log('[fin sync] automatic daily sync started');
    } catch (e: any) { console.warn('[fin sync] auto tick failed:', e?.message ?? e); }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 5 * 60_000).unref();
}

const RATE = 'rate_override_pennies', ISTAT = 'install_status', TEAM = 'team_id';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ACE — Office</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
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
  .grp{position:relative}
  .grpbtn{background:transparent;border:none;color:#cfc9ea;font-size:13px;font-weight:700;padding:8px 12px;border-radius:9px;cursor:pointer}
  .grpbtn:hover{background:rgba(255,255,255,.1);color:#fff}
  .grp.on .grpbtn{background:rgba(255,255,255,.16);color:#fff}
  .grpmenu{position:absolute;top:calc(100% + 6px);left:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.2);padding:6px;min-width:180px;display:none;z-index:40}
  .grpmenu.open{display:block}
  .grpmenu .tab{display:block;width:100%;text-align:left;color:var(--ink);font-weight:600;padding:8px 12px;border-radius:7px}
  .grpmenu .tab:hover{background:#f4f2fa;color:var(--purple)}
  .grpmenu .tab.on{background:#f4f2fa;color:var(--magenta)}
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
  .statgrid .stat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .statgrid .stat .v{font-size:26px;font-weight:800;line-height:1.1;color:var(--ink)}
  .statgrid .stat .l{font-size:12px;font-weight:600;color:var(--muted);margin-top:4px}
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
  .newbtn{background:var(--magenta);color:#fff;border:none;border-radius:9px;padding:9px 16px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
  /* Segmented header action groups (job actions, PO) — quiet ghost buttons bound in one pill */
  .segbar{display:inline-flex;align-items:stretch;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;vertical-align:middle}
  .segbar>*+*{border-left:1px solid #ece9f4}
  .segbtn{background:none;border:none;padding:8px 13px;font-size:13px;color:var(--purple);cursor:pointer;display:inline-flex;align-items:center;gap:6px;line-height:1;white-space:nowrap}
  .segbtn:hover{background:var(--soft)}
  .segbtn.danger{color:#b42318}
  .segbtn.danger:hover{background:#fdecec}
  .seglabel{font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--muted);padding:0 10px;display:inline-flex;align-items:center;background:#faf9fd}
  .segsel{border:none;border-radius:0;padding:8px 10px;font-size:13px;background:none;color:var(--ink);cursor:pointer}
  .segbtn svg,.newbtn svg{flex:0 0 auto}
  .snagtag{font-size:9px;font-weight:800;letter-spacing:.03em;color:#fff;background:var(--magenta);padding:2px 5px;border-radius:5px;vertical-align:middle}
  .unfintag{font-size:9px;font-weight:800;letter-spacing:.03em;color:#fff;background:#b45309;padding:2px 5px;border-radius:5px;vertical-align:middle}
  /* Required-but-empty fields on the item edit form (same colour as the Unfinished badge) */
  .field.needfill>label{color:#b45309;font-weight:700}
  .field.needfill input,.field.needfill select,.field.needfill textarea{background:#fff1e6;box-shadow:inset 0 0 0 1px #e8a570}
  .field.needfill>label::after{content:' • required';font-size:10px;font-weight:700;color:#b45309;letter-spacing:.02em}
  .needfill-note{margin:2px 22px 0;padding:9px 12px;background:#fff1e6;border:1px solid #e8a570;border-radius:8px;color:#8a4406;font-size:12.5px}
  /* Per-item activity timeline (item drawer) */
  .actrow{padding:8px 0;border-top:1px solid #f2f0f8}
  .actrow:first-child{border-top:none}
  .actmeta{font-size:12.5px;color:var(--ink)}
  .actwhen{color:var(--muted);font-size:11px;margin-left:8px}
  .actchg{font-size:12px;color:var(--muted);margin-top:3px}
  .actfrom{text-decoration:line-through;opacity:.7}
  .actmore{font-size:12px;color:var(--purple);cursor:pointer;margin-top:8px;display:inline-block}
  /* Excel import grid */
  .imp-wrap{overflow:auto;max-height:60vh;border:1px solid var(--line);border-radius:10px;background:#fff}
  table.impgrid{border-collapse:collapse;font-size:12px;white-space:nowrap}
  table.impgrid th,table.impgrid td{border:1px solid var(--line);padding:0}
  table.impgrid thead th{position:sticky;top:0;z-index:2;background:#f6f5fb;padding:5px 7px;text-align:left;font-size:10.5px;letter-spacing:.02em;color:var(--muted)}
  table.impgrid thead tr.filters th{top:26px;padding:3px 4px}
  table.impgrid thead tr.filters input{width:80px;border:1px solid var(--line);border-radius:5px;font-size:11px;padding:2px 4px}
  table.impgrid td input{border:none;background:transparent;font-size:12px;padding:4px 6px;width:76px;outline:none}
  table.impgrid td input:focus{background:#eef;box-shadow:inset 0 0 0 1px var(--purple)}
  table.impgrid td.wide input{width:150px}
  table.impgrid td.stcell{padding:4px 8px;font-weight:700;font-size:10px}
  table.impgrid tr.badrow td.stcell{color:#b45309}
  table.impgrid tr.badrow{background:#fff8f0}
  table.impgrid td.miss input{background:#fff1e6}
  table.impgrid tr.duprow{background:#fdecec}
  table.impgrid tr.duprow td.stcell{color:#b91c1c;font-weight:800}
  .imp-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
  .imp-summary{font-size:12px;color:var(--muted)}
  /* Clear/delete buttons on the light import toolbar (the .bulk styles are for the dark bar) */
  .impclear{font-size:12px;font-weight:700;border-radius:8px;padding:7px 12px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
  .impclear:hover{background:#f3f1f9;border-color:var(--purple)}
  .impdel{font-size:12px;font-weight:700;border-radius:8px;padding:7px 12px;border:none;background:#dc2626;color:#fff;cursor:pointer}
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
  .jobgrp{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:11px 14px 4px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px}
  .jobgrp:hover{color:var(--purple)}
  .jobgrp-ar{width:10px;display:inline-block;font-size:10px}
  .jobgrp-n{margin-left:auto;background:var(--soft);border-radius:999px;padding:1px 8px;font-size:10px;color:var(--muted)}
  .maptotals{position:sticky;top:6px;z-index:5;background:#efeaf8;border:1px solid var(--line);border-radius:9px;padding:8px 13px;font-size:13px;color:var(--ink);margin:10px 0;box-shadow:0 1px 4px rgba(58,43,114,.08)}
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
  .mfilter{position:relative;margin-top:4px;display:inline-block;font-weight:400}
  .mfbtn{font-size:11px;font-weight:600;color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:3px 7px;background:#fff;cursor:pointer;max-width:128px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mfbtn.act{border-color:var(--magenta);color:var(--magenta);background:#fdf1f7}
  .mfpop{position:absolute;z-index:60;top:calc(100% + 3px);left:0;background:#fff;border:1px solid var(--line);border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:5px;min-width:158px;max-height:280px;overflow:auto;display:none}
  .mfpop.open{display:block}
  .mfpop label{display:flex;align-items:center;gap:7px;padding:4px 7px;font-size:12px;font-weight:500;color:var(--ink);border-radius:6px;cursor:pointer;white-space:nowrap}
  .mfpop label:hover{background:#f4f2fa}
  .mfpop input[type=checkbox]{width:14px;height:14px;accent-color:var(--magenta);flex:0 0 auto}
  .mfclear{font-size:11px;font-weight:700;color:var(--magenta);cursor:pointer;padding:5px 7px;border-top:1px solid var(--line);margin-top:4px}
  .mfclear:hover{text-decoration:underline}
  .pohead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:16px 22px 0;font-size:13px;color:var(--muted)}
  .pohead b{color:var(--ink)}
  .podecide{margin:14px 22px 0;padding:12px 14px;border-radius:12px;border:1px solid #f5d9a8;background:#fff8eb;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .podecide .msg{flex:1;min-width:200px;font-size:13px;color:var(--ink)}
  .podecide .msg small{display:block;color:var(--muted);font-size:12px;margin-top:2px;white-space:pre-wrap}
  .podecide.ok{border-color:#bfe6cb;background:#effaf2}
  .podecide.bad{border-color:#f0c2bb;background:#fdf0ee}
  .pobtn{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:9px 16px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;line-height:1.2}
  .pobtn:hover{border-color:#cfcbe0}
  .pobtn.ok{background:#16a34a;border-color:#16a34a;color:#fff}
  .pobtn.bad{color:#c0392b;border-color:#f0c2bb}
  .pobtn.bad.solid{background:#c0392b;border-color:#c0392b;color:#fff}
  .pobtn:disabled{opacity:.45;cursor:not-allowed}
  .posec{padding:2px 22px 16px}
  .posec .groupt{margin:4px 0 8px}
  .pofiles{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .pofile{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid #f2f0f8;font-size:13px}
  .pofile:first-child{border-top:none}
  .pofiles .empty{padding:12px;color:var(--muted);font-size:13px}
  .pokind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:#f4f3f9;border-radius:6px;padding:3px 7px}
  .porow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
  .porow .tinput{padding:8px 10px}
  .pofname{font-size:12px;color:var(--muted);flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pomini{position:fixed;inset:0;background:rgba(31,26,61,.35);display:grid;place-items:center;z-index:30;padding:20px}
  .pomini .box{background:#fff;border-radius:16px;width:min(440px,100%);box-shadow:0 20px 50px rgba(31,26,61,.25);overflow:hidden}
  .pomini h4{margin:0;padding:16px 20px 4px;font-size:16px;color:var(--ink)}
  .pomini p{margin:0;padding:0 20px 10px;font-size:13px;color:var(--muted)}
  .pomini textarea{display:block;width:calc(100% - 40px);margin:0 20px;min-height:96px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical}
  .pomini textarea:focus{outline:none;border-color:#c0392b}
  .pomini .btns{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px 18px}
  .fp{font-size:12px;border-collapse:separate;border-spacing:0;width:100%}
  .fp th{position:sticky;top:0;background:#fff;z-index:2;text-align:right;white-space:nowrap}
  .fp th:first-child,.fp td:first-child{position:sticky;left:0;z-index:1;text-align:left;background:#fff;min-width:230px;max-width:280px}
  .fp th:first-child{z-index:3}
  .fp td{padding:5px 10px;border-top:1px solid #f2f0f8;white-space:nowrap}
  .fp td.n{text-align:right;font-variant-numeric:tabular-nums;cursor:pointer}
  .fp td.n:hover{background:#fde8f3!important}
  .fp td.n.neg{color:#b42318}
  .fp td.t{font-weight:700;border-left:1px solid var(--line)}
  .fp tr.dept td{background:var(--purple)!important;color:#fff;font-weight:800;font-size:13px}
  .fp tr.dept td.n:hover{background:#55449a!important}
  .fp tr.sec td{background:#efedf7!important;font-weight:700}
  .fp tr.kind td{background:#f8f7fc!important;font-weight:700;cursor:pointer}
  .fp tr.line td:first-child{padding-left:30px}
  .fp tr.ph td{color:#9a97ad;font-style:italic}
  .fj td{cursor:pointer}.fj tr:hover td{background:#fbf3f8!important}.fj td:first-child{min-width:130px;font-weight:700}
  .fj tr.lk td{color:#6b6786}.fj tr.ctrl:hover td{background:#fff8eb!important}
  .fjl{width:100%;border-collapse:collapse;font-size:12.5px}.fjl td,.fjl th{padding:6px 8px;border-top:1px solid #f2f0f8;text-align:left;vertical-align:top}.fjl th{font-size:10px;color:#9a97ad;letter-spacing:.04em}
  .fyt td{vertical-align:middle}.fyt input.tinput{width:110px;padding:6px 8px;text-align:right;font-size:12.5px}.fyt input.tinput::placeholder{color:#b9b6c9;font-style:italic}
  .fyt input.tinput:disabled{background:#f6f5fa;color:var(--ink)}.fyt tr.fut td{opacity:.75}
  .fp td.n.est{font-style:italic;color:#b45309}
  .fsl tr.g td{cursor:pointer;font-size:13px;padding:9px 8px}.fsl tr.g:hover td{background:#fbf3f8}.fsl tr.g td:first-child{font-weight:700}
  .fsl tr.i td{background:#faf9fd;font-size:12px}.fsl tr.i td:first-child{padding-left:26px}.fsl th[style*=right]{text-align:right}
  .fjl td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .fp tr.ctrl td{background:#fff8eb!important;font-weight:800;border-top:2px solid #f5d9a8}
  .tabbadge{display:inline-block;min-width:16px;padding:0 5px;height:16px;line-height:16px;border-radius:8px;background:var(--magenta);color:#fff;font-size:10px;font-weight:800;text-align:center}
  td{padding:9px 12px;border-top:1px solid #f2f0f8;vertical-align:middle}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px}
  .scanned{background:#eef0f4;color:var(--muted)}.in_survey{background:var(--amber-soft);color:var(--amber)}
  .surveyed{background:var(--soft);color:var(--purple)}.synced{background:var(--green-soft);color:var(--green)}
  input.rate{width:74px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px}
  input.pocell{width:48px;border:1px solid var(--line);border-radius:6px;padding:5px 6px;font-size:12px;text-align:center}
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
  <h1>ACE<b>GROUP</b></h1><p>Office web app — sign in</p>
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
    <div class="brand">ACE<b>GROUP</b> <span>· Office</span><span class="envbadge" id="envBadge"></span></div>
    <button class="verchip" onclick="showChangelog()" title="What's new">v__APP_VERSION__</button>
    <nav class="nav">
      <div class="grp" id="grp_ops"><button class="grpbtn" onclick="toggleGrp('ops')">Operations \u25be</button><div class="grpmenu" id="menu_ops">
        <button id="tabDash" class="tab" onclick="showTab('dashboard')">Dashboard</button>
        <button id="tabItems" class="tab" onclick="showTab('items')">Items</button>
        <button id="tabMapping" class="tab" style="display:none" onclick="showTab('mapping')">Mapping</button>
        <button id="tabPlans" class="tab" onclick="showTab('plans')">Plans</button>
        <button id="tabCal" class="tab" onclick="showTab('cal')">Calendar</button>
        <button id="tabSignoff" class="tab" style="display:none" onclick="showTab('signoff')">Sign-off</button>
      </div></div>
      <div class="grp" id="grp_sales"><button class="grpbtn" onclick="toggleGrp('sales')">Sales \u25be</button><div class="grpmenu" id="menu_sales">
        <button id="tabLeads" class="tab" style="display:none" onclick="showTab('leads')">Leads</button>
      </div></div>
      <div class="grp" id="grp_crm"><button class="grpbtn" onclick="toggleGrp('crm')">CRM \u25be</button><div class="grpmenu" id="menu_crm">
        <button id="tabCustomers" class="tab" style="display:none" onclick="showTab('customers')">Customers</button>
      </div></div>
      <div class="grp" id="grp_finance"><button class="grpbtn" onclick="toggleGrp('finance')">Finance \u25be</button><div class="grpmenu" id="menu_finance">
        <button id="tabBudget" class="tab" style="display:none" onclick="showTab('budget')">Budget</button>
        <button id="tabInvoices" class="tab" style="display:none" onclick="showTab('invoices')">Invoices</button>
      </div></div>
      <div class="grp" id="grp_purchasing"><button class="grpbtn" onclick="toggleGrp('purchasing')">Purchasing \u25be</button><div class="grpmenu" id="menu_purchasing">
        <button id="tabPoReq" class="tab" style="display:none" onclick="showTab('poreq')">PO requests <span id="poBadge" class="tabbadge" style="display:none"></span></button>
        <button id="tabSuppliers" class="tab" style="display:none" onclick="showTab('suppliers')">Suppliers</button>
        <button id="tabCostCentres" class="tab" style="display:none" onclick="showTab('costcentres')">Cost centres</button>
      </div></div>
      <div class="grp" id="grp_logistics"><button class="grpbtn" onclick="toggleGrp('logistics')">Logistics \u25be</button><div class="grpmenu" id="menu_logistics">
        <button id="tabLabels" class="tab" style="display:none" onclick="showTab('labels')">Labels</button>
        <button id="tabConfirm" class="tab" style="display:none" onclick="showTab('confirm')">Confirmations</button>
      </div></div>
      <div class="grp" id="grp_finops"><button class="grpbtn" onclick="toggleGrp('finops')">Fin&amp;Ops \u25be</button><div class="grpmenu" id="menu_finops">
        <button id="tabFinPerf" class="tab" style="display:none" onclick="showTab('finperf')">Performance</button>
        <button id="tabFinCosts" class="tab" style="display:none" onclick="showTab('fincosts')">Costs</button>
        <button id="tabFinJobs" class="tab" style="display:none" onclick="showTab('finjobs')">Job costs</button>
        <button id="tabFinSales" class="tab" style="display:none" onclick="showTab('finsales')">Sales</button>
        <button id="tabFinPay" class="tab" style="display:none" onclick="showTab('finpay')">Payroll</button>
      </div></div>
      <div class="grp" id="grp_admin"><button class="grpbtn" onclick="toggleGrp('admin')">Admin \u25be</button><div class="grpmenu" id="menu_admin">
        <button id="tabTeams" class="tab" onclick="showTab('teams')">Teams &amp; rates</button>
        <button id="tabCustAdmin" class="tab" style="display:none" onclick="showTab('custadmin')">Customers</button>
        <button id="tabSync" class="tab" onclick="showTab('sync')">Monday sync</button>
        <button id="tabTests" class="tab" style="display:none" onclick="showTab('tests')">Test</button>
        <button id="tabUsers" class="tab" style="display:none" onclick="showTab('users')">Users</button>
        <button id="tabRoles" class="tab" style="display:none" onclick="showTab('roles')">Roles</button>
        <button id="tabLogs" class="tab" style="display:none" onclick="showTab('logs')">Logs</button>
        <button id="tabBilling" class="tab" style="display:none" onclick="showTab('billing')">Billing</button>
      </div></div>
    </nav>
    <div class="who"><span id="whoName"></span><button onclick="logout()">Sign out</button></div>
  </header>

  <div id="dashView" style="display:none">
    <main style="max-width:1000px">
      <h2>Dashboard</h2>
      <div class="sub">Live status across all jobs — straight from the store.</div>
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
          <button class="jobstoggle" onclick="toggleJobs()" title="Show/hide the Jobs panel">☰ Jobs</button>
          <div><h2 id="title">—</h2><div class="sub" id="subtitle"></div></div>
        </div>
        <div style="display:flex;gap:12px;align-items:center">
          <span id="jobActions" class="segbar" style="display:none">
            <button id="filesBtn" class="segbtn" onclick="openJobFiles(current)" title="Job files"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>Files</button>
            <button id="editJobBtn" class="segbtn" style="display:none" onclick="openEditJob(current)" title="Edit job"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>Edit</button>
            <button id="delJobBtn" class="segbtn danger" style="display:none" onclick="delJob()" title="Delete job" aria-label="Delete job"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg></button>
          </span>
          <span id="poPdfWrap" class="segbar" style="display:none">
            <span class="seglabel">PO</span>
            <select id="poPhaseSel" class="segsel" style="width:auto" title="PO phase" onchange="poPhasePick()"></select>
            <select id="poSortSel" class="segsel" style="width:auto" title="Sort the PO schedule">
              <option value="flat">by Flat</option><option value="floor">by Floor</option><option value="item">by Item code</option><option value="code">by Full code</option>
            </select>
            <button class="segbtn" onclick="downloadPoPdf()" title="Download the purchase-order PDF for this PO phase (Surveyed items)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>PDF</button>
            <button id="poReadyBtn" class="segbtn" onclick="poReadyClick()" title="Mark this PO phase ready for ordering (locks items from phase changes)"></button>
          </span>
          <button id="newBtn" class="newbtn" onclick="openCreate()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>New item</button>
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
        <button class="chip" data-f="unfinished" onclick="setFilter('unfinished')">Unfinished</button>
        <span id="itemCount" class="itemcount"></span>
      </div>
      <div id="bulkbar" class="bulkbar" style="display:none">
        <div class="bulkrow">
          <span id="bulkcount">0 selected</span>
          <button class="bulk bsync" onclick="bulkSync()">Sync selected</button>
          <button class="bulk bapply" onclick="bulkFinish()" title="Promote selected items to Surveyed when all mandatory fields are complete (incomplete ones are skipped)">Mark surveyed</button>
          <button id="bulkDelBtn" class="bulk bdel" style="display:none" onclick="bulkDelete()">Delete</button>
          <button class="bulk bclear" onclick="clearSel()">Clear selection</button>
        </div>
        <div class="bulkrow">
          <span class="bulklabel">Set on selected:</span>
          <select id="bulkField" class="bulk bsel" onchange="bulkFieldPick()">
            <option value="team">Team</option><option value="status">Install status</option><option value="po">PO phase</option>
            <optgroup label="Location (code)">
              <option value="block">Block</option><option value="elevation">Elevation</option>
              <option value="floor">Floor</option><option value="flat">Flat</option><option value="room">Room</option><option value="item">Item code</option>
            </optgroup>
            <optgroup label="Specification">
              <option value="material">Material</option><option value="item_type">Item type</option>
              <option value="glazing">Glass (panes)</option><option value="glass">Glass texture</option>
              <option value="width">Width (mm)</option><option value="height">Height (mm)</option>
              <option value="open_in_out">Open in/out</option><option value="design_code">Style (design code)</option>
            </optgroup>
          </select>
          <span id="bulkValWrap"></span>
          <button id="bulkApplyBtn" class="bulk bapply" onclick="bulkEditApply()">Apply</button>
        </div>
      </div>
      <div class="card2" style="overflow:auto"><table class="itable"><thead><tr>
        <th class="cbcell"><input type="checkbox" id="selAll" onclick="toggleAll(this)"></th>
        <th>FULL CODE</th>
        <th>BLOCK<br><div id="blockFilter" class="mfhost"></div></th>
        <th>ELEV<br><div id="elevFilter" class="mfhost"></div></th>
        <th>FLAT<br><div id="flatFilter" class="mfhost"></div></th>
        <th>FLOOR<br><div id="floorFilter" class="mfhost"></div></th>
        <th>ROOM<br><div id="roomFilter" class="mfhost"></div></th>
        <th>ITEM<br><div id="itemColFilter" class="mfhost"></div></th>
        <th>STAGE<br><div id="stageFilter" class="mfhost"></div></th>
        <th>PO<br><div id="poFilter" class="mfhost"></div></th>
        <th>RATE (£)</th>
        <th>INSTALL STATUS<br><div id="statusFilter" class="mfhost"></div></th>
        <th>TEAM<br><div id="teamFilter" class="mfhost"></div></th><th>MONDAY</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
    </main>
  </div>

  <div id="teamsView" style="display:none">
    <main style="max-width:760px">
      <h2>Fitter teams &amp; rates</h2>
      <div class="sub">Each team has a <b>Windows</b> rate and a <b>Doors</b> rate. Items inherit their team's rate for their category (doors are detected from the item type/code) unless a per-item override is set. The rate flows to Monday's <b>Labour Cost</b> column when an item is synced. A team with items assigned can't be deleted — <b>Retire</b> it instead: it stays on existing items and reports but disappears from new assignment lists, and can be reactivated anytime.</div>
      <div id="addTeam" class="addrow" style="display:none">
        <input id="newTeamName" class="tinput" placeholder="Team name (e.g. Team P03)">
        <div class="pfx" title="Windows rate"><span>W £</span><input id="newTeamRate" class="tinput rate2" type="number" min="0" step="1" placeholder="80"></div>
        <button class="add" onclick="addTeam()">Add team</button>
      </div>
      <div id="teamsNote" class="sub" style="display:none">You're signed in as <b id="roleName"></b>. Only admins can add or edit teams.</div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>TEAM</th><th>WINDOWS RATE (£)</th><th>DOORS RATE (£)</th><th>ITEMS USING</th><th></th>
      </tr></thead><tbody id="teamRows"></tbody></table></div>
    </main>
  </div>

  <div id="syncView" style="display:none">
    <main style="max-width:900px">
      <h2>Monday sync</h2>
      <div class="sub">Link each job to its Monday board, then push its items across. Matching is by item name (the full code), so re-syncing updates in place — it never duplicates. Board id is the number in the board's URL: monday.com/boards/<b>18424137545</b>.</div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>JOB</th><th>MONDAY BOARD</th><th>ITEMS</th><th>SYNCED</th><th>TO SYNC</th><th></th>
      </tr></thead><tbody id="syncRows"></tbody></table></div>
    </main>
  </div>
  <div id="plansView" style="display:none">
    <main style="max-width:1200px">
      <h2>Plans</h2>
      <div class="sub">Upload a floor plan or elevation per job (image or PDF — a multi-page PDF becomes one plan per page), then pin each item to its spot. Field staff see the pins on the phone. Click an item on the right, then click its location on the plan.</div>
      <div class="planbar">
        <select id="planJob" class="tinput" onchange="loadPlans()"></select>
        <select id="planSel" class="tinput" onchange="renderPlan()"></select>
        <button class="add" id="planUploadBtn" onclick="document.getElementById('planFile').click()">Upload from disk</button>
        <input type="file" id="planFile" accept="image/*,application/pdf,.pdf" style="display:none" onchange="uploadPlan(this)">
        <button class="add" id="planFromJobBtn" onclick="addPlanFromJob()">From job files</button>
        <button class="del" id="planDelBtn" onclick="deletePlan()">Delete plan</button>
        <button class="add" id="rptSurveyBtn" onclick="downloadReport('survey')" title="Download a survey sheet PDF for this job">Survey PDF</button>
        <button class="add" id="rptInstallBtn" onclick="downloadReport('install')" title="Internal install report (includes teams and rates)">Internal install PDF</button>
        <button class="add" id="rptCustInstallBtn" onclick="downloadReport('customer_install')" title="Customer install report (no rates — safe to send the customer)">Customer install PDF</button>
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
      <div class="sub">Every scheduled install across all jobs and teams. Dates come from Monday (Sync tab → Pull fitters + dates). Filter by team, page months, click a day to see what's on.</div>
      <div class="calbar">
        <div style="display:flex;gap:6px;margin-right:10px">
          <button id="calModeMonth" onclick="calSetMode('month')" style="border:1px solid var(--line);background:var(--magenta);color:#fff;border-radius:9px;height:34px;padding:0 16px;font-size:13px;font-weight:600;cursor:pointer">Month</button>
          <button id="calModeGantt" onclick="calSetMode('gantt')" style="border:1px solid var(--line);background:#fff;color:var(--purple);border-radius:9px;height:34px;padding:0 16px;font-size:13px;font-weight:600;cursor:pointer">Gantt</button>
        </div>
        <button id="calNavPrev" class="calnav" onclick="calShift(-1)">‹</button>
        <div class="calmonth" id="calMonth">—</div>
        <button id="calNavNext" class="calnav" onclick="calShift(1)">›</button>
        <select id="calTeam" class="tinput" onchange="renderCalendar()" style="margin-left:auto"></select>
        <select id="ganttTeam" class="tinput" onchange="renderGantt()" style="display:none;margin-left:auto"></select>
        <span id="calMsg" class="itemcount"></span>
      </div>
      <div class="calgridwrap">
        <div class="calweek"></div>
        <div class="calgrid" id="calGrid"></div>
      </div>
      <div class="calsel-h" id="calSelHead"></div>
      <div id="calSel"></div>
      <div id="ganttWrap" style="display:none"></div>
    </main>
  </div>

  <div id="budgetView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>Budget &amp; pricing</h2><div class="sub">Customer pricing rules. Assign a rule to a job, and items are priced by it. Visible to admins and invoice managers only — no one else can see costs or prices.</div></div>
        <button class="newbtn" onclick="openRule()">+ New rule</button>
      </div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>RULE</th><th>CUSTOMER</th><th>MODEL</th><th>RATE / FLAT</th><th>RATE / DOOR</th><th>RATE / m²</th><th></th>
      </tr></thead><tbody id="ruleRows"></tbody></table></div>

      <h3 style="margin-top:28px;color:var(--purple)">Job pricing</h3>
      <div class="sub">Assign a rule to a job, then see the budget cost and the customer price broken down by flat.</div>
      <div class="planbar">
        <select id="fpJob" class="tinput" onchange="loadJobPricing()"></select>
        <label style="font-size:12.5px;color:var(--muted)">Rule:
          <select id="fpRule" class="tinput" onchange="assignRule()"></select>
        </label>
        <button class="add" id="fpPdfBtn" onclick="downloadPricePdf()" title="Download the customer price breakdown (sale side only)">Customer price PDF</button>
        <label style="font-size:12.5px;color:var(--muted);display:inline-flex;align-items:center;gap:5px" title="Include items whose Install status is Omit in the budget, price and PDF"><input type="checkbox" id="fpIncludeOmit" onchange="loadJobPricing()"> Include Omit items</label>
        <span id="fpMsg" class="itemcount"></span>
      </div>
      <div id="fpBreak"></div>
    </main>
  </div>

  <div id="invoicesView" style="display:none">
    <main style="max-width:1080px">
      <div class="titlerow">
        <div><h2>Invoices</h2><div class="sub">Raise a VAT invoice from a priced job, download the PDF, and track paid / unpaid. Finance-only — no one else can see it.</div></div>
        <button class="newbtn" onclick="openNewInvoice()">+ New invoice</button>
      </div>
      <div class="statgrid" id="invSummary" style="margin:14px 0"></div>
      <div class="chips" style="align-items:center;margin-bottom:6px">
        <select id="invStatusFilter" class="tinput" onchange="loadInvoices()">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Awaiting payment</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
      </div>
      <div class="card2"><table><thead><tr>
        <th>INVOICE</th><th>JOB</th><th>CUSTOMER</th><th>ISSUED</th><th>DUE</th><th>TOTAL</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="invRows"></tbody></table></div>
    </main>
  </div>

  <div id="signoffView" style="display:none">
    <main style="max-width:1080px">
      <div class="titlerow">
        <div><h2>Install sign-off</h2><div class="sub">Run the QA checklist per flat when its installs are done, mark it Passed or Failed, and download a handover certificate.</div></div>
        <button class="add" id="qaEditBtn" style="display:none;align-self:center" onclick="openQaTemplate()">Edit checklist</button>
      </div>
      <div class="planbar">
        <select id="soJob" class="tinput" onchange="loadSignoff()"></select>
        <span id="soMsg" class="itemcount"></span>
      </div>
      <div class="card2"><table><thead><tr>
        <th>FLAT</th><th>ITEMS</th><th>INSTALLED</th><th>SNAGS</th><th>READY</th><th>SIGN-OFF</th><th></th>
      </tr></thead><tbody id="soRows"></tbody></table></div>
    </main>
  </div>

  <div id="poreqView" style="display:none">
    <main style="max-width:1080px">
      <div class="titlerow">
        <div><h2>PO requests</h2><div class="sub">Raise purchase-order requests, tag them to a cost centre, attach the quote, and track approval. Requests of £2000+ need a purchasing manager to approve.</div></div>
        <div style="display:flex;gap:8px;align-self:center"><button class="add" id="poNotifyBtn" style="display:none" onclick="openPoSettings()">Notifications</button><button class="newbtn" id="newPoBtn" onclick="openNewPoReq()">+ New request</button></div>
      </div>
      <div class="statgrid" id="poSummary" style="margin:14px 0"></div>
      <div class="chips" style="align-items:center;margin-bottom:6px">
        <select id="poStatusFilter" class="tinput" onchange="loadPoRequests()">
          <option value="">All statuses</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="po_sent">PO sent</option><option value="supplier_confirmed">Supplier confirmed</option><option value="part_delivered">Part delivered</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
        </select>
        <select id="poCcTypeFilter" class="tinput" onchange="renderPoRows()">
          <option value="">All cost-centre types</option><option value="framework">Framework</option><option value="enquiry">Enquiry / job</option><option value="general">General / overhead</option>
        </select>
        <input id="poSearch" class="tinput" placeholder="Search number, title, supplier, cost centre" oninput="renderPoRows()" style="min-width:260px">
        <span id="poShown" class="itemcount"></span>
        <a class="codelink" onclick="poShowAwaiting()" style="margin-left:auto">Awaiting approval →</a>
      </div>
      <div class="card2"><table><thead><tr>
        <th>NUMBER</th><th>TITLE</th><th>COST CENTRE</th><th>SUPPLIER</th><th>AMOUNT</th><th>REQUESTOR</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="poRows"></tbody></table></div>
    </main>
  </div>

  <div id="finPayView" style="display:none">
    <main style="max-width:1400px">
      <div class="titlerow">
        <div><h2>Payroll</h2><div class="sub" data-th="fy_desc">Total salaries and total payroll tax per department, per month. Enter the figures and tick <b>Actuals</b> when they are final. Until then the month shows an <b>estimate</b>: the average of the last 3 months with actuals &mdash; or your own figure, if you type one without ticking the box. Ticking a month moves the estimate on to the next one. These numbers fill the Salaries and Taxes rows on Performance.</div></div>
        <div style="display:flex;gap:8px;align-self:center;align-items:center"><select id="fy_year" class="tinput"></select></div>
      </div>
      <div class="card2" style="overflow-x:auto;margin-top:14px"><table class="fjl fyt"><thead>
        <tr><th rowspan="2">MONTH</th><th colspan="2" style="text-align:center">OFFICE</th><th colspan="2" style="text-align:center">SALES</th><th colspan="2" style="text-align:center">PRODUCTION</th><th rowspan="2" style="text-align:right">TOTAL</th><th rowspan="2">STATUS</th><th rowspan="2">ACTUALS</th><th rowspan="2"></th></tr>
        <tr><th>Salaries</th><th>Taxes</th><th>Salaries</th><th>Taxes</th><th>Salaries</th><th>Taxes</th></tr>
      </thead><tbody id="fy_rows"></tbody></table></div>
      <div class="sub" style="margin:10px 0 30px" data-th="fy_foot">Grey figures in an empty box are the estimate that will be used. A ticked month is protected: untick <b>Actuals</b> to change it.</div>
    </main>
  </div>
  <div id="finSalesView" style="display:none">
    <main style="max-width:1500px">
      <div class="titlerow">
        <div><h2>Sales</h2><div class="sub" data-th="fs_desc">Sales invoices &mdash; the <b>Sprzeda&#380;</b> sheet, entered by hand until Subiekt is connected. One row per <b>job</b>, holding all of its invoices (prepayments and the final one); click a job to see them. The net total of a job&rsquo;s invoices is its sales in Job costs. <b>Orpiszew</b> = producer Acemark PL; everything else is <b>Trade from Poland</b>.</div></div>
        <div style="display:flex;gap:8px;align-self:center;align-items:center;flex-wrap:wrap;justify-content:flex-end"><button class="pobtn" id="fs_import" style="display:none">Import from Excel</button><button class="pobtn" id="fs_csv">Export CSV</button><button class="newbtn" id="fs_new">+ Add invoice</button></div>
      </div>
      <div class="statgrid" id="fs_stats" style="margin:14px 0"></div>
      <div class="chips" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select id="fs_year" class="tinput"></select>
        <select id="fs_month" class="tinput"></select>
        <select id="fs_channel" class="tinput"><option value="">Orpiszew + trade</option><option value="production">Sales from Orpiszew</option><option value="trade">Trade from Poland</option></select>
        <select id="fs_country" class="tinput"></select>
        <select id="fs_buyer" class="tinput"></select>
        <select id="fs_state" class="tinput"><option value="">All</option><option value="multi">Jobs with several invoices</option><option value="prepaid">With a prepayment</option><option value="planned">Planned (no invoice number)</option><option value="nojob">Not tied to a job</option></select>
        <input id="fs_q" class="tinput" placeholder="Search job, invoice no, buyer" style="min-width:220px;flex:1">
      </div>
      <div class="card2" style="overflow-x:auto"><table class="fjl fsl"><thead><tr><th>JOB</th><th>BUYER</th><th>COUNTRY</th><th>FROM</th><th style="text-align:right">INVOICES</th><th style="text-align:right">PREPAID NET</th><th style="text-align:right">FINAL NET</th><th style="text-align:right">TOTAL NET</th><th style="text-align:right">TOTAL GROSS</th><th>PERIOD</th></tr></thead><tbody id="fs_rows"></tbody></table></div>
      <div class="sub" id="fs_more" style="margin:10px 0 30px"></div>
    </main>
  </div>
  <div id="finJobsView" style="display:none">
    <main style="max-width:1700px">
      <div class="titlerow">
        <div><h2>Job costs</h2><div class="sub" data-th="fj_desc">Profit &amp; loss per job order &mdash; the <b>Koszty</b> sheet. Each job holds cost lines (material, extras, painting, transport, customs, labour = hours &times; rate; several per job, e.g. several invoices). Total cost = all costs added up; profit = sales &minus; total cost. Click a job to open it. A locked job can&rsquo;t be changed until an admin unlocks it.</div></div>
        <div style="display:flex;gap:8px;align-self:center;align-items:center;flex-wrap:wrap;justify-content:flex-end"><button class="pobtn" id="fj_import" style="display:none">Import from Excel</button><button class="pobtn" id="fj_csv">Export CSV</button><button class="newbtn" id="fj_new">+ New job</button></div>
      </div>
      <div class="sub" id="fj_rate" style="margin:6px 0 0;text-align:right"></div>
      <div class="statgrid" id="fj_stats" style="margin:14px 0"></div>
      <div class="chips" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select id="fj_year" class="tinput"></select>
        <select id="fj_month" class="tinput"></select>
        <select id="fj_cust" class="tinput"></select>
        <select id="fj_state" class="tinput"><option value="">All jobs</option><option value="open">Not locked</option><option value="locked">Locked</option><option value="nosales">No sales entered</option><option value="salesdiff">Sales differ from the sheet value</option><option value="nocost">No costs entered</option><option value="loss">Making a loss</option></select>
        <input id="fj_q" class="tinput" placeholder="Search reference or customer" style="min-width:220px;flex:1">
      </div>
      <div class="card2" style="overflow:auto;max-height:calc(100vh - 300px)"><table class="fp fj"><thead id="fj_head"></thead><tbody id="fj_rows"></tbody></table></div>
      <div class="sub" id="fj_more" style="margin:10px 0 30px"></div>
    </main>
  </div>
  <div id="finPerfView" style="display:none">
    <main style="max-width:1600px">
      <div class="titlerow">
        <div><h2>Performance</h2><div class="sub" data-th="fp_desc">Costs by department &rarr; fixed / variable &rarr; cost line, month by month &mdash; the structure of the <b>New Performance Sheet</b>, calculated from the synced monday invoices (net). Click any number to see the invoices behind it.</div></div>
        <div style="display:flex;gap:8px;align-self:center;align-items:center"><span class="sub" id="fp_last" style="margin:0;text-align:right"></span><button class="pobtn" id="fp_toggle">Collapse all</button><button class="pobtn" id="fp_csv">Export CSV</button></div>
      </div>
      <div class="chips" style="align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 8px">
        <select id="fp_year" class="tinput"></select>
        <select id="fp_company" class="tinput"><option value="acemark">Acemark</option><option value="ace_group">Ace Group</option><option value="off_balance">Poza bilans</option><option value="">All companies</option></select>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="fp_dec"> Show decimals</label>
        <span class="sub" style="margin:0 0 0 auto" id="fp_note"></span>
      </div>
      <div class="card2" style="overflow:auto;max-height:calc(100vh - 230px)"><table class="fp"><thead id="fp_head"></thead><tbody id="fp_rows"></tbody></table></div>
      <div class="sub" style="margin:10px 0 30px" data-th="fp_foot">The department comes from the board&rsquo;s <b>Dzia&#322;</b> column and the line from <b>Podrodzaj kosztu</b>. Fixed / variable is decided by the category, as in the sheet: 469, 401, 412, 457, 489, 463, 464 and 467 are fixed; their <b>.V</b> variants and every other category are variable (the board&rsquo;s Koszt column is not used). Salaries and payroll taxes come from the <b>Payroll</b> tab; estimates are shown in italics. The <b>Result</b> block follows the sheet: Sales &minus; Materials (RW of the month&rsquo;s jobs, from Job costs) &minus; Sales costs = Gross margin; &minus; Overheads (Office + Production payroll) = EBITDA; each with its % of sales. Run <b>Sync from Monday</b> on the Costs tab to refresh the invoices.</div>
    </main>
  </div>
  <div id="finCostsView" style="display:none">
    <main style="max-width:1400px">
      <div class="titlerow">
        <div><h2>Costs</h2><div class="sub" data-th="fc_desc">All purchase invoices from the monday board <b id="fc_board">FAKTURY WSZYSTKIE</b>. Each invoice gets a <b>Cost ID</b> (supplier # invoice no # net) when first synced; the month it counts in is its monday group &mdash; kept here and written to monday. If the supplier, invoice number or net amount is edited later, the invoice is flagged <b>Changed</b>.</div></div>
        <div style="display:flex;gap:8px;align-self:center;align-items:center"><span class="sub" id="fc_last" style="margin:0;text-align:right"></span><button class="newbtn" id="fc_sync">Sync from Monday</button></div>
      </div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin:8px 0 0"><span class="sub" style="margin:0">Sync:</span>
        <button class="pobtn fcscope" data-m="" style="padding:5px 11px;font-size:12px">All</button><button class="pobtn fcscope" data-m="12" style="padding:5px 11px;font-size:12px">Last 12 months</button><button class="pobtn fcscope" data-m="3" style="padding:5px 11px;font-size:12px">Last 3 months</button></div>
      <div class="sub" id="fc_auto" style="margin:6px 0 0;text-align:right"></div>
      <div id="fc_progress" class="podecide" style="display:none;margin:14px 0 0"><div class="msg" id="fc_progress_msg"></div></div>
      <div class="statgrid" id="fc_stats" style="margin:14px 0"></div>
      <div class="chips" style="align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select id="fc_year" class="tinput"></select>
        <select id="fc_month" class="tinput"></select>
        <select id="fc_company" class="tinput"><option value="acemark">Acemark</option><option value="ace_group">Ace Group</option><option value="off_balance">Poza bilans</option><option value="">All companies</option></select>
        <select id="fc_dept" class="tinput"></select>
        <select id="fc_cat" class="tinput"></select>
        <select id="fc_kind" class="tinput"><option value="">Fixed + variable</option><option value="fixed">Fixed</option><option value="variable">Variable</option></select>
        <select id="fc_status" class="tinput"></select>
        <select id="fc_flag" class="tinput"><option value="">All invoices</option><option value="any">Any warning</option><option value="changed">Changed after sync</option><option value="duplicate">Duplicate Cost ID</option><option value="incomplete">Incomplete (no supplier / amount)</option><option value="reclass">To fix in monday (any reason)</option><option value="konto">\u2003KONTO \u2260 category</option><option value="unclassified">\u2003No department / category</option><option value="period">\u2003Invoice date outside its month group</option><option value="noinvoice">No invoice number</option></select>
        <span id="fc_extra" class="pill" style="display:none;background:#efedf7;color:var(--purple);cursor:pointer" title="Click to remove this filter"></span>
        <input id="fc_q" class="tinput" placeholder="Search supplier, invoice no, order, description" style="min-width:260px;flex:1">
      </div>
      <div class="card2" style="overflow-x:auto"><table><thead><tr>
        <th title="Invoice date. The month an invoice is counted in is its monday group.">DATE</th><th>SUPPLIER</th><th>INVOICE NO</th><th style="text-align:right">NET</th><th style="text-align:right">GROSS</th><th>CATEGORY</th><th>DEPT</th><th>STATUS</th><th>ORDER</th><th>COST ID</th><th></th>
      </tr></thead><tbody id="fc_rows"></tbody></table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0 30px"><div id="fc_more" class="sub" style="margin:0"></div><button class="pobtn" id="fc_csv">Export this list (CSV)</button></div>
    </main>
  </div>
  <div id="confirmView" style="display:none">
    <main style="max-width:1180px">
      <div class="titlerow"><div><h2>Report confirmations</h2><div class="sub">Upload a report to confirm (HTML), copy the link and send it to the customer. They mark their decisions, sign and click <b>Approve</b> &mdash; you then download the signed PDF here.</div></div></div>
      <div class="card2" style="padding:16px 18px;margin-top:14px">
        <div class="porow" style="margin-top:0"><label class="pobtn" for="cf_file">Choose report (.html)&hellip;</label><input id="cf_file" type="file" accept=".html,.htm,text/html" style="display:none"><span class="pofname" id="cf_fname">No file chosen</span></div>
        <div class="porow"><input id="cf_title" class="tinput" placeholder="Title (optional &mdash; taken from the report)" style="flex:1;min-width:240px"><button class="newbtn" id="cf_create">Create link</button></div>
        <div id="cf_new" style="display:none;margin-top:12px"></div>
      </div>
      <div class="statgrid" id="cf_summary" style="margin:14px 0"></div>
      <div class="card2"><table><thead><tr><th>REPORT</th><th>SHARED BY</th><th>CREATED</th><th>LAST ACTIVITY</th><th>STATUS</th><th>APPROVED</th><th></th></tr></thead><tbody id="cf_rows"></tbody></table></div>
    </main>
  </div>
  <div id="labelsView" style="display:none">
    <main style="max-width:1080px">
      <div class="titlerow"><div><h2>Labels</h2><div class="sub">Upload an Archimede production printout (<b>WYDRUK PRODUKCYJNY</b> PDF) and download an A4 sheet of labels (2 &times; 4, 105 &times; 74 mm). Each piece gets <b>two labels side by side</b> &mdash; the label on the left and its copy on the right &mdash; so one sheet holds 4 pieces. Nothing is stored.</div></div></div>
      <div class="statgrid" id="lbl_stats" style="display:none;margin:14px 0 0"></div>
      <div class="card2" style="padding:16px 18px;margin-top:14px">
        <div class="porow" style="margin-top:0"><label class="pobtn" for="lbl_file">Choose PDF&hellip;</label><input id="lbl_file" type="file" accept="application/pdf,.pdf" style="display:none"><span class="pofname" id="lbl_fname">No file chosen</span></div>
        <div id="lbl_status" class="sub" style="margin:10px 0 0"></div>
      </div>
      <div id="lbl_result" style="display:none">
        <div id="lbl_warn"></div>
        <div class="card2" style="padding:16px 18px;margin-top:14px">
          <div class="fgrid" style="padding:0">
            <div class="field full"><label>Job line (printed under the size, before the reference)</label><input id="lbl_title" class="tinput"></div>
          </div>
          <div class="porow" style="gap:18px">
            <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="lbl_logo" checked> WEM logo</label>
            <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="lbl_company" checked> Company details</label>
            <label style="display:flex;gap:6px;align-items:center;font-size:13px">Skip first <input type="number" id="lbl_skip" class="tinput" min="0" max="3" value="0" style="width:64px"> rows on the sheet</label>
          </div>
        </div>
        <div class="card2" style="margin-top:14px"><table><thead><tr><th style="width:34px"><input type="checkbox" id="lbl_all" checked></th><th>POZ.</th><th>CONFIGURATION</th><th>W</th><th>H</th><th>REFERENCE</th></tr></thead><tbody id="lbl_rows"></tbody></table></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:14px 0 30px"><button class="pobtn" id="lbl_hw" title="Adds one more row at the end: two labels that say HARDWARE">+ Add HARDWARE labels</button><button class="newbtn" id="lbl_go">Download labels PDF</button></div>
      </div>
    </main>
  </div>
  <div id="suppliersView" style="display:none">
    <main style="max-width:900px">
      <div class="titlerow">
        <div><h2>Suppliers</h2><div class="sub">Approved suppliers to pick from on a PO request.</div></div>
        <div style="display:flex;gap:8px;align-self:center"><button class="add" id="impSupBtn" style="display:none" onclick="importSuppliers()">Import from Monday</button><button class="newbtn" id="newSupBtn" style="display:none" onclick="openSupplier()">+ New supplier</button></div>
      </div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>NAME</th><th>CONTACT</th><th>EMAIL</th><th>PHONE</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="supRows"></tbody></table></div>
    </main>
  </div>

  <div id="costcentresView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>Cost centres</h2><div class="sub">The list that tags every purchase / PO request. Frameworks and general overheads are added by hand; job cost centres are imported from the Enquiries board (code = the L-number, description = the enquiry name).</div></div>
        <div style="display:flex;gap:8px;align-self:center">
          <button class="add" id="importEqBtn" onclick="importEnquiries()">Import from Enquiries</button>
          <button class="newbtn" id="newCcBtn" onclick="openCostCentre()">+ New cost centre</button>
        </div>
      </div>
      <div class="chips" style="align-items:center;margin-bottom:6px">
        <select id="ccTypeFilter" class="tinput" onchange="loadCostCentres()">
          <option value="">All types</option><option value="framework">Framework</option><option value="enquiry">Enquiry / job</option><option value="general">General / overhead</option>
        </select>
        <input id="ccSearch" class="tinput" placeholder="Search code or description" oninput="renderCostCentres()" style="min-width:220px">
        <span id="ccCount" class="itemcount"></span>
      </div>
      <div class="card2"><table><thead><tr>
        <th>CODE</th><th>DESCRIPTION</th><th>TYPE</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="ccRows"></tbody></table></div>
    </main>
  </div>

  <div id="custadminView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>Customers</h2><div class="sub">Customer cards: a short code, name, contact people and the contractual requirements that apply (Pass24, Building control, …). New jobs must reference a customer created here.</div></div>
        <div style="display:flex;gap:8px;align-self:center">
          <button class="add" id="reqTypesBtn" onclick="openReqTypes()">Requirements list</button>
          <button class="newbtn" id="newCustBtn" onclick="openCustomer()">+ New customer</button>
        </div>
      </div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>CODE</th><th>NAME</th><th>CONTACTS</th><th>REQUIREMENTS</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="custRows"></tbody></table></div>
    </main>
  </div>

  <div id="testsView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>QA test run</h2><div class="sub" id="testProg">—</div></div>
        <button class="add" onclick="exportTests()" style="align-self:center">Export CSV</button>
      </div>
      <div class="chips" style="align-items:center">
        <select id="testVer" class="tinput" onchange="changeTestVer()" title="Test results are recorded per app version"></select>
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
      <div class="sub">Create logins for office and field staff, set their role, and deactivate anyone who leaves. Roles: <b>admin</b> (full access + this tab), <b>office</b>, <b>surveyor</b>, <b>scanner</b>, <b>fitter</b>, and <b>invoice manager</b> (budget/pricing only — no operational data).</div>
      <div class="addrow" style="flex-wrap:wrap">
        <input id="nuName" class="tinput" placeholder="Full name">
        <input id="nuEmail" class="tinput" type="email" placeholder="email@company.com" style="width:210px">
        <select id="nuRole" class="tinput"></select>
        <input id="nuPass" class="tinput" placeholder="password (blank = auto)" style="width:180px">
        <button class="add" onclick="addUser()">Add user</button>
      </div>
      <div class="ferr" id="userErr" style="padding:6px 2px 0"></div>
      <div class="card2" style="margin-top:14px;overflow-x:auto"><table style="min-width:1000px"><thead><tr>
        <th>NAME</th><th>EMAIL</th><th>ROLE</th><th>CLIENT</th><th>TEAM</th><th title="Interface language. Default = English. Polish currently covers the Fin&amp;Ops screens.">LANGUAGE</th><th>LOGIN</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="userRows"></tbody></table></div>
      <div class="sub" style="margin-top:8px">A <b>fitter's</b> team decides which items they see in the phone app. Set it here; item→team assignment itself comes from Monday (Sync tab → Pull fitters). A <b>customer</b> only signs in to a read-only portal — set their <b>CLIENT</b> code (e.g. AXS) to control which jobs they can see and download the rate-free install report for.</div>
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
      <div class="addrow" style="margin:4px 0 12px"><input id="logSearch" class="tinput" placeholder="Filter by user, action, entity or details…" style="width:340px" oninput="renderLogs()"></div>
      <div class="card2" style="overflow:auto"><table style="min-width:760px"><thead><tr>
        <th>WHEN</th><th>USER</th><th>ROLE</th><th>ACTION</th><th>DETAILS</th>
      </tr></thead><tbody id="logRows"></tbody></table></div>
    </main>
  </div>

  <div id="mappingView" style="display:none">
    <main style="max-width:1200px">
      <h2>Mapping</h2>
      <div class="sub" id="mapSub">Import a survey sheet, or pre-load a job's items floor by floor.</div>

      <div class="card2" id="mapPickCard" style="margin:14px 0;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12.5px;color:var(--muted)">Build a plan for job
          <select id="mapJobPick" onchange="mapPickJob(this.value)" style="min-width:340px;margin-left:8px"></select>
        </label>
      </div>

      <div class="card2" id="importCard" style="margin:14px 0;padding:16px 18px">
        <div style="font-weight:800;font-size:14px;margin-bottom:3px">Import from Excel</div>
        <div class="sub" style="margin:0 0 12px">Upload a survey sheet (the <b>Main</b> tab). Rows load into an editable, filterable grid below and are saved as a draft for this job. When you're ready, <b>Upload to Items</b> — any row missing required data is created as <b>Unfinished</b> so you can complete it later.</div>
        <div class="imp-toolbar">
          <input type="file" id="impFile" accept=".xlsx,.xls" onchange="onImpFile(this)" style="font-size:12px">
          <span id="impFileName" class="imp-summary"></span>
        </div>
        <div id="impArea" style="display:none">
          <div class="imp-toolbar">
            <button class="add" onclick="saveImportDraft(true)">Save draft</button>
            <button class="newbtn" onclick="commitImport()">Upload to Items</button>
            <button class="impclear" onclick="clearImportDraft()" title="Empties this grid and the saved draft so you can import a fresh, adjusted file. Does NOT touch items already on the Items board.">Clear screen &amp; delete draft</button>
            <select id="impStatusSel" class="colfilter" onchange="setImpStatus(this.value)" style="width:auto"><option value="">All rows</option><option value="unfinished">Unfinished only</option><option value="complete">Complete only</option><option value="dupe">Duplicates only</option></select>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink)"><input type="checkbox" id="impDupChk" checked onchange="setImpDup(this.checked)"> Check duplicates</label>
            <span id="impSummary" class="imp-summary"></span>
          </div>
          <div class="imp-summary" style="margin:0 0 8px"><b>Clear screen &amp; delete draft</b> empties this grid so you can re-import an adjusted file (it only clears the draft — items already on the Items board are untouched).</div>
          <div class="imp-wrap"><table class="impgrid" id="impGrid"></table></div>
        </div>
        <div id="impEmpty" class="empty" style="margin-top:6px">No import yet — pick a job on the left, then choose an .xlsx file.</div>
        <div id="impDelWrap" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
          <button class="impdel" onclick="deleteImportedItems()">Delete items imported to this job</button>
          <span class="imp-summary" style="margin-left:8px">Removes items previously uploaded from Excel for this job. Items already synced to Monday are kept.</span>
        </div>
      </div>

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
  <div id="leadsView" style="display:none">
    <main style="max-width:1000px">
      <h2>Leads</h2>
      <div class="sub">People who tried the mobile demo or requested a quote. Read-only.</div>
      <div class="card2" style="margin:12px 0;padding:14px 16px">
        <div style="font-weight:700;font-size:13px;margin-bottom:3px">Quote request destination</div>
        <div class="sub" style="margin:0 0 10px">Email the mobile app's &ldquo;Request a quote&rdquo; opens a message to.</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input id="demoLeadsEmail" class="tinput" type="email" placeholder="sales@acegroup-uk.com" style="width:280px">
          <button class="add" onclick="saveDemoLeadsEmail()">Save</button>
          <span id="demoLeadsMsg" style="font-size:12px;color:var(--muted)"></span>
        </div>
      </div>
      <div class="card2" style="overflow-x:auto"><table style="min-width:840px"><thead><tr>
        <th>WHEN</th><th>TYPE</th><th>EMAIL</th><th>NAME</th><th>COMPANY</th><th>PHONE</th><th>MESSAGE</th><th>APP</th>
      </tr></thead><tbody id="leadsRows"></tbody></table></div>
    </main>
  </div>

  <div id="customersView" style="display:none">
    <main style="max-width:900px">
      <h2>Customers</h2>
      <div class="sub">Customer portal accounts. Create/manage logins under Admin &rarr; Users (role: customer).</div>
      <div class="card2" style="margin-top:12px;overflow-x:auto"><table style="min-width:600px"><thead><tr>
        <th>NAME</th><th>EMAIL</th><th>CLIENT</th><th>STATUS</th>
      </tr></thead><tbody id="customersRows"></tbody></table></div>
    </main>
  </div>

  <div id="billingView" style="display:none">
    <main style="max-width:900px">
      <h2>Billing &amp; usage</h2>
      <div class="sub" id="billingSub">Items created per tenant per month, at each tenant's per-item rate.</div>
      <div class="chips" style="align-items:center;margin:12px 0;gap:10px">
        <label style="font-size:12px;color:var(--muted)">Month</label>
        <input id="billMonth" type="month" class="tinput" onchange="loadBilling()">
        <span id="billMsg" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div class="card2" style="overflow-x:auto"><table style="min-width:640px"><thead><tr>
        <th>TENANT</th><th>RATE (£/item)</th><th>ITEMS</th><th>AMOUNT</th>
      </tr></thead><tbody id="billRows"></tbody></table></div>
    </main>
  </div>

<div id="modal" class="overlay" style="display:none">
  <div class="sheet">
    <div class="sheethead"><h3 id="modalTitle">—</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div id="modalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  var STAGE={scanned:'Scanned',in_survey:'In survey',surveyed:'Surveyed',synced:'Synced'};
  var ISTATUS=[['','—'],['scheduled','Scheduled'],['installed_no_snag','Installed no snag'],['installed_snag','Installed + snag'],['snag','Snag'],['misfit','MisFit'],['delayed','Delayed'],['omit','Omit']];
  var ISTATUS_LABEL={};ISTATUS.forEach(function(s){ISTATUS_LABEL[s[0]]=s[1];});
  function teamName(id){for(var i=0;i<teams.length;i++){if(teams[i].id===id)return teams[i].name;}return '—';}
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
  function roomLabel(code){ if(!code)return '—'; for(var i=0;i<ROOMS.length;i++){if(ROOMS[i].code===code)return ROOMS[i].name+' ('+code+')';} return code; }
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
    var out='<option value="">— pick room —</option>';
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
  // ---- multi-select column filters (Items table). State lives in MF[hostId].state (array). ----
  var MF={};
  function mfOptions(field,mapLabel){
    var vals=[],hasNone=false;
    ((itemsData&&itemsData.items)||[]).forEach(function(it){var v=(it[field]==null?'':String(it[field])); if(v){if(vals.indexOf(v)<0)vals.push(v);}else hasNone=true;});
    vals.sort(function(a,b){return (parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));});
    return {items:vals.map(function(v){return {v:v,l:mapLabel?mapLabel(v):v};}),hasNone:hasNone};
  }
  function buildMF(hostId,label,allLabel,opts){
    var prev=(MF[hostId]&&MF[hostId].state)||[];
    var avail={}; opts.items.forEach(function(o){avail[o.v]=1;}); if(opts.hasNone)avail['__none']=1;
    MF[hostId]={state:prev.filter(function(v){return avail[v];}),items:opts.items,hasNone:!!opts.hasNone,label:label,allLabel:allLabel};
    renderMF(hostId);
  }
  function renderMF(hostId){
    var m=MF[hostId],host=document.getElementById(hostId); if(!m||!host)return;
    var rows='';
    if(m.hasNone)rows+='<label><input type="checkbox" data-v="__none" '+(m.state.indexOf('__none')>=0?'checked':'')+'> — none —</label>';
    rows+=m.items.map(function(o){return '<label><input type="checkbox" data-v="'+av(o.v)+'" '+(m.state.indexOf(o.v)>=0?'checked':'')+'> '+esc(o.l)+'</label>';}).join('');
    host.innerHTML='<div class="mfilter"><button type="button" class="mfbtn" onclick="mfToggle(\\''+hostId+'\\',event)"></button>'
      +'<div class="mfpop" id="pop_'+hostId+'" onclick="event.stopPropagation()">'+rows+'<div class="mfclear" onclick="mfClear(\\''+hostId+'\\')" style="display:none">Clear</div></div></div>';
    var pop=document.getElementById('pop_'+hostId);
    Array.prototype.forEach.call(pop.querySelectorAll('input[type=checkbox]'),function(cb){ cb.addEventListener('change',function(){ mfSet(hostId,cb.getAttribute('data-v'),cb.checked); }); });
    mfBtn(hostId);
  }
  function mfBtn(hostId){
    var m=MF[hostId],host=document.getElementById(hostId); if(!m||!host)return;
    var n=m.state.length, btn=host.querySelector('.mfbtn');
    btn.textContent=(n?m.label+' · '+n:m.allLabel)+' ▾'; btn.classList.toggle('act',n>0);
    var clr=host.querySelector('.mfclear'); if(clr){clr.style.display=n?'block':'none'; clr.textContent='Clear ('+n+')';}
  }
  function mfSet(hostId,v,on){ var m=MF[hostId]; if(!m)return; var i=m.state.indexOf(v); if(on&&i<0)m.state.push(v); else if(!on&&i>=0)m.state.splice(i,1); mfBtn(hostId); renderItems(); }
  function mfClear(hostId){ var m=MF[hostId]; if(!m)return; m.state=[]; var host=document.getElementById(hostId); Array.prototype.forEach.call(host.querySelectorAll('input[type=checkbox]'),function(cb){cb.checked=false;}); mfBtn(hostId); renderItems(); }
  function mfToggle(hostId,e){ if(e)e.stopPropagation(); var pop=document.getElementById('pop_'+hostId); if(!pop)return; var open=pop.classList.contains('open'); document.querySelectorAll('.mfpop.open').forEach(function(p){p.classList.remove('open');}); if(!open)pop.classList.add('open'); }
  function mfMatch(hostId,val){ var m=MF[hostId]; if(!m||!m.state.length)return true; var v=(val==null||val==='')?'__none':String(val); return m.state.indexOf(v)>=0; }
  document.addEventListener('click',function(){ document.querySelectorAll('.mfpop.open').forEach(function(p){p.classList.remove('open');}); });
  // Deep link from a PO notification: /?po=<id>. Stash it so it survives login (incl. the SSO
  // round-trip), strip it from the address bar, and open it once the app is up.
  (function(){ var q=new URLSearchParams(window.location.search); var po=q.get('po');
    if(po){ sessionStorage.setItem('ace_open_po',po); history.replaceState(null,'',window.location.pathname+window.location.hash); }
    if(q.get('confirmations')){ sessionStorage.setItem('ace_tab','confirm'); history.replaceState(null,'',window.location.pathname+window.location.hash); } })();
  function openPendingPo(){
    var po=sessionStorage.getItem('ace_open_po'); if(!po)return;
    sessionStorage.removeItem('ace_open_po');
    if(!canCap('purchasing.request')){ tShow('You don\\u2019t have access to PO requests.'); return; }
    showTab('poreq'); openPoReq(po);
  }
  function restoreTab(){
    var t=sessionStorage.getItem('ace_tab')||(myRole==='scanner'?'mapping':'dashboard');
    if(myRole==='logistics') return (t==='confirm'||t==='labels')?t:'labels';
    if(myRole==='acemark_finance') return (t==='fincosts'||t==='finperf'||t==='finjobs'||t==='finsales'||t==='finpay')?t:'finperf';
    var need={fincosts:'finops.view',finperf:'finops.view',finjobs:'finops.view',finsales:'finops.view',finpay:'finops.view',confirm:'confirmations.manage',labels:'labels.print',dashboard:'dashboard.view',teams:'teams.manage',sync:'monday.sync',plans:'dashboard.view',mapping:'items.create'};
    if((t==='users'||t==='roles'||t==='logs')&&myRole!=='admin')t='items';
    else if(need[t]&&!canCap(need[t]))t='items';
    return t;
  }
  var myRole=sessionStorage.getItem('ace_role')||''; var myTeam=sessionStorage.getItem('ace_team')||''; var USER_ROLES=['admin','office','surveyor','scanner','fitter'];
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
    if(r.ok){var me=await r.json();myRole=me.role||'';myClientCode=me.client_code||'';myTeam=me.team_id||'';setLang(me.language);sessionStorage.setItem('ace_token',token);sessionStorage.setItem('ace_role',myRole);sessionStorage.setItem('ace_client',myClientCode);sessionStorage.setItem('ace_team',myTeam);document.getElementById('whoName').textContent=me.name||'';showApp();}
    else{logout();document.getElementById('loginErr').textContent='No ACE account for this email — ask an admin to add you first.';}
  }
  function showChangelog(){
    var html='<div style="padding:16px 22px 20px">'+CHANGELOG.map(function(e){
      return '<div style="margin-bottom:15px"><div style="font-weight:800;color:var(--purple);font-size:14px">v'+esc(e.version)+' <span style="color:var(--muted);font-weight:500;font-size:12px">'+esc(e.date)+'</span></div>'
        +'<ul style="margin:6px 0 0 18px;padding:0;font-size:13px">'+e.changes.map(function(c){return '<li style="margin:3px 0">'+esc(c)+'</li>';}).join('')+'</ul></div>';
    }).join('')+'</div>';
    openModal('What\\'s new',html);
  }
  function tShow(m){var t=document.getElementById('toast');t.textContent=TR(m);t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1600);}
  async function api(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json',Authorization:'Bearer '+token},opts.headers||{});var r=await fetch(path,opts);if(r.status===401){logout();throw new Error('unauth')}return r;}
  async function login(){
    var email=document.getElementById('email').value, password=document.getElementById('password').value;
    var r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    var d=await r.json();
    if(!r.ok){document.getElementById('loginErr').textContent=d.error||'Login failed';return;}
    token=d.token; myRole=d.role||''; myClientCode=d.client_code||''; myTeam=d.team_id||''; setLang(d.language); sessionStorage.setItem('ace_token',token); sessionStorage.setItem('ace_role',myRole); sessionStorage.setItem('ace_client',myClientCode); sessionStorage.setItem('ace_team',myTeam);
    document.getElementById('whoName').textContent=d.name;
    showApp();
  }
  function logout(){token='';myRole='';myClientCode='';myTeam='';setLang('');sessionStorage.removeItem('ace_token');sessionStorage.removeItem('ace_role');sessionStorage.removeItem('ace_client');sessionStorage.removeItem('ace_team');document.getElementById('appView').style.display='none';document.getElementById('loginView').style.display='grid';}
  async function showApp(){
    document.getElementById('loginView').style.display='none';document.getElementById('appView').style.display='block';applyRole();
    if(myRole==='customer'){await loadCustomer();return;}
    if(myRole==='logistics'||myRole==='acemark_finance'){showTab(restoreTab());return;}
    try{ROOM_STATS=await (await api('/api/room-stats')).json();}catch(e){ROOM_STATS={};}
    await loadJobs();await loadItems();showTab(restoreTab());openPendingPo();
  }
  async function loadCustomer(){
    ['dashboard','items','teams','sync','plans','cal','budget','invoices','signoff','custadmin','costcentres','poreq','suppliers','labels','confirm','finCosts','finPerf','finJobs','finSales','finPay','tests','users','roles'].forEach(function(n){var v=document.getElementById(n+'View');if(v)v.style.display='none';});
    document.getElementById('customerView').style.display='block';
    var box=document.getElementById('custJobs'); box.innerHTML='<div class="sub">Loading…</div>';
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
  var JOB_STATUS={}, JOB_MAPDATE={}, JOBS_BY_ID={}, mapJob='';
  // ---- Mapping (scanner pre-load) ----
  function mapJobId(){ return mapJob||''; }
  function mapJobCode(){ var j=JOBS_BY_ID[mapJob]; return j?j.code:''; }
  function loadMapping(){
    var box=document.getElementById('mapBody');
    if(!mapJob){ document.getElementById('mapSub').textContent='Pick a job above to build its plan.'; box.innerHTML='<div class="empty">Choose a job from the “Build a plan for job” list above to start.</div>'; return; }
    var status=JOB_STATUS[mapJob]||'';
    document.getElementById('mapSub').innerHTML='Job <b>'+esc((JOBS_BY_ID[mapJob]||{}).site_code||mapJobCode())+'</b> · status: <b>'+esc(status.replace('_',' '))+'</b>';
    if(status!=='pending_mapping'){
      if(canCap('jobs.manage')){
        box.innerHTML='<div class="card2" style="padding:16px;max-width:480px">'
          +'<div style="font-weight:800;margin-bottom:4px">Release this job for mapping</div>'
          +'<div class="sub" style="margin-bottom:10px">Assign a mapping start date to make this job visible to scanners.</div>'
          +'<div style="display:flex;gap:10px;align-items:center"><input type="date" id="mapDate" value="'+esc(JOB_MAPDATE[mapJob]||'')+'"><button class="save" id="mapDateBtn">Assign date</button></div></div>';
        document.getElementById('mapDateBtn').addEventListener('click',assignMapDate);
      } else box.innerHTML='<div class="empty">This job isn\\'t ready for mapping yet — an admin needs to assign a mapping start date.</div>';
      return;
    }
    renderMapBuilder(box);
  }
  // Job picker at the top of Mapping: only jobs with no items yet, grouped by programme status.
  async function loadMappingJobs(){
    var sel=document.getElementById('mapJobPick'); if(!sel)return;
    var d; try{ d=await (await api('/api/mapping-jobs')).json(); }catch(e){ return; }
    function grp(label,arr){ if(!arr||!arr.length)return ''; return '<optgroup label="'+esc(label)+'">'+arr.map(function(j){return '<option value="'+av(j.id)+'">'+esc(j.site_code||j.code)+' — '+esc(j.name)+(j.programme_end?(' · ends '+esc(j.programme_end)):'')+'</option>';}).join('')+'</optgroup>'; }
    var total=(d.live.length+d.pending.length+d.done.length);
    sel.innerHTML='<option value="">— '+(total?'pick a job to build':'no jobs without items')+' —</option>'
      +grp('Live',d.live)+grp('Pending',d.pending)+grp('Job done',d.done);
    // Keep the current mapping selection if it's still buildable; otherwise show the placeholder.
    if(mapJob&&sel.querySelector('option[value="'+mapJob+'"]')) sel.value=mapJob; else { mapJob=''; sel.value=''; }
  }
  function mapPickJob(id){
    mapJob=id||'';
    if(mapJob){ current=mapJob; document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)}); }
    loadMapping(); loadImport();
  }

  // ---- Excel import (Operations ▸ Mapping ▸ Import from Excel) ----
  var impRows=[], impFilters={}, impStatusFilter='', impFileName='', impSaveTimer=null;
  var impExistingCodes={};                       // full_codes already in the job's Items table
  var impDupOn=(localStorage.getItem('ace_imp_dupcheck')!=='0'); // duplicate checking, default ON
  // Rebuild an item's full code from a grid row (mirrors the server's buildItemCode, room included).
  function impRowCode(r){
    var cc=curCode(); if(!cc)return '';
    function up(v){return String(v==null?'':v).trim().toUpperCase();}
    function lvl(v){var s=String(v==null?'':v).trim().replace(/^F(?=[0-9])/i,''); if(!s)return ''; return /^[0-9]+$/.test(s)?('F'+s):s.toUpperCase();}
    var item=up(r.item); if(!item)return '';
    var level=(r.flat!=null&&String(r.flat).trim()!=='')?lvl(r.flat):lvl(r.floor);
    var parts=cc.split('.');
    return [parts[0],parts[1],up(r.block),up(r.elevation),level,up(r.room),item].filter(function(x){return x;}).join('.');
  }
  // Grid columns, in order. * = required (missing ⇒ Unfinished). Mirrors @ace/shared IMPORT_FIELDS.
  var IMP_COLS=[
    {k:'block',l:'Block'},{k:'elevation',l:'Elev'},{k:'flat',l:'Flat'},{k:'floor',l:'Floor'},
    {k:'room',l:'Room'},{k:'item',l:'Item'},
    {k:'material',l:'Material'},{k:'item_type',l:'Item type'},{k:'window_type',l:'Window type'},
    {k:'glass',l:'Glass'},{k:'safety_glass',l:'Safety'},{k:'glazing',l:'Glazing'},{k:'glazing_bars',l:'Glazing bars'},
    {k:'width_mm',l:'Width'},{k:'height_mm',l:'Height'},{k:'cill_depth',l:'Cill'},
    {k:'transom1_mm',l:'Trans1'},{k:'transom2_mm',l:'Trans2'},{k:'transom3_mm',l:'Trans3'},
    {k:'mullion1_mm',l:'Mull1'},{k:'mullion2_mm',l:'Mull2'},{k:'mullion3_mm',l:'Mull3'},
    {k:'open_in_out',l:'Open'},{k:'add_ons',l:'Add-ons',wide:1},{k:'coupled',l:'Coupled'},
    {k:'design_code',l:'Design'},{k:'comments',l:'Comments',wide:1}
  ];
  var IMP_REQ={block:1,elevation:1,item:1,room:1,material:1,item_type:1,glass:1,glazing:1,width_mm:1,height_mm:1,open_in_out:1,design_code:1};
  // Excel header (normalized: lowercased, non-alphanumerics stripped) → canonical key. '' = ignore.
  var IMP_HDR={
    areacouncil:'',area:'',council:'',site:'',designsketch:'',sketch:'',
    block:'block',elevation:'elevation',elev:'elevation',item:'item',floor:'floor',
    flatplotno:'flat',flatplot:'flat',flat:'flat',flatno:'flat',plotno:'flat',plot:'flat',
    material:'material',itemtype:'item_type',type:'item_type',
    glass:'glass',safetyglass:'safety_glass',safety:'safety_glass',
    glazing:'glazing',glazingbars:'glazing_bars',
    width:'width_mm',heightinccill:'height_mm',height:'height_mm',
    addonrequiredincassizeshown:'add_ons',addonrequired:'add_ons',addons:'add_ons',addon:'add_ons',
    cilldepth:'cill_depth',cill:'cill_depth',coupled:'coupled',designcode:'design_code',
    transom1fromtop:'transom1_mm',transom1:'transom1_mm',transom2fromtop:'transom2_mm',transom2:'transom2_mm',
    transom3fromtop:'transom3_mm',transom3:'transom3_mm',
    mullion1fromleft:'mullion1_mm',mullion1:'mullion1_mm',mullion2fromleft:'mullion2_mm',mullion2:'mullion2_mm',
    mullion3fromleft:'mullion3_mm',mullion3:'mullion3_mm',
    openinopenout:'open_in_out',openinout:'open_in_out',open:'open_in_out',
    room:'room',comments:'comments'
  };
  var IMP_ROOM2CODE=null;
  function impRoomMap(){
    if(IMP_ROOM2CODE)return IMP_ROOM2CODE;
    IMP_ROOM2CODE={};
    ROOMS.forEach(function(r){ IMP_ROOM2CODE[r.name.toLowerCase().replace(/[^a-z0-9]/g,'')]=r.code; IMP_ROOM2CODE[r.code.toLowerCase()]=r.code; });
    return IMP_ROOM2CODE;
  }
  function normHdr(h){ return String(h==null?'':h).toLowerCase().replace(/[^a-z0-9]/g,''); }
  function impVal(v){ return v==null?'':String(v).trim(); }
  function roomToCode(v){ if(v==null||v==='')return ''; var t=String(v).replace(/\\u00a0/g,' ').trim(); var n=t.toLowerCase().replace(/[^a-z0-9]/g,''); return impRoomMap()[n]||t.toUpperCase(); }
  // Snap common spellings of Material to the canonical option so imported values match the dropdown.
  function normMaterial(v){ var t=String(v==null?'':v).replace(/\\u00a0/g,' ').trim(); if(!t)return ''; var n=t.toLowerCase().replace(/[^a-z]/g,'');
    if(n==='pvc'||n==='upvc'||n==='pvcu'||n==='uvpc'||n==='vpvc')return 'uPVC';
    if(n==='alu'||n==='ali'||n==='aluminium'||n==='aluminum'||n==='aluminimum')return 'Aluminium';
    if(n==='timber'||n==='wood'||n==='wooden')return 'Timber';
    if(n==='composite'||n==='comp')return 'Composite';
    return t; }
  function normSafety(v){ if(v===false||v==null)return ''; if(v===true)return 'Yes'; var t=String(v).trim(); if(!t||/^n\\/?a$/i.test(t))return ''; if(/^y/i.test(t))return 'Yes'; return t; }
  // Which required fields a row is missing (flat OR floor satisfies the level requirement).
  function impMissing(r){
    var miss=[]; for(var k in IMP_REQ){ if(!impVal(r[k]))miss.push(k); }
    if(!impVal(r.flat)&&!impVal(r.floor))miss.push('flat/floor');
    return miss;
  }
  function rowComplete(r){ return impMissing(r).length===0; }

  function onImpFile(input){
    if(!current||current==='ALL'){ tShow('Pick a job on the left first'); input.value=''; return; }
    var f=input.files&&input.files[0]; if(!f)return;
    if(typeof XLSX==='undefined'){ tShow('Spreadsheet library still loading — try again in a moment'); return; }
    impFileName=f.name;
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
        var sheet=wb.Sheets['Main']||wb.Sheets[wb.SheetNames[0]];
        var aoa=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});
        parseImpAoa(aoa);
      }catch(err){ tShow('Could not read that file: '+(err&&err.message?err.message:err)); }
    };
    reader.readAsArrayBuffer(f);
  }
  function parseImpAoa(aoa){
    var hi=-1;
    for(var i=0;i<aoa.length&&i<15;i++){ var norm=(aoa[i]||[]).map(normHdr); if(norm.indexOf('block')>=0&&norm.indexOf('item')>=0){ hi=i; break; } }
    if(hi<0){ tShow('Could not find the header row — need the Main tab with Block & Item columns'); return; }
    var hdr=(aoa[hi]||[]).map(normHdr);
    var colKey=hdr.map(function(nh){ var k=IMP_HDR[nh]; return k?k:null; });
    var clientCol=-1,siteCol=-1;
    for(var c=0;c<hdr.length;c++){ if(hdr[c]==='areacouncil'||hdr[c]==='area'||hdr[c]==='council')clientCol=c; if(hdr[c]==='site')siteCol=c; }
    var start=hi+1;
    var exRow=aoa[start]||[];
    var looksExample=exRow.some(function(cv){ return cv!=null&&/e\\.g\\.|yes \\/ n\\/a|count from/i.test(String(cv)); });
    if(looksExample)start++;
    var cc=curCode(); var jobClient=(cc.split('.')[0]||'').toUpperCase(), jobCode=(cc.split('.')[1]||'').toUpperCase();
    var rows=[], mismatch=0;
    for(var r=start;r<aoa.length;r++){
      var arr=aoa[r]||[]; var obj={};
      for(var cc=0;cc<arr.length;cc++){
        var key=colKey[cc]; if(!key)continue; var val=arr[cc]; if(val==null)continue;
        if(key==='room')val=roomToCode(val);
        else if(key==='safety_glass')val=normSafety(val);
        else if(key==='material')val=normMaterial(val);
        else val=String(val).replace(/\\u00a0/g,' ').trim();
        if(obj[key]==null||obj[key]==='')obj[key]=val;
      }
      if(!impVal(obj.item))continue;
      if(clientCol>=0&&arr[clientCol]!=null&&String(arr[clientCol]).trim().toUpperCase()!==jobClient)mismatch++;
      else if(siteCol>=0&&arr[siteCol]!=null&&String(arr[siteCol]).trim().toUpperCase()!==jobCode)mismatch++;
      rows.push(obj);
    }
    if(!rows.length){ tShow('No item rows found in the sheet'); return; }
    var jobLabel=(JOBS_BY_ID[current]||{}).site_code||curCode();
    if(mismatch>0&&!confirm(mismatch+' of '+rows.length+' rows have a different Area/Site than the selected job ('+jobLabel+'). Import into '+jobLabel+' anyway?')) return;
    impRows=rows; impFilters={}; impStatusFilter='';
    var ss=document.getElementById('impStatusSel'); if(ss)ss.value='';
    renderImportGrid();
    saveImportDraft(false);
    tShow('Loaded '+rows.length+' rows — review, then Upload to Items');
  }

  function renderImportGrid(){
    var area=document.getElementById('impArea'), empty=document.getElementById('impEmpty');
    if(!impRows.length){ area.style.display='none'; empty.style.display=''; return; }
    area.style.display=''; empty.style.display='none';
    var g=document.getElementById('impGrid');
    var head='<thead><tr><th>#</th>';
    IMP_COLS.forEach(function(c){ head+='<th>'+esc(c.l)+(IMP_REQ[c.k]?' *':'')+'</th>'; });
    head+='<th>Status</th></tr><tr class="filters"><th></th>';
    IMP_COLS.forEach(function(c){ head+='<th><input value="'+av(impFilters[c.k]||'')+'" oninput="setImpFilter(\\''+c.k+'\\',this.value)"></th>'; });
    head+='<th></th></tr></thead><tbody id="impBody"></tbody>';
    g.innerHTML=head;
    renderImportBody();
  }
  function impRowMatches(r,dupReason){
    for(var k in impFilters){ var f=(impFilters[k]||'').trim().toLowerCase(); if(!f)continue; var v=String(r[k]==null?'':r[k]).toLowerCase(); if(v.indexOf(f)<0)return false; }
    if(impStatusFilter==='unfinished'&&rowComplete(r))return false;
    if(impStatusFilter==='complete'&&!rowComplete(r))return false;
    if(impStatusFilter==='dupe'&&!dupReason)return false;
    return true;
  }
  // Count each code across the grid (for in-sheet duplicate detection).
  function impCodeCounts(){ var m={}; impRows.forEach(function(r){ var c=impRowCode(r); if(c)m[c]=(m[c]||0)+1; }); return m; }
  // Why a row would be skipped on upload: a post-commit reason, an existing item, or an in-sheet dup.
  function impDupReason(r,counts){
    if(r.__skip)return r.__skip;
    if(!impDupOn)return '';
    var c=impRowCode(r); if(!c)return '';
    if(impExistingCodes[c])return 'Already in Items';
    if(counts[c]>1)return 'Duplicate row';
    return '';
  }
  function renderImportBody(){
    var tb=document.getElementById('impBody'); if(!tb)return;
    var counts=impCodeCounts();
    var html='', shown=0, unfin=0, dupN=0;
    impRows.forEach(function(r,idx){
      var dupReason=impDupReason(r,counts);
      if(!impRowMatches(r,dupReason))return; shown++;
      var miss=impMissing(r); var bad=miss.length>0; if(bad)unfin++;
      var missSet={}; miss.forEach(function(m){missSet[m]=1;});
      var tds='<td class="stcell">'+(idx+1)+'</td>';
      IMP_COLS.forEach(function(c){
        var isLevel=(c.k==='flat'||c.k==='floor')&&missSet['flat/floor'];
        var mc=(missSet[c.k]||isLevel)?' miss':'';
        tds+='<td class="'+(c.wide?'wide':'')+mc+'"><input value="'+av(r[c.k]==null?'':r[c.k])+'" onchange="impEdit('+idx+',\\''+c.k+'\\',this.value)"></td>';
      });
      var st, cls;
      if(dupReason){ st='⚠ '+dupReason; cls='duprow'; }
      else { st=bad?'Unfinished':'Complete'; cls=bad?'badrow':''; }
      tds+='<td class="stcell" title="'+(dupReason?av(dupReason):(bad?('Missing: '+av(miss.join(', '))):''))+'">'+esc(st)+'</td>';
      html+='<tr class="'+cls+'">'+tds+'</tr>';
    });
    tb.innerHTML=html;
    impRows.forEach(function(r){ if(impDupReason(r,counts))dupN++; });
    var totUnfin=impRows.filter(function(r){return !rowComplete(r);}).length;
    document.getElementById('impSummary').textContent=shown+' of '+impRows.length+' rows shown · '+totUnfin+' unfinished'+(impDupOn?(' · '+dupN+' duplicate'+(dupN===1?'':'s')):'')+(impFileName?(' · '+impFileName):'');
  }
  function setImpFilter(k,v){ impFilters[k]=v; renderImportBody(); }
  function setImpStatus(v){ impStatusFilter=v; renderImportBody(); }
  function setImpDup(on){ impDupOn=!!on; localStorage.setItem('ace_imp_dupcheck',on?'1':'0'); renderImportBody(); }
  function impEdit(idx,key,val){ if(!impRows[idx])return; impRows[idx][key]=val; delete impRows[idx].__skip; renderImportBody(); if(impSaveTimer)clearTimeout(impSaveTimer); impSaveTimer=setTimeout(function(){saveImportDraft(false);},900); }

  // Load the codes already in this job's Items, so the grid can flag duplicates live.
  async function loadExistingCodes(){
    impExistingCodes={};
    if(!current||current==='ALL')return;
    try{ var d=await (await api('/api/job/'+encodeURIComponent(current)+'/item-codes')).json(); (d.codes||[]).forEach(function(c){ if(c)impExistingCodes[c]=1; }); }catch(e){}
  }
  async function loadImport(){
    var card=document.getElementById('importCard'); if(!card)return;
    var empty=document.getElementById('impEmpty'), area=document.getElementById('impArea');
    if(!canCap('items.create')){ card.style.display='none'; return; }
    card.style.display='';
    impRows=[]; impFilters={}; impStatusFilter=''; impFileName=''; impExistingCodes={};
    var ss=document.getElementById('impStatusSel'); if(ss)ss.value='';
    var chk=document.getElementById('impDupChk'); if(chk)chk.checked=impDupOn;
    var dw=document.getElementById('impDelWrap'); if(dw)dw.style.display=(canCap('jobs.manage')&&current&&current!=='ALL')?'':'none';
    if(!current||current==='ALL'){ area.style.display='none'; empty.style.display=''; empty.textContent='Pick a job on the left, then choose an .xlsx file.'; return; }
    await loadExistingCodes();
    try{
      var d=await (await api('/api/job/'+encodeURIComponent(current)+'/import-draft')).json();
      impRows=d.rows||[]; impFileName=d.filename||'';
      if(impRows.length){ renderImportGrid(); }
      else { area.style.display='none'; empty.style.display=''; empty.textContent='No import draft for this job yet — choose an .xlsx file to begin.'; }
    }catch(e){ area.style.display='none'; empty.style.display=''; empty.textContent='Could not load the draft.'; }
  }
  async function saveImportDraft(showToast){
    if(!current||current==='ALL')return;
    try{
      var d=await (await api('/api/job/'+encodeURIComponent(current)+'/import-draft',{method:'PUT',body:JSON.stringify({rows:impRows,filename:impFileName})})).json();
      if(showToast)tShow(d.ok?('Draft saved · '+impRows.length+' rows'):(d.error||'Save failed'));
    }catch(e){ if(showToast)tShow('Save failed'); }
  }
  async function commitImport(){
    if(!impRows.length){ tShow('Nothing to upload — import a sheet first'); return; }
    await saveImportDraft(false);
    var jobName=(JOBS_BY_ID[current]||{}).site_code||curCode();
    var unfin=impRows.filter(function(r){return !rowComplete(r);}).length;
    var msg='Upload '+impRows.length+' item'+(impRows.length===1?'':'s')+' to the Items table for '+jobName+'?';
    if(impDupOn)msg+='\\n\\nDuplicate check is ON: rows already in Items (or repeated in the sheet) will be skipped and left on screen.';
    if(unfin)msg+='\\n\\n'+unfin+' row'+(unfin===1?' is':'s are')+' missing required data and will be marked Unfinished.';
    if(!confirm(msg)) return;
    tShow('Uploading…');
    try{
      var d=await (await api('/api/job/'+encodeURIComponent(current)+'/import-commit',{method:'POST',body:JSON.stringify({rows:impRows,dupCheck:impDupOn})})).json();
      if(!d.ok){ tShow(d.error||'Upload failed'); return; }
      var res=d.results||[]; var c=d.counts||{};
      // Clear rows that were loaded; keep the rest on screen with a reason note.
      var kept=[];
      impRows.forEach(function(r,i){
        var st=res[i];
        if(st==='loaded')return;
        if(st==='exists')r.__skip='Already in Items';
        else if(st==='dup')r.__skip='Duplicate row';
        else if(st==='noitem')r.__skip='No item code';
        kept.push(r);
      });
      impRows=kept;
      await saveImportDraft(false);
      if(kept.length){ renderImportGrid(); } else { document.getElementById('impArea').style.display='none'; var e=document.getElementById('impEmpty'); e.style.display=''; e.textContent='All rows uploaded — nothing left to import.'; }
      loadExistingCodes();
      loadItems();
      var parts=['Imported '+(c.loaded||0)];
      if(c.exists)parts.push(c.exists+' already in Items');
      if(c.dup)parts.push(c.dup+' in-sheet dup');
      if(d.unfinished)parts.push(d.unfinished+' unfinished');
      tShow(parts.join(' · '));
    }catch(e){ tShow('Upload failed'); }
  }
  async function clearImportDraft(){
    if(!current||current==='ALL')return;
    if(!confirm('Clear the screen and delete this job\\'s import draft?\\n\\nThe grid empties and the file picker resets so you can import a fresh (adjusted) file. Items already on the Items board are NOT affected.')) return;
    try{ await api('/api/job/'+encodeURIComponent(current)+'/import-draft',{method:'DELETE'}); }catch(e){}
    impRows=[]; impFileName=''; var fi=document.getElementById('impFile'); if(fi)fi.value='';
    loadImport(); tShow('Screen cleared — import your adjusted file');
  }
  // Delete items previously committed from an Excel import for this job (synced items are kept).
  async function deleteImportedItems(){
    if(!current||current==='ALL')return;
    if(!confirm('Delete all items imported from Excel for this job?\\n\\nItems already synced to Monday are kept. This cannot be undone.')) return;
    tShow('Deleting…');
    try{
      var d=await (await api('/api/job/'+encodeURIComponent(current)+'/import-items',{method:'DELETE'})).json();
      if(d.ok){ tShow('Deleted '+d.deleted+' imported item'+(d.deleted===1?'':'s')+(d.skippedSynced?(' · kept '+d.skippedSynced+' synced'):'')); loadItems(); }
      else tShow(d.error||'Delete failed');
    }catch(e){ tShow('Delete failed'); }
  }

  async function assignMapDate(){
    var jid=mapJob; if(!jid){tShow('Pick a job first');return;}
    var date=document.getElementById('mapDate').value;
    if(!date){tShow('Pick a date');return;}
    var d=await (await api('/api/job/'+encodeURIComponent(jid)+'/mapping-date',{method:'POST',body:JSON.stringify({date:date})})).json();
    if(d.ok){JOB_STATUS[jid]='pending_mapping';JOB_MAPDATE[jid]=date;tShow('Released for mapping');loadMapping();}
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
    var el=document.getElementById(id); if(!el)return;
    el.addEventListener('input',function(){ applyPfx(el,p); });
  }
  function renderMapBuilder(box){
    box.innerHTML=''
      +'<div class="card2" style="padding:16px;margin-bottom:14px">'
      +'<div class="groupt" style="padding:0 0 8px">BUILD ELEVATIONS &amp; FLOORS</div>'
      +'<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">'
      +'<label style="font-size:12px;color:var(--muted)">Block<br><input id="map_block" placeholder="e.g. 1 &rarr; B1" style="width:120px"></label>'
      +'<label style="font-size:12px;color:var(--muted)">Number of elevations<br><input id="map_nelev" type="number" min="1" max="60" value="1" style="width:150px"></label>'
      +'<label style="font-size:12px;color:var(--muted)">Number of floors<br><input id="map_nfloors" type="number" min="1" max="60" value="1" style="width:150px"></label>'
      +'<button class="add" id="buildGridBtn">Build grid</button>'
      +'</div>'
      +'<div class="sub" style="margin-top:8px">Each elevation gets its own floor grid (F1&hellip;FN). Fill windows &amp; doors per floor, then Preload.</div>'
      +'<div id="mapTotals" class="maptotals" style="display:none"></div>'
      +'<div id="elevGrids" style="margin-top:14px"></div>'
      +'<button class="add" id="preloadBtn" style="margin-top:10px;display:none">Preload</button>'
      +'</div>'
      +'<div id="mapTableWrap"></div>'
      +'<div id="mapFooter" style="margin-top:12px;gap:12px;align-items:center;display:none">'
      +'<button class="save" id="mapSaveBtn">Save</button>'
      +'<button class="add" id="mapAddRowBtn">+ Add line</button>'
      +'<span class="sub" id="mapSaveNote"></span></div>';
    mapWirePrefix('map_block','B');
    document.getElementById('buildGridBtn').addEventListener('click',buildElevGrids);
    document.getElementById('preloadBtn').addEventListener('click',mapPreload);
    document.getElementById('mapSaveBtn').addEventListener('click',mapSave);
    document.getElementById('mapAddRowBtn').addEventListener('click',mapAddRow);
    document.getElementById('elevGrids').addEventListener('input',updateMapTotals);
  }
  // Live running totals of windows and doors across all elevation floor grids (sticky bar).
  function updateMapTotals(){
    var el=document.getElementById('mapTotals'); if(!el)return;
    var w=0,d=0;
    document.querySelectorAll('#elevGrids .ef-win').forEach(function(x){ w+=parseInt(x.value,10)||0; });
    document.querySelectorAll('#elevGrids .ef-door').forEach(function(x){ d+=parseInt(x.value,10)||0; });
    var has=!!document.querySelector('#elevGrids .elevcard');
    el.style.display=has?'':'none';
    el.innerHTML='Windows <b>'+w+'</b> &middot; Doors <b>'+d+'</b> &middot; Items <b>'+(w+d)+'</b>';
  }
  function mapBlockVal(){ var e=document.getElementById('map_block'); return e?e.value.trim().toUpperCase():''; }
  // Build one floor grid per elevation (each with its own window/door counts to fill).
  function buildElevGrids(){
    if(!mapJobId()){tShow('Pick a job to build first');return;}
    var block=mapBlockVal(); if(!block){tShow('Enter a Block first');return;}
    var nE=Math.min(60,Math.max(1,parseInt(document.getElementById('map_nelev').value,10)||1));
    var nF=Math.min(60,Math.max(1,parseInt(document.getElementById('map_nfloors').value,10)||1));
    var host=document.getElementById('elevGrids'); host.innerHTML='';
    for(var e=1;e<=nE;e++){
      var card=document.createElement('div'); card.className='elevcard'; card.style.cssText='border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px';
      var rowsHtml='';
      for(var fN=1;fN<=nF;fN++){
        var flabel=(fN===1)?'GF':('F'+(fN-1)); // ground floor first, then F1, F2, …
        rowsHtml+='<div class="efrow" style="display:flex;gap:8px;margin-bottom:6px;align-items:center">'
          +'<input class="ef-floor" value="'+flabel+'" style="width:80px" title="Floor">'
          +'<input class="ef-win" type="number" min="0" placeholder="Windows" style="width:110px">'
          +'<input class="ef-door" type="number" min="0" placeholder="Doors" style="width:110px"></div>';
      }
      card.innerHTML='<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">'
        +'<span style="font-size:12px;color:var(--muted)">Elevation</span>'
        +'<input class="ec-elev" value="E'+e+'" style="width:90px">'
        +'<span class="sub">Block '+esc(block)+'</span></div>'
        +'<div class="ef-rows">'+rowsHtml+'</div>';
      host.appendChild(card);
      card.querySelectorAll('.ec-elev').forEach(function(el){ el.addEventListener('input',function(){ applyPfx(el,'E'); }); });
      card.querySelectorAll('.ef-floor').forEach(function(el){ el.addEventListener('input',function(){ applyPfx(el,'F'); }); });
    }
    document.getElementById('preloadBtn').style.display='';
    updateMapTotals();
  }
  // Floor segment: prefix F only for a plain number (1 -> F1); leave labels like GF as-is.
  function floorSeg(flat){ if(!flat) return ''; return /^[0-9]+$/.test(flat) ? ('F'+flat) : flat.toUpperCase(); }
  function levelOf(floor,flat){ return (flat&&String(flat).trim()!=='')?flat:floor; }
  function mapCode(block,elev,floor,flat,item){
    var parts=mapJobCode().split('.');
    return [parts[0],parts[1],block,elev,floorSeg(levelOf(floor,flat)),item].filter(function(x){return x;}).join('.');
  }
  function stripF(v){ return String(v||'').trim().replace(/^F(?=[0-9])/i,''); } // "F1"->"1", "GF" stays
  // Preload: expand every elevation x floor x (W1..Wn, D1..Dn) into review rows carrying their elevation.
  function mapPreload(){
    if(!mapJobId()){tShow('Pick a job to build first');return;}
    var block=mapBlockVal();
    var rows=[];
    document.querySelectorAll('#elevGrids .elevcard').forEach(function(card){
      var elev=(card.querySelector('.ec-elev').value||'').trim().toUpperCase();
      card.querySelectorAll('.efrow').forEach(function(fr){
        var floor=(fr.querySelector('.ef-floor').value||'').trim();
        var w=parseInt(fr.querySelector('.ef-win').value,10)||0;
        var d=parseInt(fr.querySelector('.ef-door').value,10)||0;
        var k;
        for(k=1;k<=w;k++) rows.push({block:block,elevation:elev,floor:floor,flat:'',item:'W'+k,type:'Window'});
        for(k=1;k<=d;k++) rows.push({block:block,elevation:elev,floor:floor,flat:'',item:'D'+k,type:'Door'});
      });
    });
    if(!rows.length){tShow('Enter windows or doors on at least one floor');return;}
    renderMapRows(rows);
  }
  function renderMapRows(rows){
    var wrap=document.getElementById('mapTableWrap');
    var head='<tr><th>CODE</th><th>ELEV</th><th>FLOOR</th><th>FLAT</th><th>ITEM</th><th>TYPE</th><th>COUPLE</th><th>#</th><th></th><th></th></tr>';
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
    var block=mapBlockVal();
    var elev=(r.elevation||'').toUpperCase();
    var tr=document.createElement('tr');
    tr.innerHTML=''
      +'<td class="mono mapcode" style="font-size:11px;white-space:nowrap">'+esc(mapCode(block,elev,r.floor,r.flat,r.item))+'</td>'
      +'<td><input class="mr-elev" value="'+esc(elev)+'" style="width:56px" title="Elevation"></td>'
      +'<td><input class="mr-floor" value="'+esc(r.floor||'')+'" style="width:58px" title="Floor"></td>'
      +'<td><input class="mr-flat" value="'+esc(r.flat||'')+'" style="width:58px" title="Flat / plot (optional - replaces floor in the code)"></td>'
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
    function recode(){ tr.querySelector('.mapcode').textContent=mapCode(mapBlockVal(),(tr.querySelector('.mr-elev').value||'').trim().toUpperCase(),stripF(tr.querySelector('.mr-floor').value),stripF(tr.querySelector('.mr-flat').value),tr.querySelector('.mr-item').value.trim().toUpperCase()); }
    tr.querySelector('.mr-elev').addEventListener('input',function(){applyPfx(this,'E');recode();});
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
    var elev=tr.querySelector('.mr-elev').value.trim();
    var floor=tr.querySelector('.mr-floor').value.trim();
    var flat=tr.querySelector('.mr-flat').value.trim();
    var base=tr.querySelector('.mr-item').value.trim().toUpperCase();
    var type=tr.querySelector('.mr-type').value;
    if(!base){tShow('Enter an item code first');return;}
    for(var i=1;i<=n;i++){ tr.parentNode.insertBefore(makeMapRow({elevation:elev,floor:floor,flat:flat,item:base+'.'+i,type:type}),tr); }
    tr.remove(); updateSaveCount();
  }
  function mapAddRow(){ var tb=document.getElementById('mapTbody'); if(!tb)return; tb.appendChild(makeMapRow({elevation:'',floor:'',flat:'',item:'',type:'Window'})); updateSaveCount(); }
  function updateSaveCount(){ var n=document.querySelectorAll('#mapTbody tr').length; var b=document.getElementById('mapSaveBtn'); if(b)b.textContent='Save '+n+' item'+(n===1?'':'s'); }
  async function mapSave(){
    var jid=mapJobId(); if(!jid){tShow('Pick a job to build first');return;}
    var block=mapBlockVal();
    var out=[];
    document.querySelectorAll('#mapTbody tr').forEach(function(tr){
      var elev=(tr.querySelector('.mr-elev').value||'').trim().toUpperCase();
      var floor=tr.querySelector('.mr-floor').value.trim(); // keep the F; server normalises
      var flat=stripF(tr.querySelector('.mr-flat').value);
      var item=tr.querySelector('.mr-item').value.trim().toUpperCase();
      var type=tr.querySelector('.mr-type').value;
      if(!item) return;
      var couple=tr.querySelector('.mr-couple').checked;
      var nn=parseInt(tr.querySelector('.mr-n').value,10)||0;
      if(couple&&nn>=2){ for(var i=1;i<=nn;i++) out.push({block:block,elevation:elev,floor:floor,flat:flat,item:item+'.'+i,item_type:type}); }
      else out.push({block:block,elevation:elev,floor:floor,flat:flat,item:item,item_type:type});
    });
    if(!out.length){tShow('Nothing to save');return;}
    tShow('Saving '+out.length+' item(s)...');
    var d=await (await api('/api/job/'+encodeURIComponent(jid)+'/mapping-items',{method:'POST',body:JSON.stringify({block:block,elevation:'',rows:out})})).json();
    if(d.ok){
      tShow(d.inserted+' item(s) created'+(d.skipped?(' · '+d.skipped+' already existed'):''));
      // Clear the preloaded table so the user doesn't think it's still pending.
      var tw=document.getElementById('mapTableWrap'); if(tw)tw.innerHTML='';
      var ft=document.getElementById('mapFooter'); if(ft)ft.style.display='none';
      loadItems(); loadMappingJobs();
    }
    else tShow(d.error||'Save failed');
  }

  // Build one job row element (not appended). Jobs are addressed by uuid; the label is the site
  // code, tooltip the client.job code.
  function mkEl(id,label,tip){
    var d=document.createElement('div');d.className='job'+(id===current?' on':'');d.textContent=label;d.title=tip||'';d.setAttribute('data-code',id);
    d.onclick=function(){current=id;itemFilter='all';MF={};document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)});
      if(sessionStorage.getItem('ace_tab')==='mapping'){ mapJob=(id==='ALL'?'':id); var sp=document.getElementById('mapJobPick'); if(sp){ sp.value=(sp.querySelector('option[value="'+id+'"]')?id:''); } loadMapping(); loadImport(); }
      else loadItems();};
    if(id!=='ALL'){var b=document.createElement('span');b.textContent='⋯';b.title='Files';b.style.cssText='float:right;cursor:pointer;padding:0 6px;opacity:.7';b.onclick=function(ev){ev.stopPropagation();openJobFiles(id);};d.appendChild(b);}
    return d;
  }
  async function loadJobs(){
    var jobs=await (await api('/api/jobs')).json(); var el=document.getElementById('jobs');el.innerHTML='';
    JOB_STATUS={}; JOB_MAPDATE={}; JOBS_BY_ID={};
    jobs.forEach(function(j){ JOBS_BY_ID[j.id]=j; JOB_STATUS[j.id]=j.status||'pending_mapping'; JOB_MAPDATE[j.id]=j.mapping_start_date||''; });
    if(myRole!=='scanner') el.appendChild(mkEl('ALL','▦ All jobs','ALL'));
    // Group by programme status: Live (end date still to come), Pending (no date), Job done (end passed).
    var today=new Date().toISOString().slice(0,10);
    var G={live:[],pending:[],done:[]};
    jobs.forEach(function(j){ var pe=j.programme_end||''; G[!pe?'pending':(pe<today?'done':'live')].push(j); });
    [['live','Live'],['pending','Pending'],['done','Job done']].forEach(function(pr){
      var arr=G[pr[0]]; if(!arr.length)return;
      var collapsed=localStorage.getItem('ace_jobgrp_'+pr[0])==='1';
      var hdr=document.createElement('div'); hdr.className='jobgrp';
      hdr.innerHTML='<span class="jobgrp-ar">'+(collapsed?'▸':'▾')+'</span> '+esc(pr[1])+' <span class="jobgrp-n">'+arr.length+'</span>';
      var wrap=document.createElement('div'); wrap.className='jobgrpwrap'; if(collapsed)wrap.style.display='none';
      hdr.onclick=function(){ var show=wrap.style.display==='none'; wrap.style.display=show?'':'none'; hdr.querySelector('.jobgrp-ar').textContent=show?'▾':'▸'; localStorage.setItem('ace_jobgrp_'+pr[0],show?'0':'1'); };
      arr.forEach(function(j){ wrap.appendChild(mkEl(j.id,(j.site_code||j.code),j.code)); });
      el.appendChild(hdr); el.appendChild(wrap);
    });
    // Scanner (or an empty/stale current) lands on the first available job.
    if((myRole==='scanner'||current==='ALL')&&jobs.length&&(current==='ALL'||!JOB_STATUS[current])){ current=jobs[0].id; document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)}); }
  }
  // The client.job code (e.g. AXS.PAD) of the currently-selected job — used to build item codes.
  function curCode(){ var j=JOBS_BY_ID[current]; return j?j.code:(current||''); }
  function opt(v,l,sel){return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+l+'</option>';}
  var JOB_DATE_PHASES=[
    {key:'programme',label:'Programme (overall)',color:'#64748b'},
    {key:'mapping',label:'Mapping',color:'#8b5cf6'},
    {key:'survey',label:'Survey',color:'#0ea5e9'},
    {key:'scaffold_erect',label:'Scaffold erect',color:'#f59e0b'},
    {key:'scaffold_dismantle',label:'Scaffold dismantle',color:'#ef4444'},
    {key:'delivery',label:'Delivery',color:'#0d9488'},
    {key:'fitting',label:'Fitting',color:'#10b981'}
  ];
  function jobTabBar(p){
    var bs='padding:7px 13px;border:none;background:none;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;color:var(--ink)';
    return '<div style="display:flex;gap:4px;padding:12px 22px 0;border-bottom:1px solid var(--line)">'
      +'<button type="button" id="'+p+'TabBtnD" onclick="jobTab(\\''+p+'\\',\\'d\\')" style="'+bs+';font-weight:700;border-bottom-color:var(--magenta)">Details</button>'
      +'<button type="button" id="'+p+'TabBtnT" onclick="jobTab(\\''+p+'\\',\\'t\\')" style="'+bs+'">Dates</button>'
      +'</div>';
  }
  function jobTab(p,which){
    var det=document.getElementById(p+'Details'), dat=document.getElementById(p+'Dates');
    if(det)det.style.display=(which==='d')?'':'none';
    if(dat)dat.style.display=(which==='t')?'':'none';
    var bd=document.getElementById(p+'TabBtnD'), bt=document.getElementById(p+'TabBtnT');
    if(bd){bd.style.fontWeight=(which==='d')?'700':'400';bd.style.borderBottomColor=(which==='d')?'var(--magenta)':'transparent';}
    if(bt){bt.style.fontWeight=(which==='t')?'700':'400';bt.style.borderBottomColor=(which==='t')?'var(--magenta)':'transparent';}
  }
  function jobDatesFieldsHtml(p,d){
    d=d||{}; var q=function(v){return (v==null?'':String(v)).slice(0,10);};
    return '<div style="padding:14px 22px 6px"><div class="sub" style="margin:0 0 12px">All optional. Used for planning and the Gantt view on the Calendar tab.</div>'
      +JOB_DATE_PHASES.map(function(ph){
        return '<div style="display:flex;align-items:center;gap:10px;margin:0 0 9px">'
          +'<span style="display:inline-block;width:12px;height:12px;border-radius:3px;flex:0 0 auto;background:'+ph.color+'"></span>'
          +'<label style="flex:0 0 148px;font-size:12.5px;font-weight:600">'+ph.label+'</label>'
          +'<input type="date" id="'+p+'_'+ph.key+'_start" value="'+q(d[ph.key+'_start'])+'" style="flex:1;min-width:0">'
          +'<span style="color:var(--muted);font-size:12px">to</span>'
          +'<input type="date" id="'+p+'_'+ph.key+'_end" value="'+q(d[ph.key+'_end'])+'" style="flex:1;min-width:0">'
          +'</div>';
      }).join('')+'</div>';
  }
  function collectJobDates(p){
    var o={};
    JOB_DATE_PHASES.forEach(function(ph){
      o[ph.key+'_start']=(document.getElementById(p+'_'+ph.key+'_start')||{}).value||'';
      o[ph.key+'_end']=(document.getElementById(p+'_'+ph.key+'_end')||{}).value||'';
    });
    return o;
  }
  function validateJobDates(dts){
    for(var i=0;i<JOB_DATE_PHASES.length;i++){var ph=JOB_DATE_PHASES[i];var a=dts[ph.key+'_start'],b=dts[ph.key+'_end'];
      if(a&&b&&b<a)return ph.label+': end date is before start date.';}
    return '';
  }
  async function openNewJob(){
    var ruleField='';
    if(canCap('finance.manage')){
      var rules=[]; try{rules=await (await api('/api/pricing-rules')).json();}catch(e){}
      ruleField='<div class="field full"><label>Pricing rule (optional)</label><select id="nj_rule"><option value="">— none —</option>'
        +rules.map(function(r){return '<option value="'+r.id+'">'+esc(r.name)+(r.customer?(' · '+esc(r.customer)):'')+'</option>';}).join('')+'</select></div>';
    }
    var njCusts=[]; try{ njCusts=((await (await api('/api/customers-master')).json()).customers||[]).filter(function(c){return c.active!==false;}); }catch(e){}
    var njClientField = njCusts.length
      ? '<div class="field"><label>Customer *</label><select id="nj_client"><option value="">— pick customer —</option>'+njCusts.map(function(c){return '<option value="'+av(c.code)+'">'+esc(c.code)+' — '+esc(c.name)+'</option>';}).join('')+'</select></div>'
      : '<div class="field"><label>Customer *</label><input id="nj_client" type="hidden" value=""><div class="ro" style="padding:6px 0;font-size:12px">No customers yet — create one in Admin ▸ Customers first.</div></div>';
    var detail='<div class="fgrid">'
      +'<div class="codeprev" id="njPrev">CLIENT.JOB</div>'
      +njClientField+field('nj_job','Job code *','e.g. LAB')
      +'<div class="field full"><label>Job name *</label><input id="nj_name" placeholder="e.g. Laburnum Road, Waterlooville"></div>'
      +'<div class="field full"><label>Site address *</label><input id="nj_addr" placeholder="Full site address"></div>'
      +'<div class="field full"><label>Site postcode *</label><input id="nj_postcode" placeholder="e.g. PO7 7EW"></div>'
      +'<div class="field full"><label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:12.5px"><input type="checkbox" id="nj_delsame" onchange="njToggleDel()"> Delivery address is the same as the site address</label></div>'
      +'<div id="nj_delwrap" style="display:contents">'
        +'<div class="field full"><label>Delivery address *</label><input id="nj_deladdr" placeholder="Where frames / glass are delivered"></div>'
        +'<div class="field full"><label>Delivery postcode *</label><input id="nj_delpostcode" placeholder="e.g. PO9 5RX"></div>'
      +'</div>'
      +'<div class="field full"><label>Site code</label><input id="nj_sitecode" placeholder="shown on screen — defaults to CLIENT.JOB"></div>'
      +'<div class="field full"><label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:12.5px"><input type="checkbox" id="nj_multielev"> Multi-elevation flats <span style="color:var(--muted)">— unticked: single-elevation flats · ticked: multi-elevation flats</span></label></div>'
      +'<div class="field full"><label>Drawings / files (optional)</label><input id="nj_files" type="file" multiple accept="image/*,.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"><div class="sub" style="margin:4px 0 0">jpg, pdf or zip · up to 25MB each</div></div>'
      +ruleField
      +'</div>';
    var html=jobTabBar('nj')
      +'<div id="njDetails">'+detail+'</div>'
      +'<div id="njDates" style="display:none">'+jobDatesFieldsHtml('nj',{})+'</div>'
      +'<div class="ferr" id="njErr" style="padding:0 22px"></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="saveJob()">Create job</button></div>';
    openModal('New job',html);
    ['nj_client','nj_job'].forEach(function(id){document.getElementById(id).addEventListener('input',njCode);});
    njCode();
    watchModalDirty(['nj_client','nj_job','nj_name','nj_addr','nj_postcode','nj_deladdr','nj_delpostcode','nj_sitecode','nj_multielev'].concat(jobDateInputIds('nj')));
  }
  function njCode(){var c=(document.getElementById('nj_client').value||'').trim().toUpperCase();var j=(document.getElementById('nj_job').value||'').trim().toUpperCase();document.getElementById('njPrev').textContent=(c||'CLIENT')+'.'+(j||'JOB');}
  // Delivery-same-as-site toggle: hide the delivery fields when ticked (default: not ticked = No).
  function njToggleDel(){var same=document.getElementById('nj_delsame').checked;var w=document.getElementById('nj_delwrap');if(w)w.style.display=same?'none':'contents';}
  async function saveJob(){
    var client=(document.getElementById('nj_client').value||'').trim();
    var job=(document.getElementById('nj_job').value||'').trim();
    var name=(document.getElementById('nj_name').value||'').trim();
    var postcode=(document.getElementById('nj_postcode').value||'').trim();
    var addr=(document.getElementById('nj_addr').value||'').trim();
    var same=document.getElementById('nj_delsame').checked;
    var deladdr=same?addr:(document.getElementById('nj_deladdr').value||'').trim();
    var delpc=same?postcode:(document.getElementById('nj_delpostcode').value||'').trim();
    if(!client||!job){document.getElementById('njErr').textContent='Client code and job code are required.';return;}
    if(!name){document.getElementById('njErr').textContent='Job name is required.';return;}
    if(!addr){document.getElementById('njErr').textContent='Site address is required.';return;}
    if(!postcode){document.getElementById('njErr').textContent='Site postcode is required.';return;}
    if(!deladdr){document.getElementById('njErr').textContent='Delivery address is required (or tick “same as site address”).';return;}
    if(!delpc){document.getElementById('njErr').textContent='Delivery postcode is required.';return;}
    var dts=collectJobDates('nj');
    var dErr=validateJobDates(dts); if(dErr){document.getElementById('njErr').textContent=dErr;jobTab('nj','t');return;}
    var r=await api('/api/jobs',{method:'POST',body:JSON.stringify(Object.assign({client_code:client,job_code:job,name:name,site_address:addr,postcode:postcode,delivery_address:deladdr,delivery_postcode:delpc,site_code:(document.getElementById('nj_sitecode').value||'').trim(),multi_elevation:document.getElementById('nj_multielev').checked},dts))});
    var d=await r.json();
    if(r.ok&&d.ok){
      var rsel=document.getElementById('nj_rule');
      if(rsel&&rsel.value){ try{await api('/api/job/'+encodeURIComponent(d.id||d.code)+'/pricing',{method:'PUT',body:JSON.stringify({rule_id:rsel.value})});}catch(e){} }
      var fl=document.getElementById('nj_files'); var picked=fl&&fl.files?fl.files.length:0;
      if(picked){ document.getElementById('njErr').textContent=''; tShow('Uploading '+picked+' file(s)…'); try{ await uploadJobFiles(d.code, fl.files); }catch(e){ tShow('Job created, but a file upload failed'); } }
      closeModal(true);tShow('Created '+d.code);loadJobs();
    }
    else document.getElementById('njErr').textContent=d.error||'Could not create job';
  }
  // ---- job file attachments ----
  async function uploadJobFiles(code,fileList){
    var arr=[];
    for(var i=0;i<fileList.length;i++){ var f=fileList[i]; if(f.size>25*1024*1024){tShow('"'+f.name+'" is over 25MB — skipped');continue;} arr.push({name:f.name,dataUrl:await fileToDataUrl(f)}); }
    if(!arr.length)return;
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/files',{method:'POST',body:JSON.stringify({files:arr})})).json();
    if(!d.ok)throw new Error(d.error||'upload failed');
  }
  function fmtSize(n){ if(!n)return''; if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(0)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
  async function openEditJob(code){
    if(!code||code==='ALL')return;
    var d={}; try{d=await (await api('/api/job/'+encodeURIComponent(code))).json();}catch(e){}
    if(d.error){tShow(d.error);return;}
    var q=function(v){return (v==null?'':String(v)).replace(/"/g,'&quot;');};
    var ejSame=!!(d.delivery_address&&d.site_address&&String(d.delivery_address).trim()===String(d.site_address).trim()&&String(d.delivery_postcode||'').trim()===String(d.postcode||'').trim());
    var detail='<div class="fgrid">'
      +'<div class="field full"><label>Job</label><div class="codeprev">'+esc(code)+'</div></div>'
      +'<div class="field full"><label>Job name *</label><input id="ej_name" value="'+q(d.name)+'"></div>'
      +'<div class="field full"><label>Site address *</label><input id="ej_addr" value="'+q(d.site_address)+'" placeholder="Full site address"></div>'
      +'<div class="field full"><label>Site postcode *</label><input id="ej_postcode" value="'+q(d.postcode)+'" placeholder="e.g. PO7 7EW"></div>'
      +'<div class="field full"><label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:12.5px"><input type="checkbox" id="ej_delsame" onchange="ejToggleDel()"'+(ejSame?' checked':'')+'> Delivery address is the same as the site address</label></div>'
      +'<div id="ej_delwrap" style="display:'+(ejSame?'none':'contents')+'">'
        +'<div class="field full"><label>Delivery address *</label><input id="ej_deladdr" value="'+q(d.delivery_address)+'" placeholder="Where frames / glass are delivered"></div>'
        +'<div class="field full"><label>Delivery postcode *</label><input id="ej_delpostcode" value="'+q(d.delivery_postcode)+'" placeholder="e.g. PO9 5RX"></div>'
      +'</div>'
      +'<div class="field full"><label>Site code</label><input id="ej_sitecode" value="'+q(d.site_code)+'" placeholder="shown on screen — defaults to CLIENT.JOB"></div>'
      +'<div class="field full"><label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:12.5px"><input type="checkbox" id="ej_multielev"'+(d.multi_elevation?' checked':'')+'> Multi-elevation flats <span style="color:var(--muted)">— unticked: single-elevation flats · ticked: multi-elevation flats</span></label></div>'
      +'</div>';
    var html=jobTabBar('ej')
      +'<div id="ejDetails">'+detail+'</div>'
      +'<div id="ejDates" style="display:none">'+jobDatesFieldsHtml('ej',d)+'</div>'
      +'<div class="ferr" id="ejErr" style="padding:0 22px"></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="saveEditJob(\\''+code+'\\')">Save</button></div>';
    openModal('Edit job '+code,html);
    watchModalDirty(['ej_name','ej_addr','ej_postcode','ej_deladdr','ej_delpostcode','ej_sitecode','ej_multielev'].concat(jobDateInputIds('ej')));
  }
  function ejToggleDel(){var same=document.getElementById('ej_delsame').checked;var w=document.getElementById('ej_delwrap');if(w)w.style.display=same?'none':'contents';}
  async function saveEditJob(code){
    var name=(document.getElementById('ej_name').value||'').trim();
    var postcode=(document.getElementById('ej_postcode').value||'').trim();
    var addr=(document.getElementById('ej_addr').value||'').trim();
    var same=document.getElementById('ej_delsame').checked;
    var deladdr=same?addr:(document.getElementById('ej_deladdr').value||'').trim();
    var delpc=same?postcode:(document.getElementById('ej_delpostcode').value||'').trim();
    if(!name){document.getElementById('ejErr').textContent='Job name is required.';return;}
    if(!addr){document.getElementById('ejErr').textContent='Site address is required.';return;}
    if(!postcode){document.getElementById('ejErr').textContent='Site postcode is required.';return;}
    if(!deladdr){document.getElementById('ejErr').textContent='Delivery address is required (or tick “same as site address”).';return;}
    if(!delpc){document.getElementById('ejErr').textContent='Delivery postcode is required.';return;}
    var dts=collectJobDates('ej');
    var dErr=validateJobDates(dts); if(dErr){document.getElementById('ejErr').textContent=dErr;jobTab('ej','t');return;}
    var r=await api('/api/job/'+encodeURIComponent(code),{method:'PUT',body:JSON.stringify(Object.assign({name:name,site_address:addr,postcode:postcode,delivery_address:deladdr,delivery_postcode:delpc,site_code:(document.getElementById('ej_sitecode').value||'').trim(),multi_elevation:document.getElementById('ej_multielev').checked},dts))});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal(true);tShow('Job updated');loadJobs();}else{document.getElementById('ejErr').textContent=(d.error||'Save failed');}
  }
  async function openJobFiles(code){
    if(!code||code==='ALL'){tShow('Pick a job first');return;}
    openModal('Files · '+esc(code),'<div class="empty" style="padding:22px">Loading…</div>');
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
    tShow('Uploading '+fl.files.length+' file(s)…');
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
    var pc=data.job.postcode?(' <span style="color:var(--muted);font-weight:500">· '+esc(data.job.postcode)+'</span>'):'';
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> — '+esc(data.job.name)+pc;
    document.getElementById('subtitle').textContent=(current==='ALL'?'All jobs · ':'Monday board: '+(data.job.board||'(not linked)')+' · ')+'edits save to the store; use Sync to push to Monday';
    document.getElementById('newBtn').style.display=(current==='ALL')?'none':'';
    document.getElementById('jobActions').style.display=(current!=='ALL')?'':'none';
    document.getElementById('filesBtn').style.display='';
    document.getElementById('delJobBtn').style.display=canCap('jobs.manage')?'':'none';
    var ejb=document.getElementById('editJobBtn'); if(ejb)ejb.style.display=canCap('jobs.manage')?'':'none';
    // header column filters — multi-select popovers (state in MF[hostId].state)
    buildMF('blockFilter','Block','All blocks',mfOptions('block'));
    buildMF('elevFilter','Elev','All elevations',mfOptions('elevation'));
    buildMF('flatFilter','Flat','All flats',mfOptions('flat'));
    buildMF('floorFilter','Floor','All floors',mfOptions('floor'));
    buildMF('roomFilter','Room','All rooms',mfOptions('room'));
    buildMF('itemColFilter','Item','All items',mfOptions('item'));
    buildMF('stageFilter','Stage','All stages',mfOptions('stage',function(v){return STAGE[v]||v;}));
    buildMF('poFilter','PO','All PO',mfOptions('po_phase',function(v){return 'Phase '+v;}));
    buildMF('statusFilter','Status','All statuses',mfOptions('install_status',function(v){return istatLabel(v);}));
    buildMF('teamFilter','Team','All teams',mfOptions('team_id',function(v){return teamName(v);}));
    fillPoPdfControl();
    renderItems();
  }
  // Populate the PO-phase dropdown (distinct phases on Surveyed items) and show the PO PDF control.
  function fillPoPdfControl(){
    var wrap=document.getElementById('poPdfWrap'), sel=document.getElementById('poPhaseSel'); if(!wrap||!sel)return;
    var phases=[]; (itemsData.items||[]).forEach(function(it){ if((it.stage==='surveyed'||it.stage==='synced')&&it.po_phase!=null&&phases.indexOf(it.po_phase)<0)phases.push(it.po_phase); });
    phases.sort(function(a,b){return a-b;});
    var can=canCap('items.edit')&&current!=='ALL'&&phases.length>0;
    wrap.style.display=can?'inline-flex':'none';
    if(!can){sel.innerHTML='';return;}
    var keep=sel.value;
    sel.innerHTML=phases.map(function(p){return '<option value="'+p+'">Phase '+p+'</option>';}).join('');
    if(keep&&phases.indexOf(Number(keep))>=0)sel.value=keep;
    poPhasePick();
  }
  // Is any Surveyed item in this phase already marked ready-for-PO?
  function poPhaseReady(phase){ return (itemsData&&itemsData.items||[]).some(function(it){return String(it.po_phase)===String(phase)&&it.po_ready;}); }
  function poPhasePick(){
    var sel=document.getElementById('poPhaseSel'), btn=document.getElementById('poReadyBtn'); if(!sel||!btn)return;
    var phase=sel.value; var ready=phase&&poPhaseReady(phase);
    if(ready){ btn.textContent=(myRole==='admin')?'Unlock':'Ready ✓'; btn.title=(myRole==='admin')?'Unlock this PO phase so items can be re-assigned':'This PO phase is marked ready for PO'; }
    else { btn.textContent='Mark ready'; btn.title='Mark this PO phase ready for ordering (locks items from phase changes)'; }
  }
  async function poReadyClick(){
    if(current==='ALL')return;
    var phase=document.getElementById('poPhaseSel').value; if(!phase){tShow('Pick a PO phase');return;}
    var ready=poPhaseReady(phase);
    if(ready){
      if(myRole!=='admin'){tShow('Phase '+phase+' is already marked ready for PO');return;}
      if(!confirm('Unlock PO phase '+phase+'? Items in it become editable again.'))return;
      try{ var d=await (await api('/api/job/'+encodeURIComponent(current)+'/po-unlock?phase='+encodeURIComponent(phase),{method:'POST'})).json();
        if(d.ok){tShow('PO phase '+phase+' unlocked');loadItems();}else tShow(d.error||'Failed'); }catch(e){tShow('Failed');}
    } else {
      if(!confirm('Mark PO phase '+phase+' as ready for PO?\\n\\nItems in this phase will be locked from PO-phase changes (admins can still change them), and stamped with your name and the date.'))return;
      try{ var d=await (await api('/api/job/'+encodeURIComponent(current)+'/po-ready?phase='+encodeURIComponent(phase),{method:'POST'})).json();
        if(d.ok){tShow('PO phase '+phase+' marked ready · '+d.count+' item'+(d.count===1?'':'s')+' locked');loadItems();}else tShow(d.error||'Failed'); }catch(e){tShow('Failed');}
    }
  }
  async function downloadPoPdf(){
    if(current==='ALL'){tShow('Pick a job first');return;}
    var phase=document.getElementById('poPhaseSel').value; if(!phase){tShow('Pick a PO phase');return;}
    var sortEl=document.getElementById('poSortSel'); var sort=sortEl?sortEl.value:'flat';
    tShow('Building PO PDF…');
    try{
      var r=await fetch('/api/job/'+encodeURIComponent(current)+'/po.pdf?phase='+encodeURIComponent(phase)+'&sort='+encodeURIComponent(sort),{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){var e={};try{e=await r.json();}catch(_){}tShow(e.error||'PO PDF failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download=curCode()+'-PO-phase-'+phase+'.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000);
      tShow('PO PDF downloaded');
    }catch(err){tShow('PO PDF failed');}
  }
  function fillColFilter(selId,field,setFn,cur,allLabel){
    var vals=[], hasNone=false;
    (itemsData.items||[]).forEach(function(it){ var v=it[field]||''; if(v){ if(vals.indexOf(v)<0)vals.push(v); } else hasNone=true; });
    vals.sort(function(a,b){return (parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));});
    if(cur&&cur!=='__none'&&vals.indexOf(cur)<0){ setFn(''); cur=''; }
    if(cur==='__none'&&!hasNone){ setFn(''); cur=''; }
    var sel=document.getElementById(selId); if(!sel)return;
    sel.innerHTML='<option value="">'+allLabel+'</option>'+(hasNone?'<option value="__none">— none —</option>':'')
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
      case 'unfinished':return !!r.incomplete;
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
      if(!mfMatch('flatFilter',r.flat))return false;
      if(!mfMatch('statusFilter',r.install_status))return false;
      if(!mfMatch('teamFilter',r.team_id))return false;
      if(!mfMatch('blockFilter',r.block))return false;
      if(!mfMatch('elevFilter',r.elevation))return false;
      if(!mfMatch('floorFilter',r.floor))return false;
      if(!mfMatch('roomFilter',r.room))return false;
      if(!mfMatch('stageFilter',r.stage))return false;
      if(!mfMatch('itemColFilter',r.item))return false;
      if(!mfMatch('poFilter',r.po_phase==null?'':String(r.po_phase)))return false;
      return true;
    });
    var canEdit=canCap('items.edit'), canFit=canCap('items.fit'), canSync=canCap('monday.sync');
    var canSelect=canEdit||canFit||canSync;
    // counters: how many shown (current filter) / total, plus how many changed (need re-sync) and not-yet-synced.
    var dirtyN=all.filter(function(x){return x.dirty;}).length;
    var unsyncedN=all.filter(function(x){return !x.synced;}).length;
    document.getElementById('itemCount').textContent=
      rows.length+(itemFilter==='all'?'':' of '+all.length)+' item'+(rows.length===1?'':'s')
      +(dirtyN?('  ·  '+dirtyN+' changed'):'')+(unsyncedN?('  ·  '+unsyncedN+' not synced'):'');
    document.getElementById('bulkDelBtn').style.display=canCap('jobs.manage')?'':'none';
    var tb=document.getElementById('rows');tb.innerHTML='';
    rows.forEach(function(r){
      var tr=document.createElement('tr');
      var curStatus=r.install_status?(ISTATUS_LABEL[r.install_status]||r.install_status):'—';
      var statusSel=(canFit||canEdit)
        ?'<select class="sel" onchange="save(\\''+r.id+'\\',\\'install_status\\',this.value)">'+ISTATUS.map(function(s){return opt(s[0],s[1],r.install_status||'')}).join('')+'</select>'
        :'<span class="ro">'+curStatus+'</span>';
      var teamSel=canEdit
        ?'<select class="sel" onchange="save(\\''+r.id+'\\',\\'team_id\\',this.value)">'+opt('','—',r.team_id||'')+teamOptionList(r.team_id||'')+'</select>'
        :'<span class="ro">'+teamName(r.team_id)+'</span>';
      var rateVal=r.rate_override_pennies!=null?(r.rate_override_pennies/100):'';
      var rateInput=canEdit
        ?'<input class="rate" type="number" placeholder="'+r.effective_rate.replace('£','')+'" value="'+rateVal+'" onchange="saveRate(\\''+r.id+'\\',this.value)">'
        :'<span class="ro">'+r.effective_rate+'</span>';
      var monday=r.synced
        ?'<a class="mlink" target="_blank" href="'+r.monday_url+'">open ↗</a>'+(canSync?' <button class="resync'+(r.dirty?' dirty':'')+'" onclick="syncItem(\\''+r.id+'\\')">Re-sync</button>'+(r.dirty?' <span class="chgtag">changed</span>':''):'')
        :(canSync?'<button class="sync" onclick="syncItem(\\''+r.id+'\\')">Sync</button>':'<span class="ro">not synced</span>');
      var snagTag=r.kind==='snag'?'<span class="snagtag">SNAG</span> ':'';
      var unfinTag=r.incomplete?'<span class="unfintag" title="Imported with required data missing — open to complete it">UNFINISHED</span> ':'';
      // Flat & Room are editable until the item is synced to Monday (editing rebuilds the code).
      var editable=canEdit&&!r.synced;
      var flatCell=editable?'<input class="cedit" value="'+(r.flat||'')+'" placeholder="—" onchange="saveCode(\\''+r.id+'\\',\\'flat\\',this.value)">':(r.flat||'—');
      var roomCell=editable?'<select class="sel" style="min-width:150px" onchange="saveCode(\\''+r.id+'\\',\\'room\\',this.value)">'+roomOptions(r.room||'')+'</select>':roomLabel(r.room);
      // PO phase: editable only on Surveyed items; a phase marked ready-for-PO is locked (admins exempt).
      var poLocked=r.po_ready&&myRole!=='admin';
      var poCell=(canEdit&&(r.stage==='surveyed'||r.stage==='synced')&&!poLocked)
        ?'<input class="pocell" type="number" min="1" step="1" value="'+(r.po_phase!=null?r.po_phase:'')+'" placeholder="—" onchange="savePo(\\''+r.id+'\\',this.value)">'
        :'<span class="ro"'+(poLocked?' title="PO phase '+r.po_phase+' is ready for PO — locked (admin only)"':(r.stage==='surveyed'?'':' title="Assign a PO phase only once the item is Surveyed"'))+'>'+(r.po_phase!=null?r.po_phase:'—')+(poLocked?' \\ud83d\\udd12':'')+'</span>';
      tr.innerHTML='<td class="cbcell">'+(canSelect?'<input type="checkbox" class="rowcb" data-id="'+r.id+'"'+(sel[r.id]?' checked':'')+' onclick="toggleRow(\\''+r.id+'\\',this)">':'')+'</td>'+
        '<td>'+snagTag+unfinTag+'<a class="codelink mono" onclick="openDetail(\\''+r.id+'\\')">'+(r.full_code||'')+'</a></td>'+
        '<td>'+(r.block||'—')+'</td><td>'+(r.elevation||'—')+'</td><td>'+flatCell+'</td><td>'+(r.floor||'—')+'</td><td>'+roomCell+'</td><td>'+(r.item||'—')+'</td>'+
        '<td><span class="pill '+r.stage+'">'+(STAGE[r.stage]||r.stage)+'</span></td>'+
        '<td>'+poCell+'</td>'+
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
  async function savePo(id,value){var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify({po_phase:value===''?null:value})})).json();if(d.ok){tShow(value===''?'PO phase cleared':'PO phase set');loadItems();}else{tShow(d.error||'Failed');loadItems();}}
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
  async function syncItem(id){tShow('Syncing…');try{var d=await (await api('/api/promote/'+id,{method:'POST'})).json();if(d.ok){var m='Synced to Monday'+(d.photosPushed?' · '+d.photosPushed+' photo'+(d.photosPushed>1?'s':''):'');tShow(d.photoError?('Synced · photo issue: '+d.photoError):m);loadItems();}else tShow(d.error||'Sync failed');}catch(e){tShow('Sync failed')}}

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
    tShow('Syncing '+ids.length+' item(s)…');
    try{var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:'sync'})})).json();
      if(d.ok)tShow(d.created+' created, '+d.updated+' updated'+(d.failed?', '+d.failed+' failed':''));else tShow(d.error||'Bulk sync failed');
    }catch(e){tShow('Bulk sync failed');}
    loadItems();
  }
  async function bulkFinish(){
    var ids=selectedIds(); if(!ids.length){tShow('Select some items first');return;}
    tShow('Checking '+ids.length+' item(s)…');
    try{
      var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:'finish'})})).json();
      if(d.ok)tShow((d.updated||0)+' marked surveyed'+(d.skipped?(' · '+d.skipped+' still incomplete — skipped'):''));
      else tShow(d.error||'Failed');
    }catch(e){tShow('Failed');}
    loadItems();
  }
  function bulkSelect(arr,label){return '<select id="bulkVal" class="bulk bsel"><option value="">— '+label+' (blank = clear) —</option>'+arr.map(function(x){return opt(x,x,'')}).join('')+'</select>';}
  function bulkFieldPick(){
    var sel=document.getElementById('bulkField'); if(!sel)return;
    var f=sel.value; var w=document.getElementById('bulkValWrap');
    if(f==='team') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">— team —</option>'+teamOptionList('')+'</select>';
    else if(f==='status') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">— status —</option>'+ISTATUS.filter(function(s){return s[0]}).map(function(s){return opt(s[0],s[1],'')}).join('')+'</select>';
    else if(f==='po') w.innerHTML='<input id="bulkVal" class="bulk" type="number" min="1" step="1" placeholder="PO phase (blank = clear)" style="width:150px">';
    else if(f==='glazing') w.innerHTML=bulkSelect(GLASS_PANES,'panes');
    else if(f==='glass') w.innerHTML=bulkSelect(GLASS_TEXTURES,'texture');
    else if(f==='material') w.innerHTML=bulkSelect(MATERIALS,'material');
    else if(f==='item_type') w.innerHTML=bulkSelect(['Window','Door'],'type');
    else if(f==='open_in_out') w.innerHTML=bulkSelect(['In','Out'],'open in/out');
    else if(f==='width'||f==='height') w.innerHTML='<input id="bulkVal" class="bulk" type="number" min="0" step="1" placeholder="'+(f==='width'?'Width':'Height')+' mm (blank = clear)" style="width:170px">';
    else if(f==='design_code') w.innerHTML='<input id="bulkVal" class="bulk" placeholder="Style code e.g. 27 (blank = clear)" style="width:200px">';
    else w.innerHTML='<input id="bulkVal" class="bulk" placeholder="'+(f.charAt(0).toUpperCase()+f.slice(1))+' value" style="width:130px;text-transform:uppercase">';
  }
  async function bulkEditApply(){
    var f=document.getElementById('bulkField').value;
    var vEl=document.getElementById('bulkVal'); var value=vEl?vEl.value:'';
    var ids=selectedIds(); if(!ids.length){tShow('Select some items first');return;}
    var action=(f==='status')?'status':f;
    var btn=document.getElementById('bulkApplyBtn'); var label=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='Applying…';}
    tShow('Applying to '+ids.length+' item(s)…');
    try{
      var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:action,value:value})})).json();
      if(vEl&&vEl.tagName==='INPUT')vEl.value='';
      if(d.ok){tShow((d.updated||0)+' updated'+(d.skipped?(' · '+d.skipped+' skipped (synced/dupe)'):''));loadItems();}else tShow(d.error||'Update failed');
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
    document.getElementById('invoicesView').style.display=name==='invoices'?'block':'none';
    document.getElementById('signoffView').style.display=name==='signoff'?'block':'none';
    document.getElementById('custadminView').style.display=name==='custadmin'?'block':'none';
    document.getElementById('costcentresView').style.display=name==='costcentres'?'block':'none';
    document.getElementById('poreqView').style.display=name==='poreq'?'block':'none';
    document.getElementById('suppliersView').style.display=name==='suppliers'?'block':'none';
    document.getElementById('labelsView').style.display=name==='labels'?'block':'none';
    document.getElementById('confirmView').style.display=name==='confirm'?'block':'none';
    document.getElementById('finCostsView').style.display=name==='fincosts'?'block':'none';
    document.getElementById('finPerfView').style.display=name==='finperf'?'block':'none';
    document.getElementById('finJobsView').style.display=name==='finjobs'?'block':'none';
    document.getElementById('finSalesView').style.display=name==='finsales'?'block':'none';
    document.getElementById('finPayView').style.display=name==='finpay'?'block':'none';
    document.getElementById('testsView').style.display=name==='tests'?'block':'none';
    document.getElementById('usersView').style.display=name==='users'?'block':'none';
    document.getElementById('rolesView').style.display=name==='roles'?'block':'none';
    document.getElementById('logsView').style.display=name==='logs'?'block':'none';
    document.getElementById('leadsView').style.display=name==='leads'?'block':'none';
    document.getElementById('customersView').style.display=name==='customers'?'block':'none';
    document.getElementById('billingView').style.display=name==='billing'?'block':'none';
    document.getElementById('tabDash').classList.toggle('on',name==='dashboard');
    document.getElementById('tabItems').classList.toggle('on',name==='items');
    document.getElementById('tabMapping').classList.toggle('on',name==='mapping');
    document.getElementById('tabTeams').classList.toggle('on',name==='teams');
    var _tca=document.getElementById('tabCustAdmin'); if(_tca)_tca.classList.toggle('on',name==='custadmin');
    var _tcc=document.getElementById('tabCostCentres'); if(_tcc)_tcc.classList.toggle('on',name==='costcentres');
    var _tpo=document.getElementById('tabPoReq'); if(_tpo)_tpo.classList.toggle('on',name==='poreq');
    var _tsu=document.getElementById('tabSuppliers'); if(_tsu)_tsu.classList.toggle('on',name==='suppliers');
    document.getElementById('tabSync').classList.toggle('on',name==='sync');
    document.getElementById('tabPlans').classList.toggle('on',name==='plans');
    document.getElementById('tabCal').classList.toggle('on',name==='cal');
    document.getElementById('tabBudget').classList.toggle('on',name==='budget');
    var _tinv=document.getElementById('tabInvoices'); if(_tinv)_tinv.classList.toggle('on',name==='invoices');
    var _tso=document.getElementById('tabSignoff'); if(_tso)_tso.classList.toggle('on',name==='signoff');
    document.getElementById('tabTests').classList.toggle('on',name==='tests');
    document.getElementById('tabUsers').classList.toggle('on',name==='users');
    document.getElementById('tabRoles').classList.toggle('on',name==='roles');
    document.getElementById('tabLogs').classList.toggle('on',name==='logs');
    var _tl=document.getElementById('tabLeads'); if(_tl)_tl.classList.toggle('on',name==='leads');
    var _tc=document.getElementById('tabCustomers'); if(_tc)_tc.classList.toggle('on',name==='customers');
    var _tbl=document.getElementById('tabBilling'); if(_tbl)_tbl.classList.toggle('on',name==='billing');
    if(name==='items')loadItems(); // always refresh (e.g. after saving in Mapping)
    if(name==='dashboard')loadDashboard();
    if(name==='mapping'){loadMappingJobs();loadMapping();loadImport();}
    if(name==='teams')loadTeams();
    if(name==='sync')loadSync();
    if(name==='plans')loadPlansTab();
    if(name==='cal')loadCalendar();
    if(name==='budget')loadBudget();
    if(name==='invoices')loadInvoices();
    if(name==='signoff')loadSignoff();
    if(name==='custadmin')loadCustAdmin();
    if(name==='costcentres')loadCostCentres();
    if(name==='poreq')loadPoRequests();
    if(name==='suppliers')loadSuppliers();
    if(name==='labels')initLabels();
    if(name==='confirm')loadConfirmations();
    if(name==='fincosts')loadFinCosts();
    if(name==='finperf')loadFinPerf();
    if(name==='finjobs')loadFinJobs();
    if(name==='finsales')loadFinSales();
    if(name==='finpay')loadFinPay();
    if(name==='tests')loadTests();
    if(name==='users')loadUsers();
    if(name==='roles')loadRoles();
    if(name==='logs')loadLogs();
    if(name==='leads')loadLeads();
    if(name==='customers')loadCustomers();
    if(name==='billing')loadBilling();
    setActiveGroup(name); closeGrps();
  }
  // ---- grouped navigation ----
  var NAV_GROUPS={ops:['tabDash','tabItems','tabMapping','tabPlans','tabCal','tabSignoff'],sales:['tabLeads'],crm:['tabCustomers'],finance:['tabBudget','tabInvoices'],purchasing:['tabPoReq','tabSuppliers','tabCostCentres'],logistics:['tabLabels','tabConfirm'],finops:['tabFinPerf','tabFinCosts','tabFinJobs','tabFinSales','tabFinPay'],admin:['tabTeams','tabCustAdmin','tabSync','tabTests','tabUsers','tabRoles','tabLogs','tabBilling']};
  var TAB2GROUP={dashboard:'ops',items:'ops',mapping:'ops',plans:'ops',cal:'ops',signoff:'ops',confirm:'logistics',leads:'sales',customers:'crm',budget:'finance',invoices:'finance',teams:'admin',custadmin:'admin',costcentres:'purchasing',poreq:'purchasing',suppliers:'purchasing',labels:'logistics',fincosts:'finops',finperf:'finops',finjobs:'finops',finsales:'finops',finpay:'finops',sync:'admin',tests:'admin',users:'admin',roles:'admin',logs:'admin',billing:'admin'};
  function toggleGrp(gid){var m=document.getElementById('menu_'+gid);if(!m)return;var open=m.classList.contains('open');closeGrps();if(!open)m.classList.add('open');}
  function closeGrps(){var ms=document.querySelectorAll('.grpmenu');for(var i=0;i<ms.length;i++)ms[i].classList.remove('open');}
  function grpVisible(gid){var t=NAV_GROUPS[gid]||[];for(var i=0;i<t.length;i++){var el=document.getElementById(t[i]);if(el&&el.style.display!=='none')return true;}return false;}
  function setActiveGroup(tab){var gid=TAB2GROUP[tab];Object.keys(NAV_GROUPS).forEach(function(g){var b=document.getElementById('grp_'+g);if(b)b.classList.toggle('on',g===gid);});}
  function rebuildNav(){Object.keys(NAV_GROUPS).forEach(function(gid){var b=document.getElementById('grp_'+gid);if(b)b.style.display=grpVisible(gid)?'':'none';});setActiveGroup(sessionStorage.getItem('ace_tab')||'dashboard');}
  document.addEventListener('click',function(e){var t=e.target;var inGrp=t&&t.closest?t.closest('.grp'):null;if(!inGrp)closeGrps();});
  async function loadLeads(){
    loadDemoLeadsEmail();
    var tb=document.getElementById('leadsRows'); tb.innerHTML='<tr><td colspan="8" style="padding:16px;color:var(--muted)">Loading…</td></tr>';
    var rows; try{rows=await (await api('/api/leads')).json();}catch(e){tb.innerHTML='<tr><td colspan="8" style="padding:16px;color:var(--muted)">Could not load leads.</td></tr>';return;}
    if(!rows||!rows.length){tb.innerHTML='<tr><td colspan="8" style="padding:16px;color:var(--muted)">No leads yet.</td></tr>';return;}
    tb.innerHTML=rows.map(function(r){return '<tr><td style="white-space:nowrap">'+esc(new Date(r.created_at).toLocaleString('en-GB'))+'</td><td>'+esc(r.kind||'')+'</td><td>'+esc(r.email||'')+'</td><td>'+esc(r.name||'')+'</td><td>'+esc(r.company||'')+'</td><td>'+esc(r.phone||'')+'</td><td>'+esc(r.message||'')+'</td><td>'+esc(r.app_version||'')+'</td></tr>';}).join('');
  }
  async function loadBilling(){
    var mo=document.getElementById('billMonth');
    if(mo&&!mo.value){var d=new Date();mo.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
    var month=mo?mo.value:'';
    var tb=document.getElementById('billRows'); tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">Loading…</td></tr>';
    var d; try{d=await (await api('/api/billing?month='+encodeURIComponent(month))).json();}catch(e){tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">Could not load.</td></tr>';return;}
    if(d.error){tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">'+esc(d.error)+'</td></tr>';return;}
    var sup=!!d.superadmin;
    document.getElementById('billingSub').textContent=sup?'All tenants — items created in the month × each tenant\\'s per-item rate. Edit a rate inline.':'Your tenant — items created in the month × your per-item rate.';
    var rows=(d.rows||[]).map(function(r){
      var rateCell=sup?('<input class="rate" type="number" min="0" step="0.01" value="'+(r.rate_pennies/100)+'" onchange="saveTenantRate(\\''+r.tenant_id+'\\',this.value)">'):('£'+(r.rate_pennies/100).toFixed(2));
      return '<tr><td>'+esc(r.name||'')+'</td><td>'+rateCell+'</td><td>'+r.items+'</td><td><b>'+gbp(r.amount_pennies)+'</b></td></tr>';
    }).join('');
    var tot=d.totals||{items:0,amount_pennies:0};
    rows+='<tr style="border-top:2px solid var(--line)"><td><b>Total</b></td><td></td><td><b>'+tot.items+'</b></td><td><b>'+gbp(tot.amount_pennies)+'</b></td></tr>';
    tb.innerHTML=rows;
  }
  async function saveTenantRate(id,val){
    var pennies=Math.round(parseFloat(val)*100); if(isNaN(pennies)||pennies<0)pennies=0;
    var msg=document.getElementById('billMsg'); if(msg)msg.textContent='Saving…';
    var r=await api('/api/tenants/'+id+'/rate',{method:'PUT',body:JSON.stringify({rate_pennies:pennies})});
    var d=await r.json();
    if(r.ok&&d.ok){ if(msg){msg.textContent='Saved';setTimeout(function(){msg.textContent='';},1200);} loadBilling(); }
    else if(msg)msg.textContent=(d.error||'Save failed');
  }
  async function loadCustomers(){
    var tb=document.getElementById('customersRows'); tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">Loading…</td></tr>';
    var rows; try{rows=await (await api('/api/customers')).json();}catch(e){tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">Could not load customers.</td></tr>';return;}
    if(!rows||!rows.length){tb.innerHTML='<tr><td colspan="4" style="padding:16px;color:var(--muted)">No customer accounts yet — add one under Admin → Users (role: customer).</td></tr>';return;}
    tb.innerHTML=rows.map(function(r){return '<tr><td>'+esc(r.name||'')+'</td><td>'+esc(r.email||'')+'</td><td>'+esc(r.client_code||'—')+'</td><td>'+(r.active?'Active':'Inactive')+'</td></tr>';}).join('');
  }
  var ROLE_MATRIX=__ROLE_MATRIX_JSON__;
  function canCap(cap){if(myRole==='admin')return true;return (ROLE_MATRIX.matrix[myRole]||[]).indexOf(cap)>=0;}
  var LOGS=[];
  async function loadLogs(){
    var tb=document.getElementById('logRows'); tb.innerHTML='<tr><td colspan="5" style="padding:16px;color:var(--muted)">Loading…</td></tr>';
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
        +'<td>'+esc(l.actor_name||'—')+'</td>'
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
        return '<td style="text-align:center;font-size:15px">'+(ok?'<span style="color:var(--green,#16a34a)">✓</span>':'<span style="color:var(--muted);opacity:.4">–</span>')+'</td>';
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
      el.setAttribute('onclick',"openItemsFiltered('"+j.id+"','all')");
      el.innerHTML='<div class="jobtop"><div><b class="mono">'+esc(j.code)+'</b> <span style="color:var(--muted)">'+esc(j.name)+'</span></div>'
        +'<div class="jobmeta">'+(j.board?'<span class="count green">board linked</span>':'<span class="count amber">no board</span>')+' · '+j.items+' items · '+j.snags+' snags · labour '+esc(j.labour)+'</div></div>'
        +bar('Synced',pct(j.synced,j.items),'')+bar('Installed',pct(j.installed,j.items),'green')
        +(j.openSnags?'<div class="opensnag" onclick="event.stopPropagation();openItemsFiltered(\\''+j.id+'\\',\\'open_snags\\')">⚠ '+j.openSnags+' open snag'+(j.openSnags>1?'s':'')+' →</div>':'');
      jc.appendChild(el);
    });
  }
  function applyRole(){
    applyLang();
    var isAdmin=(myRole==='admin');
    // Hover the name (top-right) to see the signed-in role.
    var wn=document.getElementById('whoName'); if(wn){var lbl=(ROLE_MATRIX&&ROLE_MATRIX.labels&&ROLE_MATRIX.labels[myRole])||myRole; wn.setAttribute('data-role','Role: '+lbl); wn.title='Role: '+lbl;}
    function show(id,ok){var el=document.getElementById(id);if(el)el.style.display=ok?'block':'none';}
    var isCustomer=(myRole==='customer');
    var navEl=document.querySelector('#appView nav.nav'); if(navEl)navEl.style.display=isCustomer?'none':'flex';
    var isLogistics=(myRole==='logistics'), isFin=(myRole==='acemark_finance');
    show('tabItems',!isCustomer&&!isLogistics&&!isFin);
    show('tabLabels',canCap('labels.print'));
    show('tabConfirm',canCap('confirmations.manage'));
    show('tabFinCosts',canCap('finops.view'));
    show('tabFinPerf',canCap('finops.view'));
    show('tabFinJobs',canCap('finops.view'));
    show('tabFinSales',canCap('finops.view'));
    show('tabFinPay',canCap('finops.view'));
    show('tabMapping',canCap('items.create')&&!isCustomer);
    show('tabUsers',isAdmin);
    show('tabRoles',isAdmin);
    show('tabLogs',isAdmin);
    show('tabDash',canCap('dashboard.view'));
    show('tabTeams',canCap('teams.manage'));
    show('tabSync',canCap('monday.sync'));
    show('tabPlans',canCap('plans.view'));
    show('tabCal',canCap('calendar.view'));
    show('tabSignoff',canCap('qa.signoff'));
    show('tabBudget',canCap('finance.view'));
    show('tabInvoices',canCap('finance.view'));
    show('tabTests',canCap('dashboard.view'));
    show('tabLeads',canCap('jobs.manage'));
    show('tabCustomers',canCap('jobs.manage'));
    show('tabCustAdmin',canCap('customers.manage'));
    show('tabCostCentres',canCap('purchasing.manage'));
    show('tabPoReq',canCap('purchasing.request'));
    show('tabSuppliers',canCap('purchasing.request'));
    if(canCap('purchasing.request'))refreshPoApprovalsBadge();
    show('tabBilling',myRole==='admin');
    var njb=document.getElementById('newJobBtn'); if(njb)njb.style.display=canCap('jobs.manage')?'inline':'none';
    var nb=document.getElementById('newBtn');if(nb)nb.style.display=canCap('items.create')?'':'none';
    rebuildNav();
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
      var drate=canManage?'<input class="trate" type="number" min="0" step="1" value="'+(((t.door_rate_pennies!=null?t.door_rate_pennies:t.default_rate_pennies))/100)+'" onchange="saveTeamDoorRate(\\''+t.id+'\\',this.value)">':(t.door_rate||'—');
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
        ? '<input class="board" placeholder="board id or URL" value="'+(jb.board||'')+'" onchange="saveBoard(\\''+jb.id+'\\',this.value)">'
        : (jb.board?'<a class="mlink" target="_blank" href="https://'+bhost+'/boards/'+jb.board+'">'+jb.board+' ↗</a>':'<span style="color:var(--muted)">not linked</span>');
      var toSync=jb.unsynced>0?'<span class="count amber">'+jb.unsynced+'</span>':'<span class="count">0</span>';
      var canSync=jb.board&&jb.total>0;
      var btn='<button class="syncall" '+(canSync?'':'disabled')+' onclick="syncJob(\\''+jb.id+'\\',\\''+jb.code+'\\',this)">Sync all</button>';
      var pull=manage?' <button class="syncall" style="background:#fff;color:var(--purple);border:1px solid #cfc9ea" '+(jb.board?'':'disabled')+' onclick="pullFitters(\\''+jb.id+'\\',this)" title="Read team assignments (Fitters column) and planned install dates (date column) back from Monday">Pull fitters + dates</button>':'';
      tr.innerHTML='<td class="mono"><b>'+jb.code+'</b><div style="font-size:11px;color:var(--muted);font-weight:400">'+(jb.name||'')+'</div></td>'+
        '<td>'+board+'</td><td>'+jb.total+'</td><td><span class="count green">'+jb.synced+'</span></td><td>'+toSync+'</td>'+
        '<td style="text-align:right;white-space:nowrap">'+btn+pull+'</td>';
      tb.appendChild(tr);
    });
  }
  async function saveBoard(code,value){var d=await (await api('/api/job/'+encodeURIComponent(code)+'/board',{method:'PUT',body:JSON.stringify({board:value})})).json();
    if(d.ok){
      var n=(d.columnsCreated||[]).length;
      tShow(d.board?('Board linked'+(n?(' · '+n+' column'+(n===1?'':'s')+' created'):' · columns OK')):'Board unlinked');
      loadSync();
    } else tShow(d.error||'Failed');}
  async function syncJob(ref,label,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Syncing…';tShow('Syncing '+label+'…');
    try{var d=await (await api('/api/job/'+encodeURIComponent(ref)+'/sync',{method:'POST'})).json();
      if(d.ok){tShow(label+': '+d.created+' created, '+d.updated+' updated'+(d.failed?', '+d.failed+' failed':''));loadSync();}
      else tShow(d.error||'Sync failed');
    }catch(e){tShow('Sync failed');}
    btn.textContent=old;btn.disabled=false;
  }
  async function pullFitters(ref,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Pulling…';tShow('Reading fitters from Monday…');
    try{var d=await (await api('/api/job/'+encodeURIComponent(ref)+'/pull-fitters',{method:'POST'})).json();
      if(d.ok){var msg=d.assigned+' assigned'+(d.cleared?', '+d.cleared+' cleared':'');
        if(d.datesSet||d.datesCleared)msg+=' · '+d.datesSet+' date'+(d.datesSet===1?'':'s')+' set'+(d.datesCleared?', '+d.datesCleared+' cleared':'')+(d.dateColumn?' (from "'+d.dateColumn+'")':'');
        else if(!d.dateColumn)msg+=' · no date column found';
        if(d.unmatched&&d.unmatched.length)msg+=' · unknown team'+(d.unmatched.length>1?'s':'')+': '+d.unmatched.join(', ');
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
    sel.innerHTML=jobs.map(function(j){return '<option value="'+j.id+'">'+esc(j.site_code||j.code)+' — '+esc(j.name)+'</option>';}).join('');
    if(current&&jobs.some(function(j){return j.id===current;}))sel.value=current;
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
    document.getElementById('planFromJobBtn').style.display=d.canManage?'':'none';
    var seeRpt=canCap('dashboard.view');
    ['rptSurveyBtn','rptInstallBtn','rptCustInstallBtn'].forEach(function(id){var b=document.getElementById(id);if(b)b.style.display=seeRpt?'':'none';});
    var mw=document.getElementById('multiPlanWrap');mw.style.display=d.canManage?'flex':'none';
    document.getElementById('multiPlanChk').checked=!!d.multiPlan;
    renderPlan(); renderPlanItems();
  }
  async function downloadReport(type){
    var code=document.getElementById('planJob').value; if(!code){tShow('Pick a job first');return;}
    var btnId=type==='install'?'rptInstallBtn':(type==='customer_install'?'rptCustInstallBtn':'rptSurveyBtn');
    var btn=document.getElementById(btnId); var was=btn.textContent; btn.textContent='Building…'; btn.disabled=true;
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
    if(!planData.canPin){tShow('Your role can’t place pins');return;}
    if(!curPlanId){tShow('Upload a plan first');return;}
    var it=planData.items.find(function(i){return i.id===id;});
    if(it&&it.plan_id&&it.plan_id!==curPlanId&&!planData.multiPlan){tShow('Already on '+planName(it.plan_id)+' — unpin it there first');return;}
    armedItem=(armedItem===id)?null:id;
    var arm=document.getElementById('planArm');
    if(armedItem){var it=planData.items.find(function(i){return i.id===armedItem;});arm.style.display='block';arm.innerHTML='Click the plan to place <b>'+esc(it.item_code||it.full_code)+'</b>  ·  <a style="color:#fff;text-decoration:underline;cursor:pointer" onclick="armItem(\\''+id+'\\')">cancel</a>';}
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
      else action='<span class="pact pplace">place ›</span>';
      return '<div class="pitem'+(armedItem===it.id?' armed':'')+'" onclick="armItem(\\''+it.id+'\\')">'
        +'<span class="pdot" style="background:'+statusColor(it.install_status)+'"></span>'
        +'<span class="pcode">'+esc(it.full_code||it.item_code||'')+'</span>'
        +action
        +'</div>';
    }).join('')||'<div style="padding:14px;color:var(--muted);font-size:12px">No items.</div>';
  }
  var _pdfjs=null,_jfp=[],_jfpCode='';
  async function loadPdfjs(){
    if(_pdfjs)return _pdfjs;
    document.getElementById('planMsg').textContent='Loading PDF engine…';
    _pdfjs=await import('/vendor/pdfjs/pdf.min.mjs');
    try{_pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';}catch(e){}
    return _pdfjs;
  }
  async function pdfToPlanImages(buf){
    var pdfjs=await loadPdfjs();
    var doc=await pdfjs.getDocument({data:buf}).promise;
    var out=[];
    for(var i=1;i<=doc.numPages;i++){
      document.getElementById('planMsg').textContent='Rendering page '+i+'/'+doc.numPages+'…';
      var page=await doc.getPage(i);
      var b=page.getViewport({scale:1});
      var scale=Math.min(2.0,2000/Math.max(b.width,b.height)); if(!(scale>0.1))scale=0.1;
      var v=page.getViewport({scale:scale});
      var c=document.createElement('canvas'); c.width=Math.ceil(v.width); c.height=Math.ceil(v.height);
      await page.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
      out.push(c.toDataURL('image/jpeg',0.85));
    }
    try{await doc.destroy();}catch(e){}
    return out;
  }
  async function uploadPagesAsPlans(code,base,images){
    var n=images.length,lastId=null;
    for(var i=0;i<n;i++){
      document.getElementById('planMsg').textContent='Uploading page '+(i+1)+'/'+n+'…';
      var nm=n>1?(base+' ('+(i+1)+'/'+n+')'):base;
      var d=await (await api('/api/job/'+encodeURIComponent(code)+'/plans',{method:'POST',body:JSON.stringify({name:nm,image:images[i]})})).json();
      if(!d.ok){document.getElementById('planMsg').textContent='';tShow(d.error||'Upload failed');return null;}
      lastId=d.id;
    }
    document.getElementById('planMsg').textContent='';
    return lastId;
  }
  function isPdfFile(name,type){return (type==='application/pdf')||/\\.pdf$/i.test(name||'');}
  async function uploadPlan(input){
    var f=input.files&&input.files[0]; input.value=''; if(!f)return;
    var code=document.getElementById('planJob').value;
    if(!code){tShow('Pick a job first');return;}
    var pdf=isPdfFile(f.name,f.type);
    if(!confirm('Add this plan to job '+code+'?\\n\\n(Plans belong to the job selected above — switch the job first if this is wrong.)'))return;
    var base=prompt('Plan name (e.g. Ground floor, Elevation E1):', f.name.replace(/\\.[^.]+$/,''))||'Plan';
    if(pdf){
      try{
        var buf=await f.arrayBuffer();
        var imgs=await pdfToPlanImages(buf);
        if(!imgs.length){document.getElementById('planMsg').textContent='';tShow('No pages found in that PDF');return;}
        var id=await uploadPagesAsPlans(code,base,imgs);
        if(id){curPlanId=id;await loadPlans();tShow(imgs.length>1?(imgs.length+' pages added as plans'):'Plan uploaded');}
      }catch(e){document.getElementById('planMsg').textContent='';tShow('Could not read that PDF');}
      return;
    }
    var reader=new FileReader();
    reader.onload=async function(){
      document.getElementById('planMsg').textContent='Uploading…';
      var d=await (await api('/api/job/'+encodeURIComponent(code)+'/plans',{method:'POST',body:JSON.stringify({name:base,image:reader.result})})).json();
      document.getElementById('planMsg').textContent='';
      if(d.ok){curPlanId=d.id;await loadPlans();tShow('Plan uploaded');}else tShow(d.error||'Upload failed');
    };
    reader.readAsDataURL(f);
  }
  async function addPlanFromJob(){
    var code=document.getElementById('planJob').value;
    if(!code){tShow('Pick a job first');return;}
    var files=[]; try{files=await (await api('/api/job/'+encodeURIComponent(code)+'/files')).json();}catch(e){}
    _jfp=(Array.isArray(files)?files:[]).filter(function(f){return /^image\\//.test(f.content_type||'')||isPdfFile(f.name,f.content_type);});
    _jfpCode=code;
    if(!_jfp.length){tShow('No image or PDF files attached to '+code+' — attach one on the job first');return;}
    var html='<div class="sub" style="margin:0 0 10px">Pick an image or PDF attached to <b>'+esc(code)+'</b> to use as a plan. A multi-page PDF becomes one plan per page.</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow:auto">'
      +_jfp.map(function(f,idx){var pdf=isPdfFile(f.name,f.content_type);var thumb=pdf?'<div style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;background:#f6f5fb;border-radius:6px;font-size:12px;font-weight:700;color:var(--magenta)">PDF</div>':'<img src="'+(f.url||'')+'" style="width:100%;height:80px;object-fit:contain;background:#fff">';return '<div style="border:1px solid var(--line);border-radius:8px;padding:6px;cursor:pointer;text-align:center" onclick="usePlanFromJob('+idx+')">'+thumb+'<div style="font-size:11px;margin-top:4px;word-break:break-all">'+esc(f.name)+'</div></div>';}).join('')
      +'</div><div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button></div>';
    openModal('Use a job file as a plan',html);
  }
  async function usePlanFromJob(idx){
    var f=_jfp[idx]; if(!f)return; var code=_jfpCode;
    var pdf=isPdfFile(f.name,f.content_type);
    var base=(prompt('Plan name (e.g. Ground floor, Elevation E1):', (f.name||'Plan').replace(/\\.[^.]+$/,''))||'Plan').trim()||'Plan';
    if(pdf){
      closeModal();
      try{
        document.getElementById('planMsg').textContent='Fetching PDF…';
        var buf=await (await fetch(f.url)).arrayBuffer();
        var imgs=await pdfToPlanImages(buf);
        if(!imgs.length){document.getElementById('planMsg').textContent='';tShow('No pages found in that PDF');return;}
        var id=await uploadPagesAsPlans(code,base,imgs);
        if(id){curPlanId=id;await loadPlans();tShow(imgs.length>1?(imgs.length+' pages added as plans'):'Plan added');}
      }catch(e){document.getElementById('planMsg').textContent='';tShow('Could not read that PDF');}
      return;
    }
    tShow('Adding plan…');
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/plans',{method:'POST',body:JSON.stringify({name:base,job_file_id:f.id})})).json();
    if(d.ok){curPlanId=d.id;closeModal();await loadPlans();tShow('Plan added');}else tShow(d.error||'Failed');
  }
  async function deletePlan(){
    if(!curPlanId||!confirm('Delete this plan? Item pins on it will be cleared.'))return;
    var d=await (await api('/api/plans/'+curPlanId,{method:'DELETE'})).json();
    if(d.ok){curPlanId=null;await loadPlans();tShow('Plan deleted');}else tShow(d.error||'Failed');
  }

  // ---- user management (admin only) ----
  var myId='';
  async function loadDemoLeadsEmail(){
    try{ var d=await (await api('/api/config/demo-leads-email')).json(); var el=document.getElementById('demoLeadsEmail'); if(el)el.value=d.email||''; }catch(e){}
  }
  async function saveDemoLeadsEmail(){
    var el=document.getElementById('demoLeadsEmail'); var msg=document.getElementById('demoLeadsMsg');
    var email=(el.value||'').trim();
    if(msg)msg.textContent='Saving…';
    var r=await api('/api/config/demo-leads-email',{method:'PUT',body:JSON.stringify({email:email})});
    var d=await r.json();
    if(r.ok&&d.ok){ if(msg){msg.textContent='Saved';setTimeout(function(){msg.textContent='';},1500);} }
    else if(msg)msg.textContent=(d.error||'Save failed');
  }
  async function loadUsers(){
    var data=await (await api('/api/users')).json();
    var tb=document.getElementById('userRows');
    if(data.error){tb.innerHTML='<tr><td colspan="9" style="padding:16px;color:var(--muted)">'+esc(data.error)+'</td></tr>';return;}
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
      var teamOpts='<option value="">— none —</option>'+allTeams.filter(function(t){return t.active!==false||t.id===u.team_id;}).map(function(t){return '<option value="'+t.id+'"'+(u.team_id===t.id?' selected':'')+'>'+esc(t.name)+(t.active===false?' (retired)':'')+'</option>';}).join('');
      var teamSel='<select class="sel" onchange="saveUserField(\\''+u.id+'\\',\\'team_id\\',this.value)">'+teamOpts+'</select>';
      var clientCell=(u.role==='customer')
        ? '<input class="tname" style="width:80px;text-transform:uppercase" placeholder="e.g. AXS" value="'+attr(u.client_code||'')+'" onchange="saveUserField(\\''+u.id+'\\',\\'client_code\\',this.value)">'
        : '<span style="color:var(--muted)">—</span>';
      var langSel='<select class="sel" onchange="saveUserField(\\''+u.id+'\\',\\'language\\',this.value)"><option value=""'+(!u.language?' selected':'')+'>Default (EN)</option><option value="en"'+(u.language==='en'?' selected':'')+'>English (EN)</option><option value="pl"'+(u.language==='pl'?' selected':'')+'>Polski (PL)</option></select>';
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
      tr.innerHTML='<td>'+nameInput+'</td><td>'+emailInput+'</td><td>'+roleSel+'</td><td>'+clientCell+'</td><td>'+teamSel+'</td><td>'+langSel+'</td><td>'+login+'</td><td>'+status+'</td><td style="text-align:right;white-space:nowrap">'+actions+'</td>';
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
  async function resetPw(id){if(!confirm('Reset this user\\'s password?'))return;var d=await (await api('/api/users/'+id+'/reset',{method:'POST'})).json();if(d.ok)showCreds(d.email,d.password,true);else alert('Password reset failed: '+(d.error||'unknown error'));}
  function showCreds(email,password,isReset){
    var row=function(label,val,bold){ return '<div class="drow" style="align-items:center"><dt>'+label+'</dt><dd class="mono" style="display:flex;align-items:center;gap:10px;justify-content:space-between"><span style="user-select:all">'+(bold?'<b>'+esc(val)+'</b>':esc(val))+'</span><button class="pobtn" style="padding:5px 11px;font-size:12px" data-copy="'+av(val)+'">Copy</button></dd></div>'; };
    var html='<div style="padding:20px 22px">'
      +'<p style="font-size:13px;color:var(--muted);margin-bottom:14px">'+(isReset?'Password reset. ':'Login created. ')+'Share these securely — the password is shown only once.</p>'
      +row('Email',email,false)+row('Password',password,true)+'</div>'
      +'<div class="foot"><button class="cancel" id="credsCopyBoth">Copy both (for sharing)</button><button class="save" onclick="closeModal()">Done</button></div>';
    openModal(isReset?'New password':'Login created',html);
    document.querySelectorAll('#modalBody [data-copy]').forEach(function(bt){ bt.onclick=function(){ copyText(bt.getAttribute('data-copy'), bt.parentNode.parentNode.querySelector('dt').textContent+' copied'); }; });
    document.getElementById('credsCopyBoth').onclick=function(){ copyText('Email: '+email+'\\nPassword: '+password,'Email and password copied'); };
  }
  function copyText(t,msg){ if(navigator.clipboard)navigator.clipboard.writeText(t); tShow(msg||'Copied'); }

  // ---- modal, create item, item detail ----
  function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  var modalDirty=null; // function -> bool, set by modals that need an unsaved-changes guard
  function openModal(title,html){modalDirty=null;document.getElementById('modalTitle').innerHTML=title;document.getElementById('modalBody').innerHTML=html;document.getElementById('modal').style.display='grid';}
  function closeModal(force){
    if(force!==true && typeof modalDirty==='function'){ try{ if(modalDirty() && !confirm('You have unsaved changes on this job. Discard them?'))return; }catch(e){} }
    modalDirty=null; document.getElementById('modal').style.display='none';
  }
  function jobDateInputIds(p){var a=[];JOB_DATE_PHASES.forEach(function(ph){a.push(p+'_'+ph.key+'_start');a.push(p+'_'+ph.key+'_end');});return a;}
  function watchModalDirty(ids){
    var snap={}; ids.forEach(function(id){var e=document.getElementById(id); snap[id]=e?(e.value||''):'';});
    modalDirty=function(){ return ids.some(function(id){var e=document.getElementById(id); return e && (e.value||'')!==snap[id]; }); };
  }
  function field(id,label,ph,type){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" placeholder="'+(ph||'')+'"></div>';}
  function openCreate(){
    var topts='<option value="">— no team —</option>'+teamOptionList('');
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="codePrev">'+curCode()+'</div>'
      +'<div class="groupt">LOCATION</div>'
      +field('f_block','Block','e.g. 1 → B1')+field('f_elev','Elevation','e.g. 1 → E1')
      +field('f_flat','Flat / plot','e.g. 21 → F21')+field('f_floor','Floor','e.g. 1 → F1')
      +'<div class="field"><label>Room *</label><select id="f_room">'+roomOptions('')+'</select></div>'+field('f_item','Item *','e.g. W02')
      +'<div class="groupt">SPECIFICATION</div>'
      +'<div class="field full"><label>Design code (Clearview style)</label>'
        +'<div style="display:flex;gap:8px;align-items:center">'
          +'<input id="f_design" type="text" placeholder="e.g. 27" style="flex:1" oninput="stylePreview()">'
          +'<button type="button" class="add" onclick="openStylePicker()">Choose style…</button>'
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
    var parts=[curCode()].concat([g('f_block'),g('f_elev'),flat,g('f_room').toUpperCase(),g('f_item').toUpperCase(),g('f_floor')].filter(function(x){return x;}));
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
    if(!calTeamInit){ if(myTeam&&CAL_DATA.teams.some(function(t){return t.id===myTeam;}))calTeamId=myTeam; calTeamInit=true; }
    sel.value=calTeamId;
    if(!calSel)calSel=calIso(new Date());
    calSetMode(calMode);
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
  // ---- Programme Gantt (Calendar tab: Month / Gantt toggle) ----
  var calMode='month'; var GANTT_DATA={jobs:[],teams:[]}; var ganttTeamId=''; var ganttTeamInit=false; var calTeamInit=false;
  function calSetMode(m){
    calMode=m;
    var mb=document.getElementById('calModeMonth'), gb=document.getElementById('calModeGantt');
    if(mb){mb.style.background=(m==='month')?'var(--magenta)':'#fff';mb.style.color=(m==='month')?'#fff':'var(--purple)';}
    if(gb){gb.style.background=(m==='gantt')?'var(--magenta)':'#fff';gb.style.color=(m==='gantt')?'#fff':'var(--purple)';}
    var monthEls=[document.querySelector('#calView .calgridwrap'),document.getElementById('calSelHead'),document.getElementById('calSel')];
    monthEls.forEach(function(e){if(e)e.style.display=(m==='month')?'':'none';});
    var gw=document.getElementById('ganttWrap'); if(gw)gw.style.display=(m==='gantt')?'block':'none';
    ['calNavPrev','calNavNext','calMonth','calTeam','calMsg'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display=(m==='month')?'':'none';});
    var gt=document.getElementById('ganttTeam'); if(gt)gt.style.display=(m==='gantt')?'':'none';
    if(m==='gantt')loadGantt(); else renderCalendar();
  }
  function ganttParse(s){ if(!s)return null; var p=String(s).slice(0,10).split('-'); if(p.length!==3)return null; var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); return isNaN(d)?null:d; }
  function fmtGD(d){return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});}
  async function loadGantt(){
    var wrap=document.getElementById('ganttWrap'); wrap.innerHTML='<div class="empty" style="padding:24px">Loading…</div>';
    try{GANTT_DATA=await (await api('/api/gantt')).json();}catch(e){GANTT_DATA={jobs:[],teams:[]};}
    if(!GANTT_DATA||!GANTT_DATA.jobs){GANTT_DATA={jobs:(Array.isArray(GANTT_DATA)?GANTT_DATA:[]),teams:[]};}
    var teams=GANTT_DATA.teams||[];
    if(!ganttTeamInit){ if(myTeam&&teams.some(function(t){return t.id===myTeam;}))ganttTeamId=myTeam; ganttTeamInit=true; }
    var sel=document.getElementById('ganttTeam');
    if(sel){ sel.innerHTML='<option value="">All teams</option>'+teams.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+(t.active===false?' (retired)':'')+'</option>';}).join(''); sel.value=ganttTeamId; }
    renderGantt();
  }
  function renderGantt(){
    var wrap=document.getElementById('ganttWrap');
    var sel=document.getElementById('ganttTeam'); if(sel)ganttTeamId=sel.value;
    var jobs=(GANTT_DATA&&GANTT_DATA.jobs)?GANTT_DATA.jobs:[];
    var rows=jobs.filter(function(j){ return !ganttTeamId || (Array.isArray(j.team_ids)&&j.team_ids.indexOf(ganttTeamId)>=0); }).map(function(j){
      var phases=JOB_DATE_PHASES.map(function(ph){return {ph:ph,s:ganttParse(j[ph.key+'_start']),e:ganttParse(j[ph.key+'_end'])};}).filter(function(x){return x.s||x.e;});
      return {code:j.code,name:j.name,phases:phases};
    }).filter(function(r){return r.phases.length;});
    if(!rows.length){wrap.innerHTML='<div class="empty" style="padding:24px">'+(ganttTeamId?'No jobs with programme dates for this team.':'No programme dates yet. Add them on a job (Edit job → Dates) to see the timeline here.')+'</div>';return;}
    var min=null,max=null;
    rows.forEach(function(r){r.phases.forEach(function(x){var a=x.s||x.e,b=x.e||x.s; if(!min||a<min)min=a; if(!max||b>max)max=b;});});
    min=new Date(min.getFullYear(),min.getMonth(),1);
    max=new Date(max.getFullYear(),max.getMonth()+1,0);
    var day=86400000; var totalMs=(max-min)+day;
    function pct(d){return ((d-min)/totalMs)*100;}
    var months=[]; var cur=new Date(min.getFullYear(),min.getMonth(),1);
    while(cur<=max){ months.push(new Date(cur)); cur=new Date(cur.getFullYear(),cur.getMonth()+1,1); }
    var labelW=220;
    var head='<div style="display:flex;align-items:stretch">'
      +'<div style="flex:0 0 '+labelW+'px"></div>'
      +'<div style="position:relative;flex:1;height:20px;border-bottom:1px solid var(--line)">'
      +months.map(function(m){return '<div style="position:absolute;left:'+pct(m)+'%;top:0;bottom:0;border-left:1px solid var(--line)"><span style="font-size:10px;color:var(--muted);padding:1px 4px;white-space:nowrap">'+m.toLocaleDateString('en-GB',{month:'short',year:'2-digit'})+'</span></div>';}).join('')
      +'</div></div>';
    var legend='<div style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 10px">'+JOB_DATE_PHASES.map(function(ph){return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted)"><span style="width:11px;height:11px;border-radius:3px;background:'+ph.color+'"></span>'+ph.label+'</span>';}).join('')+'</div>';
    var laneH=9, laneGap=3;
    var body=rows.map(function(r){
      var rowH=r.phases.length*(laneH+laneGap)+6;
      var bars=r.phases.map(function(x,idx){
        var s=x.s||x.e, e=x.e||x.s; var left=pct(s); var right=pct(new Date(e.getTime()+day)); var w=Math.max(0.6,right-left);
        var top=idx*(laneH+laneGap)+3;
        var tip=x.ph.label+': '+(x.s?fmtGD(x.s):'?')+' to '+(x.e?fmtGD(x.e):'?');
        return '<div title="'+tip+'" style="position:absolute;left:'+left+'%;width:'+w+'%;top:'+top+'px;height:'+laneH+'px;border-radius:3px;background:'+x.ph.color+'"></div>';
      }).join('');
      return '<div style="display:flex;align-items:stretch;border-bottom:1px solid #f2f0f8">'
        +'<div style="flex:0 0 '+labelW+'px;padding:6px 10px 6px 0"><span class="mono" style="font-size:11px">'+esc(r.code)+'</span><div style="color:var(--muted);font-size:10.5px;line-height:1.3;overflow-wrap:anywhere;margin-top:1px">'+esc(r.name||'')+'</div></div>'
        +'<div style="position:relative;flex:1;min-height:'+rowH+'px">'
          +months.map(function(m){return '<div style="position:absolute;left:'+pct(m)+'%;top:0;bottom:0;border-left:1px solid #f4f2fa"></div>';}).join('')
          +bars
        +'</div></div>';
    }).join('');
    wrap.innerHTML=legend+'<div class="calgridwrap" style="overflow-x:auto"><div style="min-width:720px">'+head+body+'</div></div>';
  }
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
        +'<div class="cmeta">'+esc(it.job)+(it.jobName?(' \\u00b7 '+esc(it.jobName)):'')+' \\u00b7 '+esc(it.room_code||'—')+'/'+esc(it.item_code||'—')+(it.team?(' \\u00b7 '+esc(it.team)):'')+'</div></div>'
        +'<span class="cstat" style="color:'+col+';border-color:'+col+'">'+esc(istatLabel(it.install_status))+'</span></div>';
    }).join(''):'<div class="empty" style="padding:8px 0">Nothing scheduled this day.</div>';
  }

  // ---- Budget & pricing rules (admin / invoice_manager) ----
  var RULES=[];
  var DEFAULT_PARAMS={material:{window_frame_per_m2:13000,window_glass_per_m2:3000,door_frame_per_unit:34000,door_glass_per_unit:3000},labour:{window_per_unit:8000,door_per_unit:12000},sale:{rate_per_flat:315900,rate_per_door:135000,rate_per_m2_extra:32400,windows_included_per_flat:5}};
  function gbp(pennies){return '£'+((pennies||0)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function av(s){return esc(s).replace(/"/g,'&quot;');}
  async function loadBudget(){
    try{RULES=await (await api('/api/pricing-rules')).json();}catch(e){RULES=[];}
    var tb=document.getElementById('ruleRows');
    tb.innerHTML=RULES.length?RULES.map(function(r){var s=(r.params&&r.params.sale)||{};
      return '<tr><td><b>'+esc(r.name)+'</b></td><td>'+esc(r.customer||'—')+'</td><td class="ro">'+esc(r.model)+'</td>'
        +'<td>'+gbp(s.rate_per_flat)+'</td><td>'+gbp(s.rate_per_door)+'</td><td>'+gbp(s.rate_per_m2_extra)+'</td>'
        +'<td style="text-align:right"><a class="codelink" onclick="openRule(\\''+r.id+'\\')">Edit</a> &nbsp; <a class="codelink" onclick="delRule(\\''+r.id+'\\')">Delete</a></td></tr>';
    }).join(''):'<tr><td colspan="7" class="ro">No pricing rules yet — create one to price a customer\\'s jobs.</td></tr>';
    // job pricing selector
    var jsel=document.getElementById('fpJob');
    var jobs=await (await api('/api/jobs')).json();
    var keep=jsel.value;
    jsel.innerHTML=jobs.map(function(j){return '<option value="'+j.id+'">'+esc(j.site_code||j.code)+' — '+esc(j.name)+'</option>';}).join('');
    if(keep)jsel.value=keep;
    await loadJobPricing();
  }
  function fpOmitOn(){ var c=document.getElementById('fpIncludeOmit'); return c&&c.checked; }
  async function loadJobPricing(){
    var code=document.getElementById('fpJob').value; if(!code){document.getElementById('fpBreak').innerHTML='';return;}
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/pricing'+(fpOmitOn()?'?includeOmit=1':''))).json();
    var rsel=document.getElementById('fpRule');
    rsel.innerHTML='<option value="">— none —</option>'+(d.rules||[]).map(function(r){return '<option value="'+r.id+'">'+esc(r.name)+'</option>';}).join('');
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
    if(!d.rule_id){host.innerHTML='<div class="ro" style="padding:14px 2px">No rule assigned to this job yet — pick one above to price it.</div>';return;}
    var b=d.breakdown;
    if(!b){host.innerHTML='<div class="ro" style="padding:14px 2px">The assigned rule has no parameters yet. Edit it above.</div>';return;}
    var marginPct=b.saleTotal?Math.round(b.margin/b.saleTotal*100):0;
    var omitNote=(d.omitted?('<div class="sub" style="margin:8px 0 0;color:#b45309">'+d.omitted+' item'+(d.omitted===1?'':'s')+' marked <b>Omit</b> '+(d.includeOmit?'ARE included':'are excluded')+' in this budget/price'+(d.includeOmit?'':' — tick “Include Omit items” above to include them')+'.</div>'):'');
    var card=function(v,l,s,warn){return '<div class="stat'+(warn?' warn':'')+'"><div class="v">'+v+'</div><div class="l">'+l+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';};
    // Cost + margin are temporarily zeroed — the cost model is under review (see backlog).
    var cards='<div class="statgrid" style="margin:14px 0">'
      +card(gbp(b.saleTotal),'Customer price','')
      +card(gbp(0),'Our cost (budget)','under review')
      +card(gbp(0),'Margin','under review',false)+'</div>';
    var rows=b.flats.map(function(f){
      return '<tr><td><b>'+esc(f.flat)+'</b></td><td>'+f.windows+'</td><td>'+gbp(f.base)+'</td>'
        +'<td>'+(f.extraWindows?(f.extraWindows+' · '+f.extraM2+' m²'):'—')+'</td>'
        +'<td>'+(f.extraAmount?gbp(f.extraAmount):'—')+'</td><td><b>'+gbp(f.total)+'</b></td></tr>';
    }).join('');
    var extra='';
    if(b.doors.count)extra+='<tr><td colspan="5">Doors × '+b.doors.count+'</td><td><b>'+gbp(b.doors.amount)+'</b></td></tr>';
    if(b.communal.windows)extra+='<tr><td colspan="5">Communal / COM windows × '+b.communal.windows+' ('+b.communal.m2+' m²)</td><td><b>'+gbp(b.communal.amount)+'</b></td></tr>';
    if(b.variationsTotal)extra+='<tr><td colspan="5">Variations × '+b.variations.length+'</td><td><b>'+gbp(b.variationsTotal)+'</b></td></tr>';
    var table='<div class="card2"><table><thead><tr><th>FLAT</th><th>WINDOWS</th><th>BASE</th><th>EXTRA (biggest)</th><th>EXTRA £</th><th>FLAT TOTAL</th></tr></thead><tbody>'
      +rows+extra
      +'<tr style="border-top:2px solid var(--line)"><td colspan="5" style="text-align:right"><b>Customer price</b></td><td><b>'+gbp(b.saleTotal)+'</b></td></tr></tbody></table></div>';
    var itemsHtml='';
    if(d.items&&d.items.length){
      itemsHtml='<h4 style="margin:22px 0 6px;color:var(--purple)">Variations</h4>'
        +'<div class="sub" style="margin-bottom:8px">Tick an item to price it as a variation (a manually-agreed amount). Variations are billed separately and leave the flat\\'s fixed scope.</div>'
        +'<div class="card2"><table><thead><tr><th>ITEM</th><th>TYPE</th><th>FLAT</th><th>VARIATION</th><th>AMOUNT (£)</th></tr></thead><tbody>'
        +d.items.map(function(it){
          return '<tr><td class="mono">'+esc(it.full_code||'')+'</td><td class="ro">'+esc(it.category)+'</td><td>'+esc(it.flat||'—')+'</td>'
            +'<td><input type="checkbox" id="var_'+it.id+'" '+(it.is_variation?'checked':'')+' onchange="saveItemVar(\\''+it.id+'\\')" style="width:15px;height:15px;accent-color:var(--magenta)"></td>'
            +'<td><input id="vamt_'+it.id+'" type="number" min="0" step="0.01" value="'+(it.is_variation&&it.variation_amount?(it.variation_amount/100):'')+'" '+(it.is_variation?'':'disabled')+' onchange="saveItemVar(\\''+it.id+'\\')" style="width:92px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px"></td></tr>';
        }).join('')+'</tbody></table></div>';
    }
    var warn=d.missingDims?'<div style="background:#fff4ce;border:1px solid #f0d97a;border-radius:10px;padding:10px 14px;margin:0 0 12px;font-size:13px;color:#7a5b00">⚠ '+d.missingDims+' window'+(d.missingDims===1?' has':'s have')+' no Width/Height — their m² charges (extra windows above the included count, and COM units) are £0 until you add dimensions.</div>':'';
    host.innerHTML=cards+omitNote+warn+table+itemsHtml;
  }
  async function downloadPricePdf(){
    var code=document.getElementById('fpJob').value; if(!code){tShow('Pick a job first');return;}
    var btn=document.getElementById('fpPdfBtn'); var was=btn.textContent; btn.textContent='Building…'; btn.disabled=true;
    try{
      var r=await fetch('/api/job/'+encodeURIComponent(code)+'/price.pdf'+(fpOmitOn()?'?includeOmit=1':''),{headers:{Authorization:'Bearer '+token}});
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
  function rMoney(id,label,pennies){return '<div class="field"><label>'+label+' (£)</label><input id="'+id+'" type="number" min="0" step="0.01" value="'+((pennies||0)/100)+'"></div>';}
  function rNum(id,label,val){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="number" min="0" step="1" value="'+(val==null?'':val)+'"></div>';}
  function openRule(id){
    var r=id?RULES.find(function(x){return x.id===id;}):null;
    var p=(r&&r.params&&r.params.sale)?r.params:JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    var m=p.material||{},l=p.labour||{},sa=p.sale||{};
    var html='<div class="fgrid">'
      +'<div class="field full"><label>Rule name *</label><input id="r_name" value="'+av(r?r.name:'')+'" placeholder="e.g. Axis — standard"></div>'
      +'<div class="field full"><label>Customer</label><input id="r_customer" value="'+av(r?(r.customer||''):'')+'" placeholder="Customer / client name"></div>'
      +'<div class="groupt">MATERIAL COST (our purchase)</div>'
      +rMoney('r_wfm','Windows — frame / m²',m.window_frame_per_m2)+rMoney('r_wgm','Windows — glass / m²',m.window_glass_per_m2)
      +rMoney('r_dfu','Single door — frame / unit',m.door_frame_per_unit)+rMoney('r_dgu','Single door — glass / unit',m.door_glass_per_unit)
      +'<div class="groupt">LABOUR COST — rip-out (budget, not fitter pay)</div>'
      +rMoney('r_wl','Window / unit',l.window_per_unit)+rMoney('r_dl','Single door / unit',l.door_per_unit)
      +'<div class="groupt">SALE RATES (customer price)</div>'
      +rMoney('r_rf','Rate per flat',sa.rate_per_flat)+rMoney('r_rd','Rate per door',sa.rate_per_door)
      +rMoney('r_rm','Rate per m² (COM / communal / extra windows)',sa.rate_per_m2_extra)+rNum('r_wi','Windows included per flat',sa.windows_included_per_flat)
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

  // ---- Client invoicing (admin / invoice_manager) ----
  var INV_STATUS={draft:{t:'Draft',c:'#6b6880'},sent:{t:'Awaiting payment',c:'#3a2b72'},paid:{t:'Paid',c:'#16a34a'},void:{t:'Void',c:'#9a97a8'}};
  function invDate(s){ if(!s)return '—'; var d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}); }
  function invBadge(inv){ var m=INV_STATUS[inv.status]||INV_STATUS.draft; var lbl=inv.overdue?'Overdue':m.t; var col=inv.overdue?'#c0392b':m.c;
    return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:'+col+'">'+lbl+'</span>'; }
  async function loadInvoices(){
    var f=document.getElementById('invStatusFilter'); var q=f&&f.value?('?status='+encodeURIComponent(f.value)):'';
    var d; try{ d=await (await api('/api/invoices'+q)).json(); }catch(e){ d={invoices:[],summary:{}}; }
    var s=d.summary||{};
    document.getElementById('invSummary').innerHTML=
      '<div class="stat"><div class="v">'+gbp(s.outstanding||0)+'</div><div class="l">Outstanding</div><div class="s">awaiting payment</div></div>'
      +'<div class="stat"><div class="v">'+gbp(s.paid||0)+'</div><div class="l">Paid</div><div class="s">received</div></div>'
      +'<div class="stat'+((s.overdueCount||0)?' warn':'')+'"><div class="v">'+(s.overdueCount||0)+'</div><div class="l">Overdue</div><div class="s">past due date</div></div>'
      +'<div class="stat"><div class="v">'+(s.count||0)+'</div><div class="l">Invoices</div></div>';
    var tb=document.getElementById('invRows');
    var rows=d.invoices||[];
    tb.innerHTML=rows.length?rows.map(function(i){
      var act='<a class="codelink" onclick="dlInvoicePdf(\\''+i.id+'\\')">PDF</a>';
      if(i.status==='draft')act+=' &nbsp; <a class="codelink" onclick="invSetStatus(\\''+i.id+'\\',\\'sent\\')">Send</a> &nbsp; <a class="codelink" onclick="openInvoice(\\''+i.id+'\\')">Edit</a> &nbsp; <a class="codelink" style="color:#c0392b" onclick="delInvoice(\\''+i.id+'\\')">Delete</a>';
      else if(i.status==='sent')act+=' &nbsp; <a class="codelink" onclick="invMarkPaid(\\''+i.id+'\\')">Mark paid</a> &nbsp; <a class="codelink" onclick="invSetStatus(\\''+i.id+'\\',\\'void\\')">Void</a>';
      else if(i.status==='paid')act+=' &nbsp; <a class="codelink" onclick="invSetStatus(\\''+i.id+'\\',\\'sent\\')">Mark unpaid</a>';
      else if(i.status==='void')act+=' &nbsp; <a class="codelink" style="color:#c0392b" onclick="delInvoice(\\''+i.id+'\\')">Delete</a>';
      return '<tr><td><a class="codelink" onclick="openInvoice(\\''+i.id+'\\')"><b>'+esc(i.number)+'</b></a></td>'
        +'<td class="mono">'+esc(i.job_ref||'')+'<div style="color:var(--muted);font-size:11px">'+esc(i.job_name||'')+'</div></td>'
        +'<td>'+esc(i.customer||'—')+'</td><td>'+invDate(i.issue_date)+'</td><td>'+invDate(i.due_date)+'</td>'
        +'<td><b>'+gbp(i.total_pennies)+'</b></td><td>'+invBadge(i)+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+act+'</td></tr>';
    }).join(''):'<tr><td colspan="8" class="ro">No invoices yet — raise one from a priced job.</td></tr>';
  }
  async function openNewInvoice(){
    var jobs; try{ jobs=await (await api('/api/jobs')).json(); }catch(e){ jobs=[]; }
    var opts=jobs.map(function(j){return '<option value="'+j.id+'">'+esc(j.site_code||j.code)+' — '+esc(j.name)+'</option>';}).join('');
    var html='<div class="fgrid">'
      +'<div class="field full"><label>Job *</label><select id="ni_job" class="tinput">'+opts+'</select><div class="sub" style="margin-top:4px">Only jobs with a pricing rule assigned (Budget tab) can be invoiced.</div></div>'
      +'<div class="field"><label>VAT rate (%)</label><input id="ni_vat" type="number" min="0" max="100" step="0.5" value="20"></div>'
      +'<div class="field"><label>Payment terms (days)</label><input id="ni_due" type="number" min="0" step="1" value="30"></div>'
      +'<div class="field full"><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="ni_omit" style="width:15px;height:15px"> Include items marked Omit</label></div>'
      +'<div class="field full"><label>Bill-to address</label><textarea id="ni_billto" rows="3" placeholder="Customer billing address (appears on the invoice)"></textarea></div>'
      +'<div class="field full"><label>Notes</label><input id="ni_notes" placeholder="e.g. PO reference, payment instructions"></div>'
      +'</div>';
    openModal('New invoice','<form onsubmit="return false">'+html+'<div class="foot"><button class="cancel" type="button" onclick="closeModal()">Cancel</button><button class="save" type="button" onclick="createInvoice()">Create invoice</button></div></form>');
  }
  async function createInvoice(){
    var job=document.getElementById('ni_job').value; if(!job){tShow('Pick a job');return;}
    var body={job_id:job,vat_rate:parseFloat(document.getElementById('ni_vat').value),due_days:parseInt(document.getElementById('ni_due').value,10),
      includeOmit:document.getElementById('ni_omit').checked,bill_to:document.getElementById('ni_billto').value,notes:document.getElementById('ni_notes').value};
    var r=await api('/api/invoices',{method:'POST',body:JSON.stringify(body)}); var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Invoice '+d.number+' created');loadInvoices();}else tShow(d.error||'Could not create invoice');
  }
  async function openInvoice(id){
    var inv; try{ inv=await (await api('/api/invoice/'+id)).json(); }catch(e){ tShow('Could not load'); return; }
    if(inv.error){tShow(inv.error);return;}
    var b=(inv.snapshot&&inv.snapshot.breakdown)||{flats:[],doors:{},communal:{},variations:[]};
    var lines='';
    (b.flats||[]).forEach(function(f){ lines+='<tr><td>Flat '+esc(f.flat)+'</td><td class="ro">'+f.windows+' window'+(f.windows===1?'':'s')+(f.extraWindows?(' · '+f.extraWindows+' extra'):'')+'</td><td style="text-align:right">'+gbp(f.total)+'</td></tr>'; });
    if(b.doors&&b.doors.count)lines+='<tr><td>Doors</td><td class="ro">'+b.doors.count+'</td><td style="text-align:right">'+gbp(b.doors.amount)+'</td></tr>';
    if(b.communal&&b.communal.windows)lines+='<tr><td>Communal / COM windows</td><td class="ro">'+b.communal.windows+' ('+b.communal.m2+' m²)</td><td style="text-align:right">'+gbp(b.communal.amount)+'</td></tr>';
    (b.variations||[]).forEach(function(v){ lines+='<tr><td>Variation '+esc(v.code||'')+'</td><td class="ro">agreed</td><td style="text-align:right">'+gbp(v.amount)+'</td></tr>'; });
    var editable=(inv.status==='draft');
    var head='<div class="sub" style="margin-bottom:8px">'+esc((inv.snapshot&&inv.snapshot.job&&(inv.snapshot.job.client_code+'.'+inv.snapshot.job.job_code))||'')+' · '+esc(inv.customer||'—')+' · '+invBadge({status:inv.status,overdue:false})+'</div>';
    var tbl='<div class="card2" style="margin-bottom:12px"><table><thead><tr><th>DESCRIPTION</th><th>DETAILS</th><th style="text-align:right">AMOUNT</th></tr></thead><tbody>'+lines
      +'<tr style="border-top:1px solid var(--line)"><td colspan="2" style="text-align:right">Subtotal (ex VAT)</td><td style="text-align:right">'+gbp(inv.subtotal_pennies)+'</td></tr>'
      +'<tr><td colspan="2" style="text-align:right">VAT @ '+Number(inv.vat_rate)+'%</td><td style="text-align:right">'+gbp(inv.vat_pennies)+'</td></tr>'
      +'<tr style="border-top:2px solid var(--line)"><td colspan="2" style="text-align:right"><b>Total</b></td><td style="text-align:right"><b>'+gbp(inv.total_pennies)+'</b></td></tr></tbody></table></div>';
    var form='<div class="fgrid">'
      +'<div class="field"><label>VAT rate (%)</label><input id="ei_vat" type="number" min="0" max="100" step="0.5" value="'+Number(inv.vat_rate)+'" '+(editable?'':'disabled')+'></div>'
      +'<div class="field"><label>Due date</label><input id="ei_due" type="date" value="'+(inv.due_date||'')+'" '+(editable?'':'disabled')+'></div>'
      +'<div class="field full"><label>Bill-to address</label><textarea id="ei_billto" rows="3" '+(editable?'':'disabled')+'>'+esc(inv.bill_to||'')+'</textarea></div>'
      +'<div class="field full"><label>Notes</label><input id="ei_notes" value="'+av(inv.notes||'')+'" '+(editable?'':'disabled')+'></div>'
      +'</div>';
    var actions='<div class="foot"><button class="cancel" type="button" onclick="closeModal()">Close</button>'
      +'<button class="cancel" type="button" onclick="dlInvoicePdf(\\''+inv.id+'\\')">Download PDF</button>'
      +(editable?'<button class="save" type="button" onclick="saveInvoice(\\''+inv.id+'\\')">Save changes</button>':'')+'</div>';
    openModal('Invoice '+esc(inv.number),head+tbl+(editable?'<div class="groupt">EDIT (draft only)</div>':'')+form+actions);
  }
  async function saveInvoice(id){
    var body={vat_rate:parseFloat(document.getElementById('ei_vat').value),due_date:document.getElementById('ei_due').value||null,
      bill_to:document.getElementById('ei_billto').value,notes:document.getElementById('ei_notes').value};
    var r=await api('/api/invoice/'+id,{method:'PUT',body:JSON.stringify(body)}); var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Saved');loadInvoices();}else tShow(d.error||'Could not save');
  }
  async function invSetStatus(id,status){
    if(status==='void'&&!confirm('Void this invoice? It stays on record but is marked void.'))return;
    var r=await api('/api/invoice/'+id+'/status',{method:'POST',body:JSON.stringify({status:status})}); var d=await r.json();
    if(r.ok&&d.ok){tShow(status==='sent'?'Marked sent':status==='void'?'Voided':'Updated');loadInvoices();}else tShow(d.error||'Failed');
  }
  async function invMarkPaid(id){
    var ref=prompt('Mark paid — payment reference (optional):','');
    if(ref===null)return;
    var r=await api('/api/invoice/'+id+'/status',{method:'POST',body:JSON.stringify({status:'paid',paid_ref:ref})}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Marked paid');loadInvoices();}else tShow(d.error||'Failed');
  }
  async function delInvoice(id){
    if(!confirm('Delete this invoice permanently?'))return;
    var r=await api('/api/invoice/'+id,{method:'DELETE'}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Invoice deleted');loadInvoices();}else tShow(d.error||'Could not delete');
  }
  async function dlInvoicePdf(id){
    try{
      var r=await fetch('/api/invoice/'+id+'/pdf',{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){var e={};try{e=await r.json();}catch(_){}tShow(e.error||'PDF failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download='invoice.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000); tShow('Invoice PDF downloaded');
    }catch(err){tShow('PDF failed');}
  }

  // ---- Install sign-off / QA (admin / office) ----
  var SO_CUR={job:'',flat:'',checklist:[]};
  async function loadSignoff(){
    var jsel=document.getElementById('soJob');
    var jobs; try{ jobs=await (await api('/api/jobs')).json(); }catch(e){ jobs=[]; }
    var keep=jsel.value;
    jsel.innerHTML=jobs.map(function(j){return '<option value="'+j.id+'">'+esc(j.site_code||j.code)+' — '+esc(j.name)+'</option>';}).join('');
    if(keep)jsel.value=keep;
    var eb=document.getElementById('qaEditBtn'); if(eb)eb.style.display=canCap('users.manage')?'inline-block':'none';
    await loadSignoffFlats();
  }
  async function loadSignoffFlats(){
    var code=document.getElementById('soJob').value;
    var tb=document.getElementById('soRows');
    if(!code){tb.innerHTML='<tr><td colspan="7" class="ro">No job selected.</td></tr>';return;}
    var d; try{ d=await (await api('/api/job/'+encodeURIComponent(code)+'/signoff')).json(); }catch(e){ d={flats:[]}; }
    var flats=d.flats||[];
    document.getElementById('soMsg').textContent=flats.length?(flats.length+' flat'+(flats.length===1?'':'s')):'';
    tb.innerHTML=flats.length?flats.map(function(f){
      var so=f.signoff;
      var badge=so?('<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:'+(so.result==='pass'?'#16a34a':'#c0392b')+'">'+(so.result==='pass'?'Passed':'Failed')+'</span>'):'<span class="ro">—</span>';
      var ready=f.ready?'<span style="color:#16a34a;font-weight:700">✓</span>':('<span class="ro">'+f.outstanding+' left</span>');
      var act='<a class="codelink" onclick="openFlatSignoff(\\''+esc(f.flat)+'\\')">'+(so?'Review':'Sign off')+'</a>';
      if(so)act+=' &nbsp; <a class="codelink" onclick="dlSignoffPdf(\\''+esc(f.flat)+'\\')">PDF</a>';
      return '<tr><td><b>'+esc(f.flat)+'</b></td><td>'+f.total+'</td><td>'+f.installed+'</td>'
        +'<td>'+(f.snags?('<span style="color:#c0392b">'+f.snags+'</span>'):'0')+'</td><td>'+ready+'</td><td>'+badge+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+act+'</td></tr>';
    }).join(''):'<tr><td colspan="7" class="ro">No flats on this job yet.</td></tr>';
  }
  async function openFlatSignoff(flat){
    var code=document.getElementById('soJob').value;
    var d; try{ d=await (await api('/api/job/'+encodeURIComponent(code)+'/flat/'+encodeURIComponent(flat)+'/signoff')).json(); }catch(e){ tShow('Could not load'); return; }
    if(d.error){tShow(d.error);return;}
    SO_CUR={job:code,flat:flat,checklist:d.checklist||[]};
    var rows=(d.checklist||[]).map(function(c,i){
      return '<tr><td style="text-align:center"><input type="checkbox" id="qa_ok_'+i+'" '+(c.ok?'checked':'')+' style="width:16px;height:16px;accent-color:var(--magenta)"></td>'
        +'<td>'+esc(c.label)+'</td>'
        +'<td><input id="qa_note_'+i+'" value="'+av(c.note||'')+'" placeholder="note (optional)" style="width:100%;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px"></td></tr>';
    }).join('');
    var checklistTbl='<div class="card2" style="margin:6px 0 12px"><table><thead><tr><th style="width:44px">OK</th><th>CHECK</th><th style="width:34%">NOTE</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    var photos=(d.photos||[]).filter(function(p){return p.url;});
    var photoHtml=photos.length?('<div class="groupt">AFTER-INSTALL PHOTOS ('+photos.length+')</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">'
      +photos.map(function(p){return '<a href="'+p.url+'" target="_blank" title="'+av(p.code||'')+'"><img src="'+p.url+'" style="width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"></a>';}).join('')+'</div>')
      :'<div class="sub" style="margin-bottom:12px">No after-install photos uploaded for this flat yet.</div>';
    var itemsNote='<div class="sub" style="margin-bottom:10px">'+(d.items||[]).length+' item'+((d.items||[]).length===1?'':'s')+' in this flat. Tick each check that passes; untick and note anything that fails.</div>';
    var resultSel='<div class="fgrid"><div class="field"><label>Result</label><select id="qa_result" class="tinput"><option value="pass"'+(d.result!=='fail'?' selected':'')+'>Pass</option><option value="fail"'+(d.result==='fail'?' selected':'')+'>Fail</option></select></div>'
      +'<div class="field full"><label>Overall notes</label><input id="qa_notes" value="'+av(d.notes||'')+'" placeholder="Handover notes (optional)"></div></div>';
    var actions='<div class="foot"><button class="cancel" type="button" onclick="closeModal()">Cancel</button>'
      +(d.exists?'<button class="cancel" type="button" style="color:#c0392b;border-color:#f0c2bb" onclick="delSignoff()">Clear</button>':'')
      +(d.exists?'<button class="cancel" type="button" onclick="dlSignoffPdf(\\''+esc(flat)+'\\')">Download PDF</button>':'')
      +'<button class="save" type="button" onclick="saveFlatSignoff()">Save sign-off</button></div>';
    openModal('Flat '+esc(flat)+' — sign-off',itemsNote+checklistTbl+photoHtml+resultSel+actions);
  }
  async function saveFlatSignoff(){
    var checklist=SO_CUR.checklist.map(function(c,i){
      var ok=document.getElementById('qa_ok_'+i); var note=document.getElementById('qa_note_'+i);
      return {key:c.key,label:c.label,ok:ok?ok.checked:false,note:note?note.value:''};
    });
    var body={result:document.getElementById('qa_result').value,notes:document.getElementById('qa_notes').value,checklist:checklist};
    var r=await api('/api/job/'+encodeURIComponent(SO_CUR.job)+'/flat/'+encodeURIComponent(SO_CUR.flat)+'/signoff',{method:'PUT',body:JSON.stringify(body)});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Flat '+SO_CUR.flat+' signed off');loadSignoffFlats();}else tShow(d.error||'Could not save');
  }
  async function delSignoff(){
    if(!confirm('Clear this flat\\'s sign-off?'))return;
    var r=await api('/api/job/'+encodeURIComponent(SO_CUR.job)+'/flat/'+encodeURIComponent(SO_CUR.flat)+'/signoff',{method:'DELETE'});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Sign-off cleared');loadSignoffFlats();}else tShow(d.error||'Failed');
  }
  async function dlSignoffPdf(flat){
    var code=document.getElementById('soJob').value;
    try{
      var r=await fetch('/api/job/'+encodeURIComponent(code)+'/flat/'+encodeURIComponent(flat)+'/signoff.pdf',{headers:{Authorization:'Bearer '+token}});
      if(!r.ok){var e={};try{e=await r.json();}catch(_){}tShow(e.error||'PDF failed');return;}
      var blob=await r.blob(); var u=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=u; a.download='flat-'+flat+'-signoff.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(u);},4000); tShow('Certificate downloaded');
    }catch(err){tShow('PDF failed');}
  }
  async function openQaTemplate(){
    var d; try{ d=await (await api('/api/qa-checklist')).json(); }catch(e){ tShow('Could not load'); return; }
    var list=d.checklist||[];
    var rows=list.map(function(c){return c.label;}).join('\\n');
    var html='<div class="field full"><label>Checklist lines (one per line)</label>'
      +'<textarea id="qa_tmpl" rows="10" style="width:100%;font-size:13px">'+esc(rows)+'</textarea>'
      +'<div class="sub" style="margin-top:6px">Each line becomes a QA check. Existing sign-offs keep the wording they were saved with.</div></div>';
    openModal('Edit QA checklist',html+'<div class="foot"><button class="cancel" type="button" onclick="closeModal()">Cancel</button><button class="save" type="button" onclick="saveQaTemplate()">Save checklist</button></div>');
  }
  async function saveQaTemplate(){
    var lines=document.getElementById('qa_tmpl').value.split('\\n').map(function(s){return s.trim();}).filter(Boolean);
    if(!lines.length){tShow('Add at least one line');return;}
    var checklist=lines.map(function(label,i){return {key:'c'+(i+1),label:label};});
    var r=await api('/api/qa-checklist',{method:'PUT',body:JSON.stringify({checklist:checklist})});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Checklist saved');loadSignoffFlats();}else tShow(d.error||'Could not save');
  }

  // ---- Purchasing: Suppliers ----
  var SUP_CANMANAGE=false, SUP_ALL=[];
  async function loadSuppliers(){
    var d; try{ d=await (await api('/api/suppliers')).json(); }catch(e){ d={suppliers:[],canManage:false}; }
    SUP_CANMANAGE=!!d.canManage; SUP_ALL=d.suppliers||[];
    var nb=document.getElementById('newSupBtn'); if(nb)nb.style.display=d.canManage?'inline-block':'none';
    var ib=document.getElementById('impSupBtn'); if(ib)ib.style.display=d.canManage?'inline-block':'none';
    var tb=document.getElementById('supRows');
    tb.innerHTML=SUP_ALL.length?SUP_ALL.map(function(su){
      var act=SUP_CANMANAGE?('<a class="codelink" data-act="edit" data-id="'+su.id+'">Edit</a> &nbsp; <a class="codelink" style="color:#c0392b" data-act="del" data-id="'+su.id+'" data-name="'+av(su.name)+'">Delete</a>'):'';
      return '<tr><td><b>'+esc(su.name)+'</b></td><td>'+esc(su.contact||'')+'</td><td>'+esc(su.email||'')+'</td><td>'+esc(su.phone||'')+'</td>'
        +'<td>'+(su.active?'<span class="count green">active</span>':'<span class="count">inactive</span>')+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+act+'</td></tr>';
    }).join(''):'<tr><td colspan="6" class="ro">No suppliers yet.</td></tr>';
    Array.prototype.forEach.call(tb.querySelectorAll('a[data-act]'),function(a){ a.onclick=function(){ var id=a.getAttribute('data-id'); if(a.getAttribute('data-act')==='edit')openSupplier(id); else delSupplier(id,a.getAttribute('data-name')); }; });
  }
  function openSupplier(id){
    var su=id?(SUP_ALL.filter(function(x){return x.id===id;})[0]||{}):{};
    var html='<div class="fgrid">'
      +'<div class="field full"><label>Name *</label><input id="su_name" class="tinput" value="'+av(su.name||'')+'"></div>'
      +'<div class="field"><label>Contact</label><input id="su_contact" class="tinput" value="'+av(su.contact||'')+'"></div>'
      +'<div class="field"><label>Phone</label><input id="su_phone" class="tinput" value="'+av(su.phone||'')+'"></div>'
      +'<div class="field full"><label>Email</label><input id="su_email" class="tinput" value="'+av(su.email||'')+'"></div>'
      +(id?'<div class="field full"><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="su_active" '+(su.active?'checked':'')+'> Active</label></div>':'')
      +'</div><div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="suSave">Save</button></div>';
    openModal(id?('Supplier '+esc(su.name||'')):'New supplier', html);
    document.getElementById('suSave').onclick=function(){ saveSupplier(id||''); };
  }
  async function saveSupplier(id){
    var body={name:(document.getElementById('su_name').value||'').trim(),contact:document.getElementById('su_contact').value,email:document.getElementById('su_email').value,phone:document.getElementById('su_phone').value};
    var ae=document.getElementById('su_active'); if(ae)body.active=ae.checked;
    if(!body.name){tShow('Name required');return;}
    var r=id?await api('/api/suppliers/'+id,{method:'PUT',body:JSON.stringify(body)}):await api('/api/suppliers',{method:'POST',body:JSON.stringify(body)});
    var d=await r.json(); if(r.ok&&d.ok){closeModal();tShow('Saved');loadSuppliers();}else tShow(d.error||'Could not save');
  }
  async function importSuppliers(){
    if(!confirm('Import approved suppliers from the monday board? Adds new ones and refreshes contact/email/phone on existing (matched by name).'))return;
    tShow('Importing suppliers from monday…');
    try{ var r=await api('/api/suppliers/import-monday',{method:'POST',body:'{}'}); var d=await r.json();
      if(r.ok&&d.ok){tShow(d.added+' added · '+d.updated+' updated (of '+d.scanned+' on the board)');loadSuppliers();}else tShow(d.error||'Import failed');
    }catch(e){tShow('Import failed');}
  }
  async function delSupplier(id,name){ if(!confirm('Delete supplier '+name+'?'))return; var r=await api('/api/suppliers/'+id,{method:'DELETE'}); var d=await r.json(); if(r.ok&&d.ok){tShow('Deleted');loadSuppliers();}else tShow(d.error||'Could not delete'); }

  // ---- Purchasing: PO requests ----
  var PO_ST={in_review:['In review','#6b6880'],approved:['Approved','#16a34a'],rejected:['Rejected','#c0392b'],po_sent:['PO sent','#579bfc'],supplier_confirmed:['Supplier confirmed','#784bd1'],part_delivered:['Part delivered','#ff6d3b'],delivered:['Delivered','#037f4c'],cancelled:['Cancelled','#555']};
  var CUR_SYM={GBP:'£',PLN:'zł',EUR:'€',USD:'$'};
  function poMoney(p,cur){ return (CUR_SYM[cur]||'')+(((p||0)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})); }
  function poBadge(st){ var m=PO_ST[st]||[st,'#6b6880']; return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:'+m[1]+'">'+m[0]+'</span>'; }
  var PO_CANAPPROVE=false, PO_ROWS=[], PO_CCS=[], PO_SUPS=[], PO_TEAMS=[];
  async function poLoadRefs(){
    try{ PO_CCS=((await (await api('/api/cost-centres')).json()).costCentres||[]).filter(function(c){return c.active;}); }catch(e){ PO_CCS=[]; }
    try{ PO_SUPS=((await (await api('/api/suppliers')).json()).suppliers||[]).filter(function(x){return x.active;}); }catch(e){ PO_SUPS=[]; }
    try{ var td=await (await api('/api/teams')).json(); PO_TEAMS=(td.teams||[]).filter(function(t){return t.active!==false;}); }catch(e){ PO_TEAMS=[]; }
  }
  async function loadPoRequests(){
    var st=(document.getElementById('poStatusFilter')||{}).value||'';
    var d; try{ d=await (await api('/api/po-requests'+(st?('?status='+encodeURIComponent(st)):''))).json(); }catch(e){ d={requests:[],summary:{}}; }
    PO_CANAPPROVE=!!d.canApprove; PO_ROWS=d.requests||[];
    var nbtn=document.getElementById('poNotifyBtn'); if(nbtn)nbtn.style.display=PO_CANAPPROVE?'inline-block':'none';
    refreshPoApprovalsBadge();
    var sm=d.summary||{};
    document.getElementById('poSummary').innerHTML=
      '<div class="stat"><div class="v">'+(sm.count||0)+'</div><div class="l">Requests</div></div>'
      +'<div class="stat'+((sm.awaiting||0)?' warn':'')+'"><div class="v">'+(sm.awaiting||0)+'</div><div class="l">In review</div></div>';
    renderPoRows();
  }
  function renderPoRows(){
    var tf=(document.getElementById('poCcTypeFilter')||{}).value||'';
    var q=((document.getElementById('poSearch')||{}).value||'').trim().toLowerCase();
    var rows=PO_ROWS.filter(function(r){
      if(tf&&r.cc_type!==tf)return false;
      if(q){ var hay=((r.number||'')+' '+(r.title||'')+' '+(r.supplier||'')+' '+(r.cost_centre||'')).toLowerCase(); if(hay.indexOf(q)<0)return false; }
      return true;
    });
    var sh=document.getElementById('poShown'); if(sh)sh.textContent=rows.length+' of '+PO_ROWS.length;
    var tb=document.getElementById('poRows');
    tb.innerHTML=rows.length?rows.map(function(r){
      return '<tr><td><a class="codelink" data-act="open" data-id="'+r.id+'"><b>'+esc(r.number)+'</b></a></td><td>'+esc(r.title)+'</td>'
        +'<td>'+esc(r.cost_centre||'—')+'</td><td>'+esc(r.supplier||'—')+'</td>'
        +'<td><b>'+poMoney(r.amount_pennies,r.currency)+'</b>'+(r.approval_required?' <span class="count amber" title="Needs approval">≥£2k</span>':'')+'</td>'
        +'<td>'+esc(r.requestor_name||'')+'</td><td>'+poBadge(r.status)+'</td>'
        +'<td style="text-align:right;white-space:nowrap"><a class="codelink" data-act="open" data-id="'+r.id+'">Open</a> &nbsp; <a class="codelink" data-act="copy" data-id="'+r.id+'">Copy</a></td></tr>';
    }).join(''):'<tr><td colspan="8" class="ro">No PO requests match.</td></tr>';
    Array.prototype.forEach.call(tb.querySelectorAll('a[data-act]'),function(a){ a.onclick=function(){ var id=a.getAttribute('data-id'); if(a.getAttribute('data-act')==='copy')copyPoReq(id); else openPoReq(id); }; });
  }
  function readFilesAsDataUrls(inputEl){
    return new Promise(function(resolve){ var fs=inputEl&&inputEl.files?inputEl.files:[]; if(!fs.length){resolve([]);return;} var out=[],n=0; for(var i=0;i<fs.length;i++){ (function(file){ var rd=new FileReader(); rd.onload=function(){ out.push({name:file.name,dataUrl:rd.result}); if(++n===fs.length)resolve(out); }; rd.onerror=function(){ if(++n===fs.length)resolve(out); }; rd.readAsDataURL(file); })(fs[i]); } });
  }
  function poCcOptions(sel){
    var types=[]; ['framework','enquiry','general'].forEach(function(t){ var cb=document.getElementById('cc_t_'+t); if(!cb||cb.checked)types.push(t); });
    var list=PO_CCS.filter(function(c){return types.indexOf(c.type)>=0;});
    return '<option value="">— pick cost centre —</option>'+list.map(function(c){return '<option value="'+c.id+'"'+(sel===c.id?' selected':'')+'>'+esc(c.code+(c.label?(' — '+c.label):''))+'</option>';}).join('');
  }
  function poFilterCC(){ var cc=document.getElementById('po_cc'); if(cc)cc.innerHTML=poCcOptions(cc.value); }
  function poFieldsHtml(d){
    d=d||{};
    var supOpts='<option value="">— pick supplier —</option>'+PO_SUPS.map(function(x){return '<option value="'+x.id+'"'+(d.supplier_id===x.id?' selected':'')+'>'+esc(x.name)+'</option>';}).join('');
    var teamOpts='<option value="">— no team —</option>'+PO_TEAMS.map(function(t){return '<option value="'+t.id+'"'+(d.team_id===t.id?' selected':'')+'>'+esc(t.name)+'</option>';}).join('');
    var curOpts=['GBP','PLN','EUR','USD'].map(function(c){return '<option'+((d.currency||'GBP')===c?' selected':'')+'>'+c+'</option>';}).join('');
    var ccInit='<option value="">— pick cost centre —</option>'+PO_CCS.map(function(c){return '<option value="'+c.id+'"'+(d.cost_centre_id===c.id?' selected':'')+'>'+esc(c.code+(c.label?(' — '+c.label):''))+'</option>';}).join('');
    return '<div class="fgrid">'
      +'<div class="field full"><label>Title / description *</label><input id="po_title" class="tinput" value="'+av(d.title||'')+'" placeholder="What is being ordered"></div>'
      +'<div class="field full"><label>Cost-centre type</label><div style="display:flex;gap:16px;font-size:13px;font-weight:500">'
        +'<label style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="cc_t_framework" checked onchange="poFilterCC()"> Framework</label>'
        +'<label style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="cc_t_enquiry" checked onchange="poFilterCC()"> Enquiry / job</label>'
        +'<label style="display:inline-flex;align-items:center;gap:5px"><input type="checkbox" id="cc_t_general" checked onchange="poFilterCC()"> General</label></div></div>'
      +'<div class="field full"><label>Cost centre</label><select id="po_cc" class="tinput">'+ccInit+'</select></div>'
      +'<div class="field"><label>Supplier</label><select id="po_sup" class="tinput">'+supOpts+'</select></div>'
      +'<div class="field"><label>…or new supplier</label><input id="po_newsup" class="tinput" value="'+av(d.new_supplier||'')+'" placeholder="if not on the list"></div>'
      +'<div class="field"><label>Amount</label><input id="po_amount" class="tinput" type="number" min="0" step="0.01" value="'+(d.amount_pennies!=null?(d.amount_pennies/100):'')+'"></div>'
      +'<div class="field"><label>Currency</label><select id="po_cur" class="tinput">'+curOpts+'</select></div>'
      +'<div class="field"><label>Fitters team</label><select id="po_team" class="tinput">'+teamOpts+'</select></div>'
      +'<div class="field"><label>Delivery date</label><input id="po_deldate" class="tinput" type="date" value="'+(d.delivery_date||'')+'"></div>'
      +'<div class="field"><label>Service start</label><input id="po_svcstart" class="tinput" type="date" value="'+(d.service_start||'')+'"></div>'
      +'<div class="field"><label>Service end</label><input id="po_svcend" class="tinput" type="date" value="'+(d.service_end||'')+'"></div>'
      +'<div class="field"><label>Site contact</label><input id="po_sitecontact" class="tinput" value="'+av(d.site_contact||'')+'"></div>'
      +'<div class="field full"><label>Delivery location</label><input id="po_delloc" class="tinput" value="'+av(d.delivery_location||'')+'"></div>'
      +'<div class="field"><label>Qty of items</label><input id="po_qty" class="tinput" type="number" min="0" step="1" value="'+(d.qty_items!=null?d.qty_items:'')+'"></div>'
      +'<div class="field"><label>Qty of snags</label><input id="po_snags" class="tinput" type="number" min="0" step="1" value="'+(d.qty_snags!=null?d.qty_snags:'')+'"></div>'
      +'<div class="field full"><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="po_remake" '+(d.remake?'checked':'')+'> Remake</label></div>'
      +'<div class="field full"><label>Special instructions / remake reason</label><input id="po_special" class="tinput" value="'+av(d.special_instructions||'')+'"></div>'
      +'</div>';
  }
  function poBody(){
    return {title:(document.getElementById('po_title').value||'').trim(),cost_centre_id:document.getElementById('po_cc').value||null,
      supplier_id:document.getElementById('po_sup').value||null,new_supplier:document.getElementById('po_newsup').value,
      amount:document.getElementById('po_amount').value||0,currency:document.getElementById('po_cur').value,
      team_id:document.getElementById('po_team').value||null,
      delivery_date:document.getElementById('po_deldate').value||null,service_start:document.getElementById('po_svcstart').value||null,service_end:document.getElementById('po_svcend').value||null,
      site_contact:document.getElementById('po_sitecontact').value,delivery_location:document.getElementById('po_delloc').value,
      qty_items:document.getElementById('po_qty').value,qty_snags:document.getElementById('po_snags').value,
      remake:document.getElementById('po_remake').checked,special_instructions:document.getElementById('po_special').value};
  }
  async function openNewPoReq(prefill){
    await poLoadRefs();
    var html=poFieldsHtml(prefill||{})
      +'<div class="field full" style="padding:0 2px"><label>Budget file (optional)</label><input id="po_budget" type="file" multiple accept="image/*,.pdf,.xlsx,.xls,application/pdf"></div>'
      +'<div class="field full" style="padding:0 2px"><label>Quote file (optional)</label><input id="po_quote" type="file" multiple accept="image/*,.pdf,.xlsx,.xls,application/pdf"></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="poSave">Create request</button></div>';
    openModal(prefill?'New PO request (copy)':'New PO request', html);
    document.getElementById('poSave').onclick=async function(){
      var body=poBody(); if(!body.title){tShow('Title required');return;}
      var r=await api('/api/po-requests',{method:'POST',body:JSON.stringify(body)}); var d=await r.json();
      if(!(r.ok&&d.ok)){ tShow(d.error||'Could not create'); return; }
      var bud=(await readFilesAsDataUrls(document.getElementById('po_budget'))).map(function(fl){fl.kind='budget';return fl;});
      var quo=(await readFilesAsDataUrls(document.getElementById('po_quote'))).map(function(fl){fl.kind='quote';return fl;});
      var files=bud.concat(quo);
      if(files.length){ await api('/api/po-requests/'+d.id+'/files',{method:'POST',body:JSON.stringify({files:files})}); }
      closeModal(); tShow('Request '+d.number+' created'+(d.approval_required?' · needs approval (≥£2k)':'')); loadPoRequests();
    };
  }
  async function copyPoReq(id){
    var d; try{ d=await (await api('/api/po-requests/'+id)).json(); }catch(e){ tShow('Could not load'); return; }
    if(d.error){tShow(d.error);return;} var r=d.request;
    openNewPoReq({title:(r.title||'')+' (copy)',cost_centre_id:r.cost_centre_id,supplier_id:r.supplier_id,new_supplier:r.new_supplier,amount_pennies:r.amount_pennies,currency:r.currency,team_id:r.team_id,delivery_date:r.delivery_date,service_start:r.service_start,service_end:r.service_end,site_contact:r.site_contact,delivery_location:r.delivery_location,qty_items:r.qty_items,qty_snags:r.qty_snags,remake:r.remake,special_instructions:r.special_instructions});
  }
  async function openPoReq(id){
    var d; try{ d=await (await api('/api/po-requests/'+id)).json(); }catch(e){ tShow('Could not load'); return; }
    if(d.error){tShow(d.error);return;}
    var r=d.request; await poLoadRefs();
    var fields=poFieldsHtml(r);
    var filesHtml=(d.files||[]).map(function(fl){ return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0"><a class="mlink" href="'+(fl.url||'#')+'" target="_blank">'+esc(fl.name)+'</a><span class="ro" style="font-size:11px">'+esc(fl.kind)+'</span></div>'; }).join('')||'<div class="ro">No files.</div>';
    var money=(r.currency==='GBP'?'£':(r.currency||'')+' ')+((r.amount_pennies||0)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
    var when=function(t){ return t?new Date(t).toLocaleDateString('en-GB'):''; };
    var head='<div class="pohead">'+poBadge(r.status)+'<span>·</span><b>'+esc(money)+'</b><span>·</span><span>requested by <b>'+esc(r.requestor_name||'—')+'</b></span>'+(r.po_number?'<span>·</span><span>PO <b>'+esc(r.po_number)+'</b></span>':'')+'</div>';
    var decide='';
    if(r.status==='in_review'){
      var why=r.approval_required?'This request is £2,000 or more and needs a purchasing manager\u2019s approval.':'Under £2,000 \u2014 approval is optional.';
      decide='<div class="podecide"><div class="msg"><b>Awaiting approval</b><small>'+why+'</small></div>'
        +(d.canApprove?'<button class="pobtn bad" id="poReject">Reject</button><button class="pobtn ok" id="poApprove">Approve</button>':'')+'</div>';
    } else if(r.status==='rejected'){
      decide='<div class="podecide bad"><div class="msg"><b>Rejected</b>'+(r.decided_by_name?' by '+esc(r.decided_by_name):'')+(r.decided_at?' on '+esc(when(r.decided_at)):'')
        +(r.decision_comment?'<small>\u201c'+esc(r.decision_comment)+'\u201d</small>':'')+'</div></div>';
    } else if(r.approved_at){
      decide='<div class="podecide ok"><div class="msg"><b>Approved</b>'+(r.decided_by_name?' by '+esc(r.decided_by_name):'')+' on '+esc(when(r.approved_at))
        +(r.decision_comment?'<small>'+esc(r.decision_comment)+'</small>':'')+'</div></div>';
    }
    var filesHtml=(d.files||[]).map(function(fl){ return '<div class="pofile"><a class="mlink" href="'+(fl.url||'#')+'" target="_blank">'+esc(fl.name)+'</a><span class="pokind">'+esc(fl.kind)+'</span></div>'; }).join('')||'<div class="empty">No documents yet.</div>';
    var addFiles='<div class="posec"><div class="groupt">DOCUMENTS</div><div class="pofiles">'+filesHtml+'</div>'
      +'<div class="porow"><select id="po_filekind" class="tinput"><option value="quote">Quote</option><option value="budget">Budget</option><option value="po">PO</option><option value="order_ack">Order ack</option><option value="delivery">Delivery</option><option value="other">Other</option></select>'
      +'<label class="pobtn" for="po_addfile">Choose files\u2026</label><input id="po_addfile" type="file" multiple style="display:none"><span class="pofname" id="po_fname">No file chosen</span>'
      +'<button class="pobtn" id="poAddFileBtn">Upload</button></div></div>';
    var progress='<div class="posec"><div class="groupt">PROGRESS</div><div class="porow" style="margin-top:0">'
      +'<select id="po_setstatus" class="tinput"><option value="">Move to\u2026</option><option value="po_sent">PO sent</option><option value="supplier_confirmed">Supplier confirmed</option><option value="part_delivered">Part delivered</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select>'
      +'<button class="pobtn" id="poSetBtn">Update status</button></div></div>';
    openModal('PO request '+esc(r.number), head+decide+fields+addFiles+progress
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Close</button><button class="save" id="poSaveEdit">Save changes</button></div>');
    var fin=document.getElementById('po_addfile'); fin.onchange=function(){ var n=fin.files.length; document.getElementById('po_fname').textContent=n?(n===1?fin.files[0].name:n+' files selected'):'No file chosen'; };
    document.getElementById('poSaveEdit').onclick=async function(){ var r2=await api('/api/po-requests/'+id,{method:'PUT',body:JSON.stringify(poBody())}); var dd=await r2.json(); if(r2.ok&&dd.ok){tShow('Saved');loadPoRequests();}else tShow(dd.error||'Failed'); };
    var ap=document.getElementById('poApprove'); if(ap)ap.onclick=function(){ poSetStatus(id,'approved'); };
    var rj=document.getElementById('poReject'); if(rj)rj.onclick=function(){ poRejectPrompt(id, r.number); };
    document.getElementById('poSetBtn').onclick=function(){ var v=document.getElementById('po_setstatus').value; if(!v)return; var extra={}; if(v==='po_sent'){ var pon=prompt('PO number (from Xero, optional):',''); if(pon)extra.po_number=pon; } poSetStatus(id,v,extra); };
    document.getElementById('poAddFileBtn').onclick=async function(){ var files=await readFilesAsDataUrls(document.getElementById('po_addfile')); if(!files.length){tShow('Pick a file');return;} var kind=document.getElementById('po_filekind').value; files=files.map(function(fl){fl.kind=kind;return fl;}); var rr=await api('/api/po-requests/'+id+'/files',{method:'POST',body:JSON.stringify({files:files})}); var dd=await rr.json(); if(rr.ok&&dd.ok){tShow(dd.saved+' file(s) added');openPoReq(id);}else tShow(dd.error||'Upload failed'); };
  }
  // Reject needs a reason: small dialog over the PO modal; the Reject button stays disabled until a comment is typed.
  function poRejectPrompt(id, number){
    var w=document.createElement('div'); w.className='pomini';
    w.innerHTML='<div class="box"><h4>Reject '+esc(number||'request')+'?</h4><p>Tell the requestor why. This comment is required and is sent to them.</p>'
      +'<textarea id="po_rejmsg" placeholder="Reason for rejecting\u2026"></textarea>'
      +'<div class="btns"><button class="pobtn" id="po_rejcancel">Cancel</button><button class="pobtn bad solid" id="po_rejgo" disabled>Reject request</button></div></div>';
    document.body.appendChild(w);
    var ta=w.querySelector('#po_rejmsg'), go=w.querySelector('#po_rejgo');
    var close=function(){ w.remove(); document.removeEventListener('keydown',onKey); };
    var onKey=function(e){ if(e.key==='Escape')close(); };
    document.addEventListener('keydown',onKey);
    w.addEventListener('click',function(e){ if(e.target===w)close(); });
    w.querySelector('#po_rejcancel').onclick=close;
    ta.oninput=function(){ go.disabled=!ta.value.trim(); };
    go.onclick=async function(){ var c=ta.value.trim(); if(!c){ ta.focus(); return; } go.disabled=true; var ok=await poSetStatus(id,'rejected',{comment:c}); if(ok)close(); else go.disabled=false; };
    ta.focus();
  }
  // ---- Language: per-user (Admin ▸ Users). Polish covers the Fin&Ops screens; empty / EN = English. ----
  // Texts are written in English in the code; for a Polish user they are swapped when they reach the page:
  // exact phrases via I18N_PL, phrases with numbers/names via I18N_RX, blocks with markup via I18N_HTML.
  var myLang=sessionStorage.getItem('ace_lang')||'';
  var I18N_PL={"Export CSV": "Eksport CSV", "Import from Excel": "Import z Excela", "Cancel": "Anuluj", "Close": "Zamknij", "Save": "Zapisz", "Import": "Importuj", "edit": "edytuj", "delete": "usuń", "change": "zmień", "show all": "pokaż wszystko", "All years": "Wszystkie lata", "All months": "Wszystkie miesiące", "(no year)": "(bez roku)", "Total": "Razem", "Acemark": "Acemark", "Ace Group": "Ace Group", "Poza bilans": "Poza bilans", "All companies": "Wszystkie spółki", "Office": "Biuro", "Sales": "Sprzedaż", "Production": "Produkcja", "OFFICE": "BIURO", "SALES": "SPRZEDAŻ", "PRODUCTION": "PRODUKCJA", "RESULT": "WYNIK", "Materials (RW)": "Materiały (RW)", "Materials %": "Materiały %", "Sales costs": "Koszty sprzedaży", "Sales costs %": "Koszty sprzedaży %", "Gross margin": "Marża brutto", "Gross margin %": "Marża brutto %", "Overheads (Office + Production payroll)": "Koszty ogólne (Biuro + płace Produkcji)", "Overheads %": "Koszty ogólne %", "EBITDA": "EBITDA", "EBITDA %": "EBITDA %", "Not in the result: Production overheads (invoices)": "Poza wynikiem: koszty ogólne Produkcji (faktury)", "All sales invoices of the month (Sales results above).": "Wszystkie faktury sprzedaży z miesiąca (Wyniki sprzedaży powyżej).", "Material Cost (RW) of the jobs counted in this month — from Job costs.": "Koszt materiału (RW) zleceń liczonych w tym miesiącu — z Kosztów zleceń.", "The whole Sales department: salaries, payroll taxes and overheads.": "Cały dział Sprzedaży: wynagrodzenia, podatki od płac i koszty ogólne.", "Sales − Materials − Sales costs.": "Sprzedaż − Materiały − Koszty sprzedaży.", "Office salaries, taxes and overheads, plus Production salaries and taxes.": "Wynagrodzenia, podatki i koszty ogólne Biura oraz wynagrodzenia i podatki Produkcji.", "Gross margin − Overheads.": "Marża brutto − Koszty ogólne.", "These invoices are not part of the result above: materials are counted there as RW from Job costs instead. The rest (leasing, maintenance, logistics, improvements) is left out, as in the sheet.": "Te faktury nie wchodzą do wyniku powyżej: materiały są tam liczone jako RW z Kosztów zleceń. Pozostałe (leasing, utrzymanie, logistyka, ulepszenia) są pominięte, tak jak w arkuszu.", "(no department)": "(bez działu)", "(NO DEPARTMENT)": "(BEZ DZIAŁU)", "(NO CATEGORY)": "(BEZ KATEGORII)", "Imported from Excel": "Zaimportowano z Excela", "Invoices whose category, department or KONTO looks wrong — open the list to fix them in monday": "Faktury, w których kategoria, dział lub KONTO wyglądają na błędne — otwórz listę, aby poprawić je w monday", "(no category)": "(bez kategorii)", "Could not load": "Nie udało się wczytać", "Could not save": "Nie udało się zapisać", "Could not delete": "Nie udało się usunąć", "Saved": "Zapisano", "Deleted": "Usunięto", "Import failed": "Import nie powiódł się", "Failed": "Błąd", "Performance": "Wyniki", "Collapse all": "Zwiń wszystko", "Expand all": "Rozwiń wszystko", "Show decimals": "Pokaż grosze", "Salaries": "Wynagrodzenia", "Taxes (payroll)": "Podatki (płace)", "Overheads": "Koszty ogólne", "Fixed / stałe": "Stałe", "Variable / zmienne": "Zmienne", "not entered yet — see the Payroll tab": "jeszcze nie wpisano — zobacz zakładkę Płace", "Control sum — Monday (invoices)": "Suma kontrolna — Monday (faktury)", "Total costs incl. payroll": "Koszty razem z płacami", "SALES RESULTS": "WYNIKI SPRZEDAŻY", "Sales from Orpiszew": "Sprzedaż z Orpiszewa", "Trade from Poland": "Handel z Polski", "Others UK": "Pozostali UK", "Germany": "Niemcy", "Poland": "Polska", "Spain": "Hiszpania", "Netherlands": "Holandia", "(no country)": "(bez kraju)", "No costs or sales for this year / company yet.": "Brak kosztów i sprzedaży dla tego roku / spółki.", "Never synced — run Sync from Monday on the Costs tab": "Brak synchronizacji — uruchom „Synchronizuj z Monday” w zakładce Koszty", "Could not load costs": "Nie udało się wczytać kosztów", "Line": "Pozycja", "Control sum - Monday": "Suma kontrolna - Monday", "Costs": "Koszty", "Sync from Monday": "Synchronizuj z Monday", "Sync:": "Zakres:", "All": "Wszystko", "Last 12 months": "Ostatnie 12 miesięcy", "Last 3 months": "Ostatnie 3 miesiące", "Fixed + variable": "Stałe + zmienne", "Fixed": "Stałe", "Variable": "Zmienne", "All invoices": "Wszystkie faktury", "Any warning": "Dowolne ostrzeżenie", "Changed after sync": "Zmienione po synchronizacji", "Duplicate Cost ID": "Zdublowany Cost ID", "Incomplete (no supplier / amount)": "Niekompletne (brak dostawcy / kwoty)", "To fix in monday (any reason)": "Do poprawy w monday (dowolny powód)", "KONTO ≠ category": "KONTO ≠ kategoria", "No department / category": "Brak działu / kategorii", "Invoice date outside its month group": "Data faktury poza grupą miesiąca", "No invoice number": "Brak numeru faktury", "All departments": "Wszystkie działy", "All categories": "Wszystkie kategorie", "All statuses": "Wszystkie statusy", "DATE": "DATA", "SUPPLIER": "DOSTAWCA", "INVOICE NO": "NR FAKTURY", "NET": "NETTO", "GROSS": "BRUTTO", "CATEGORY": "KATEGORIA", "DEPT": "DZIAŁ", "STATUS": "STATUS", "ORDER": "ZLECENIE", "COST ID": "COST ID", "Export this list (CSV)": "Eksportuj tę listę (CSV)", "Click to remove this filter": "Kliknij, aby usunąć ten filtr", "Search supplier, invoice no, order, description": "Szukaj: dostawca, nr faktury, zlecenie, opis", "Invoice date. The month an invoice is counted in is its monday group.": "Data faktury. Miesiąc, w którym faktura jest liczona, wynika z jej grupy w monday.", "Invoices": "Faktury", "Net total": "Razem netto", "Gross not yet paid": "Brutto do zapłaty", "To fix in monday": "Do poprawy w monday", "With any warning": "Z ostrzeżeniem", "Changed": "Zmieniona", "Duplicate": "Duplikat", "Incomplete": "Niekompletna", "Unclassified": "Bez klasyfikacji", "Date ≠ month": "Data ≠ miesiąc", "No invoice no": "Brak nr faktury", "Open in monday to fix ↗": "Otwórz w monday i popraw ↗", "Open this invoice in monday": "Otwórz tę fakturę w monday", "No invoices match these filters.": "Żadna faktura nie spełnia tych filtrów.", "No costs yet — click “Sync from Monday”.": "Brak kosztów — kliknij „Synchronizuj z Monday”.", "Never synced": "Brak synchronizacji", "Automatic sync:": "Automatyczna synchronizacja:", "off": "wyłączona", "Automatic sync": "Automatyczna synchronizacja", "Sync from Monday automatically every day": "Synchronizuj z Monday automatycznie codziennie", "Time (Poland time)": "Godzina (czas polski)", "Runs once a day at the chosen hour and refreshes the last 12 months. If the server was restarting at that moment, it runs as soon as it is back. You can still sync by hand at any time.": "Uruchamia się raz dziennie o wybranej godzinie i odświeża ostatnie 12 miesięcy. Jeśli serwer był w tym momencie restartowany, synchronizacja ruszy zaraz po jego powrocie. W każdej chwili można też zsynchronizować ręcznie.", "Supplier": "Dostawca", "Invoice no": "Nr faktury", "Net": "Netto", "Cost ID": "Cost ID", "Accept as correct": "Zaakceptuj jako poprawne", "Invoice changed after sync": "Faktura zmieniona po synchronizacji", "Accept the current monday values as correct? A new Cost ID is created and written to monday.": "Zaakceptować aktualne wartości z monday jako poprawne? Zostanie utworzony nowy Cost ID i zapisany w monday.", "Accepted": "Zaakceptowano", "Could not accept": "Nie udało się zaakceptować", "Could not start": "Nie udało się uruchomić", "Could not start the sync": "Nie udało się uruchomić synchronizacji", "Syncing…": "Synchronizacja…", "Last sync failed": "Ostatnia synchronizacja nie powiodła się", "Date": "Data", "Gross": "Brutto", "Department": "Dział", "Category": "Kategoria", "Fixed/variable": "Stałe/zmienne", "Status": "Status", "Order": "Zlecenie", "Description": "Opis", "Warnings": "Ostrzeżenia", "What to fix": "Co poprawić", "Monday link": "Link do monday", "Job costs": "Koszty zleceń", "+ New job": "+ Nowe zlecenie", "All jobs": "Wszystkie zlecenia", "Not locked": "Niezablokowane", "Locked": "Zablokowane", "No sales entered": "Bez wpisanej sprzedaży", "Sales differ from the sheet value": "Sprzedaż inna niż w arkuszu", "No costs entered": "Bez wpisanych kosztów", "Making a loss": "Ze stratą", "Search reference or customer": "Szukaj: numer zlecenia lub klient", "All customers": "Wszyscy klienci", "Default labour rate:": "Domyślna stawka robocizny:", "Default labour rate (zł per hour) — used when a new labour line is added:": "Domyślna stawka robocizny (zł za godzinę) — używana przy dodawaniu nowej pozycji robocizny:", "Total cost": "Koszt całkowity", "Profit / loss": "Zysk / strata", "Profitability": "Rentowność", "Profitability %": "Rentowność %", "Reference": "Zlecenie", "Month": "Miesiąc", "Year": "Rok", "Customer": "Klient", "Labour hours": "Godziny pracy", "Labour cost": "Koszt robocizny", "Material Cost (RW)": "Koszt materiału (RW)", "Other cost — panels": "Koszty dodatkowe — panele", "Glass": "Szkło", "Other extras": "Inne koszty dodatkowe", "Painting": "Malowanie", "Transport": "Transport", "Customs clearance": "Odprawa celna", "Labour": "Robocizna", "No jobs match these filters.": "Żadne zlecenie nie spełnia tych filtrów.", "No jobs yet — add one with “+ New job” or bring in the Koszty sheet with “Import from Excel”.": "Brak zleceń — dodaj je przyciskiem „+ Nowe zlecenie” albo wczytaj arkusz Koszty przez „Import z Excela”.", "No jobs yet — add one with “+ New job”.": "Brak zleceń — dodaj je przyciskiem „+ Nowe zlecenie”.", "Could not load job costs": "Nie udało się wczytać kosztów zleceń", "Could not load the job": "Nie udało się wczytać zlecenia", "Job {0}": "Zlecenie {0}", "by {0}": "przez: {0}", "on {0}": "dnia {0}", "New job": "Nowe zlecenie", "🔒 Locked": "🔒 Zablokowane", "This job can’t be changed. Unlock it to edit.": "Tego zlecenia nie można zmieniać. Odblokuj je, aby edytować.", "This job can’t be changed. Ask an admin to unlock it.": "Tego zlecenia nie można zmieniać. Poproś administratora o odblokowanie.", "Reference *": "Zlecenie *", "Sales (net zł)": "Sprzedaż (netto zł)", "Note": "Uwagi", "Sum of this job’s invoices on the": "Suma faktur tego zlecenia w zakładce", "Sales tab": "Sprzedaż", "SUMMARY": "PODSUMOWANIE", "COST LINES": "POZYCJE KOSZTOWE", "ADD A COST LINE": "DODAJ POZYCJĘ KOSZTOWĄ", "EDIT COST LINE": "EDYCJA POZYCJI KOSZTOWEJ", "TYPE": "RODZAJ", "AMOUNT": "KWOTA", "NOTE": "UWAGI", "No cost lines yet.": "Brak pozycji kosztowych.", "Type": "Rodzaj", "Amount (zł)": "Kwota (zł)", "Hours": "Godziny", "Rate (zł/h)": "Stawka (zł/h)", "Add line": "Dodaj pozycję", "Save line": "Zapisz pozycję", "Delete job": "Usuń zlecenie", "🔓 Unlock": "🔓 Odblokuj", "🔒 Lock job": "🔒 Zablokuj zlecenie", "Save job": "Zapisz zlecenie", "Create job": "Utwórz zlecenie", "Job created": "Zlecenie utworzone", "Unlocked": "Odblokowano", "Could not change the lock": "Nie udało się zmienić blokady", "Line saved": "Pozycja zapisana", "Line added": "Pozycja dodana", "Could not save the line": "Nie udało się zapisać pozycji", "Delete this cost line?": "Usunąć tę pozycję kosztową?", "Line deleted": "Pozycja usunięta", "No job rows recognised yet — copy whole rows starting at column A.": "Nie rozpoznano jeszcze wierszy zleceń — skopiuj całe wiersze, zaczynając od kolumny A.", "Paste here…": "Wklej tutaj…", "yes": "tak", "+ Add invoice": "+ Dodaj fakturę", "Orpiszew + trade": "Orpiszew + handel", "Jobs with several invoices": "Zlecenia z kilkoma fakturami", "With a prepayment": "Z zaliczką", "Planned (no invoice number)": "Planowane (bez numeru faktury)", "Not tied to a job": "Bez zlecenia", "All countries": "Wszystkie kraje", "All buyers": "Wszyscy nabywcy", "JOB": "ZLECENIE", "BUYER": "NABYWCA", "COUNTRY": "KRAJ", "FROM": "ŹRÓDŁO", "INVOICES": "FAKTURY", "PREPAID NET": "ZALICZKI NETTO", "FINAL NET": "KOŃCOWE NETTO", "TOTAL NET": "RAZEM NETTO", "TOTAL GROSS": "RAZEM BRUTTO", "PERIOD": "OKRES", "Search job, invoice no, buyer": "Szukaj: zlecenie, nr faktury, nabywca", "Jobs": "Zlecenia", "(not tied to a job)": "(bez zlecenia)", "Trade": "Handel", "Orpiszew": "Orpiszew", "planned — no invoice yet": "planowana — jeszcze bez faktury", "Prepayment": "Zaliczka", "Final": "Końcowa", "No sales invoices yet — add one with “+ Add invoice” or bring in the Sprzedaż sheet with “Import from Excel”.": "Brak faktur sprzedaży — dodaj je przyciskiem „+ Dodaj fakturę” albo wczytaj arkusz Sprzedaż przez „Import z Excela”.", "No sales invoices yet — add one with “+ Add invoice”.": "Brak faktur sprzedaży — dodaj je przyciskiem „+ Dodaj fakturę”.", "Delete this sales invoice?": "Usunąć tę fakturę sprzedaży?", "Could not load sales": "Nie udało się wczytać sprzedaży", "Edit sales invoice": "Edycja faktury sprzedaży", "Add sales invoice": "Dodaj fakturę sprzedaży", "Job": "Zlecenie", "e.g. Z.410 (leave empty if none)": "np. Z.410 (puste, jeśli brak)", "FS 12/ACE/10/2026 (empty = planned)": "FS 12/ACE/10/2026 (puste = planowana)", "Final invoice": "Faktura końcowa", "Prepayment (zaliczka)": "Zaliczka", "Invoice date": "Data faktury", "Net (zł) *": "Netto (zł) *", "Gross (zł)": "Brutto (zł)", "Buyer": "Nabywca", "Country": "Kraj", "Producer (Acemark PL = Orpiszew; other = trade)": "Producent (Acemark PL = Orpiszew; inny = handel)", "Seller": "Sprzedawca", "Counted in month": "Liczona w miesiącu", "(from the date)": "(z daty)", "Add invoice": "Dodaj fakturę", "Invoice added": "Faktura dodana", "No invoice rows recognised yet — copy whole rows starting at column A.": "Nie rozpoznano jeszcze wierszy faktur — skopiuj całe wiersze, zaczynając od kolumny A.", "Producer": "Producent", "From": "Źródło", "Payroll": "Płace", "MONTH": "MIESIĄC", "TOTAL": "RAZEM", "ACTUALS": "RZECZYWISTE", "Taxes": "Podatki", "Actual": "Rzeczywiste", "Estimate — avg of last 3 months": "Szacunek — średnia z 3 ostatnich miesięcy", "Your estimate": "Własny szacunek", "Estimate (part typed)": "Szacunek (częściowo wpisany)", "future": "przyszły", "no data": "brak danych", "Saved as actuals": "Zapisano jako rzeczywiste", "Saved as an estimate": "Zapisano jako szacunek", "Could not load payroll": "Nie udało się wczytać płac", "Enter the job reference (e.g. Z.373).": "Wpisz numer zlecenia (np. Z.373).", "Year looks wrong.": "Nieprawidłowy rok.", "Job not found.": "Nie znaleziono zlecenia.", "Choose the type of cost.": "Wybierz rodzaj kosztu.", "Labour needs both hours and a rate.": "Robocizna wymaga podania godzin i stawki.", "Enter the amount.": "Wpisz kwotę.", "Enter the hours and the rate.": "Wpisz godziny i stawkę.", "Cost line not found.": "Nie znaleziono pozycji kosztowej.", "Enter the net amount.": "Wpisz kwotę netto.", "Invoice not found.": "Nie znaleziono faktury.", "Month or year looks wrong.": "Nieprawidłowy miesiąc lub rok.", "Amounts cannot be negative.": "Kwoty nie mogą być ujemne.", "To tick Actuals, enter salaries and taxes for all three departments (0 is fine).": "Aby zaznaczyć „Rzeczywiste”, wpisz wynagrodzenia i podatki dla wszystkich trzech działów (może być 0).", "Nothing to import.": "Brak danych do importu.", "Enter a rate per hour.": "Wpisz stawkę za godzinę.", "Hour must be 0–23.": "Godzina musi być z zakresu 0–23.", "Not found.": "Nie znaleziono.", "This invoice is missing its supplier or net amount in monday.": "Ta faktura nie ma w monday dostawcy lub kwoty netto.", "Admins only": "Tylko dla administratorów"};
  var I18N_RX=[["^Last sync (.*)$", "Ostatnia synchronizacja $1"], ["[(]last ([0-9]+) months[)]", "(ostatnie $1 mies.)"], ["[(]all history[)]", "(cała historia)"], ["Automatic [(]daily[)]", "Automatyczna (codzienna)"], ["^([0-9]+) invoices · ([0-9]+) new · ([0-9]+) changed$", "Faktury: $1 · nowe: $2 · zmienione: $3"], ["^failed: ", "błąd: "], ["^every day at (.*)$", "codziennie o $1"], ["[(]Poland time, last ([0-9]+) months[)]", "(czas polski, ostatnie $1 mies.)"], ["^Showing ([0-9]+) of ([0-9]+) jobs —$", "Pokazano $1 z $2 zleceń —"], ["^Showing ([0-9]+) of ([0-9]+) —$", "Pokazano $1 z $2 —"], ["^(.*) invoices · nothing to fix(.*)$", "Faktury: $1 · nic do poprawy$2"], ["^([0-9]+) changed after sync$", "Zmienione po synchronizacji: $1"], ["([0-9]+) without a month [(]not shown[)]", "bez miesiąca (pominięte): $1"], ["^([0-9]+) to fix in monday →$", "Do poprawy w monday: $1 →"], ["^(.*) invoices( ·)?$", "Faktury: $1$2"], ["^Data as of last sync: (.*)$", "Dane z ostatniej synchronizacji: $1"], ["^([0-9]{4}) · net zł$", "$1 · netto zł"], ["^(.*) — estimate, actuals not entered yet$", "$1 — szacunek, brak wartości rzeczywistych"], ["^(.*) — includes estimates$", "$1 — zawiera szacunki"], ["^fixed( · KONTO .*)?$", "stały$1"], ["^variable( · KONTO .*)?$", "zmienny$1"], ["Invoice date (.*) is not in its monday group “(.*)” — it is counted in (.*); correct the date or move the item", "Data faktury $1 nie pasuje do grupy monday „$2” — faktura jest liczona w miesiącu: $3; popraw datę lub przenieś pozycję"], ["KONTO (.*) does not match the category “(.*)” — one of them is wrong", "KONTO $1 nie zgadza się z kategorią „$2” — jedno z nich jest błędne"], ["No department and no category", "Brak działu i kategorii"], ["No department [(]Dział[)]", "Brak działu (Dział)"], ["No category [(]Podrodzaj kosztu[)]", "Brak kategorii (Podrodzaj kosztu)"], ["^This invoice was edited in monday after its Cost ID was created [(]first noticed (.*)[)][.]$", "Ta faktura została zmieniona w monday po utworzeniu Cost ID (zauważono: $1)."], ["^This invoice was edited in monday after its Cost ID was created[.]$", "Ta faktura została zmieniona w monday po utworzeniu Cost ID."], ["Reading invoices from monday", "Odczyt faktur z monday"], ["Saving to the app…", "Zapisywanie w aplikacji…"], ["Writing Cost IDs to monday…", "Zapisywanie Cost ID w monday…"], ["([0-9]+) read —", "odczytano: $1 —"], ["you can leave this page; it keeps running[.]", "możesz opuścić tę stronę — synchronizacja trwa dalej."], ["The invoices below are already up to date; the Cost IDs are now being copied into monday [(]the first time takes a while[)][.]", "Faktury poniżej są już aktualne; Cost ID są teraz kopiowane do monday (za pierwszym razem trwa to dłużej)."], ["^Jobs [(]([0-9]+) locked[)]$", "Zlecenia (zablokowane: $1)"], ["^Total [(]([0-9]+)[)]$", "Razem ($1)"], ["^(.*) zł / hour$", "$1 zł / godz."], ["^Labour cost = ", "Koszt robocizny = "], ["^Sales [(]net zł[)] — from ([0-9]+) sales invoices?$", "Sprzedaż (netto zł) — z faktur sprzedaży: $1"], ["^the sheet had (.*)$", "w arkuszu było $1"], ["^Frozen at lock[.] Invoices now add up to (.*)[.]$", "Zamrożone przy blokadzie. Faktury dają teraz razem $1."], ["^Imported ([0-9]+) job[(]s[)] with ([0-9]+) cost line[(]s[)][.]", "Zaimportowano zleceń: $1, pozycji kosztowych: $2."], [" Skipped ([0-9]+) that already existed[.]", " Pominięto już istniejących: $1."], ["^Imported ([0-9]+) invoice[(]s[)][.]", "Zaimportowano faktur: $1."], [" Skipped ([0-9]+) already here[.]", " Pominięto już istniejących: $1."], [" ([0-9]+) row[(]s[)] had no net amount and were left out[.]", " Pominięto wierszy bez kwoty netto: $1."], ["^Lock job (.*)[?] Nobody can change it until an admin unlocks it[.]$", "Zablokować zlecenie $1? Nikt nie będzie mógł go zmienić, dopóki administrator go nie odblokuje."], ["^Delete job (.*) and its ([0-9]+) cost line[(]s[)][?] This cannot be undone[.]$", "Usunąć zlecenie $1 wraz z pozycjami kosztowymi ($2)? Tej operacji nie można cofnąć."], ["^job row[(]s[)] recognised", "— tyle wierszy zleceń rozpoznano"], ["([0-9]+) already exist and will be skipped", "już istniejące (zostaną pominięte): $1"], ["· first: (.*), last: (.*)$", "· pierwszy: $1, ostatni: $2"], ["^invoice row[(]s[)] recognised", "— tyle wierszy faktur rozpoznano"], ["^Job (.*) already exists[.]$", "Zlecenie $1 już istnieje."], ["^Job (.*) is locked — an admin has to unlock it before it can be changed[.]$", "Zlecenie $1 jest zablokowane — administrator musi je odblokować, zanim będzie można je zmienić."], ["^Your role [(](.*)[)] is not allowed to do that[.]$", "Twoja rola ($1) nie ma uprawnień do tej operacji."]].map(function(r){ return [new RegExp(r[0]),r[1]]; });
  var I18N_HTML={"fp_desc": "Koszty według działu → stałe / zmienne → pozycja kosztowa, miesiąc po miesiącu — układ arkusza <b>New Performance Sheet</b>, liczony z zsynchronizowanych faktur z monday (netto). Kliknij dowolną liczbę, aby zobaczyć faktury, z których się składa.", "fp_foot_old": "", "fp_foot": "Dział pochodzi z kolumny <b>Dział</b> na tablicy, a pozycja z kolumny <b>Podrodzaj kosztu</b>. O tym, czy koszt jest stały czy zmienny, decyduje kategoria — tak jak w arkuszu: 469, 401, 412, 457, 489, 463, 464 i 467 są stałe; ich warianty <b>.V</b> i wszystkie pozostałe kategorie są zmienne (kolumna Koszt z tablicy nie jest używana). Wynagrodzenia i podatki od płac pochodzą z zakładki <b>Płace</b>; szacunki są oznaczone kursywą. Blok <b>Wynik</b> jest liczony jak w arkuszu: Sprzedaż − Materiały (RW zleceń z danego miesiąca, z Kosztów zleceń) − Koszty sprzedaży = Marża brutto; − Koszty ogólne (Biuro + płace Produkcji) = EBITDA; każda pozycja z udziałem % w sprzedaży. Aby odświeżyć faktury, uruchom <b>Synchronizuj z Monday</b> w zakładce Koszty.", "fc_desc": "Wszystkie faktury zakupowe z tablicy monday <b id=\\"fc_board\\">FAKTURY WSZYSTKIE</b>. Każda faktura przy pierwszej synchronizacji dostaje <b>Cost ID</b> (dostawca # nr faktury # netto), przechowywany tutaj i zapisywany w monday; miesiąc, w którym faktura jest liczona, wynika z jej grupy w monday. Jeśli dostawca, numer faktury lub kwota netto zostaną później zmienione, faktura zostanie oznaczona jako <b>Zmieniona</b>.", "fj_desc": "Zysk i strata na zleceniu — arkusz <b>Koszty</b>. Każde zlecenie ma pozycje kosztowe (materiał, koszty dodatkowe, malowanie, transport, odprawa celna, robocizna = godziny × stawka; po kilka na zlecenie, np. kilka faktur). Koszt całkowity = suma wszystkich kosztów; zysk = sprzedaż − koszt całkowity. Kliknij zlecenie, aby je otworzyć. Zablokowanego zlecenia nie można zmienić, dopóki administrator go nie odblokuje.", "fs_desc": "Faktury sprzedaży — arkusz <b>Sprzedaż</b>, wpisywane ręcznie do czasu podłączenia Subiekta. Jeden wiersz na <b>zlecenie</b>, zawierający wszystkie jego faktury (zaliczki i fakturę końcową); kliknij zlecenie, aby je zobaczyć. Suma netto faktur zlecenia jest jego sprzedażą w Kosztach zleceń. <b>Orpiszew</b> = producent Acemark PL; wszystko inne to <b>Handel z Polski</b>.", "fy_desc": "Łączne wynagrodzenia i łączne podatki od płac dla każdego działu, w każdym miesiącu. Wpisz kwoty i zaznacz <b>Rzeczywiste</b>, gdy są ostateczne. Do tego czasu miesiąc pokazuje <b>szacunek</b>: średnią z 3 ostatnich miesięcy z wartościami rzeczywistymi — albo własną kwotę, jeśli wpiszesz ją bez zaznaczania pola. Zaznaczenie miesiąca przesuwa szacunek na kolejny. Te liczby wypełniają wiersze Wynagrodzenia i Podatki w zakładce Wyniki.", "fy_foot": "Szare liczby w pustym polu to szacunek, który zostanie użyty. Zaznaczony miesiąc jest chroniony: odznacz <b>Rzeczywiste</b>, aby go zmienić.", "fj_import": "W arkuszu <b>Koszty</b> zaznacz wiersze zleceń od kolumny <b>A (LP.)</b> do kolumny <b>U (klient)</b>, skopiuj i wklej tutaj. Każdy wiersz stanie się zleceniem z jedną pozycją kosztową na każdą wypełnioną kolumnę; robocizna zachowuje godziny i koszt. Zlecenia, które już istnieją, są pomijane, więc można wkleić ponownie.", "fs_import": "W arkuszu <b>Sprzedaż</b> zaznacz wiersze faktur od kolumny <b>A (Data wystawienia)</b> do kolumny <b>L (Sprzedawca)</b>, skopiuj i wklej tutaj. Każdy wiersz stanie się jedną fakturą przy swoim zleceniu. Wiersze, które już tu są (ten sam numer faktury, zlecenie i kwota netto), są pomijane, więc można wkleić ponownie."};
  var I18N_TABS={"tabFinPerf": "Wyniki", "tabFinCosts": "Koszty", "tabFinJobs": "Koszty zleceń", "tabFinSales": "Sprzedaż", "tabFinPay": "Płace"};
  var I18N_VIEWS=['finPerfView','finCostsView','finJobsView','finSalesView','finPayView'];
  var EN_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var PL_MONTHS=['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  var I18N_OBS=null;
  function FLOC(){ return myLang==='pl'?'fr-FR':'en-GB'; }   // numbers only: fr-FR = '1 234,56' and, unlike pl-PL, also groups 4-digit numbers
  function TR(s){
    if(myLang!=='pl'||s==null)return s; s=String(s); var k=s.trim(); if(!k||k.length>700)return s;
    var t=I18N_PL[k]; if(t!==undefined)return s.split(k).join(t);
    var o=k; for(var i=0;i<I18N_RX.length;i++){ if(I18N_RX[i][0].test(o))o=o.replace(I18N_RX[i][0],I18N_RX[i][1]); }
    return o===k?s:s.split(k).join(o);
  }
  function T(tpl){ var a=arguments; return String(TR(tpl)).replace(/[{]([0-9]+)[}]/g,function(m,i){ return a[+i+1]; }); }
  function TH(key,en){ return (myLang==='pl'&&I18N_HTML[key]!==undefined)?I18N_HTML[key]:en; }
  function fAlert(m){ alert(TR(m)); }
  function fConfirm(m){ return confirm(TR(m)); }
  function fPrompt(m,d){ return prompt(TR(m),d); }
  function trText(n){
    var cur=n.nodeValue;
    if(n.__tr!==undefined&&cur===n.__tr){ if(myLang==='pl')return; n.nodeValue=n.__en; n.__tr=undefined; return; }
    if(myLang!=='pl')return;
    var t=TR(cur); if(t!==cur){ n.__en=cur; n.__tr=t; n.nodeValue=t; }
  }
  function trAttrs(el){
    ['placeholder','title'].forEach(function(a){
      if(!el.hasAttribute||!el.hasAttribute(a))return; var st=el.__i18n||(el.__i18n={}), cur=el.getAttribute(a), x=st[a];
      if(x&&cur===x.tr){ if(myLang==='pl')return; el.setAttribute(a,x.en); delete st[a]; return; }
      if(myLang!=='pl')return; var t=TR(cur); if(t!==cur){ st[a]={en:cur,tr:t}; el.setAttribute(a,t); }
    });
  }
  function trHtml(el){
    var k=el.getAttribute('data-th'), want=(myLang==='pl'&&I18N_HTML[k]!==undefined)?'pl':'en';
    if(el.__enH===undefined){ if(want==='en')return; el.__enH=el.innerHTML; }
    if(el.__thL===want)return; el.innerHTML=want==='pl'?I18N_HTML[k]:el.__enH; el.__thL=want;
  }
  function trTree(root){
    if(!root)return; if(root.nodeType===3){ trText(root); return; } if(root.nodeType!==1)return;
    var tag=root.tagName; if(tag==='SCRIPT'||tag==='STYLE')return;
    if(root.hasAttribute('data-th'))trHtml(root);
    root.querySelectorAll('[data-th]').forEach(trHtml);
    trAttrs(root); root.querySelectorAll('[placeholder],[title]').forEach(trAttrs);
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null), n, list=[]; while((n=w.nextNode()))list.push(n); list.forEach(trText);
  }
  function finTab(){ return String(sessionStorage.getItem('ace_tab')||'').indexOf('fin')===0; }
  function applyLang(){
    var mo=myLang==='pl'?PL_MONTHS:EN_MONTHS; for(var i=0;i<12;i++)FC_MONTHS[i]=mo[i];
    Object.keys(I18N_TABS).forEach(function(id){ var b=document.getElementById(id); if(!b)return; if(b.__en===undefined)b.__en=b.textContent; b.textContent=myLang==='pl'?I18N_TABS[id]:b.__en; });
    I18N_VIEWS.forEach(function(id){ trTree(document.getElementById(id)); });
    if(!I18N_OBS&&window.MutationObserver){
      var modal=document.getElementById('modal');
      I18N_OBS=new MutationObserver(function(ms){
        if(myLang!=='pl')return;
        ms.forEach(function(m){
          if(modal&&modal.contains(m.target)&&!finTab())return;
          if(m.type==='characterData'){ trText(m.target); return; }
          for(var i=0;i<m.addedNodes.length;i++)trTree(m.addedNodes[i]);
        });
      });
      I18N_VIEWS.concat(['modal']).forEach(function(id){ var el=document.getElementById(id); if(el)I18N_OBS.observe(el,{childList:true,subtree:true,characterData:true}); });
    }
  }
  // Remember the user's language; returns true when it changed.
  function setLang(l){ l=(String(l||'').toLowerCase()==='pl')?'pl':''; var ch=l!==myLang; myLang=l; try{ sessionStorage.setItem('ace_lang',l); }catch(e){} if(typeof FC_MONTHS!=='undefined')applyLang(); return ch; }
  // After a page reload the stored language is used at once, then checked against the server (an admin may have changed it).
  async function refreshLang(){ try{ var r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}}); if(!r.ok)return; var me=await r.json(); if(setLang(me.language)&&finTab())showTab(sessionStorage.getItem('ace_tab')); }catch(e){} }
  // ---- Fin&Ops ▸ Costs: invoices synced from monday, guarded by a Cost ID ----
  var FC={rows:[],canManage:false,slug:'',boardId:'',limit:300,timer:null};
  var FC_MONTHS=EN_MONTHS.slice();
  var FC_FLAG={changed:['Changed','#fde2e0','#b42318'],duplicate:['Duplicate','#fff1e0','#b45309'],incomplete:['Incomplete','#eeedf3','#6b6786'],konto:['KONTO','#e0effa','#0b6ea8'],unclassified:['Unclassified','#fde2e0','#b42318'],period:['Date \u2260 month','#fff1e0','#b45309'],noinvoice:['No invoice no','#eeedf3','#6b6786']};
  // Plain-language reasons an invoice should be reclassified on the board.
  function fcReasons(r){
    var out=[];
    if(r.flags.indexOf('unclassified')>=0) out.push(!r.department&&!r.subcategory?'No department and no category':(!r.department?'No department (Dzia\u0142)':'No category (Podrodzaj kosztu)'));
    if(r.flags.indexOf('period')>=0) out.push('Invoice date '+r.invoice_date+' is not in its monday group \u201c'+r.group_title+'\u201d \u2014 it is counted in '+FC_MONTHS[(r.period_month||1)-1]+'; correct the date or move the item');
    if(r.flags.indexOf('konto')>=0) out.push('KONTO '+r.konto+' does not match the category \u201c'+r.subcategory+'\u201d \u2014 one of them is wrong');
    return out;
  }
  function fcMoney(v){ return v==null?'\u2014':Number(v).toLocaleString(FLOC(),{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fcOpts(id,first,vals,keep){ var el=document.getElementById(id); var cur=keep?el.value:''; el.innerHTML='<option value="">'+first+'</option>'+vals.map(function(v){return '<option value="'+av(v[0])+'">'+esc(v[1])+'</option>';}).join(''); if(cur&&vals.some(function(v){return String(v[0])===cur;}))el.value=cur; }
  async function loadFinCosts(){
    var first=!document.getElementById('fc_sync').dataset.ready;
    if(first){ document.getElementById('fc_sync').dataset.ready='1';
      document.getElementById('fc_sync').onclick=fcSync;
      document.getElementById('fc_csv').onclick=fcCsv;
      FC.scope=sessionStorage.getItem('ace_fc_scope'); if(FC.scope===null)FC.scope='12';
      document.querySelectorAll('.fcscope').forEach(function(b){ b.onclick=function(){ FC.scope=b.getAttribute('data-m'); sessionStorage.setItem('ace_fc_scope',FC.scope); fcScopeUi(); }; });
      fcScopeUi();
      ['fc_year','fc_month','fc_company','fc_dept','fc_cat','fc_kind','fc_status','fc_flag'].forEach(function(id){ document.getElementById(id).onchange=function(){ FC.limit=300; renderFinCosts(); }; });
      document.getElementById('fc_q').oninput=function(){ FC.limit=300; renderFinCosts(); };
    }
    var d; try{ var r=await api('/api/finops/costs'); d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load'); }catch(e){ document.getElementById('fc_rows').innerHTML='<tr><td colspan="11" class="sub" style="padding:18px">'+esc(e.message||'Could not load costs')+'</td></tr>'; return; }
    FC.rows=d.rows||[]; FC.canManage=!!d.canManage; FC.slug=d.slug; FC.boardId=d.boardId;
    var years=[]; FC.rows.forEach(function(r){ if(r.period_year&&years.indexOf(r.period_year)<0)years.push(r.period_year); }); years.sort(function(a,b){return b-a;});
    fcOpts('fc_year','All years',years.map(function(y){return [y,String(y)];}),!first);
    if(first&&years.length)document.getElementById('fc_year').value=String(years[0]);
    fcOpts('fc_month','All months',FC_MONTHS.map(function(m,i){return [i+1,m];}),!first);
    var uniq=function(k){ var o={}; FC.rows.forEach(function(r){ if(r[k])o[r[k]]=1; }); return Object.keys(o).sort().map(function(v){return [v,v];}); };
    fcOpts('fc_dept','All departments',uniq('department').concat([['__none','(no department)']]),!first);
    fcOpts('fc_cat','All categories',uniq('subcategory').concat([['__none','(no category)']]),!first);
    fcOpts('fc_status','All statuses',uniq('status'),!first);
    var bl=document.getElementById('fc_board'); if(bl)bl.innerHTML='<a class="codelink" target="_blank" rel="noopener" href="https://'+av(d.slug)+'.monday.com/boards/'+av(d.boardId)+'">FAKTURY WSZYSTKIE'+(d.isTestBoard?' _TEST':'')+' \u2197</a>';
    if(FC.preset){ var ps=FC.preset; FC.preset=null; ['year','month','company','dept','cat','kind'].forEach(function(k){ var el=document.getElementById('fc_'+k); el.value=ps[k]==null?'':String(ps[k]); }); document.getElementById('fc_status').value=''; document.getElementById('fc_flag').value=ps.flag||''; document.getElementById('fc_q').value=''; FC.limit=300; FC.extra=ps.extra||null; }
    FC.lastRun=d.lastRun; FC.loaded=true; FC.auto=d.auto; fcAutoLine();
    fcLast(d.lastRun); renderFinCosts(); fcProgress(d.sync);
  }
  function fcScopeUi(){ document.querySelectorAll('.fcscope').forEach(function(b){ var on=b.getAttribute('data-m')===FC.scope; b.style.background=on?'var(--purple)':'#fff'; b.style.color=on?'#fff':'var(--ink)'; b.style.borderColor=on?'var(--purple)':'var(--line)'; }); }
  function fcAutoLine(){
    var a=FC.auto, el=document.getElementById('fc_auto'); if(!a){ el.textContent=''; return; }
    var hh=(a.hour<10?'0':'')+a.hour+':00';
    el.innerHTML='Automatic sync: '+(a.enabled?'<b>every day at '+hh+'</b> (Poland time, last '+(a.months||12)+' months)':'<b>off</b>')+(FC.canManage?' \u00b7 <a class="codelink" id="fc_auto_edit">change</a>':'');
    var e=document.getElementById('fc_auto_edit'); if(e)e.onclick=fcAutoEdit;
  }
  function fcAutoEdit(){
    var a=FC.auto||{enabled:true,hour:6}, opts=''; for(var h=0;h<24;h++)opts+='<option value="'+h+'"'+(h===a.hour?' selected':'')+'>'+(h<10?'0':'')+h+':00</option>';
    openModal('Automatic sync','<div class="fgrid"><div class="field full"><label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input type="checkbox" id="fca_on"'+(a.enabled?' checked':'')+' style="width:16px;height:16px"> Sync from Monday automatically every day</label></div>'
      +'<div class="field"><label>Time (Poland time)</label><select id="fca_hour">'+opts+'</select></div>'
      +'<div class="sub full" style="margin:0">Runs once a day at the chosen hour and refreshes the last 12 months. If the server was restarting at that moment, it runs as soon as it is back. You can still sync by hand at any time.</div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="fca_save">Save</button></div>');
    document.getElementById('fca_save').onclick=async function(){
      var r=await api('/api/finops/auto-sync',{method:'PUT',body:JSON.stringify({enabled:document.getElementById('fca_on').checked,hour:+document.getElementById('fca_hour').value})}); var d=await r.json();
      if(r.ok&&d.ok){ FC.auto=d.auto; fcAutoLine(); closeModal(); tShow('Saved'); } else tShow(d.error||'Could not save');
    };
  }
  function fcLast(run){
    var el=document.getElementById('fc_last');
    if(!run){ el.textContent='Never synced'; return; }
    el.innerHTML='Last sync '+esc(cfWhen(run.finished_at||run.started_at))+(run.started_by?' \u00b7 '+esc(run.started_by):'')
      +(run.error?'<br><span style="color:#b42318">failed: '+esc(String(run.error).slice(0,120))+'</span>':(run.finished_at?'<br>'+(run.scanned||0)+' invoices \u00b7 '+(run.added||0)+' new \u00b7 '+(run.changed||0)+' changed':''));
  }
  function fcFiltered(){
    var g=function(id){ return document.getElementById(id).value; };
    var y=g('fc_year'),m=g('fc_month'),co=g('fc_company'),de=g('fc_dept'),ca=g('fc_cat'),ki=g('fc_kind'),st=g('fc_status'),fl=g('fc_flag'),q=g('fc_q').trim().toLowerCase();
    return FC.rows.filter(function(r){
      if(y&&String(r.period_year)!==y)return false; if(m&&String(r.period_month)!==m)return false;
      if(co&&r.company!==co)return false;
      if(FC.extra&&FC.extra.cats.indexOf(r.subcategory||'(no category)')<0)return false;
      if(de&&(de==='__none'?!!r.department:r.department!==de))return false; if(ca&&(ca==='__none'?!!r.subcategory:r.subcategory!==ca))return false;
      if(ki&&fpKind(r)!==ki)return false; if(st&&r.status!==st)return false;
      if(fl==='any'&&!r.flags.length)return false; if(fl==='reclass'&&!fcNeedsReclass(r))return false; if(fl&&fl!=='any'&&fl!=='reclass'&&r.flags.indexOf(fl)<0)return false;
      if(q&&[r.supplier,r.invoice_no,r.order_ref,r.description,r.cost_id].join(' ').toLowerCase().indexOf(q)<0)return false;
      return true;
    }).sort(function(a,b){ return String(b.invoice_date||'').localeCompare(String(a.invoice_date||''))||String(a.supplier||'').localeCompare(String(b.supplier||'')); });
  }
  function renderFinCosts(){
    var ex=document.getElementById('fc_extra'); ex.style.display=FC.extra?'inline-block':'none'; if(FC.extra){ ex.textContent=FC.extra.label+' \u2715'; ex.onclick=function(){ FC.extra=null; renderFinCosts(); }; }
    var rows=fcFiltered(), sum=function(k,f){ return rows.reduce(function(s,r){ return s+((!f||f(r))?(r[k]||0):0); },0); };
    var unpaid=function(r){ return r.status!=='Opłacona'; }, warn=rows.filter(function(r){return r.flags.length;}).length, rcl=rows.filter(fcNeedsReclass).length, chg=rows.filter(function(r){return r.flags.indexOf('changed')>=0;}).length;
    document.getElementById('fc_stats').innerHTML='<div class="stat"><div class="v">'+rows.length.toLocaleString(FLOC())+'</div><div class="l">Invoices</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sum('net'))+' zł</div><div class="l">Net total</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sum('gross',unpaid))+' zł</div><div class="l">Gross not yet paid</div></div>'
      +'<div class="stat"><div class="v" style="color:'+(chg?'#b42318':'inherit')+'">'+chg+'</div><div class="l">Changed after sync</div></div>'
      +'<div class="stat"><div class="v" style="color:'+(rcl?'#b45309':'inherit')+'">'+rcl+'</div><div class="l">To fix in monday</div></div>'
      +'<div class="stat"><div class="v">'+warn+'</div><div class="l">With any warning</div></div>';
    var tb=document.getElementById('fc_rows'), shown=rows.slice(0,FC.limit);
    tb.innerHTML=shown.length?shown.map(function(r){
      var flags=r.flags.map(function(f){ var m=FC_FLAG[f]; return '<span class="pill" data-fc="'+(f==='changed'?'changed':'')+'" data-id="'+av(r.id)+'" style="background:'+m[1]+';color:'+m[2]+';margin-left:4px'+(f==='changed'?';cursor:pointer':'')+'">'+m[0]+'</span>'; }).join('');
      var url='https://'+FC.slug+'.monday.com/boards/'+FC.boardId+'/pulses/'+r.monday_item_id;
      return '<tr'+(r.flags.indexOf('changed')>=0?' style="background:#fff5f4"':'')+'><td style="white-space:nowrap">'+esc(r.invoice_date||r.group_title||'\u2014')+'</td><td><a target="_blank" rel="noopener" href="'+av(url)+'" title="Open this invoice in monday" style="font-weight:700;color:var(--ink);text-decoration:none">'+esc(r.supplier||'\u2014')+'</a><div class="sub" style="margin:0">'+esc(r.description||'')+'</div></td><td class="mono" style="font-size:12px">'+esc(r.invoice_no||'\u2014')+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+fcMoney(r.net)+'</td><td style="text-align:right;white-space:nowrap;color:var(--muted)">'+fcMoney(r.gross)+'</td>'
        +'<td>'+esc(r.subcategory||'\u2014')+'<div class="sub" style="margin:0">'+fpKind(r)+(r.konto?' \u00b7 KONTO '+esc(r.konto):'')+'</div>'+fcReasons(r).map(function(x){ return '<div style="font-size:11px;color:#b45309;max-width:260px;white-space:normal">\u26a0 '+esc(x)+'</div>'; }).join('')+(fcNeedsReclass(r)?'<a class="pobtn" style="display:inline-block;margin-top:5px;padding:4px 10px;font-size:11px;text-decoration:none;color:#b45309;border-color:#f5d9a8" target="_blank" rel="noopener" href="'+av(url)+'">Open in monday to fix \u2197</a>':'')+'</td><td>'+esc(r.department||'\u2014')+'</td><td>'+esc(r.status||'\u2014')+'</td><td>'+esc(r.order_ref||'')+'</td>'
        +'<td class="mono" style="font-size:11px;color:var(--muted);max-width:230px;overflow-wrap:anywhere">'+esc(r.cost_id||'')+flags+'</td>'
        +'<td><a class="codelink" target="_blank" rel="noopener" href="'+av(url)+'">monday \u2197</a></td></tr>';
    }).join(''):'<tr><td colspan="11" class="sub" style="padding:18px">'+(FC.rows.length?'No invoices match these filters.':'No costs yet \u2014 click \u201cSync from Monday\u201d.')+'</td></tr>';
    tb.querySelectorAll('[data-fc="changed"]').forEach(function(el){ el.onclick=function(){ fcShowChange(el.getAttribute('data-id')); }; });
    var more=document.getElementById('fc_more');
    if(rows.length>shown.length){ more.innerHTML='Showing '+shown.length+' of '+rows.length+' \u2014 <a class="codelink" id="fc_showall">show all</a>'; document.getElementById('fc_showall').onclick=function(){ FC.limit=100000; renderFinCosts(); }; } else more.textContent='';
  }
  function fcCsv(){
    var rows=fcFiltered(), q=function(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; };
    var L=[['Date','Supplier','Invoice no','Net','Gross','Department','Category','Fixed/variable','KONTO','Status','Order','Description','Warnings','What to fix','Cost ID','Monday link'].map(TR).map(q).join(',')];
    rows.forEach(function(r){ L.push([r.invoice_date||'',r.supplier,r.invoice_no,r.net==null?'':r.net.toFixed(2),r.gross==null?'':r.gross.toFixed(2),r.department,r.subcategory,fpKind(r),r.konto,r.status,r.order_ref,r.description,r.flags.join(' | '),fcReasons(r).join(' | '),r.cost_id,'https://'+FC.slug+'.monday.com/boards/'+FC.boardId+'/pulses/'+r.monday_item_id].map(q).join(',')); });
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([String.fromCharCode(65279)+L.join(String.fromCharCode(13,10))],{type:'text/csv;charset=utf-8'})); a.download='Costs '+(document.getElementById('fc_year').value||'all')+(document.getElementById('fc_flag').value?' '+document.getElementById('fc_flag').value:'')+'.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  function fcShowChange(id){
    var r=FC.rows.filter(function(x){return x.id===id;})[0]; if(!r)return;
    var line=function(label,was,now){ var diff=String(was==null?'':was)!==String(now==null?'':now); return '<div class="drow"><dt>'+label+'</dt><dd>'+(diff?'<span style="text-decoration:line-through;color:var(--muted)">'+esc(was==null?'\u2014':was)+'</span> \u2192 <b style="color:#b42318">'+esc(now==null||now===''?'\u2014':now)+'</b>':esc(now==null?'\u2014':now))+'</dd></div>'; };
    var html='<div style="padding:18px 22px"><p class="sub" style="margin:0 0 12px">This invoice was edited in monday after its Cost ID was created'+(r.changed_at?' (first noticed '+esc(cfWhen(r.changed_at))+')':'')+'.</p>'
      +line('Supplier',r.orig_supplier,r.supplier)+line('Invoice no',r.orig_invoice_no,r.invoice_no)+line('Net',r.orig_net==null?null:fcMoney(r.orig_net),r.net==null?null:fcMoney(r.net))
      +'<div class="drow"><dt>Cost ID</dt><dd class="mono" style="font-size:12px">'+esc(r.cost_id||'')+'</dd></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Close</button>'+(FC.canManage?'<button class="save" id="fcAccept">Accept as correct</button>':'')+'</div>';
    openModal('Invoice changed after sync',html);
    var b=document.getElementById('fcAccept'); if(b)b.onclick=async function(){
      if(!fConfirm('Accept the current monday values as correct? A new Cost ID is created and written to monday.'))return;
      b.disabled=true; var rr=await api('/api/finops/costs/'+encodeURIComponent(id)+'/accept',{method:'POST'}); var d=await rr.json();
      if(rr.ok&&d.ok){ closeModal(); tShow('Accepted'); loadFinCosts(); } else { tShow(d.error||'Could not accept'); b.disabled=false; }
    };
  }
  async function fcSync(){
    var btn=document.getElementById('fc_sync'); btn.disabled=true;
    var d; try{ var r=await api('/api/finops/costs/sync',{method:'POST',body:JSON.stringify({months:FC.scope||null})}); d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not start'); }catch(e){ tShow(e.message||'Could not start the sync'); btn.disabled=false; return; }
    fcProgress(d.sync);
  }
  function fcProgress(s){
    var box=document.getElementById('fc_progress'), btn=document.getElementById('fc_sync');
    if(FC.timer){ clearTimeout(FC.timer); FC.timer=null; }
    if(!s||(!s.running&&!s.error)){ box.style.display='none'; btn.disabled=false; return; }
    box.style.display='flex';
    if(s.running){
      btn.disabled=true; box.className='podecide';
      document.getElementById('fc_progress_msg').innerHTML='<b>Syncing\u2026</b><small>'+esc(s.phase)+(s.total?' '+s.done+' / '+s.total:(s.done?' '+s.done+' read':''))+' \u2014 you can leave this page; it keeps running.'+(/^Writing/.test(s.phase)?' The invoices below are already up to date; the Cost IDs are now being copied into monday (the first time takes a while).':'')+'</small>';
      FC.timer=setTimeout(async function(){ if(sessionStorage.getItem('ace_tab')!=='fincosts')return; try{ var d=await (await api('/api/finops/costs/sync')).json(); if(d.sync&&d.sync.running){ var w=/^Writing/.test(d.sync.phase); if(w&&!FC.shownSaved){ FC.shownSaved=true; loadFinCosts(); } else fcProgress(d.sync); } else { FC.shownSaved=false; loadFinCosts(); } }catch(e){} },2500);
    } else { btn.disabled=false; box.className='podecide bad'; document.getElementById('fc_progress_msg').innerHTML='<b>Last sync failed</b><small>'+esc(s.error)+'</small>'; }
  }
  // ---- Fin&Ops ▸ Payroll: salaries + tax per department per month; estimate until Actuals is ticked ----
  var FY={months:[],now:null,depts:['Office','Sales','Production']};
  async function fyFetch(){ var r=await api('/api/finops/payroll'); var d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load payroll'); FY.months=d.months||[]; FY.now=d.now; if(d.departments)FY.depts=d.departments; return d; }
  function fyMonth(y,m){ return FY.months.filter(function(x){ return x.year===y&&x.month===m; })[0]||null; }
  async function loadFinPay(){
    var sel=document.getElementById('fy_year'), first=!sel.dataset.ready;
    if(first){ sel.dataset.ready='1'; sel.onchange=renderFinPay; }
    try{ await fyFetch(); }catch(e){ document.getElementById('fy_rows').innerHTML='<tr><td colspan="11" class="sub" style="padding:18px">'+esc(e.message)+'</td></tr>'; return; }
    var cy=FY.now?FY.now.year:new Date().getFullYear(), ys={}; ys[cy]=1; ys[cy-1]=1; FY.months.forEach(function(x){ ys[x.year]=1; });
    var cur=sel.value; sel.innerHTML=Object.keys(ys).sort().reverse().map(function(y){ return '<option value="'+y+'">'+y+'</option>'; }).join(''); sel.value=(cur&&ys[cur])?cur:(FY.preYear&&ys[FY.preYear]?String(FY.preYear):String(cy)); FY.preYear=null;
    renderFinPay();
  }
  var FY_ST={actual:['Actual','#dcfce7','#15803d'],forecast:['Estimate \u2014 avg of last 3 months','#fff1e0','#b45309'],manual:['Your estimate','#e0effa','#0b6ea8'],mixed:['Estimate (part typed)','#e0effa','#0b6ea8']};
  function renderFinPay(){
    var y=+document.getElementById('fy_year').value, h='';
    for(var m=1;m<=12;m++){
      var M=fyMonth(y,m), fut=FY.now&&(y*12+m>FY.now.year*12+FY.now.month), act=!!(M&&M.actual), sts={}, total=0, cells='';
      FY.depts.forEach(function(d){ ['salaries','taxes'].forEach(function(k){ var c=M?M.depts[d]:null, v=c?c[k]:null, st=c?c[k+'Status']:null; if(st)sts[st]=1; if(v!=null)total+=v;
        cells+='<td><input class="tinput" inputmode="decimal" data-d="'+d+'" data-k="'+k+'" value="'+((st==='actual'||st==='manual')&&v!=null?av(v):'')+'"'+(st==='forecast'&&v!=null?' placeholder="\u2248 '+av(fcMoney(v))+'"':'')+(act?' disabled':'')+'></td>'; }); });
      var keys=Object.keys(sts), st=act?'actual':(keys.length>1?'mixed':(keys[0]||'')), P=FY_ST[st];
      h+='<tr data-m="'+m+'"'+(fut?' class="fut"':'')+'><td><b>'+FC_MONTHS[m-1]+'</b></td>'+cells+'<td class="r" style="font-weight:700'+(act?'':';font-style:italic;color:#b45309')+'">'+(total?fcMoney(total):'')+'</td>'
        +'<td>'+(P?'<span class="pill" style="background:'+P[1]+';color:'+P[2]+'">'+P[0]+'</span>':'<span class="sub" style="margin:0">'+(fut?'future':'no data')+'</span>')+'</td>'
        +'<td style="text-align:center"><input type="checkbox" class="fy_act" style="width:16px;height:16px"'+(act?' checked':'')+'></td><td><button class="pobtn fy_save" style="padding:5px 12px;font-size:12px">Save</button></td></tr>';
    }
    var tb=document.getElementById('fy_rows'); tb.innerHTML=h;
    tb.querySelectorAll('tr').forEach(function(tr){
      var cb=tr.querySelector('.fy_act'), was=cb.checked;
      cb.onchange=function(){ if(was&&!cb.checked)tr.querySelectorAll('input.tinput').forEach(function(i){ i.disabled=false; }); };
      tr.querySelector('.fy_save').onclick=async function(){
        var deps={}; tr.querySelectorAll('input.tinput').forEach(function(i){ var d=i.getAttribute('data-d'); (deps[d]||(deps[d]={}))[i.getAttribute('data-k')]=i.value; });
        var r=await api('/api/finops/payroll',{method:'PUT',body:JSON.stringify({year:y,month:+tr.getAttribute('data-m'),actual:cb.checked,departments:deps})}); var d=await r.json();
        if(r.ok&&d.ok){ tShow(cb.checked?'Saved as actuals':'Saved as an estimate'); loadFinPay(); } else fAlert(d.error||'Could not save');
      };
    });
  }
  // Payroll of one department for a year: [12] values and whether each is an estimate.
  function fyYear(year,dept,k){ var v=[0,0,0,0,0,0,0,0,0,0,0,0], est=[], has=false; for(var m=1;m<=12;m++){ var M=fyMonth(year,m), c=M?M.depts[dept]:null; if(c&&c[k]!=null){ v[m-1]=c[k]; has=true; est[m-1]=c[k+'Status']!=='actual'; } } return {v:v,est:est,has:has}; }
  // ---- Fin&Ops ▸ Sales (sheet "Sprzedaż"): invoices entered by hand, shown one row per job ----
  var FS={inv:[],canManage:false,open:{},limit:300,preset:null};
  var FS_COUNTRY={UK:'UK',DE:'Germany',PL:'Poland',ES:'Spain',NL:'Netherlands'};
  function fsCountry(c){ return TR(c?(FS_COUNTRY[c]||c):'(no country)'); }
  async function fsFetch(){ var r=await api('/api/finops/sales'); var d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load sales'); FS.inv=d.invoices||[]; FS.canManage=!!d.canManage; return d; }
  async function loadFinSales(){
    var first=!document.getElementById('fs_new').dataset.ready;
    if(first){ document.getElementById('fs_new').dataset.ready='1';
      document.getElementById('fs_new').onclick=function(){ fsEdit(null); };
      document.getElementById('fs_csv').onclick=fsCsv; document.getElementById('fs_import').onclick=fsImport;
      ['fs_year','fs_month','fs_channel','fs_country','fs_buyer','fs_state'].forEach(function(id){ document.getElementById(id).onchange=function(){ FS.limit=300; renderFinSales(); }; });
      document.getElementById('fs_q').oninput=function(){ FS.limit=300; renderFinSales(); };
    }
    try{ await fsFetch(); }catch(e){ document.getElementById('fs_rows').innerHTML='<tr><td colspan="10" class="sub" style="padding:18px">'+esc(e.message)+'</td></tr>'; return; }
    document.getElementById('fs_import').style.display=FS.canManage?'':'none';
    var years=[]; FS.inv.forEach(function(r){ if(r.period_year&&years.indexOf(r.period_year)<0)years.push(r.period_year); }); years.sort(function(a,b){return b-a;});
    fcOpts('fs_year','All years',years.map(function(y){return [y,String(y)];}),!first);
    if(first&&years.length)document.getElementById('fs_year').value=String(years[0]);
    fcOpts('fs_month','All months',FC_MONTHS.map(function(m,i){return [i+1,m];}),!first);
    var u=function(k){ var o={}; FS.inv.forEach(function(r){ if(r[k])o[r[k]]=1; }); return Object.keys(o).sort(function(a,b){return a.localeCompare(b);}); };
    fcOpts('fs_country','All countries',u('country').map(function(c){return [c,fsCountry(c)];}),!first);
    fcOpts('fs_buyer','All buyers',u('buyer').map(function(v){return [v,v];}),!first);
    if(FS.preset){ var ps=FS.preset; FS.preset=null; ['year','month','channel','country','buyer','state'].forEach(function(k){ document.getElementById('fs_'+k).value=ps[k]==null?'':String(ps[k]); }); document.getElementById('fs_q').value=ps.q||''; FS.open={}; if(ps.q)FS.open[String(ps.q).replace(/\s/g,'').toUpperCase()]=true; }
    renderFinSales();
  }
  function fsFilteredInv(){
    var g=function(id){ return document.getElementById(id).value; };
    var y=g('fs_year'),m=g('fs_month'),ch=g('fs_channel'),co=g('fs_country'),bu=g('fs_buyer'),st=g('fs_state'),q=g('fs_q').trim().toLowerCase();
    return FS.inv.filter(function(r){
      if(y&&String(r.period_year)!==y)return false; if(m&&String(r.period_month)!==m)return false; if(ch&&r.channel!==ch)return false; if(co&&r.country!==co)return false; if(bu&&r.buyer!==bu)return false;
      if(st==='planned'&&r.invoice_no)return false; if(st==='nojob'&&r.job_key)return false;
      if(q&&[r.job_ref,r.invoice_no,r.buyer,r.note].join(' ').toLowerCase().indexOf(q)<0)return false;
      return true;
    });
  }
  function fsGroups(){
    var st=document.getElementById('fs_state').value, map={}, order=[];
    fsFilteredInv().forEach(function(r){ var k=r.job_key||'~'; var G=map[k]; if(!G){ G=map[k]={key:k,ref:r.job_key?r.job_ref:'(not tied to a job)',inv:[],net:0,gross:0,prepaid:0,final:0}; order.push(G); }
      G.inv.push(r); G.net+=r.net; G.gross+=(r.gross||0); if(r.kind==='prepaid')G.prepaid+=r.net; else G.final+=r.net; });
    if(st==='multi')order=order.filter(function(G){return G.key!=='~'&&G.inv.length>1;}); if(st==='prepaid')order=order.filter(function(G){return G.prepaid!==0;});
    return order.sort(function(a,b){ if(a.key==='~')return 1; if(b.key==='~')return -1; return String(a.ref).localeCompare(String(b.ref),undefined,{numeric:true,sensitivity:'base'}); });
  }
  function fsUniq(G,k,f){ var o={}; G.inv.forEach(function(r){ var v=f?f(r[k]):r[k]; if(v)o[v]=1; }); var a=Object.keys(o); return a.length>2?a.slice(0,2).join(', ')+' +'+(a.length-2):a.join(', '); }
  function fsPeriod(G){ var a=G.inv.map(function(r){ return r.period_year&&r.period_month?r.period_year*100+r.period_month:null; }).filter(Boolean).sort(); if(!a.length)return ''; var f=function(v){ return FC_MONTHS[v%100-1].slice(0,3)+' '+Math.floor(v/100); }; return a[0]===a[a.length-1]?f(a[0]):f(a[0])+' \u2013 '+f(a[a.length-1]); }
  function renderFinSales(){
    var groups=fsGroups(), inv=[]; groups.forEach(function(G){ inv=inv.concat(G.inv); });
    var sum=function(f){ return inv.reduce(function(s,r){ return s+(f(r)||0); },0); };
    document.getElementById('fs_stats').innerHTML='<div class="stat"><div class="v">'+groups.filter(function(G){return G.key!=='~';}).length.toLocaleString(FLOC())+'</div><div class="l">Jobs</div></div>'
      +'<div class="stat"><div class="v">'+inv.length.toLocaleString(FLOC())+'</div><div class="l">Invoices</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sum(function(r){return r.net;}))+' z\u0142</div><div class="l">Net total</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sum(function(r){return r.channel==='production'?r.net:0;}))+' z\u0142</div><div class="l">Sales from Orpiszew</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sum(function(r){return r.channel==='trade'?r.net:0;}))+' z\u0142</div><div class="l">Trade from Poland</div></div>';
    var shown=groups.slice(0,FS.limit), h='';
    shown.forEach(function(G){
      var open=!!FS.open[G.key];
      h+='<tr class="g" data-g="'+av(G.key)+'"><td>'+(open?'\u25be ':'\u25b8 ')+esc(G.ref)+'</td><td>'+esc(fsUniq(G,'buyer'))+'</td><td>'+esc(fsUniq(G,'country',fsCountry))+'</td><td>'+esc(fsUniq(G,'channel',function(c){return TR(c==='production'?'Orpiszew':'Trade');}))+'</td>'
        +'<td class="r">'+G.inv.length+'</td><td class="r">'+fjNum(G.prepaid)+'</td><td class="r">'+fjNum(G.final)+'</td><td class="r" style="font-weight:700">'+(fjNum(G.net)||'0.00')+'</td><td class="r" style="color:var(--muted)">'+fjNum(G.gross)+'</td><td>'+esc(fsPeriod(G))+'</td></tr>';
      if(open) G.inv.slice().sort(function(a,b){ return String(a.invoice_date||'9').localeCompare(String(b.invoice_date||'9')); }).forEach(function(r){
        h+='<tr class="i"><td>'+(r.invoice_no?esc(r.invoice_no):'<i style="color:#b45309">planned \u2014 no invoice yet</i>')+'<div class="sub" style="margin:0">'+esc(r.invoice_date||'')+'</div></td><td>'+esc(r.buyer||'')+'</td><td>'+esc(fsCountry(r.country))+'</td><td>'+esc(r.producer||'\u2014')+'</td>'
          +'<td class="r"><span class="pill" style="background:'+(r.kind==='prepaid'?'#fff1e0;color:#b45309':'#dcfce7;color:#15803d')+'">'+(r.kind==='prepaid'?'Prepayment':'Final')+'</span></td><td class="r">'+(r.kind==='prepaid'?fcMoney(r.net):'')+'</td><td class="r">'+(r.kind==='final'?fcMoney(r.net):'')+'</td><td class="r">'+fcMoney(r.net)+'</td><td class="r" style="color:var(--muted)">'+fcMoney(r.gross)+'</td>'
          +'<td>'+esc(r.period_month?FC_MONTHS[r.period_month-1].slice(0,3)+' '+(r.period_year||''):'')+(r.note?' \u00b7 '+esc(r.note):'')+' \u00b7 <a class="codelink" data-fse="'+av(r.id)+'">edit</a> \u00b7 <a class="codelink" style="color:#b42318" data-fsd="'+av(r.id)+'">delete</a></td></tr>'; });
    });
    var tb=document.getElementById('fs_rows');
    tb.innerHTML=h||'<tr><td colspan="10" class="sub" style="padding:18px">'+(FS.inv.length?'No invoices match these filters.':'No sales invoices yet \u2014 add one with \u201c+ Add invoice\u201d'+(FS.canManage?' or bring in the Sprzeda\u017c sheet with \u201cImport from Excel\u201d.':'.'))+'</td></tr>';
    tb.querySelectorAll('tr.g').forEach(function(tr){ tr.onclick=function(){ var k=tr.getAttribute('data-g'); FS.open[k]=!FS.open[k]; renderFinSales(); }; });
    tb.querySelectorAll('[data-fse]').forEach(function(a){ a.onclick=function(e){ e.stopPropagation(); fsEdit(a.getAttribute('data-fse')); }; });
    tb.querySelectorAll('[data-fsd]').forEach(function(a){ a.onclick=async function(e){ e.stopPropagation(); if(!fConfirm('Delete this sales invoice?'))return; var r=await api('/api/finops/sales/'+encodeURIComponent(a.getAttribute('data-fsd')),{method:'DELETE'}); var d=await r.json(); if(r.ok&&d.ok){ tShow('Deleted'); loadFinSales(); } else tShow(d.error||'Could not delete'); }; });
    var more=document.getElementById('fs_more');
    if(groups.length>shown.length){ more.innerHTML='Showing '+shown.length+' of '+groups.length+' jobs \u2014 <a class="codelink" id="fs_all">show all</a>'; document.getElementById('fs_all').onclick=function(){ FS.limit=100000; renderFinSales(); }; } else more.textContent='';
  }
  function fsEdit(id){
    var r=id?FS.inv.filter(function(x){return x.id===id;})[0]:null; if(id&&!r)return;
    var v=function(k){ return r&&r[k]!=null?r[k]:''; }, dl=function(k){ var o={}; FS.inv.forEach(function(x){ if(x[k])o[x[k]]=1; }); return Object.keys(o).sort().map(function(c){ return '<option value="'+av(c)+'">'; }).join(''); };
    var mo='<option value="">(from the date)</option>'+FC_MONTHS.map(function(m,i){ return '<option value="'+(i+1)+'"'+(r&&r.period_month===i+1?' selected':'')+'>'+m+'</option>'; }).join('');
    openModal(id?'Edit sales invoice':'Add sales invoice','<div class="fgrid">'
      +'<div class="field"><label>Job</label><input id="fse_job" class="tinput" value="'+av(v('job_ref'))+'" placeholder="e.g. Z.410 (leave empty if none)" list="fse_jobs"><datalist id="fse_jobs">'+dl('job_ref')+'</datalist></div>'
      +'<div class="field"><label>Invoice no</label><input id="fse_no" class="tinput" value="'+av(v('invoice_no'))+'" placeholder="FS 12/ACE/10/2026 (empty = planned)"></div>'
      +'<div class="field"><label>Type</label><select id="fse_kind"><option value="final"'+(r&&r.kind==='prepaid'?'':' selected')+'>Final invoice</option><option value="prepaid"'+(r&&r.kind==='prepaid'?' selected':'')+'>Prepayment (zaliczka)</option></select></div>'
      +'<div class="field"><label>Invoice date</label><input id="fse_date" class="tinput" type="date" value="'+av(v('invoice_date'))+'"></div>'
      +'<div class="field"><label>Net (z\u0142) *</label><input id="fse_net" class="tinput" inputmode="decimal" value="'+av(v('net'))+'"></div>'
      +'<div class="field"><label>Gross (z\u0142)</label><input id="fse_gross" class="tinput" inputmode="decimal" value="'+av(v('gross'))+'"></div>'
      +'<div class="field"><label>Buyer</label><input id="fse_buyer" class="tinput" value="'+av(v('buyer'))+'" list="fse_buyers"><datalist id="fse_buyers">'+dl('buyer')+'</datalist></div>'
      +'<div class="field"><label>Country</label><input id="fse_country" class="tinput" value="'+av(v('country'))+'" placeholder="UK / DE / PL / ES / NL" list="fse_countries"><datalist id="fse_countries"><option value="UK"><option value="DE"><option value="PL"><option value="ES"><option value="NL"></datalist></div>'
      +'<div class="field"><label>Producer (Acemark PL = Orpiszew; other = trade)</label><input id="fse_prod" class="tinput" value="'+av(r?v('producer'):'Acemark PL')+'" list="fse_prods"><datalist id="fse_prods"><option value="Acemark PL"><option value="Eko-okna"></datalist></div>'
      +'<div class="field"><label>Seller</label><input id="fse_seller" class="tinput" value="'+av(r?v('seller'):'Acemark PL')+'"></div>'
      +'<div class="field"><label>Counted in month</label><select id="fse_month">'+mo+'</select></div>'
      +'<div class="field"><label>Year</label><input id="fse_year" class="tinput" type="number" value="'+av(v('period_year'))+'" placeholder="(from the date)"></div>'
      +'<div class="field full"><label>Note</label><input id="fse_note" class="tinput" value="'+av(v('note'))+'"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="fse_save">'+(id?'Save':'Add invoice')+'</button></div>');
    document.getElementById('fse_save').onclick=async function(){ var g=function(x){ return document.getElementById(x).value; };
      var b={job_ref:g('fse_job'),invoice_no:g('fse_no'),kind:g('fse_kind'),invoice_date:g('fse_date'),net:g('fse_net'),gross:g('fse_gross'),buyer:g('fse_buyer'),country:g('fse_country'),producer:g('fse_prod'),seller:g('fse_seller'),period_month:g('fse_month'),period_year:g('fse_year'),note:g('fse_note')};
      var rr=await api(id?'/api/finops/sales/'+encodeURIComponent(id):'/api/finops/sales',{method:id?'PUT':'POST',body:JSON.stringify(b)}); var d=await rr.json();
      if(rr.ok&&d.ok){ closeModal(); tShow(id?'Saved':'Invoice added'); if(b.job_ref)FS.open[b.job_ref.replace(/\s/g,'').toUpperCase()]=true; loadFinSales(); } else tShow(d.error||'Could not save'); };
  }
  function fsCsv(){
    var q=function(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; }, L=[['Job','Invoice no','Type','Invoice date','Month','Year','Producer','Buyer','Net','Gross','Country','From','Note','Seller'].map(TR).map(q).join(',')];
    fsGroups().forEach(function(G){ G.inv.forEach(function(r){ L.push([r.job_ref,r.invoice_no,r.kind,r.invoice_date,r.period_month?FC_MONTHS[r.period_month-1]:'',r.period_year,r.producer,r.buyer,r.net.toFixed(2),r.gross==null?'':r.gross.toFixed(2),r.country,r.channel==='production'?'Orpiszew':'Trade',r.note,r.seller].map(q).join(',')); }); });
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([String.fromCharCode(65279)+L.join(String.fromCharCode(13,10))],{type:'text/csv;charset=utf-8'})); a.download='Sales.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  // Paste the Sprzedaż rows from Excel (columns A..L): date, invoice no, job, month, year, producer, buyer, net, gross, country, note, seller.
  function fsParsePaste(text){
    var out=[]; String(text).split(String.fromCharCode(10)).forEach(function(ln){ var c=ln.replace(String.fromCharCode(13),'').split(String.fromCharCode(9)); if(c.length<8)return; if(/^data wyst/i.test((c[0]||'').trim())||/^total$/i.test((c[0]||'').trim()))return; if(!(c[7]||'').trim())return;
      out.push({date:c[0],invoice_no:c[1],job:c[2],month:c[3],year:c[4],producer:c[5],buyer:c[6],net:c[7],gross:c[8],country:c[9],note:c[10],seller:c[11]}); });
    return out;
  }
  function fsImport(){
    openModal('Import from Excel','<div style="padding:18px 22px"><p class="sub" style="margin:0 0 10px">'+TH('fs_import','In the <b>Sprzeda\u017c</b> sheet select the invoice rows from column <b>A (Data wystawienia)</b> to column <b>L (Sprzedawca)</b>, copy, and paste here. Each row becomes one invoice under its job. Lines already here (same invoice number, job and net) are skipped, so it is safe to paste again.')+'</p>'
      +'<textarea id="fsp_text" style="width:100%;min-height:200px;border:1px solid var(--line);border-radius:10px;padding:10px;font:12px ui-monospace,Menlo,monospace" placeholder="Paste here\u2026"></textarea><div class="sub" id="fsp_info" style="margin:8px 0 0"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="fsp_go" disabled>Import</button></div>');
    var ta=document.getElementById('fsp_text'), go=document.getElementById('fsp_go'), rows=[];
    ta.oninput=function(){ rows=fsParsePaste(ta.value); document.getElementById('fsp_info').innerHTML=rows.length?('<b>'+rows.length+'</b> invoice row(s) recognised \u00b7 first: '+esc(rows[0].invoice_no||rows[0].job||'')+', last: '+esc(rows[rows.length-1].invoice_no||rows[rows.length-1].job||'')):'No invoice rows recognised yet \u2014 copy whole rows starting at column A.'; go.disabled=!rows.length; };
    go.onclick=async function(){ go.disabled=true; var r=await api('/api/finops/sales/import',{method:'POST',body:JSON.stringify({rows:rows})}); var d=await r.json();
      if(r.ok&&d.ok){ closeModal(); fAlert('Imported '+d.added+' invoice(s).'+(d.skipped?' Skipped '+d.skipped+' already here.':'')+(d.invalid?' '+d.invalid+' row(s) had no net amount and were left out.':'')); loadFinSales(); } else { tShow(d.error||'Import failed'); go.disabled=false; } };
  }
  // ---- Fin&Ops ▸ Job costs (sheet "Koszty"): P&L per job, cost lines, admin lock ----
  var FJ={jobs:[],kinds:[],rate:45,canManage:false,limit:400};
  function fjPct(v){ return v==null?'':(v*100).toLocaleString(FLOC(),{minimumFractionDigits:1,maximumFractionDigits:1})+'%'; }
  function fjNum(v){ return (v==null||Math.abs(v)<0.005)?'':Number(v).toLocaleString(FLOC(),{minimumFractionDigits:2,maximumFractionDigits:2}); }
  async function loadFinJobs(){
    var first=!document.getElementById('fj_new').dataset.ready;
    if(first){ document.getElementById('fj_new').dataset.ready='1';
      document.getElementById('fj_new').onclick=function(){ fjOpen(null); };
      document.getElementById('fj_csv').onclick=fjCsv; document.getElementById('fj_import').onclick=fjImport;
      ['fj_year','fj_month','fj_cust','fj_state'].forEach(function(id){ document.getElementById(id).onchange=function(){ FJ.limit=400; renderFinJobs(); }; });
      document.getElementById('fj_q').oninput=function(){ FJ.limit=400; renderFinJobs(); };
    }
    var d; try{ var r=await api('/api/finops/jobs'); d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load'); }catch(e){ document.getElementById('fj_rows').innerHTML='<tr><td class="sub" style="padding:18px">'+esc(e.message||'Could not load job costs')+'</td></tr>'; return; }
    FJ.jobs=d.jobs||[]; FJ.kinds=d.kinds||[]; FJ.rate=d.labourRate; FJ.canManage=!!d.canManage;
    document.getElementById('fj_import').style.display=FJ.canManage?'':'none';
    var years=[]; FJ.jobs.forEach(function(j){ if(j.period_year&&years.indexOf(j.period_year)<0)years.push(j.period_year); }); years.sort(function(a,b){return b-a;});
    fcOpts('fj_year','All years',years.map(function(y){return [y,String(y)];}).concat([['__none','(no year)']]),!first);
    fcOpts('fj_month','All months',FC_MONTHS.map(function(m,i){return [i+1,m];}),!first);
    var cu={}; FJ.jobs.forEach(function(j){ if(j.customer)cu[j.customer]=1; });
    fcOpts('fj_cust','All customers',Object.keys(cu).sort(function(a,b){return a.localeCompare(b);}).map(function(v){return [v,v];}),!first);
    if(FJ.preset){ var jp=FJ.preset; FJ.preset=null; document.getElementById('fj_year').value=String(jp.year); document.getElementById('fj_month').value=String(jp.month||''); document.getElementById('fj_cust').value=''; document.getElementById('fj_state').value=''; document.getElementById('fj_q').value=''; FJ.limit=400; }
    fjRateLine(); renderFinJobs();
  }
  function fjRateLine(){
    var el=document.getElementById('fj_rate');
    el.innerHTML='Default labour rate: <b>'+fcMoney(FJ.rate)+' z\u0142 / hour</b>'+(FJ.canManage?' \u00b7 <a class="codelink" id="fj_rate_edit">change</a>':'');
    var e=document.getElementById('fj_rate_edit'); if(e)e.onclick=async function(){ var v=fPrompt('Default labour rate (z\u0142 per hour) \u2014 used when a new labour line is added:',String(FJ.rate)); if(v==null)return;
      var r=await api('/api/finops/labour-rate',{method:'PUT',body:JSON.stringify({rate:v})}); var d=await r.json(); if(r.ok&&d.ok){ FJ.rate=d.labourRate; fjRateLine(); tShow('Saved'); } else tShow(d.error||'Could not save'); };
  }
  function fjNat(a,b){ return String(a.reference).localeCompare(String(b.reference),undefined,{numeric:true,sensitivity:'base'}); }
  function fjFiltered(){
    var g=function(id){ return document.getElementById(id).value; };
    var y=g('fj_year'),m=g('fj_month'),c=g('fj_cust'),st=g('fj_state'),q=g('fj_q').trim().toLowerCase();
    return FJ.jobs.filter(function(j){
      if(y&&(y==='__none'?!!j.period_year:String(j.period_year)!==y))return false; if(m&&String(j.period_month)!==m)return false; if(c&&j.customer!==c)return false;
      if(st==='open'&&j.locked)return false; if(st==='locked'&&!j.locked)return false; if(st==='nosales'&&j.sales)return false; if(st==='salesdiff'&&!(j.salesSource==='invoices'&&j.salesTyped!=null&&Math.abs(j.salesTyped-j.sales)>=0.01))return false; if(st==='nocost'&&j.totalCost)return false; if(st==='loss'&&!(j.profit<0))return false;
      if(q&&(j.reference+' '+(j.customer||'')).toLowerCase().indexOf(q)<0)return false;
      return true;
    }).sort(fjNat);
  }
  function renderFinJobs(){
    var rows=fjFiltered(), K=FJ.kinds, add=function(f){ return rows.reduce(function(s,j){ return s+(f(j)||0); },0); };
    var sales=add(function(j){return j.sales;}), cost=add(function(j){return j.totalCost;}), prof=sales-cost;
    document.getElementById('fj_stats').innerHTML='<div class="stat"><div class="v">'+rows.length.toLocaleString(FLOC())+'</div><div class="l">Jobs ('+rows.filter(function(j){return j.locked;}).length+' locked)</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(sales)+' z\u0142</div><div class="l">Sales</div></div>'
      +'<div class="stat"><div class="v">'+fcMoney(cost)+' z\u0142</div><div class="l">Total cost</div></div>'
      +'<div class="stat"><div class="v" style="color:'+(prof<0?'#b42318':'#15803d')+'">'+fcMoney(prof)+' z\u0142</div><div class="l">Profit / loss</div></div>'
      +'<div class="stat"><div class="v">'+(sales?fjPct(prof/sales):'\u2014')+'</div><div class="l">Profitability</div></div>';
    document.getElementById('fj_head').innerHTML='<tr><th>Reference</th><th style="text-align:left">Month</th><th>Year</th>'+K.map(function(k){ return '<th>'+esc(k.key==='labour'?'Labour cost':k.label)+'</th>'+(k.key==='customs'?'<th>Labour hours</th>':''); }).join('')+'<th>Sales</th><th>Total cost</th><th>Profit / loss</th><th>Profitability</th><th style="text-align:left">Customer</th></tr>';
    var line=function(cls,ref,j,vals){ return '<tr class="'+cls+'"'+(j?' data-id="'+av(j.id)+'"':'')+'><td>'+ref+'</td>'+vals+'</tr>'; };
    var cells=function(sums,hours,sl,tc,pr,mg){ return K.map(function(k){ return '<td class="n">'+fjNum(sums[k.key])+'</td>'+(k.key==='customs'?'<td class="n">'+(hours?Number(hours).toLocaleString(FLOC()):'')+'</td>':''); }).join('')
      +'<td class="n t">'+fjNum(sl)+'</td><td class="n">'+fjNum(tc)+'</td><td class="n'+(pr<0?' neg':'')+'" style="font-weight:700">'+(pr==null?'':fjNum(pr)||'0.00')+'</td><td class="n'+(mg<0?' neg':'')+'">'+fjPct(mg)+'</td>'; };
    var shown=rows.slice(0,FJ.limit), h='';
    shown.forEach(function(j){ h+=line(j.locked?'lk':'',(j.locked?'\ud83d\udd12 ':'')+esc(j.reference),j,'<td style="text-align:left">'+(j.period_month?FC_MONTHS[j.period_month-1]:'')+'</td><td class="n">'+(j.period_year||'')+'</td>'+cells(j.sums,j.hours,j.sales,j.totalCost,j.profit,j.margin)+'<td style="text-align:left">'+esc(j.customer||'')+'</td>'); });
    if(rows.length){ var tot={}; K.forEach(function(k){ tot[k.key]=add(function(j){return j.sums[k.key];}); });
      h+=line('ctrl','Total ('+rows.length+')',null,'<td></td><td></td>'+cells(tot,add(function(j){return j.hours;}),sales,cost,prof,sales?prof/sales:null)+'<td></td>'); }
    var tb=document.getElementById('fj_rows');
    tb.innerHTML=h||'<tr><td class="sub" style="padding:18px" colspan="20">'+(FJ.jobs.length?'No jobs match these filters.':'No jobs yet \u2014 add one with \u201c+ New job\u201d'+(FJ.canManage?' or bring in the Koszty sheet with \u201cImport from Excel\u201d.':'.'))+'</td></tr>';
    tb.querySelectorAll('tr[data-id]').forEach(function(tr){ tr.onclick=function(){ fjOpen(tr.getAttribute('data-id')); }; });
    var more=document.getElementById('fj_more');
    if(rows.length>shown.length){ more.innerHTML='Showing '+shown.length+' of '+rows.length+' \u2014 <a class="codelink" id="fj_all">show all</a>'; document.getElementById('fj_all').onclick=function(){ FJ.limit=100000; renderFinJobs(); }; } else more.textContent='';
  }
  async function fjOpen(id){
    var job={reference:'',customer:'',period_year:new Date().getFullYear(),period_month:new Date().getMonth()+1,sales:null,note:'',locked:false,sums:{},totalCost:0,profit:null,margin:null}, items=[];
    if(id){ var d; try{ var r=await api('/api/finops/jobs/'+encodeURIComponent(id)); d=await r.json(); if(!r.ok)throw new Error(d.error); }catch(e){ tShow(e.message||'Could not load the job'); return; } job=d.job; items=d.items; }
    var ro=!!job.locked, dis=ro?' disabled':'';
    var mo='<option value="">\u2014</option>'+FC_MONTHS.map(function(m,i){ return '<option value="'+(i+1)+'"'+(job.period_month===i+1?' selected':'')+'>'+m+'</option>'; }).join('');
    var banner=ro?'<div class="podecide" style="margin:14px 22px 0"><div class="msg"><b>\ud83d\udd12 Locked</b>'+(job.locked_by?' '+T('by {0}',esc(job.locked_by)):'')+(job.locked_at?' '+T('on {0}',esc(cfWhen(job.locked_at))):'')+'<small>This job can\u2019t be changed. '+(FJ.canManage?'Unlock it to edit.':'Ask an admin to unlock it.')+'</small></div></div>':'';
    var head='<div class="fgrid">'
      +'<div class="field"><label>Reference *</label><input id="fjf_ref" class="tinput" value="'+av(job.reference)+'" placeholder="e.g. Z.373"'+dis+'></div>'
      +'<div class="field"><label>Customer</label><input id="fjf_cust" class="tinput" value="'+av(job.customer||'')+'" list="fjf_custs"'+dis+'><datalist id="fjf_custs">'+Object.keys(FJ.jobs.reduce(function(o,j){ if(j.customer)o[j.customer]=1; return o; },{})).sort().map(function(c){ return '<option value="'+av(c)+'">'; }).join('')+'</datalist></div>'
      +'<div class="field"><label>Month</label><select id="fjf_month"'+dis+'>'+mo+'</select></div>'
      +'<div class="field"><label>Year</label><input id="fjf_year" class="tinput" type="number" value="'+av(job.period_year||'')+'"'+dis+'></div>'
      +'<div class="field"><label>Sales (net z\u0142)'+(job.salesSource==='invoices'?' \u2014 from '+job.salesInvoices+' sales invoice'+(job.salesInvoices===1?'':'s'):'')+'</label><input id="fjf_sales" class="tinput" value="'+av(job.sales==null?'':job.sales)+'" inputmode="decimal"'+(job.salesSource==='invoices'?' disabled':dis)+'>'
        +(job.salesSource==='invoices'?'<div class="sub" style="margin:0">Sum of this job\u2019s invoices on the <a class="codelink" id="fjf_tosales">Sales tab</a>'+(job.salesTyped!=null&&Math.abs(job.salesTyped-job.sales)>=0.01?' \u00b7 <span style="color:#b45309">the sheet had '+fcMoney(job.salesTyped)+'</span>':'')+'</div>':(job.salesSource==='locked'&&job.salesInvoiced!=null&&Math.abs(job.salesInvoiced-(job.sales||0))>=0.01?'<div class="sub" style="margin:0;color:#b45309">Frozen at lock. Invoices now add up to '+fcMoney(job.salesInvoiced)+'.</div>':''))+'</div>'
      +'<div class="field"><label>Note</label><input id="fjf_note" class="tinput" value="'+av(job.note||'')+'"'+dis+'></div></div>';
    var body='';
    if(id){
      var kl=function(k){ var x=FJ.kinds.filter(function(q){return q.key===k;})[0]; return x?x.label:k; };
      var sum='<div class="statgrid" style="margin:0 22px 12px;grid-template-columns:repeat(4,1fr)"><div class="stat"><div class="v" style="font-size:18px">'+(fjNum(job.sales)||'\u2014')+'</div><div class="l">Sales</div></div><div class="stat"><div class="v" style="font-size:18px">'+(fjNum(job.totalCost)||'0.00')+'</div><div class="l">Total cost</div></div><div class="stat"><div class="v" style="font-size:18px;color:'+(job.profit<0?'#b42318':'#15803d')+'">'+(job.profit==null?'\u2014':(fjNum(job.profit)||'0.00'))+'</div><div class="l">Profit / loss</div></div><div class="stat"><div class="v" style="font-size:18px">'+(fjPct(job.margin)||'\u2014')+'</div><div class="l">Profitability</div></div></div>';
      var lines=items.length?items.map(function(it){ return '<tr><td><b>'+esc(kl(it.kind))+'</b></td><td class="r">'+fcMoney(it.amount)+(it.kind==='labour'&&it.hours!=null?'<div class="sub" style="margin:0">'+it.hours+' h \u00d7 '+(it.rate==null?'?':fcMoney(it.rate))+'</div>':'')+'</td><td>'+esc(it.invoice_no||'')+'</td><td>'+esc(it.supplier||'')+'</td><td style="white-space:nowrap">'+esc(it.item_date||'')+'</td><td>'+esc(it.note||'')+'</td><td style="white-space:nowrap">'+(ro?'':'<a class="codelink" data-fje="'+av(it.id)+'">edit</a> \u00b7 <a class="codelink" style="color:#b42318" data-fjd="'+av(it.id)+'">delete</a>')+'</td></tr>'; }).join(''):'<tr><td colspan="7" class="sub">No cost lines yet.</td></tr>';
      var form=ro?'':'<div class="groupt" style="margin:14px 0 6px" id="fji_title">ADD A COST LINE</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
        +'<div class="field" style="min-width:190px"><label>Type</label><select id="fji_kind">'+FJ.kinds.map(function(k){ return '<option value="'+k.key+'">'+esc(k.label)+'</option>'; }).join('')+'</select></div>'
        +'<div class="field" id="fji_amt_w" style="width:120px"><label>Amount (z\u0142)</label><input id="fji_amount" class="tinput" inputmode="decimal"></div>'
        +'<div class="field" id="fji_h_w" style="width:90px;display:none"><label>Hours</label><input id="fji_hours" class="tinput" inputmode="decimal"></div>'
        +'<div class="field" id="fji_r_w" style="width:100px;display:none"><label>Rate (z\u0142/h)</label><input id="fji_rate" class="tinput" inputmode="decimal"></div>'
        +'<div class="field" style="width:140px"><label>Invoice no</label><input id="fji_inv" class="tinput"></div>'
        +'<div class="field" style="width:150px"><label>Supplier</label><input id="fji_sup" class="tinput"></div>'
        +'<div class="field" style="width:140px"><label>Date</label><input id="fji_date" class="tinput" type="date"></div>'
        +'<div class="field" style="flex:1;min-width:140px"><label>Note</label><input id="fji_note" class="tinput"></div>'
        +'<button class="pobtn ok" id="fji_save">Add line</button><button class="pobtn" id="fji_cancel" style="display:none">Cancel</button></div><div class="sub" id="fji_calc" style="margin:6px 0 0"></div>';
      body='<div class="posec"><div class="groupt">SUMMARY</div></div>'+sum+'<div class="posec"><div class="groupt">COST LINES</div><div class="pofiles"><table class="fjl"><thead><tr><th>TYPE</th><th style="text-align:right">AMOUNT</th><th>INVOICE NO</th><th>SUPPLIER</th><th>DATE</th><th>NOTE</th><th></th></tr></thead><tbody>'+lines+'</tbody></table></div>'+form+'</div>';
    }
    var foot='<div class="foot">'+(id&&FJ.canManage&&!ro?'<button class="cancel" id="fjf_del" style="color:#b42318;margin-right:auto">Delete job</button>':'<span style="margin-right:auto"></span>')
      +(id&&FJ.canManage?'<button class="cancel" id="fjf_lock">'+(ro?'\ud83d\udd13 Unlock':'\ud83d\udd12 Lock job')+'</button>':'')
      +'<button class="cancel" onclick="closeModal()">Close</button>'+(ro?'':'<button class="save" id="fjf_save">'+(id?'Save job':'Create job')+'</button>')+'</div>';
    openModal(id?T('Job {0}',esc(job.reference)):'New job',banner+head+body+foot);
    var sheet=document.querySelector('#modal .sheet'); if(sheet)sheet.style.maxWidth='1080px';
    var after=function(nid){ loadFinJobs(); fjOpen(nid||id); };
    var ts=document.getElementById('fjf_tosales'); if(ts)ts.onclick=function(){ closeModal(true); FS.preset={q:job.reference}; showTab('finsales'); };
    var sv=document.getElementById('fjf_save'); if(sv)sv.onclick=async function(){
      var b={reference:document.getElementById('fjf_ref').value,customer:document.getElementById('fjf_cust').value,period_month:document.getElementById('fjf_month').value,period_year:document.getElementById('fjf_year').value,note:document.getElementById('fjf_note').value};
      if(job.salesSource!=='invoices')b.sales=document.getElementById('fjf_sales').value;
      var r=await api(id?'/api/finops/jobs/'+encodeURIComponent(id):'/api/finops/jobs',{method:id?'PUT':'POST',body:JSON.stringify(b)}); var d=await r.json();
      if(r.ok&&d.ok){ tShow(id?'Saved':'Job created'); after(d.id); } else tShow(d.error||'Could not save');
    };
    var lk=document.getElementById('fjf_lock'); if(lk)lk.onclick=async function(){
      if(!ro&&!fConfirm('Lock job '+job.reference+'? Nobody can change it until an admin unlocks it.'))return;
      var r=await api('/api/finops/jobs/'+encodeURIComponent(id)+'/lock',{method:'POST',body:JSON.stringify({locked:!ro})}); var d=await r.json();
      if(r.ok&&d.ok){ tShow(ro?'Unlocked':'Locked'); after(); } else tShow(d.error||'Could not change the lock');
    };
    var dl=document.getElementById('fjf_del'); if(dl)dl.onclick=async function(){
      if(!fConfirm('Delete job '+job.reference+' and its '+items.length+' cost line(s)? This cannot be undone.'))return;
      var r=await api('/api/finops/jobs/'+encodeURIComponent(id),{method:'DELETE'}); var d=await r.json();
      if(r.ok&&d.ok){ closeModal(); tShow('Deleted'); loadFinJobs(); } else tShow(d.error||'Could not delete');
    };
    if(!id||ro)return;
    var editing=null, kindEl=document.getElementById('fji_kind');
    var sync=function(){ var lab=kindEl.value==='labour'; document.getElementById('fji_amt_w').style.display=lab?'none':''; document.getElementById('fji_h_w').style.display=lab?'':'none'; document.getElementById('fji_r_w').style.display=lab?'':'none';
      if(lab&&!document.getElementById('fji_rate').value)document.getElementById('fji_rate').value=FJ.rate;
      var h=parseFloat(String(document.getElementById('fji_hours').value).replace(',','.')), rt=parseFloat(String(document.getElementById('fji_rate').value).replace(',','.'));
      document.getElementById('fji_calc').textContent=lab&&h>0&&rt>0?('Labour cost = '+h+' h \u00d7 '+fcMoney(rt)+' = '+fcMoney(Math.round(h*rt*100)/100)+' z\u0142'):''; };
    kindEl.onchange=sync; document.getElementById('fji_hours').oninput=sync; document.getElementById('fji_rate').oninput=sync; sync();
    var reset=function(){ editing=null; ['fji_amount','fji_hours','fji_rate','fji_inv','fji_sup','fji_date','fji_note'].forEach(function(x){ document.getElementById(x).value=''; }); document.getElementById('fji_save').textContent='Add line'; document.getElementById('fji_cancel').style.display='none'; document.getElementById('fji_title').textContent='ADD A COST LINE'; sync(); };
    document.getElementById('fji_cancel').onclick=reset;
    document.getElementById('fji_save').onclick=async function(){
      var b={kind:kindEl.value,amount:document.getElementById('fji_amount').value,hours:document.getElementById('fji_hours').value,rate:document.getElementById('fji_rate').value,invoice_no:document.getElementById('fji_inv').value,supplier:document.getElementById('fji_sup').value,item_date:document.getElementById('fji_date').value,note:document.getElementById('fji_note').value};
      var r=await api(editing?'/api/finops/job-items/'+encodeURIComponent(editing):'/api/finops/jobs/'+encodeURIComponent(id)+'/items',{method:editing?'PUT':'POST',body:JSON.stringify(b)}); var d=await r.json();
      if(r.ok&&d.ok){ tShow(editing?'Line saved':'Line added'); after(); } else tShow(d.error||'Could not save the line');
    };
    document.querySelectorAll('[data-fje]').forEach(function(a){ a.onclick=function(){ var it=items.filter(function(x){return x.id===a.getAttribute('data-fje');})[0]; if(!it)return; editing=it.id;
      kindEl.value=it.kind; document.getElementById('fji_amount').value=it.kind==='labour'&&it.hours!=null?'':it.amount; document.getElementById('fji_hours').value=it.hours==null?'':it.hours; document.getElementById('fji_rate').value=it.rate==null?'':it.rate;
      if(it.kind==='labour'&&it.hours==null){ document.getElementById('fji_hours').value=''; document.getElementById('fji_rate').value=''; }
      document.getElementById('fji_inv').value=it.invoice_no||''; document.getElementById('fji_sup').value=it.supplier||''; document.getElementById('fji_date').value=it.item_date||''; document.getElementById('fji_note').value=it.note||'';
      document.getElementById('fji_save').textContent='Save line'; document.getElementById('fji_cancel').style.display=''; document.getElementById('fji_title').textContent='EDIT COST LINE'; sync(); document.getElementById('fji_title').scrollIntoView({block:'nearest'}); }; });
    document.querySelectorAll('[data-fjd]').forEach(function(a){ a.onclick=async function(){ if(!fConfirm('Delete this cost line?'))return;
      var r=await api('/api/finops/job-items/'+encodeURIComponent(a.getAttribute('data-fjd')),{method:'DELETE'}); var d=await r.json(); if(r.ok&&d.ok){ tShow('Line deleted'); after(); } else tShow(d.error||'Could not delete'); }; });
  }
  function fjCsv(){
    var rows=fjFiltered(), q=function(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; }, n=function(v){ return v==null?'':Number(v).toFixed(2); };
    var L=[['Reference','Month','Year'].concat(FJ.kinds.map(function(k){ return k.key==='labour'?'Labour cost':k.label; })).concat(['Labour hours','Sales','Total cost','Profit / loss','Profitability %','Customer','Locked']).map(TR).map(q).join(',')];
    rows.forEach(function(j){ L.push([q(j.reference),q(j.period_month?FC_MONTHS[j.period_month-1]:''),j.period_year||''].concat(FJ.kinds.map(function(k){ return n(j.sums[k.key]); })).concat([j.hours||'',n(j.sales),n(j.totalCost),n(j.profit),j.margin==null?'':(j.margin*100).toFixed(2),q(j.customer),j.locked?'yes':'']).join(',')); });
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([String.fromCharCode(65279)+L.join(String.fromCharCode(13,10))],{type:'text/csv;charset=utf-8'})); a.download='Job costs.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  // Paste the Koszty rows copied from Excel (columns A..U): LP, Referencja, Miesiac, Rok, material, panele, szklo, inne, malowanie, transport, odprawa, godziny, koszt pracownikow, sprzedaz, …, customer in U.
  function fjParsePaste(text){
    var out=[]; String(text).split(String.fromCharCode(10)).forEach(function(ln){ var c=ln.replace(String.fromCharCode(13),'').split(String.fromCharCode(9)); if(c.length<14)return; var ref=(c[1]||'').trim(); if(!ref||/^referencja$/i.test(ref))return;
      out.push({reference:ref,month:c[2],year:c[3],customer:c[20]||'',hours:c[11],sales:c[13],costs:{material:c[4],panels:c[5],glass:c[6],extras:c[7],painting:c[8],transport:c[9],customs:c[10],labour:c[12]}}); });
    return out;
  }
  function fjImport(){
    openModal('Import from Excel','<div style="padding:18px 22px"><p class="sub" style="margin:0 0 10px">'+TH('fj_import','In the <b>Koszty</b> sheet select the job rows from column <b>A (LP.)</b> to column <b>U (customer)</b>, copy, and paste here. Each row becomes a job with one cost line per filled column; labour keeps its hours and cost. Jobs that already exist are skipped, so it is safe to paste again.')+'</p>'
      +'<textarea id="fjp_text" style="width:100%;min-height:200px;border:1px solid var(--line);border-radius:10px;padding:10px;font:12px ui-monospace,Menlo,monospace" placeholder="Paste here\u2026"></textarea><div class="sub" id="fjp_info" style="margin:8px 0 0"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="fjp_go" disabled>Import</button></div>');
    var ta=document.getElementById('fjp_text'), go=document.getElementById('fjp_go'), rows=[];
    ta.oninput=function(){ rows=fjParsePaste(ta.value); var have={}; FJ.jobs.forEach(function(j){ have[String(j.reference).replace(/\s/g,'').toUpperCase()]=1; }); var dup=rows.filter(function(r){ return have[r.reference.replace(/\s/g,'').toUpperCase()]; }).length;
      document.getElementById('fjp_info').innerHTML=rows.length?('<b>'+rows.length+'</b> job row(s) recognised'+(dup?' \u00b7 '+dup+' already exist and will be skipped':'')+' \u00b7 first: '+esc(rows[0].reference)+', last: '+esc(rows[rows.length-1].reference)):'No job rows recognised yet \u2014 copy whole rows starting at column A.'; go.disabled=!rows.length; };
    go.onclick=async function(){ go.disabled=true; var r=await api('/api/finops/jobs/import',{method:'POST',body:JSON.stringify({rows:rows})}); var d=await r.json();
      if(r.ok&&d.ok){ closeModal(); fAlert('Imported '+d.added+' job(s) with '+d.items+' cost line(s).'+(d.skipped.length?' Skipped '+d.skipped.length+' that already existed.':'')); loadFinJobs(); } else { tShow(d.error||'Import failed'); go.disabled=false; } };
  }
  // ---- Fin&Ops ▸ Performance: department → fixed/variable → cost line × month (New Performance Sheet layout) ----
  var FP={model:null,shut:{}};
  // Collapsible groups on Performance: Fixed / Variable blocks and the UK customer breakdown. FP.shut remembers which are closed.
  function fpGroups(){ return [].slice.call(document.querySelectorAll('#fp_rows tr.kind[data-g]')); }
  function fpApplyShut(){
    var tb=document.getElementById('fp_rows'), groups=fpGroups();
    groups.forEach(function(tr){ var g=tr.getAttribute('data-g'), shut=!!FP.shut[g]; tr.classList.toggle('shut',shut); var ar=tr.querySelector('.fpar'); if(ar)ar.textContent=shut?'\u25b8 ':'\u25be ';
      tb.querySelectorAll('tr.line').forEach(function(l){ if(l.getAttribute('data-of')===g)l.style.display=shut?'none':''; }); });
    var b=document.getElementById('fp_toggle'); if(b){ var allShut=groups.length>0&&groups.every(function(tr){ return FP.shut[tr.getAttribute('data-g')]; }); b.textContent=allShut?'Expand all':'Collapse all'; b.style.display=groups.length?'':'none'; }
  }
  var FP_ORDER=['469','401','412','457','489','463','464','467','429','445','425','449','468','500','TAX','499','631','473','416'];
  var FP_DEPTS=['Office','Sales','Production'];
  // Sheet rule: these categories are fixed costs; their ".V" variants and everything else are variable.
  function fpKind(r){
    var c=String(r.subcategory||'').toUpperCase();
    return (/^(469|401|412|457|489|463|464|467)(?![.]V)/.test(c))?'fixed':'variable';
  }
  var FC_RECLASS=['konto','unclassified','period'];
  function fcNeedsReclass(r){ return r.flags.some(function(f){ return FC_RECLASS.indexOf(f)>=0; }); }
  function fpRank(cat){ var c=String(cat||'').toUpperCase(); for(var i=0;i<FP_ORDER.length;i++){ if(c.indexOf(FP_ORDER[i])===0)return i; } return 99; }
  async function loadFinPerf(){
    var first=!document.getElementById('fp_csv').dataset.ready;
    if(first){ document.getElementById('fp_csv').dataset.ready='1';
      document.getElementById('fp_csv').onclick=fpCsv;
      document.getElementById('fp_toggle').onclick=function(){ var any=fpGroups().some(function(tr){ return !FP.shut[tr.getAttribute('data-g')]; }); fpGroups().forEach(function(tr){ FP.shut[tr.getAttribute('data-g')]=any; }); fpApplyShut(); };
      ['fp_year','fp_company','fp_dec'].forEach(function(id){ document.getElementById(id).onchange=renderFinPerf; }); }
    var d; try{ var r=await api('/api/finops/costs'); d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not load'); }catch(e){ document.getElementById('fp_rows').innerHTML='<tr><td class="sub" style="padding:18px">'+esc(e.message||'Could not load costs')+'</td></tr>'; return; }
    FC.rows=d.rows||[]; FC.canManage=!!d.canManage; FC.slug=d.slug; FC.boardId=d.boardId; FC.lastRun=d.lastRun;
    try{ await fsFetch(); }catch(e){ FS.inv=[]; }
    try{ await fyFetch(); }catch(e){ FY.months=[]; }
    try{ var jr=await api('/api/finops/jobs'); var jd=await jr.json(); if(jr.ok){ FJ.jobs=jd.jobs||[]; FJ.kinds=jd.kinds||[]; FJ.rate=jd.labourRate; FJ.canManage=!!jd.canManage; } }catch(e){}
    var years=[]; FC.rows.forEach(function(r){ if(r.period_year&&years.indexOf(r.period_year)<0)years.push(r.period_year); }); FS.inv.forEach(function(r){ if(r.period_year&&years.indexOf(r.period_year)<0)years.push(r.period_year); }); FY.months.forEach(function(x){ if(years.indexOf(x.year)<0)years.push(x.year); }); years.sort(function(a,b){return b-a;});
    var ys=document.getElementById('fp_year'), cur=ys.value; ys.innerHTML=years.map(function(y){return '<option value="'+y+'">'+y+'</option>';}).join(''); if(cur&&years.indexOf(+cur)>=0)ys.value=cur;
    var run=d.lastRun; document.getElementById('fp_last').textContent=run?('Data as of last sync: '+cfWhen(run.finished_at||run.started_at)):'Never synced \u2014 run Sync from Monday on the Costs tab';
    renderFinPerf();
  }
  function fpBuild(){
    var year=+document.getElementById('fp_year').value, co=document.getElementById('fp_company').value;
    var rows=FC.rows.filter(function(r){ return r.period_year===year&&(!co||r.company===co); });
    var depts={}, noMonth=0, chg=0, reclass=0;
    rows.forEach(function(r){
      if(!r.period_month){ noMonth++; return; }
      if(r.flags&&r.flags.indexOf('changed')>=0)chg++;
      var dn=r.department||'(no department)', kind=fpKind(r), cat=r.subcategory||'(no category)';
      if(fcNeedsReclass(r))reclass++;
      var D=depts[dn]||(depts[dn]={fixed:{},variable:{}}); var L=D[kind][cat]||(D[kind][cat]=[0,0,0,0,0,0,0,0,0,0,0,0]);
      L[r.period_month-1]+=(r.net||0);
    });
    // Payroll belongs to Acemark: make sure its three departments show even in a month-less year of invoices.
    if(co===''||co==='acemark') FY.depts.forEach(function(n){ if(!depts[n]&&(fyYear(year,n,'salaries').has||fyYear(year,n,'taxes').has))depts[n]={fixed:{},variable:{}}; });
    var names=FP_DEPTS.filter(function(n){return depts[n];}).concat(Object.keys(depts).filter(function(n){return FP_DEPTS.indexOf(n)<0;}).sort());
    var add=function(a,b){ return a.map(function(v,i){return v+b[i];}); }, zero=function(){ return [0,0,0,0,0,0,0,0,0,0,0,0]; };
    var out={year:year,company:co,reclass:reclass,depts:[],total:zero(),noMonth:noMonth,changed:chg,count:rows.length};
    names.forEach(function(n){
      var D={name:n,total:zero(),kinds:[]};
      ['fixed','variable'].forEach(function(k){
        var cats=Object.keys(depts[n][k]).sort(function(a,b){ return fpRank(a)-fpRank(b)||a.localeCompare(b); });
        var K={kind:k,total:zero(),lines:cats.map(function(c){ return {cat:c,m:depts[n][k][c]}; })};
        K.lines.forEach(function(l){ K.total=add(K.total,l.m); }); D.total=add(D.total,K.total); D.kinds.push(K);
      });
      out.total=add(out.total,D.total); out.depts.push(D);
    });
    return out;
  }
  function renderFinPerf(){
    var M=FP.model=fpBuild(), dec=document.getElementById('fp_dec').checked;
    var fmt=function(v){ if(!v||Math.abs(v)<0.005)return ''; return Number(v).toLocaleString(FLOC(),{minimumFractionDigits:dec?2:0,maximumFractionDigits:dec?2:0}); };
    var sum=function(a){ return a.reduce(function(s,v){return s+v;},0); };
    var cells=function(m,ctx){ return m.map(function(v,i){ return '<td class="n'+(v<0?' neg':'')+'" data-m="'+(i+1)+'" '+ctx+' title="'+av(Number(v||0).toFixed(2))+'">'+fmt(v)+'</td>'; }).join('')+'<td class="n t'+(sum(m)<0?' neg':'')+'" data-m="" '+ctx+' title="'+av(sum(m).toFixed(2))+'">'+fmt(sum(m))+'</td>'; };
    document.getElementById('fp_head').innerHTML='<tr><th>'+M.year+' \u00b7 net z\u0142</th>'+FC_MONTHS.map(function(m){return '<th>'+m.slice(0,3)+'</th>';}).join('')+'<th>Total</th></tr>';
    var h='', grand=[0,0,0,0,0,0,0,0,0,0,0,0], anyPay=false, zeroes=function(){ return [0,0,0,0,0,0,0,0,0,0,0,0]; };
    // like cells(), for payroll / totals: estimates in italics; these cells open the Payroll tab or nothing
    var pcells=function(m,est,ctx){ var t=sum(m), e=(est||[]).some(function(x){return x;}); return m.map(function(v,i){ return '<td class="n'+(est&&est[i]?' est':'')+(v<0?' neg':'')+'" data-m="'+(i+1)+'" '+ctx+' title="'+av(Number(v||0).toFixed(2))+(est&&est[i]?' \u2014 estimate, actuals not entered yet':'')+'">'+fmt(v)+'</td>'; }).join('')+'<td class="n t'+(e?' est':'')+'" data-m="" '+ctx+' title="'+av(t.toFixed(2))+(e?' \u2014 includes estimates':'')+'">'+fmt(t)+'</td>'; };
    M.depts.forEach(function(D){
      var dctx='data-d="'+av(D.name)+'"', pay=(M.company===''||M.company==='acemark')&&FY.depts.indexOf(D.name)>=0;
      var sal=pay?fyYear(M.year,D.name,'salaries'):{v:zeroes(),est:[],has:false}, tax=pay?fyYear(M.year,D.name,'taxes'):{v:zeroes(),est:[],has:false};
      var dtot=D.total.map(function(v,i){ return v+sal.v[i]+tax.v[i]; }); grand=grand.map(function(v,i){ return v+dtot[i]; }); if(sal.has||tax.has)anyPay=true;
      var anyEst=sal.est.concat(tax.est).some(function(x){return x;});
      h+='<tr class="dept"><td>'+esc(D.name.toUpperCase())+'</td>'+pcells(dtot,[],'data-d="'+av(D.name)+'" data-all="1"')+'</tr>';
      if(pay){
        h+=sal.has?'<tr class="sec"><td style="padding-left:18px">Salaries</td>'+pcells(sal.v,sal.est,'data-pay="1"')+'</tr>':'<tr class="ph"><td style="padding-left:18px">Salaries</td><td colspan="13">not entered yet \u2014 see the Payroll tab</td></tr>';
        h+=tax.has?'<tr class="sec"><td style="padding-left:18px">Taxes (payroll)</td>'+pcells(tax.v,tax.est,'data-pay="1"')+'</tr>':'<tr class="ph"><td style="padding-left:18px">Taxes (payroll)</td><td colspan="13">not entered yet \u2014 see the Payroll tab</td></tr>';
      }
      h+='<tr class="sec"><td style="padding-left:18px">Overheads</td>'+cells(D.total,dctx)+'</tr>';
      D.kinds.forEach(function(K){
        var kctx=dctx+' data-k="'+K.kind+'"', gid=av(D.name+'|'+K.kind);
        h+='<tr class="kind" data-g="'+gid+'"><td style="padding-left:24px"><span class="fpar">\u25be </span>'+(K.kind==='fixed'?'Fixed / sta\u0142e':'Variable / zmienne')+' <span style="font-weight:500;color:var(--muted)">('+K.lines.length+')</span></td>'+cells(K.total,kctx)+'</tr>';
        K.lines.forEach(function(l){ h+='<tr class="line" data-of="'+gid+'"><td>'+esc(l.cat)+'</td>'+cells(l.m,kctx+' data-c="'+av(l.cat)+'"')+'</tr>'; });
      });
    });
    if(M.depts.length)h+='<tr class="ctrl"><td>Control sum \u2014 Monday (invoices)</td>'+cells(M.total,'')+'</tr>';
    if(anyPay)h+='<tr class="ctrl"><td>Total costs incl. payroll</td>'+pcells(grand,[],'data-all="1"')+'</tr>';
    // Sales block (Sales tab), as in the sheet: total, then Orpiszew and Trade from Poland by country; UK split by customer.
    var S=fpSales(M.year);
    if(S.count){
      var zero=function(){ return [0,0,0,0,0,0,0,0,0,0,0,0]; }, sc=function(m,ctx){ return cells(m,'data-s="1" '+ctx); };
      h+='<tr class="dept"><td>SALES RESULTS</td>'+sc(S.total,'')+'</tr>';
      [['production','Sales from Orpiszew'],['trade','Trade from Poland']].forEach(function(c){
        var B=S[c[0]]; h+='<tr class="sec"><td style="padding-left:18px">'+c[1]+'</td>'+sc(B.total,'data-ch="'+c[0]+'"')+'</tr>';
        B.countries.forEach(function(C){ var grp=C.code==='UK'&&C.buyers.length, gid='sales|'+c[0]+'|UK';
          h+='<tr class="kind"'+(grp?' data-g="'+gid+'"':'')+'><td style="padding-left:24px;cursor:'+(grp?'pointer':'default')+'">'+(grp?'<span class="fpar">\u25be </span>':'')+esc(fsCountry(C.code))+'</td>'+sc(C.m,'data-ch="'+c[0]+'" data-co="'+av(C.code||'')+'"')+'</tr>';
          if(grp) C.buyers.forEach(function(Bu){ h+='<tr class="line" data-of="'+gid+'"><td>'+esc(Bu.name)+'</td>'+sc(Bu.m,'data-ch="'+c[0]+'" data-co="UK"')+'</tr>'; }); });
      });
    }
    var tb=document.getElementById('fp_rows');
    var R=fpResult(M,S); FP.result=R;
    if(R&&R.has){
      var tot=function(a){ return a.reduce(function(x,y){return x+y;},0); }, ts=tot(R.sales);
      var pc=function(vals,est){ var t=tot(vals), e=(est||[]).some(function(x){return x;}); return vals.map(function(v,i){ var r=Math.abs(R.sales[i])>0.004?v/R.sales[i]:null; return '<td class="n'+(est&&est[i]?' est':'')+(r!=null&&r<0?' neg':'')+'" data-all="1" style="color:var(--muted)">'+(r==null?'':fjPct(r))+'</td>'; }).join('')+'<td class="n t'+(e?' est':'')+(ts&&t/ts<0?' neg':'')+'" data-all="1" style="color:var(--muted)">'+(Math.abs(ts)>0.004?fjPct(t/ts):'')+'</td>'; };
      var row=function(cls,label,tip,vals,est,ctx,pctLabel){ var o='<tr class="'+cls+'"><td style="padding-left:18px" title="'+av(tip)+'">'+label+'</td>'+pcells(vals,est,ctx||'data-all="1"')+'</tr>'; if(pctLabel)o+='<tr class="line"><td style="color:var(--muted)">'+pctLabel+'</td>'+pc(vals,est)+'</tr>'; return o; };
      h+='<tr class="dept"><td>RESULT</td>'+pcells(R.eb,R.estE,'data-all="1"')+'</tr>';
      h+=row('sec','Sales','All sales invoices of the month (Sales results above).',R.sales,[],'data-s="1"');
      h+=row('sec','Materials (RW)','Material Cost (RW) of the jobs counted in this month \u2014 from Job costs.',R.mat,[],'data-mat="1"','Materials %');
      h+=row('sec','Sales costs','The whole Sales department: salaries, payroll taxes and overheads.',R.sc,R.estS,'','Sales costs %');
      h+=row('sec','Gross margin','Sales \u2212 Materials \u2212 Sales costs.',R.gm,R.estS,'','Gross margin %');
      h+=row('sec','Overheads (Office + Production payroll)','Office salaries, taxes and overheads, plus Production salaries and taxes.',R.ov,R.estO,'','Overheads %');
      h+=row('ctrl','EBITDA','Gross margin \u2212 Overheads.',R.eb,R.estE,'','EBITDA %');
      h+='<tr class="ph"><td style="padding-left:18px" title="'+av('These invoices are not part of the result above: materials are counted there as RW from Job costs instead. The rest (leasing, maintenance, logistics, improvements) is left out, as in the sheet.')+'">Not in the result: Production overheads (invoices)</td>'+pcells(R.prod,[],'data-all="1"')+'</tr>';
    }
    tb.innerHTML=(M.depts.length||S.count||(R&&R.has))?h:'<tr><td class="sub" style="padding:18px" colspan="14">No costs or sales for this year / company yet.</td></tr>';
    tb.querySelectorAll('td.n').forEach(function(td){ td.onclick=function(e){ e.stopPropagation(); if(td.getAttribute('data-mat')){ FJ.preset={year:M.year,month:td.getAttribute('data-m')||''}; showTab('finjobs'); return; } if(td.getAttribute('data-pay')){ FY.preYear=M.year; showTab('finpay'); return; } if(td.getAttribute('data-all'))return; if(td.getAttribute('data-s')){ FS.preset={year:M.year,month:td.getAttribute('data-m')||'',channel:td.getAttribute('data-ch')||'',country:td.getAttribute('data-co')||''}; showTab('finsales'); } else fpDrill(td); }; });
    fpGroups().forEach(function(tr){ tr.querySelector('td').onclick=function(){ var g=tr.getAttribute('data-g'); FP.shut[g]=!FP.shut[g]; fpApplyShut(); }; });
    fpApplyShut();
    document.getElementById('fp_note').innerHTML=M.count.toLocaleString(FLOC())+' invoices'+(M.changed?' \u00b7 <a class="codelink" id="fp_chg" style="color:#b42318">'+M.changed+' changed after sync</a>':'')+(M.reclass?' \u00b7 <a class="codelink" id="fp_rcl" style="color:#b45309" title="Invoices whose category, department or KONTO looks wrong \u2014 open the list to fix them in monday">'+M.reclass+' to fix in monday \u2192</a>':' \u00b7 nothing to fix')+(M.noMonth?' \u00b7 '+M.noMonth+' without a month (not shown)':'');
    var rc=document.getElementById('fp_rcl'); if(rc)rc.onclick=function(){ FC.preset={year:M.year,month:'',company:M.company,dept:'',cat:'',kind:'',flag:'reclass'}; showTab('fincosts'); };
    var c=document.getElementById('fp_chg'); if(c)c.onclick=function(){ FC.preset={year:M.year,month:'',company:M.company,dept:'',cat:'',kind:''}; showTab('fincosts'); setTimeout(function(){ document.getElementById('fc_flag').value='changed'; renderFinCosts(); },900); };
  }
  // Sales of a year by channel → country → (UK) customer, month by month.
  function fpSales(year){
    var z=function(){ return [0,0,0,0,0,0,0,0,0,0,0,0]; }, out={count:0,total:z(),production:{total:z(),map:{}},trade:{total:z(),map:{}}};
    var ukName=function(b){ var s=String(b||'').toLowerCase(); return s.indexOf('acemark glazing')===0?'Acemark Glazing':(s==='pcw'?'PCW':'Others UK'); };
    FS.inv.forEach(function(r){ if(r.period_year!==year||!r.period_month)return; var i=r.period_month-1, B=out[r.channel]; out.count++; out.total[i]+=r.net; B.total[i]+=r.net;
      var C=B.map[r.country||'']||(B.map[r.country||'']={code:r.country||'',m:z(),bm:{}}); C.m[i]+=r.net;
      if(r.country==='UK'){ var n=ukName(r.buyer); (C.bm[n]||(C.bm[n]=z()))[i]+=r.net; } });
    var ORD=['UK','DE','PL','ES','NL'];
    ['production','trade'].forEach(function(k){ var B=out[k]; B.countries=Object.keys(B.map).sort(function(a,b){ var x=ORD.indexOf(a),y=ORD.indexOf(b); return (x<0?99:x)-(y<0?99:y)||a.localeCompare(b); }).map(function(c){ var C=B.map[c]; C.buyers=['Acemark Glazing','PCW','Others UK'].filter(function(n){return C.bm[n];}).map(function(n){ return {name:n,m:C.bm[n]}; }); return C; }); });
    return out;
  }
  // Result block, as the sheet's P&L: Sales − Materials (RW of the month's jobs) − Sales costs (whole Sales
  // department incl. payroll) = Gross margin; − Overheads (Office incl. payroll + Production payroll) = EBITDA.
  // Production's invoice overheads are NOT in it (materials are counted as RW) — returned separately for reference.
  function fpResult(M,S){
    if(!(M.company===''||M.company==='acemark'))return null;
    var z=function(){ return [0,0,0,0,0,0,0,0,0,0,0,0]; };
    var dept=function(n){ var D=M.depts.filter(function(x){return x.name===n;})[0]; return D?D.total:z(); };
    var pay=function(n){ var a=fyYear(M.year,n,'salaries'), b=fyYear(M.year,n,'taxes'); return {v:a.v.map(function(x,i){return x+b.v[i];}),est:a.v.map(function(x,i){return !!(a.est[i]||b.est[i]);})}; };
    var mat=z(), jobs=0; FJ.jobs.forEach(function(j){ if(j.period_year===M.year&&j.period_month){ mat[j.period_month-1]+=(j.sums&&j.sums.material)||0; jobs++; } });
    var pS=pay('Sales'), pO=pay('Office'), pP=pay('Production');
    var sc=dept('Sales').map(function(v,i){return v+pS.v[i];}), ov=dept('Office').map(function(v,i){return v+pO.v[i]+pP.v[i];});
    var gm=S.total.map(function(v,i){return v-mat[i]-sc[i];}), eb=gm.map(function(v,i){return v-ov[i];});
    var estO=pO.est.map(function(e,i){return e||pP.est[i];}), estE=pS.est.map(function(e,i){return e||estO[i];});
    var has=S.total.concat(mat).some(function(v){return Math.abs(v)>0.004;});
    return {has:has,jobs:jobs,sales:S.total,mat:mat,sc:sc,gm:gm,ov:ov,eb:eb,estS:pS.est,estO:estO,estE:estE,prod:dept('Production')};
  }
  function fpDrill(td){
    var M=FP.model, d=td.getAttribute('data-d'), k=td.getAttribute('data-k'), c=td.getAttribute('data-c');
    var extra=null, kindSel=(k==null?'':k);
    FC.preset={year:M.year,month:td.getAttribute('data-m')||'',company:M.company,dept:d==null?'':(d==='(no department)'?'__none':d),cat:c==null?'':(c==='(no category)'?'__none':c),kind:kindSel,extra:extra};
    showTab('fincosts');
  }
  function fpCsv(){
    var M=FP.model; if(!M)return; var q=function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }, n=function(a){ return a.map(function(v){return (v||0).toFixed(2);}).concat([a.reduce(function(s,v){return s+v;},0).toFixed(2)]).join(','); };
    var L=[['Line'].concat(FC_MONTHS).concat(['Total']).map(TR).map(q).join(',')];
    M.depts.forEach(function(D){ L.push(q(D.name.toUpperCase())+','+n(D.total)); D.kinds.forEach(function(K){ L.push(q('  '+TR(K.kind==='fixed'?'Fixed':'Variable'))+','+n(K.total)); K.lines.forEach(function(l){ L.push(q('    '+l.cat)+','+n(l.m)); }); }); });
    L.push(q(TR('Control sum - Monday'))+','+n(M.total));
    var R=FP.result; if(R&&R.has){ var pct=function(a){ var t=a.reduce(function(x,y){return x+y;},0), ts=R.sales.reduce(function(x,y){return x+y;},0); return a.map(function(v,i){ return Math.abs(R.sales[i])>0.004?(v/R.sales[i]*100).toFixed(1)+'%':''; }).concat([Math.abs(ts)>0.004?(t/ts*100).toFixed(1)+'%':'']).join(','); };
      [['Sales',R.sales,0],['Materials (RW)',R.mat,'Materials %'],['Sales costs',R.sc,'Sales costs %'],['Gross margin',R.gm,'Gross margin %'],['Overheads (Office + Production payroll)',R.ov,'Overheads %'],['EBITDA',R.eb,'EBITDA %']].forEach(function(x){ L.push(q(TR(x[0]))+','+n(x[1])); if(x[2])L.push(q('  '+TR(x[2]))+','+pct(x[1])); });
      L.push(q(TR('Not in the result: Production overheads (invoices)'))+','+n(R.prod)); }
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([String.fromCharCode(65279)+L.join(String.fromCharCode(13,10))],{type:'text/csv;charset=utf-8'})); a.download='Performance '+M.year+(M.company?' '+M.company:'')+'.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  // ---- Operations ▸ Confirmations: shareable report sign-off links ----
  var CF_ROWS=[];
  function cfLink(t){ return location.origin+'/c/'+t; }
  function cfWhen(t){ return t?new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'\u2014'; }
  async function loadConfirmations(){
    var fin=document.getElementById('cf_file');
    if(!fin.dataset.ready){ fin.dataset.ready='1';
      fin.onchange=function(){ document.getElementById('cf_fname').textContent=fin.files[0]?fin.files[0].name:'No file chosen'; };
      document.getElementById('cf_create').onclick=cfCreate; }
    var d; try{ d=await (await api('/api/confirmations')).json(); }catch(e){ d={confirmations:[]}; }
    CF_ROWS=d.confirmations||[];
    var pend=CF_ROWS.filter(function(r){return r.status==='pending';}).length;
    document.getElementById('cf_summary').innerHTML='<div class="stat"><div class="v">'+CF_ROWS.length+'</div><div class="l">Shared</div></div><div class="stat"><div class="v">'+pend+'</div><div class="l">Pending approval</div></div><div class="stat"><div class="v">'+(CF_ROWS.length-pend)+'</div><div class="l">Approved</div></div>';
    var tb=document.getElementById('cf_rows');
    tb.innerHTML=CF_ROWS.length?CF_ROWS.map(function(r){
      var ok=r.status==='approved';
      var pill='<span class="pill" style="background:'+(ok?'#dcfce7;color:#15803d':'#fff1e0;color:#b45309')+'">'+(ok?'Approved':'Pending approval')+'</span>';
      var appr=ok?(esc(cfWhen(r.approved_at))+'<div class="sub" style="margin:0">'+esc(r.approved_by_name||'')+(r.approved_by_role?' ('+esc(r.approved_by_role)+')':'')+'</div>'):'\u2014';
      var acts='<button class="pobtn" style="padding:5px 10px;font-size:12px" data-cf="copy" data-t="'+av(r.token)+'">Copy link</button> '
        +'<a class="pobtn" style="padding:5px 10px;font-size:12px;text-decoration:none;display:inline-block" target="_blank" rel="noopener" href="'+av(cfLink(r.token))+'">Open</a> '
        +'<button class="pobtn'+(ok?' ok':'')+'" style="padding:5px 10px;font-size:12px" data-cf="pdf" data-id="'+av(r.id)+'">PDF</button> '
        +(ok?'<a class="pobtn" style="padding:5px 10px;font-size:12px;text-decoration:none;display:inline-block" target="_blank" rel="noopener" title="The report exactly as the customer filled it in (print or save as PDF)" href="'+av(cfLink(r.token)+'/filled?print=1')+'">Filled report</a> ':'')
        +'<button class="pobtn bad" style="padding:5px 10px;font-size:12px" data-cf="del" data-id="'+av(r.id)+'">Delete</button>';
      return '<tr><td><b>'+esc(r.title)+'</b><div class="sub" style="margin:0">'+esc(r.file_name||'')+'</div></td><td>'+esc(r.created_by_name||'\u2014')+'</td><td>'+esc(cfWhen(r.created_at))+'</td><td>'+esc(cfWhen(r.last_activity_at))+'</td><td>'+pill+'</td><td>'+appr+'</td><td style="white-space:nowrap">'+acts+'</td></tr>';
    }).join(''):'<tr><td colspan="7" class="sub" style="padding:18px">No reports shared yet.</td></tr>';
    tb.querySelectorAll('[data-cf]').forEach(function(bt){ bt.onclick=function(){ var k=bt.getAttribute('data-cf');
      if(k==='copy') copyText(cfLink(bt.getAttribute('data-t')),'Link copied');
      if(k==='pdf') cfPdf(bt.getAttribute('data-id'));
      if(k==='del') cfDelete(bt.getAttribute('data-id')); }; });
  }
  async function cfCreate(){
    var f=document.getElementById('cf_file').files[0]; if(!f){tShow('Choose a report file first');return;}
    var btn=document.getElementById('cf_create'); btn.disabled=true;
    try{
      var html=await new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsText(f); });
      var r=await api('/api/confirmations',{method:'POST',body:JSON.stringify({fileName:f.name,title:document.getElementById('cf_title').value,html:html})}); var d=await r.json();
      if(!r.ok||!d.ok){ tShow(d.error||'Could not create the link'); return; }
      var link=cfLink(d.token);
      var box=document.getElementById('cf_new'); box.style.display='block';
      box.innerHTML='<div class="podecide ok" style="margin:0"><div class="msg"><b>Link created</b> \u2014 send it to the person who should confirm the report.<small style="font-family:ui-monospace,Menlo,monospace;user-select:all;word-break:break-all">'+esc(link)+'</small>'
        +(d.autosave?'':'<small>This report has no autosave: the recipient\u2019s choices are captured when they click Approve.</small>')+'</div><button class="pobtn ok" id="cf_copynew">Copy link</button></div>';
      document.getElementById('cf_copynew').onclick=function(){ copyText(link,'Link copied'); };
      document.getElementById('cf_file').value=''; document.getElementById('cf_fname').textContent='No file chosen'; document.getElementById('cf_title').value='';
      loadConfirmations();
    } finally { btn.disabled=false; }
  }
  async function cfPdf(id){
    var r=await fetch('/api/confirmations/'+encodeURIComponent(id)+'/pdf',{headers:{Authorization:'Bearer '+token}});
    if(!r.ok){ tShow('Could not build the PDF'); return; }
    var cd=r.headers.get('content-disposition')||''; var m=cd.match(/filename="([^"]+)"/);
    var blob=await r.blob(); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=m?m[1]:'report.pdf'; document.body.appendChild(a); a.click(); a.remove();
  }
  async function cfDelete(id){
    var row=CF_ROWS.filter(function(r){return r.id===id;})[0]; if(!row)return;
    if(!confirm('Delete \u201c'+row.title+'\u201d? The link stops working and its decisions are removed.'))return;
    var r=await api('/api/confirmations/'+encodeURIComponent(id),{method:'DELETE'}); var d=await r.json();
    if(r.ok&&d.ok){ tShow('Deleted'); loadConfirmations(); } else tShow(d.error||'Could not delete');
  }
  // ---- Logistics ▸ Labels: Archimede PDF → A4 label sheet ----
  var LBL=null, LBL_ROWS=[];
  // Admin-only savings counter: PDFs processed, hours saved (1 h each), money saved (50 PLN / h).
  async function loadLabelStats(){
    var box=document.getElementById('lbl_stats'); if(myRole!=='admin'){ box.style.display='none'; return; }
    var d; try{ var r=await api('/api/labels/stats'); d=await r.json(); if(!r.ok)throw 0; }catch(e){ box.style.display='none'; return; }
    var n=function(v){ return Number(v||0).toLocaleString('en-GB'); };
    box.innerHTML='<div class="stat"><div class="v">'+n(d.count)+'</div><div class="l">PDFs processed</div></div>'
      +'<div class="stat"><div class="v">'+n(d.hours)+' h</div><div class="l">Time saved ('+n(d.hoursPerPdf)+' h per PDF)</div></div>'
      +'<div class="stat"><div class="v">'+n(d.money)+' '+esc(d.currency)+'</div><div class="l">Money saved ('+n(d.ratePerHour)+' '+esc(d.currency)+' per hour)</div></div>';
    box.style.display='grid';
  }
  function initLabels(){
    loadLabelStats();
    var fin=document.getElementById('lbl_file'); if(fin.dataset.ready)return; fin.dataset.ready='1';
    fin.onchange=labelsRead;
    document.getElementById('lbl_all').onchange=function(){ var on=this.checked; LBL_ROWS.forEach(function(r){r.on=on;}); renderLabelRows(); };
    document.getElementById('lbl_go').onclick=labelsDownload;
    document.getElementById('lbl_skip').oninput=updateLabelCount;
    document.getElementById('lbl_hw').onclick=function(){ LBL_ROWS.push({kind:'hardware',poz:'',config:'HARDWARE',w:'',h:'',ref:'',on:true}); renderLabelRows(); };
  }
  async function labelsRead(){
    var fin=document.getElementById('lbl_file'), f=fin.files[0], st=document.getElementById('lbl_status');
    if(!f)return;
    document.getElementById('lbl_fname').textContent=f.name; st.textContent='Reading PDF…'; document.getElementById('lbl_result').style.display='none';
    var d; try{ var dataUrl=await fileToDataUrl(f); var r=await api('/api/labels/parse',{method:'POST',body:JSON.stringify({pdf:dataUrl})}); d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not read the PDF'); }
    catch(e){ st.innerHTML='<span style="color:#c0392b">'+esc(e.message||'Could not read the PDF')+'</span>'; fin.value=''; return; }
    LBL=d; LBL_ROWS=[];
    (d.positions||[]).forEach(function(p){ for(var i=0;i<p.qty;i++) LBL_ROWS.push({poz:p.poz,config:p.config,w:p.w==null?'':p.w,h:p.h==null?'':p.h,ref:p.refs[i]||'',on:true}); });
    document.getElementById('lbl_title').value=[d.order,d.job].filter(Boolean).join(' - ');
    st.innerHTML='<b>'+esc(d.order||'Order')+'</b>'+(d.date?' · '+esc(d.date):'')+(d.client?' · '+esc(d.client):'')+' · '+(d.positions||[]).length+' position(s) · <b>'+LBL_ROWS.length+'</b> piece(s) → <b>'+(LBL_ROWS.length*2)+'</b> labels';
    document.getElementById('lbl_warn').innerHTML=(d.warnings||[]).length?'<div class="podecide" style="margin:14px 0 0"><div class="msg"><b>Please check</b>'+d.warnings.map(function(w){return '<small>'+esc(w)+'</small>';}).join('')+'</div></div>':'';
    document.getElementById('lbl_all').checked=true;
    renderLabelRows(); document.getElementById('lbl_result').style.display='block';
    if(!LBL_ROWS.length) document.getElementById('lbl_result').style.display='none';
  }
  function renderLabelRows(){
    var tb=document.getElementById('lbl_rows');
    tb.innerHTML=LBL_ROWS.map(function(r,i){
      if(r.kind==='hardware') return '<tr><td><input type="checkbox" data-i="'+i+'" data-k="on"'+(r.on?' checked':'')+'></td><td></td><td colspan="4"><b>HARDWARE</b> <span class="sub" style="margin:0">— two labels with the word HARDWARE and the job line</span></td></tr>';
      var miss=!String(r.ref).trim()||!String(r.w).trim()||!String(r.h).trim();
      return '<tr'+(miss?' style="background:#fff8eb"':'')+'><td><input type="checkbox" data-i="'+i+'" data-k="on"'+(r.on?' checked':'')+'></td><td>'+r.poz+'</td><td style="font-size:12px;color:var(--muted)">'+esc(r.config||'')+'</td>'
        +'<td><input class="tinput" style="width:80px;padding:6px 8px" data-i="'+i+'" data-k="w" value="'+av(r.w)+'"></td>'
        +'<td><input class="tinput" style="width:80px;padding:6px 8px" data-i="'+i+'" data-k="h" value="'+av(r.h)+'"></td>'
        +'<td><input class="tinput" style="width:130px;padding:6px 8px" data-i="'+i+'" data-k="ref" value="'+av(r.ref)+'" placeholder="e.g. W01.1"></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-k]').forEach(function(el){
      var ev=el.type==='checkbox'?'onchange':'oninput';
      el[ev]=function(){ var r=LBL_ROWS[+el.getAttribute('data-i')]; var k=el.getAttribute('data-k'); r[k]=el.type==='checkbox'?el.checked:el.value; if(k==='on')updateLabelCount(); };
    });
    updateLabelCount();
  }
  function updateLabelCount(){ var n=LBL_ROWS.filter(function(r){return r.on;}).length; document.getElementById('lbl_go').textContent='Download labels PDF ('+(n*2)+' labels · '+Math.ceil((n+(+document.getElementById('lbl_skip').value||0))/4)+' sheet(s))'; }
  async function labelsDownload(){
    var rows=LBL_ROWS.filter(function(r){return r.on;}); if(!rows.length){tShow('Select at least one label');return;}
    var bad=rows.filter(function(r){return r.kind!=='hardware'&&(!String(r.w).trim()||!String(r.h).trim());}); if(bad.length){ alert('Enter W and H for every selected label (Poz. '+bad.map(function(r){return r.poz;}).join(', ')+').'); return; }
    var body={order:(LBL&&LBL.order)||'',title:document.getElementById('lbl_title').value,logo:document.getElementById('lbl_logo').checked,company:document.getElementById('lbl_company').checked,skipRows:+document.getElementById('lbl_skip').value||0,labels:rows.map(function(r){return r.kind==='hardware'?{kind:'hardware'}:{w:r.w,h:r.h,ref:r.ref};})};
    var btn=document.getElementById('lbl_go'); btn.disabled=true;
    try{
      var r=await fetch('/api/labels/pdf',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
      if(!r.ok){ var e=await r.json().catch(function(){return {};}); tShow(e.error||'Could not build the PDF'); return; }
      var blob=await r.blob(); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Etykiety '+(body.order||'labels')+'.pdf'; document.body.appendChild(a); a.click(); a.remove();
      loadLabelStats();
    } finally { btn.disabled=false; }
  }
  function poShowAwaiting(){ var sf=document.getElementById('poStatusFilter'); if(sf){sf.value='in_review';} loadPoRequests(); }
  async function refreshPoApprovalsBadge(){
    if(!canCap('purchasing.request')){ return; }
    try{ var d=await (await api('/api/po-approvals-count')).json(); var b=document.getElementById('poBadge');
      if(b){ if(d.awaiting>0){ b.textContent=d.awaiting; b.style.display='inline-block'; b.title=d.awaiting+' PO request(s) in review'; } else { b.style.display='none'; } }
    }catch(e){}
  }
  async function openPoSettings(){
    var d; try{ d=await (await api('/api/po-settings')).json(); }catch(e){ d={}; }
    var html='<div class="fgrid">'
      +'<div class="field full"><label>Notification “from” email</label><input id="pos_from" class="tinput" value="'+av(d.po_email_from||'')+'" placeholder="ACE Office &lt;noreply@yourdomain&gt;"></div>'
      +'<div class="field full"><label>App base URL (for links in messages)</label><input id="pos_url" class="tinput" value="'+av(d.app_base_url||'')+'" placeholder="https://office.acemark.com.pl"></div>'
      +'<div class="sub full" style="margin:2px 0 0">Email sending '+(d.email_configured?'is enabled (RESEND_API_KEY set).':'is OFF — set RESEND_API_KEY in the server environment to enable email.')+' Teams posting '+(d.teams_configured?'is enabled (TEAMS_PO_WEBHOOK set).':'is OFF — set TEAMS_PO_WEBHOOK (the channel’s Incoming Webhook URL) in the server environment.')+' Teams personal messages '+(d.teams_dm_configured?'are enabled (TEAMS_PO_DM_WEBHOOK set) \u2014 approvers and the requestor get a 1:1 chat from the Workflows bot.':'are OFF \u2014 set TEAMS_PO_DM_WEBHOOK (see docs/teams-po-notifications.md).')+' Under-£2k requests don’t need approval and send no notification.</div>'
      +'</div><div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="posSave">Save</button></div>';
    openModal('PO approval notifications', html);
    document.getElementById('posSave').onclick=async function(){
      var body={po_email_from:document.getElementById('pos_from').value,app_base_url:document.getElementById('pos_url').value};
      var r=await api('/api/po-settings',{method:'PUT',body:JSON.stringify(body)}); var dd=await r.json();
      if(r.ok&&dd.ok){closeModal();tShow('Notification settings saved');}else tShow(dd.error||'Could not save');
    };
  }
  async function poSetStatus(id,status,extra){
    var body=Object.assign({status:status},extra||{});
    var r=await api('/api/po-requests/'+id+'/status',{method:'POST',body:JSON.stringify(body)}); var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Updated');loadPoRequests();return true;}
    tShow(d.error||'Failed'); return false;
  }

  // ---- Cost centres (Admin) ----
  var CC_ALL=[], CC_CANMANAGE=false;
  async function loadCostCentres(){
    var d; try{ d=await (await api('/api/cost-centres')).json(); }catch(e){ d={costCentres:[],canManage:false}; }
    CC_CANMANAGE=!!d.canManage; CC_ALL=d.costCentres||[];
    var nb=document.getElementById('newCcBtn'); if(nb)nb.style.display=d.canManage?'inline-block':'none';
    var ib=document.getElementById('importEqBtn'); if(ib)ib.style.display=d.canManage?'inline-block':'none';
    renderCostCentres();
  }
  function renderCostCentres(){
    var typeLabel={framework:'Framework',enquiry:'Enquiry / job',general:'General / overhead'};
    var tf=(document.getElementById('ccTypeFilter')||{}).value||'';
    var q=((document.getElementById('ccSearch')||{}).value||'').trim().toLowerCase();
    var rows=CC_ALL.filter(function(c){
      if(tf&&c.type!==tf)return false;
      if(q&&(String(c.code||'').toLowerCase().indexOf(q)<0)&&(String(c.label||'').toLowerCase().indexOf(q)<0))return false;
      return true;
    });
    var cnt=document.getElementById('ccCount'); if(cnt)cnt.textContent=rows.length+' of '+CC_ALL.length;
    var tb=document.getElementById('ccRows');
    tb.innerHTML=rows.length?rows.map(function(c){
      var act='<a class="codelink" data-act="edit" data-id="'+c.id+'">'+(CC_CANMANAGE?'Edit':'View')+'</a>';
      if(CC_CANMANAGE)act+=' &nbsp; <a class="codelink" style="color:#c0392b" data-act="del" data-id="'+c.id+'" data-code="'+av(c.code)+'">Delete</a>';
      return '<tr><td><b class="mono">'+esc(c.code)+'</b></td><td>'+esc(c.label||'')+'</td><td>'+(typeLabel[c.type]||c.type)+'</td>'
        +'<td>'+(c.active?'<span class="count green">active</span>':'<span class="count">inactive</span>')+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+act+'</td></tr>';
    }).join(''):'<tr><td colspan="5" class="ro">No cost centres match.</td></tr>';
    Array.prototype.forEach.call(tb.querySelectorAll('a[data-act]'),function(a){
      a.onclick=function(){ var id=a.getAttribute('data-id'); if(a.getAttribute('data-act')==='edit')openCostCentre(id); else delCostCentre(id,a.getAttribute('data-code')); };
    });
  }
  function openCostCentre(id){
    var cc={code:'',label:'',type:'general',active:true};
    if(id){ cc=CC_ALL.filter(function(x){return x.id===id;})[0]||cc; }
    var ro=!CC_CANMANAGE;
    var types=[['framework','Framework'],['general','General / overhead'],['enquiry','Enquiry / job']];
    var typeOpts=types.map(function(t){return '<option value="'+t[0]+'"'+(cc.type===t[0]?' selected':'')+'>'+t[1]+'</option>';}).join('');
    var html='<div class="fgrid">'
      +'<div class="field"><label>Code *</label><input id="cc_code" class="tinput" value="'+av(cc.code)+'" placeholder="e.g. L2025 17525 or PCC LAB Phase 1" '+(ro?'disabled':'')+'></div>'
      +'<div class="field"><label>Type</label><select id="cc_type" class="tinput" '+(ro?'disabled':'')+'>'+typeOpts+'</select></div>'
      +'<div class="field full"><label>Description</label><input id="cc_label" class="tinput" value="'+av(cc.label||'')+'" placeholder="framework phase or enquiry / job name" '+(ro?'disabled':'')+'></div>'
      +(id?'<div class="field full"><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="cc_active" '+(cc.active?'checked':'')+' '+(ro?'disabled':'')+'> Active</label></div>':'')
      +'</div>';
    var foot=ro?'<div class="foot"><button class="cancel" onclick="closeModal()">Close</button></div>'
      :'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" id="ccSaveBtn">Save</button></div>';
    openModal(id?('Cost centre '+esc(cc.code)):'New cost centre', html+foot);
    var sb=document.getElementById('ccSaveBtn'); if(sb)sb.onclick=function(){ saveCostCentre(id||''); };
  }
  async function saveCostCentre(id){
    var body={code:(document.getElementById('cc_code').value||'').trim(),label:document.getElementById('cc_label').value,type:document.getElementById('cc_type').value};
    var ae=document.getElementById('cc_active'); if(ae)body.active=ae.checked;
    if(!body.code){tShow('Code required');return;}
    var r=id?await api('/api/cost-centres/'+id,{method:'PUT',body:JSON.stringify(body)}):await api('/api/cost-centres',{method:'POST',body:JSON.stringify(body)});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Saved');loadCostCentres();}else tShow(d.error||'Could not save');
  }
  async function delCostCentre(id,code){
    if(!confirm('Delete cost centre '+code+'?'))return;
    var r=await api('/api/cost-centres/'+id,{method:'DELETE'}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Deleted');loadCostCentres();}else tShow(d.error||'Could not delete');
  }
  async function importEnquiries(){
    if(!confirm('Import cost centres from the Enquiries board? Scans all live enquiries and adds/updates job cost centres.'))return;
    tShow('Importing from Enquiries — this can take a moment…');
    try{
      var r=await api('/api/cost-centres/import-enquiries',{method:'POST',body:'{}'}); var d=await r.json();
      if(r.ok&&d.ok){tShow(d.added+' added · '+d.updated+' updated · '+d.unparsed+' unparsed (of '+d.scanned+' scanned)');loadCostCentres();}
      else tShow(d.error||'Import failed');
    }catch(e){tShow('Import failed');}
  }

  // ---- Customers (Admin) ----
  var CUST_CANMANAGE=false;
  async function loadCustAdmin(){
    var d; try{ d=await (await api('/api/customers-master')).json(); }catch(e){ d={customers:[],canManage:false}; }
    CUST_CANMANAGE=!!d.canManage;
    var nb=document.getElementById('newCustBtn'); if(nb)nb.style.display=d.canManage?'inline-block':'none';
    var rb=document.getElementById('reqTypesBtn'); if(rb)rb.style.display=d.canManage?'inline-block':'none';
    var tb=document.getElementById('custRows'); var rows=d.customers||[];
    tb.innerHTML=rows.length?rows.map(function(c){
      var act='<a class="codelink" onclick="openCustomer(\\''+c.id+'\\')">'+(d.canManage?'Edit':'View')+'</a>';
      if(d.canManage)act+=' &nbsp; <a class="codelink" style="color:#c0392b" onclick="delCustomer(\\''+c.id+'\\',\\''+av(c.code)+'\\')">Delete</a>';
      return '<tr><td><b class="mono">'+esc(c.code)+'</b></td><td>'+esc(c.name)+'</td><td>'+c.contacts+'</td><td>'+c.requirements+'</td>'
        +'<td>'+(c.active?'<span class="count green">active</span>':'<span class="count">inactive</span>')+'</td>'
        +'<td style="text-align:right;white-space:nowrap">'+act+'</td></tr>';
    }).join(''):'<tr><td colspan="6" class="ro">No customers yet — create one to start adding its jobs.</td></tr>';
  }
  function custContactRow(c){ c=c||{};
    return '<div class="crow" style="display:flex;gap:6px;margin-bottom:6px">'
      +'<input class="tinput cc-role" placeholder="Role e.g. Contract manager" value="'+av(c.role||'')+'" style="flex:1.1">'
      +'<input class="tinput cc-name" placeholder="Name" value="'+av(c.name||'')+'" style="flex:1">'
      +'<input class="tinput cc-email" placeholder="Email" value="'+av(c.email||'')+'" style="flex:1.2">'
      +'<input class="tinput cc-phone" placeholder="Phone" value="'+av(c.phone||'')+'" style="flex:0.9">'
      +'<button type="button" class="cancel" onclick="this.parentNode.remove()" title="Remove">✕</button></div>';
  }
  function addContactRow(){ document.getElementById('custContacts').insertAdjacentHTML('beforeend',custContactRow()); }
  function collectContacts(){
    return Array.prototype.map.call(document.querySelectorAll('#custContacts .crow'),function(r){
      return {role:r.querySelector('.cc-role').value.trim(),name:r.querySelector('.cc-name').value.trim(),email:r.querySelector('.cc-email').value.trim(),phone:r.querySelector('.cc-phone').value.trim()};
    }).filter(function(x){return x.role||x.name||x.email||x.phone;});
  }
  async function openCustomer(id){
    var cust={code:'',name:'',active:true,contacts:[]}, reqs=[];
    if(id){ var d=await (await api('/api/customers-master/'+id)).json(); if(d.error){tShow(d.error);return;} cust=d.customer; reqs=d.requirements||[]; }
    else { var t=await (await api('/api/requirement-types')).json(); reqs=(t.types||[]).map(function(x){return {id:x.id,name:x.name,active:x.active,checked:false};}); }
    var ro=!CUST_CANMANAGE;
    var reqHtml=reqs.filter(function(r){return r.active||r.checked;}).map(function(r){
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin:0 14px 8px 0;font-size:13px"><input type="checkbox" class="cust-req" data-id="'+r.id+'" '+(r.checked?'checked':'')+' '+(ro?'disabled':'')+'> '+esc(r.name)+(r.active?'':' <span class="ro">(retired)</span>')+'</label>';
    }).join('')||'<div class="ro">No requirement types yet — add some via “Requirements list”.</div>';
    var html='<div class="fgrid">'
      +'<div class="field"><label>Customer code *</label><input id="cust_code" class="tinput" value="'+av(cust.code)+'" placeholder="e.g. AXS" style="text-transform:uppercase" '+(ro?'disabled':'')+'></div>'
      +'<div class="field"><label>Full name *</label><input id="cust_name" class="tinput" value="'+av(cust.name)+'" placeholder="e.g. Axis Europe" '+(ro?'disabled':'')+'></div>'
      +(id?'<div class="field full"><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="cust_active" '+(cust.active?'checked':'')+' '+(ro?'disabled':'')+'> Active</label></div>':'')
      +'<div class="groupt">CONTACTS</div>'
      +'<div class="field full"><div id="custContacts">'+(cust.contacts||[]).map(custContactRow).join('')+'</div>'+(ro?'':'<button type="button" class="add" onclick="addContactRow()" style="margin-top:4px">+ Add contact</button>')+'</div>'
      +'<div class="groupt">CONTRACTUAL REQUIREMENTS</div>'
      +'<div class="field full">'+reqHtml+'</div></div>';
    var foot=ro?'<div class="foot"><button class="cancel" onclick="closeModal()">Close</button></div>'
      :'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="saveCustomer('+(id?'\\''+id+'\\'':'')+')">Save customer</button></div>';
    openModal(id?('Customer '+esc(cust.code)):'New customer', html+foot);
  }
  async function saveCustomer(id){
    var code=(document.getElementById('cust_code').value||'').trim().toUpperCase();
    var name=(document.getElementById('cust_name').value||'').trim();
    if(!code||!name){tShow('Code and name are required');return;}
    var reqIds=Array.prototype.map.call(document.querySelectorAll('.cust-req:checked'),function(cb){return cb.getAttribute('data-id');});
    var body={code:code,name:name,contacts:collectContacts(),requirement_ids:reqIds};
    var ae=document.getElementById('cust_active'); if(ae)body.active=ae.checked;
    var r=id?await api('/api/customers-master/'+id,{method:'PUT',body:JSON.stringify(body)}):await api('/api/customers-master',{method:'POST',body:JSON.stringify(body)});
    var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Customer saved');loadCustAdmin();}else tShow(d.error||'Could not save');
  }
  async function delCustomer(id,code){
    if(!confirm('Delete customer '+code+'?'))return;
    var r=await api('/api/customers-master/'+id,{method:'DELETE'}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Customer deleted');loadCustAdmin();}else tShow(d.error||'Could not delete');
  }
  async function openReqTypes(){
    var d=await (await api('/api/requirement-types')).json();
    var rows=(d.types||[]).map(function(t){
      return '<div class="crow" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
        +'<input class="tinput rt-name" value="'+av(t.name)+'" style="flex:1">'
        +'<label style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px"><input type="checkbox" class="rt-active" '+(t.active?'checked':'')+'> active</label>'
        +'<button type="button" class="cancel" onclick="saveReqType(\\''+t.id+'\\',this)">Save</button>'
        +'<button type="button" class="cancel" style="color:#c0392b" onclick="delReqType(\\''+t.id+'\\')">✕</button></div>';
    }).join('')||'<div class="ro">No requirements yet.</div>';
    var html='<div class="field full"><div id="reqTypeRows">'+rows+'</div></div>'
      +'<div class="field full" style="display:flex;gap:6px"><input id="rt_new" class="tinput" placeholder="New requirement, e.g. Secured by Design" style="flex:1"><button type="button" class="add" onclick="addReqType()">Add</button></div>';
    openModal('Contractual requirements list', html+'<div class="foot"><button class="cancel" onclick="closeModal()">Done</button></div>');
  }
  async function addReqType(){
    var name=(document.getElementById('rt_new').value||'').trim(); if(!name){tShow('Enter a name');return;}
    var r=await api('/api/requirement-types',{method:'POST',body:JSON.stringify({name:name})}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Added');openReqTypes();}else tShow(d.error||'Failed');
  }
  async function saveReqType(id,btn){
    var row=btn.parentNode; var name=row.querySelector('.rt-name').value.trim(); var active=row.querySelector('.rt-active').checked;
    var r=await api('/api/requirement-types/'+id,{method:'PUT',body:JSON.stringify({name:name,active:active})}); var d=await r.json();
    if(r.ok&&d.ok)tShow('Saved');else tShow(d.error||'Failed');
  }
  async function delReqType(id){
    if(!confirm('Delete this requirement type? It is removed from all customers.'))return;
    var r=await api('/api/requirement-types/'+id,{method:'DELETE'}); var d=await r.json();
    if(r.ok&&d.ok){tShow('Deleted');openReqTypes();}else tShow(d.error||'Failed');
  }

  // ---- In-app QA test run ----
  var TESTS={scenarios:[],results:{},version:'',current:'',versions:[]}; var TEST_VER='';
  async function loadTests(){
    var q=TEST_VER?('?version='+encodeURIComponent(TEST_VER)):'';
    try{TESTS=await (await api('/api/tests'+q)).json();}catch(e){TESTS={scenarios:[],results:{},version:'',current:'',versions:[]};}
    if(!TEST_VER)TEST_VER=TESTS.version;
    var vsel=document.getElementById('testVer');
    if(vsel){
      var vers=TESTS.versions||[];
      vsel.innerHTML=vers.map(function(v){return '<option value="'+av(v.version)+'">v'+esc(v.version)+(v.version===TESTS.current?' (current)':'')+' \u00b7 '+v.count+' tested'+(v.last?(' \u00b7 '+new Date(v.last).toLocaleDateString('en-GB')):'')+'</option>';}).join('');
      vsel.value=TESTS.version;
    }
    var areas=[]; TESTS.scenarios.forEach(function(s){if(areas.indexOf(s.area)<0)areas.push(s.area);});
    var av0=document.getElementById('testArea').value;
    document.getElementById('testArea').innerHTML='<option value="">All areas</option>'+areas.map(function(a){return '<option value="'+av(a)+'">'+esc(a)+'</option>';}).join('');
    document.getElementById('testArea').value=av0;
    renderTests();
  }
  function changeTestVer(){ TEST_VER=document.getElementById('testVer').value; loadTests(); }
  function testCounts(){var ok=0,nok=0,un=0;TESTS.scenarios.forEach(function(x){var g=TESTS.results[x.code];if(!g)un++;else if(g.status==='ok')ok++;else nok++;});return {total:TESTS.scenarios.length,ok:ok,nok:nok,un:un};}
  function renderTests(){
    var area=document.getElementById('testArea').value, st=document.getElementById('testStatus').value;
    var c=testCounts();
    var readonly=!!(TESTS.current&&TESTS.version!==TESTS.current);
    document.getElementById('testProg').innerHTML='v'+esc(TESTS.version)+' &middot; '+(c.ok+c.nok)+'/'+c.total+' tested &middot; <b style="color:#16a34a">'+c.ok+' OK</b> &middot; <b style="color:var(--magenta)">'+c.nok+' NOK</b> &middot; '+c.un+' untested'+(readonly?' &middot; <b style="color:#b45309">read-only (historical)</b>':'');
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
        +(readonly
          ? '<div class="tact"><span class="tmeta">read-only</span></div>'
          : ('<div class="tact"><input id="tc_'+s.code+'" class="tcomment" placeholder="Comment (optional)" value="'+av(g&&g.comment?g.comment:'')+'">'
            +'<div class="tbtns"><button class="tbtn tokbtn" onclick="submitTest(\\''+s.code+'\\',\\'ok\\')">OK</button>'
            +'<button class="tbtn tnokbtn" onclick="submitTest(\\''+s.code+'\\',\\'nok\\')">NOK</button></div></div>'))
        +'</div>';
    }).join('')||'<div class="empty" style="padding:20px">No scenarios match this filter.</div>';
  }
  async function exportTests(){
    try{var r=await fetch('/api/tests/export.csv'+(TEST_VER?('?version='+encodeURIComponent(TEST_VER)):''),{headers:{Authorization:'Bearer '+token}});
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
    wrap.innerHTML='<div class="spbox"><div class="sphead"><b>Choose a Clearview style</b><span class="spclose" onclick="closeStylePicker()">✕</span></div>'
      +'<div class="spfilters"><input id="spQ" placeholder="Search code…" oninput="spSetQ(this.value)"><span id="spTypes"></span><span id="spWide"></span><span id="spHigh"></span></div>'
      +'<div class="spgrid" id="spGrid"></div></div>';
    await loadStyles(); spRenderChips(); renderStyleGrid();
  }
  function istatLabel(v){var m=ISTATUS.filter(function(s){return s[0]===(v||'')});return (m[0]||['','—'])[1];}
  async function openDetail(id){
    openModal('Loading…','<div class="empty">Loading…</div>');
    var d=await (await api('/api/item/'+id+'/detail')).json(); var it=d.item; _detailItem=it;
    function row(k,v){return (v==null||v==='')?'':'<div class="drow"><dt>'+k+'</dt><dd>'+v+'</dd></div>';}
    function attr(v){return (v==null?'':esc(String(v))).replace(/"/g,'&quot;');}
    function fieldV(id,label,val,ph,type){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+attr(val)+'" placeholder="'+(ph||'')+'"></div>';}
    function selField(id,label,val,opts){var cur=String(val==null?'':val);var list=opts.slice();if(cur&&list.indexOf(cur)<0)list.unshift(cur);/* keep any non-standard stored value visible, never silently blank it */var o='<option value="">—</option>'+list.map(function(x){return '<option'+(cur===x?' selected':'')+'>'+esc(x)+'</option>';}).join('');return '<div class="field"><label>'+label+'</label><select id="'+id+'">'+o+'</select></div>';}
    function chkField(id,label,checked){return '<div class="field"><label>'+label+'</label><label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:400;color:var(--ink)"><input type="checkbox" id="'+id+'"'+(checked?' checked':'')+'> equally spaced</label></div>';}
    var html='<dl class="dl">'
      +row('Full code','<span class="mono">'+esc(it.full_code)+'</span>')
      +row('Stage',esc(STAGE[it.stage]||it.stage))
      +row('Location',[it.block,it.elevation,(it.flat?('Flat '+it.flat):''),(it.floor?('Floor '+it.floor):''),it.room_code,it.item_code].filter(function(x){return x;}).map(esc).join(' · '))
      +row('Team',esc(d.team||'—'))+row('Fitting rate',esc(d.effective_rate))
      +row('Install status',esc(istatLabel(it.install_status)))
      +row('Install date',esc(it.actual_install_date))
      +row('Monday',d.monday_url?'<a class="mlink" target="_blank" href="'+d.monday_url+'">open ↗</a>':'not synced')
      +'</dl>';
    // Contractual requirements inherited from the job's customer (read-only; set on the customer card).
    if(d.requirements&&d.requirements.length){
      html+='<div class="groupt" style="padding:10px 22px 0">CONTRACTUAL REQUIREMENTS'+(d.customer_code?(' · '+esc(d.customer_code)):'')+'</div>'
        +'<div style="padding:4px 22px 10px;display:flex;flex-wrap:wrap;gap:6px">'
        +d.requirements.map(function(rq){return '<span style="background:#efeaf9;color:var(--purple);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600">'+esc(rq)+'</span>';}).join('')
        +'</div>';
    }
    // Editable Flat + Room (rebuild the item code) — the other code parts (Block/Elevation/Item) are
    // set in the Items table. Locked once synced to Monday.
    var codeEditable=!d.is_snag&&canCap('items.edit')&&!it.monday_item_id;
    if(codeEditable){
      html+='<div class="groupt" style="padding:12px 22px 0">LOCATION</div><div class="fgrid" style="padding:6px 22px 6px">'
        +'<div class="field"><label>Flat / plot</label><input id="f_flat_edit" value="'+attr(it.flat)+'" placeholder="e.g. 12"></div>'
        +'<div class="field"><label>Room *</label><select id="f_room_edit">'+roomOptions(it.room_code||'')+'</select></div>'
        +'<div class="sub full" style="margin:0">Changing Flat or Room rebuilds the item code. Block, Elevation and Item are set in the Items table.</div>'
        +'</div>';
    }
    var specEditable=!d.is_snag&&canCap('items.edit');
    if(specEditable){
      html+='<div class="groupt" style="padding:12px 22px 0">SPECIFICATION</div><div class="fgrid" style="padding:6px 22px 12px">'
        +'<div class="field full"><label>Design code (Clearview style)</label><div style="display:flex;gap:8px;align-items:center">'
          +'<input id="f_design" type="text" value="'+attr(it.design_code)+'" placeholder="e.g. 27" style="flex:1" oninput="stylePreview()">'
          +'<button type="button" class="add" onclick="openStylePicker()">Choose style…</button>'
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
    } else { html+='<div class="groupt" style="padding:0 22px">PHOTOS</div><div class="empty">No photos yet — add one below, or they arrive from the mobile survey / install flow.</div>'; }
    if(canCap('photos.add')){
      var pcol=(myRole==='fitter')?'Picture After':'Picture Before';
      html+='<div style="padding:2px 22px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
        +'<input type="file" id="itemPhoto" accept="image/*" style="font-size:12px">'
        +'<button class="save" onclick="uploadItemPhoto(\\''+it.id+'\\')">Add photo</button>'
        +'<span style="font-size:11px;color:var(--muted)">→ syncs to Monday <b>'+pcol+'</b></span></div>';
    }
    if(d.is_snag){
      html+='<div class="empty">This is a snag item — set its team and labour cost above, then sync and fit it like any item.</div>';
    } else if(myRole!=='surveyor'&&myRole!=='scanner'){
      html+='<div class="groupt" style="padding:10px 22px 0">SNAGS (remedial items)</div>';
      if(d.snags&&d.snags.length){
        html+='<div style="padding:2px 22px 0">'+d.snags.map(function(s){
          var st=s.synced?'<span class="count green">synced</span>':'<span class="count amber">not synced</span>';
          var link=s.monday_url?' · <a class="mlink" target="_blank" href="'+s.monday_url+'">Monday ↗</a>':'';
          return '<div style="padding:10px 0;border-top:1px solid #f2f0f8">'
            +'<a class="codelink mono" style="font-size:11px;word-break:break-all" onclick="openDetail(\\''+s.id+'\\')">'+esc(s.full_code)+'</a>'
            +'<div style="font-size:13px;margin-top:4px">'+esc(s.comment||'')+'</div>'
            +'<div style="font-size:11px;color:var(--muted);margin-top:4px">'+st+' · rate '+esc(s.rate)+' · '+esc(s.team||'no team')+link+'</div>'
            +'</div>';
        }).join('')+'</div>';
      } else { html+='<div class="empty">No snags yet.</div>'; }
      var topts='<option value="">— team to fit (optional) —</option>'+(d.teams||[]).map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join('');
      html+='<div style="padding:2px 22px 22px">'
        +'<textarea id="snagDesc" rows="2" placeholder="Describe the snag…" style="width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 10px;font-size:13px;font-family:inherit"></textarea>'
        +'<div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">'
        +'<span style="font-size:12px;color:var(--muted)">£</span><input id="snagRate" type="number" min="0" step="1" placeholder="labour (optional)" style="width:150px;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:12px">'
        +'<select id="snagTeam" class="sel">'+topts+'</select>'
        +'<input type="file" id="snagPhoto" accept="image/*" style="font-size:12px">'
        +'<button class="save" onclick="logSnag(\\''+it.id+'\\')">Raise snag</button>'
        +'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:6px">Creates a separate item ('+esc(it.full_code)+'-S…) you can cost, assign a team, sync and fit like any other.</div>'
        +'</div>';
    }
    if(specEditable){ // sticky Save pinned to the bottom of the drawer, always visible while scrolling
      html+='<div class="sheetfoot"><button class="save" onclick="saveDetail(\\''+it.id+'\\')">Save details</button>'
        +'<button class="add" onclick="markSurveyed(\\''+it.id+'\\')">Save &amp; mark Surveyed</button>'
        +'<span class="sub" style="margin:0">Save keeps this open; changes mark the item to re-sync to Monday.</span></div>';
    }
    document.getElementById('modalTitle').innerHTML=(d.is_snag?'Snag ':'Item ')+'<span class="mono">'+esc(it.full_code)+'</span>';
    html+='<div class="groupt" style="padding:12px 22px 0">ACTIVITY</div>'
      +'<div id="itemActivity" style="padding:2px 22px 20px"><div class="sub">Loading…</div></div>';
    document.getElementById('modalBody').innerHTML=html;
    if(document.getElementById('f_design'))stylePreview(); // show the design sketch if a code is set
    var frm=document.getElementById('f_room_edit'); if(frm)frm.addEventListener('change',function(){saveDetailCode(it.id,'room',this.value);});
    var flt=document.getElementById('f_flat_edit'); if(flt)flt.addEventListener('change',function(){saveDetailCode(it.id,'flat',this.value);});
    if(specEditable)highlightNeedFill(it); // flag the required fields still to complete
    loadItemActivity(it.id);
  }
  // Save an edited Flat/Room from the item drawer (rebuilds the code), then reopen it refreshed.
  async function saveDetailCode(id,field,value){
    var body=field==='flat'?{flat:value}:{room:value};
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(body)})).json();
    if(d.ok)tShow(field==='room'?'Room saved':'Flat saved'); else tShow(d.error||'Update failed');
    loadItems(); openDetail(id);
  }
  var ACT_LABELS={material:'Material',item_type:'Item type',window_type:'Window type',glass:'Glass',safety_glass:'Safety glass',glazing:'Glazing',glazing_bars:'Glazing bars',cill_depth:'Cill depth',open_in_out:'Open in/out',add_ons:'Add-ons',coupled:'Coupled',design_code:'Design code',comments:'Comments',width_mm:'Width',height_mm:'Height',cill_depth_mm:'Cill depth',transom1_mm:'Transom 1',transom2_mm:'Transom 2',transom3_mm:'Transom 3',mullion1_mm:'Mullion 1',mullion2_mm:'Mullion 2',mullion3_mm:'Mullion 3',transom_equal:'Transoms equal',mullion_equal:'Mullions equal',install_status:'Install status',team_id:'Team',stage:'Stage',po_phase:'PO phase',rate_override_pennies:'Rate override',flat:'Flat',room_code:'Room',floor:'Floor'};
  function actLabel(f){return ACT_LABELS[f]||f;}
  function actVal(f,v){
    if(v==null||v==='')return '—';
    if(f==='install_status')return ISTATUS_LABEL[v]||v;
    if(f==='team_id')return teamName(v)||v;
    if(f==='stage')return (STAGE[v]||v);
    if(f==='room_code')return roomLabel(v);
    if(f==='rate_override_pennies')return '£'+(Number(v)/100);
    return String(v);
  }
  function actWhen(iso){ try{ return new Date(iso).toLocaleString('en-GB'); }catch(e){ return ''; } }
  function actRowHtml(ev){
    var verb=ev.action==='item.sync'?'synced to Monday':(ev.action==='item.update'?'edited':(ev.action==='import.commit'?'imported':ev.action));
    var chips='';
    (ev.changes||[]).forEach(function(c){ chips+='<div class="actchg">'+esc(actLabel(c.field))+': <span class="actfrom">'+esc(actVal(c.field,c.from))+'</span> &rarr; <b>'+esc(actVal(c.field,c.to))+'</b></div>'; });
    if(!chips&&ev.summary)chips='<div class="actchg">'+esc(ev.summary)+'</div>';
    return '<div class="actrow"><div class="actmeta"><b>'+esc(ev.actor||'—')+'</b>'+(ev.role?(' <span style="color:var(--muted)">('+esc(ev.role)+')</span>'):'')+' '+esc(verb)+'<span class="actwhen">'+esc(actWhen(ev.at))+'</span></div>'+chips+'</div>';
  }
  var _actAll=[], _actShown=0;
  async function loadItemActivity(id){
    var box=document.getElementById('itemActivity'); if(!box)return;
    var d; try{ d=await (await api('/api/item/'+encodeURIComponent(id)+'/activity')).json(); }catch(e){ box.innerHTML='<div class="sub">Could not load activity.</div>'; return; }
    _actAll=(d.events||[]);
    _actCreated=d.created;
    _actShown=Math.min(20,_actAll.length);
    renderItemActivity();
  }
  var _actCreated=null;
  function renderItemActivity(){
    var box=document.getElementById('itemActivity'); if(!box)return;
    var html='';
    for(var i=0;i<_actShown;i++){ html+=actRowHtml(_actAll[i]); }
    if(_actShown<_actAll.length){ html+='<span class="actmore" onclick="_actShown=_actAll.length;renderItemActivity()">Show all '+_actAll.length+' changes</span>'; }
    if(_actCreated&&_actCreated.at){
      html+='<div class="actrow"><div class="actmeta"><b>'+esc(_actCreated.actor||'—')+'</b> created this item'+(_actCreated.via?(' via '+esc(_actCreated.via)):'')+'<span class="actwhen">'+esc(actWhen(_actCreated.at))+'</span></div></div>';
    }
    if(!html)html='<div class="sub">No recorded activity yet.</div>';
    box.innerHTML=html;
  }
  // Highlight (in the Unfinished colour) the required fields that are still empty, so the user
  // knows exactly what to fill in to mark the item finished.
  function highlightNeedFill(it){
    function empty(v){return v==null||String(v).trim()==='';}
    var map={f_material:empty(it.material),f_type:empty(it.item_type),f_glass:empty(it.glass),f_glazing:empty(it.glazing),f_openinout:empty(it.open_in_out),f_width:!(Number(it.width_mm)>0),f_height:!(Number(it.height_mm)>0),f_design:empty(it.design_code),
      f_room_edit:empty(it.room_code),f_flat_edit:(empty(it.flat)&&empty(it.floor))};
    var anyField=false;
    Object.keys(map).forEach(function(fid){ if(!map[fid])return; var el=document.getElementById(fid); if(!el)return; anyField=true; var f=el.closest('.field'); if(f)f.classList.add('needfill'); });
    // Code parts not editable here (Block / Elevation) — note them so the user sets them in the table.
    var code=[];
    if(empty(it.block))code.push('Block'); if(empty(it.elevation))code.push('Elevation');
    // Room / Flat-or-Floor are highlighted above when the drawer offers them; otherwise note them.
    if(empty(it.room_code)&&!document.getElementById('f_room_edit'))code.push('Room');
    if(empty(it.flat)&&empty(it.floor)&&!document.getElementById('f_flat_edit'))code.push('Flat or Floor');
    if(anyField||code.length){
      var body=document.getElementById('modalBody');
      var note=document.createElement('div'); note.className='needfill-note';
      note.innerHTML='<b>To finish this item</b>, complete the highlighted field'+(anyField?'s':'')+' below'+(code.length?(', and set in the Items table: <b>'+esc(code.join(', '))+'</b>'):'')+'.';
      var g=body.querySelector('.groupt'); if(g&&g.parentNode){g.parentNode.insertBefore(note,g);} else {body.insertBefore(note,body.firstChild);}
    }
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
  // Required fields still missing for the currently-open item (from the drawer form + code fields).
  var _detailItem=null;
  function itemSurveyMissing(){
    var it=_detailItem||{};
    function g(id){var e=document.getElementById(id);return e?String(e.value||'').trim():'';}
    function has(v){return v!=null&&String(v).trim()!=='';}
    var room=document.getElementById('f_room_edit')?g('f_room_edit'):(it.room_code||'');
    var flat=document.getElementById('f_flat_edit')?g('f_flat_edit'):(it.flat||'');
    var miss=[];
    if(!has(it.block))miss.push('Block');
    if(!has(it.elevation))miss.push('Elevation');
    if(!has(room))miss.push('Room');
    if(!has(it.item_code))miss.push('Item');
    if(!has(g('f_material')))miss.push('Material');
    if(!has(g('f_type')))miss.push('Item type');
    if(!has(g('f_glass')))miss.push('Glass');
    if(!has(g('f_glazing')))miss.push('Glazing');
    if(!(Number(g('f_width'))>0))miss.push('Width');
    if(!(Number(g('f_height'))>0))miss.push('Height');
    if(!has(g('f_openinout')))miss.push('Open in/out');
    if(!has(g('f_design')))miss.push('Style');
    if(!has(flat)&&!has(it.floor))miss.push('Flat or Floor');
    return miss;
  }
  async function markSurveyed(id){
    var miss=itemSurveyMissing();
    if(miss.length){ tShow('Fill required fields first: '+miss.join(', ')); if(_detailItem)highlightNeedFill(_detailItem); return; }
    var body=collectDetail(); body.stage='surveyed';
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(body)})).json();
    if(d.ok){tShow('Saved · marked Surveyed');loadItems();closeModal();}else tShow(d.error||'Save failed');
  }
  function fileToDataUrl(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result)};r.onerror=rej;r.readAsDataURL(file);});}
  async function logSnag(id){
    var desc=(document.getElementById('snagDesc').value||'').trim(); if(!desc){tShow('Enter a snag comment');return;}
    var rate=document.getElementById('snagRate').value, team=document.getElementById('snagTeam').value;
    var f=document.getElementById('snagPhoto').files[0]; var photo=null;
    if(f){ if(f.size>4*1024*1024){tShow('Photo too large (max 4MB)');return;} photo=await fileToDataUrl(f); }
    tShow('Raising snag…');
    var body={description:desc,rate_pennies:(rate===''?null:Math.round(Number(rate)*100)),team_id:team,photo:photo};
    var d=await (await api('/api/item/'+id+'/snags',{method:'POST',body:JSON.stringify(body)})).json();
    if(d.ok){tShow('Snag created: '+d.full_code);openDetail(id);loadItems();}
    else tShow(d.error||'Could not create snag');
  }
  async function uploadItemPhoto(id){
    var f=document.getElementById('itemPhoto').files[0];
    if(!f){tShow('Choose a photo first');return;}
    if(f.size>6*1024*1024){tShow('Photo too large (max 6MB)');return;}
    tShow('Uploading photo…');
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
  } else if(token){refreshLang();document.getElementById('appView').style.display='block';document.getElementById('loginView').style.display='none';applyRole();if(myRole==='logistics'||myRole==='acemark_finance'){showTab(restoreTab());}else{loadJobs().then(loadItems).then(function(){showTab(restoreTab());openPendingPo();}).catch(logout);}}
</script></body></html>`;

// ---- standalone live wallboard (dark, auto-refreshing, key-gated) ----
const LIVE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ACE — Live</title>
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
    <div class="brand">ACE<b>GROUP</b> <span>· Live</span></div>
    <div class="live"><span class="dot"></span>LIVE</div>
    <div class="upd" id="upd">—</div>
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
        +'<div class="jmeta">'+j.items+' items · '+j.snags+' snags · '+esc(j.labour)+'</div></div>'
        +bar('Synced',pct(j.synced,j.items),'')+bar('Installed',pct(j.installed,j.items),'green')
        +(j.openSnags?'<div class="warnpill">⚠ '+j.openSnags+' open snag'+(j.openSnags>1?'s':'')+'</div>':'')+'</div>';
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
      var n=new Date();document.getElementById('upd').textContent='updated '+n.toLocaleTimeString()+' · refreshes every 30s';
    }catch(err){showMsg('Can\\'t reach the office server. Is it running?');}
  }
  load(); setInterval(load, 30000);
</script></body></html>`;
