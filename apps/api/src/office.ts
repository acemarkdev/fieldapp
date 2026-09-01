// ACE Office web app (Stage 1): real Supabase-Auth login, view jobs/items,
// edit fitting rate / install status / team, and push an item to Monday.
// The service-role key and Monday token stay on the server; the browser only
// ever holds the logged-in user's short-lived JWT.
//
// Run:  node --env-file=.env --import tsx apps/api/src/office.ts
// Then open http://localhost:3000. Needs SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env, and a login created via create-admin.

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { db, ACE_TENANT } from './supabase';
import { listPricingRules, getPricingRule, createPricingRule, updatePricingRule, deletePricingRule,
  getJobRuleId, setJobRuleId, listItemPricing, setItemPricing,
  latestTestResults, insertTestResult, allTestResults } from './store';
import { priceJob, classifyCategory, type PriceItem } from '@ace/shared';
import { createJob, bulkDeleteItems, countItemsForJob, deleteJob, roomCodeCounts, setJobMappingDate, bulkInsertSurveyItems, codeExists } from './store';
import { listJobs, getJob, getJobByCode, listSurveyItems, listTeams, listScheduledItems, getSurveyItem,
  getTeam, createTeam, updateTeam, deleteTeam, countItemsUsingTeam, setJobBoard,
  insertSurveyItem, listItemPhotos, signedPhotoUrl,
  filterItemIdsByTenant, bulkUpdateItems,
  listAppUsers, getAppUser, updateAppUser, setItemTeamFromMonday, applyMondayPull,
  listChildSnags, createSnagItem, addItemPhoto, uploadPhoto, ensurePhotoBucket,
  listJobPlans, createJobPlan, deleteJobPlan, listPinnedItems, setItemPin, uploadPlan, signedPlanUrl, ensurePlanBucket,
  getPinsMultiPlan, setPinsMultiPlan } from './store';
import { buildJobReportPdf } from './reportPdf';
import { buildJobPricePdf } from './pricingPdf';
import { inviteUser, resetUserPassword, updateAuthEmail } from './adminUser';
import { promoteItem } from './promote';
import { recogniseItemPhoto } from './recognise';
import { Monday } from './monday';

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

const genPassword = () => 'ACE-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
import { effectiveRatePennies, formatPennies, assembleFullCode, APP_VERSION, CHANGELOG,
  CAPABILITIES, ROLES as SHARED_ROLES, ROLE_CAPS, ROLE_LABEL, can, type Capability } from '@ace/shared';

// Assignable roles = the single shared list (includes invoice_manager). Never hard-code.
const ROLES: string[] = [...SHARED_ROLES];
const ROLE_MATRIX = { caps: CAPABILITIES, roles: SHARED_ROLES, labels: ROLE_LABEL, matrix: ROLE_CAPS };

const PHOTO_KIND_LABEL: Record<string, string> = { reference: 'Reference', survey: 'Survey', sketch: 'Sketch', install: 'Install', before: 'Picture Before', after: 'Picture After' };

const PORT = Number(process.env.PORT ?? 3000);

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
      code: `${j.client_code}.${j.job_code}`, name: j.name, board: !!j.monday_board_id,
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

// Unified item-code builder (mapping + Items-view edits). The "level" segment is the Flat if
// set, otherwise the mapping Floor; a plain number renders as F{n}, a label (e.g. GF) as-is.
// Order: CLIENT.JOB.BLOCK.ELEV.LEVEL.ROOM.ITEM  (empty parts skipped).
function levelSeg(v: any): string {
  const s = String(v ?? '').trim().replace(/^F(?=[0-9])/i, '');
  if (!s) return '';
  return /^[0-9]+$/.test(s) ? `F${s}` : s.toUpperCase();
}
function buildItemCode(p: { client: string; job: string; block?: any; elevation?: any; flat?: any; floor?: any; room?: any; item: any }): string {
  const up = (v: any) => String(v ?? '').trim().toUpperCase();
  const level = (p.flat != null && String(p.flat).trim() !== '') ? levelSeg(p.flat) : levelSeg(p.floor);
  return [p.client, p.job, up(p.block), up(p.elevation), level, up(p.room), up(p.item)].filter(Boolean).join('.');
}

// One item row for the Items table (shared by single-job and All-jobs views).
const itemRow = (it: any, job: any, teams: any[]) => ({
  id: it.id, full_code: it.full_code, block: it.block ?? null, elevation: it.elevation ?? null, floor: it.floor ?? null,
  flat: it.flat, room: it.room_code, item: it.item_code, stage: it.stage,
  kind: it.kind ?? 'item', snag_comment: it.snag_comment ?? null,
  install_status: it.install_status, team_id: it.team_id, rate_override_pennies: it.rate_override_pennies,
  effective_rate: formatPennies(effectiveRatePennies(it, teams)),
  synced: !!it.monday_item_id,
  dirty: !!it.monday_item_id && !!it.needs_resync,
  monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
});

// Resolve the caller's app_users row from their bearer token.
async function context(req: any): Promise<{ id: string; tenant_id: string; role: string; name: string; client_code?: string | null } | null> {
  const h = String(req.headers['authorization'] ?? '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const { data } = await authClient().auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const cols = 'id,tenant_id,role,name,active,email,client_code';
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

    // Standalone auto-refreshing wallboard (pin it as a browser tab). Key-gated, no login.
    if (p === '/live') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(LIVE_PAGE); return; }
    if (p === '/api/live') {
      const want = process.env.LIVE_KEY ?? '';
      if (!want) { send(res, 503, { error: 'Live view is off — set LIVE_KEY in .env to enable it.' }); return; }
      if ((url.searchParams.get('key') ?? '') !== want) { send(res, 401, { error: 'Bad or missing key.' }); return; }
      send(res, 200, await dashboardData(ACE_TENANT));
      return;
    }

    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await readJson(req);
      const { data, error } = await authClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) { send(res, 401, { error: 'Invalid email or password' }); return; }
      const { data: u } = await db().from('app_users').select('name,role,client_code').eq('auth_user_id', data.user.id).maybeSingle();
      send(res, 200, { token: data.session.access_token, name: u?.name ?? email, role: u?.role ?? 'user', client_code: u?.client_code ?? null });
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

    if (p === '/api/me') { send(res, 200, { id: ctx.id, name: ctx.name, role: ctx.role, client_code: ctx.client_code ?? null }); return; }

    // ---- Customer portal (role 'customer' only): their own client's jobs + the rate-free PDF ----
    // A customer is confined to a strict whitelist; everything else is refused.
    if (ctx.role === 'customer') {
      const allowedForCustomer =
        p === '/api/me' ||
        p === '/api/customer/jobs' ||
        (p.startsWith('/api/job/') && p.endsWith('/report.pdf') && req.method === 'GET');
      if (!allowedForCustomer) { send(res, 403, { error: 'Not allowed.' }); return; }
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
      if (!allow('dashboard.view')) return;
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
      const results = await latestTestResults(ctx.tenant_id, APP_VERSION);
      send(res, 200, { version: APP_VERSION, scenarios: TEST_SCENARIOS, results });
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
      const rows = await allTestResults(ctx.tenant_id, APP_VERSION);
      const esc = (v: any) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
      const byCode = new Map(TEST_SCENARIOS.map((s) => [s.code, s]));
      const lines = ['code,area,feature,status,comment,tested_by,at'];
      for (const r of rows) {
        const s: any = byCode.get(r.scenario_code) ?? {};
        lines.push([r.scenario_code, s.area, s.feature, r.status, r.comment, r.tested_by, r.created_at].map(esc).join(','));
      }
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="test-results-v${APP_VERSION}.csv"`, 'cache-control': 'no-store' });
      res.end(lines.join('\n'));
      return;
    }

    // Job pricing: current rule + full budget/sale/margin breakdown (finance only).
    if (p.startsWith('/api/job/') && p.endsWith('/pricing') && req.method === 'GET') {
      if (!allow('finance.view')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const rules = await listPricingRules(ctx.tenant_id);
      const ruleId = await getJobRuleId(job.id);
      const rule = ruleId ? await getPricingRule(ruleId, ctx.tenant_id) : null;
      let breakdown: unknown = null;
      let itemList: any[] = [];
      if (rule && (rule.params as any)?.sale) {
        const items = await listSurveyItems(job.id);
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
        // Non-snag items with their variation state, so the UI can flag variations.
        itemList = priceItems.filter((it) => (it.kind ?? 'item') !== 'snag').map((it) => ({
          id: it.id, full_code: it.full_code, category: it.category, flat: it.flat ?? null,
          is_variation: !!it.is_variation, variation_amount: it.variation_amount ?? 0,
        }));
      }
      send(res, 200, { rule_id: ruleId, rule_name: rule?.name ?? null, rules: rules.map((r) => ({ id: r.id, name: r.name })), breakdown, items: itemList });
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/pricing') && req.method === 'PUT') {
      if (!allow('finance.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
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
      const [c, j] = code.split('.');
      try {
        const out = await buildJobPricePdf(c, j, ctx.tenant_id);
        if (!out) { send(res, 400, { error: 'Assign a pricing rule to this job first.' }); return; }
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${c}.${j}-price-breakdown.pdf"`,
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

    if (p === '/api/jobs' && req.method === 'GET') {
      let jobs = await listJobs(ctx.tenant_id);
      // Scanners only see jobs an admin has released for mapping.
      if (ctx.role === 'scanner') jobs = jobs.filter((j) => (j as any).status === 'pending_mapping');
      send(res, 200, jobs.map((j) => ({
        code: `${j.client_code}.${j.job_code}`, name: j.name,
        status: (j as any).status ?? 'new', mapping_start_date: (j as any).mapping_start_date ?? null,
      })));
      return;
    }

    // Admin assigns a mapping start date → releases the job to scanners (status 'pending_mapping').
    if (p.startsWith('/api/job/') && p.endsWith('/mapping-date') && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const date = String(b.date ?? '').trim() || null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { send(res, 400, { error: 'Use a valid date (YYYY-MM-DD).' }); return; }
      await setJobMappingDate(job.id, date, ctx.tenant_id);
      send(res, 200, { ok: true, status: date ? 'pending_mapping' : 'new' });
      return;
    }

    // Scanner mapping bulk-create: block/elevation + rows [{flat, item, item_type}] → items.
    if (p.startsWith('/api/job/') && p.endsWith('/mapping-items') && req.method === 'POST') {
      if (!allow('items.create')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const block = String(b.block ?? '').trim().toUpperCase() || null;
      const elevation = String(b.elevation ?? '').trim().toUpperCase() || null;
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) { send(res, 400, { error: 'Nothing to save — preload some items first.' }); return; }
      const seen = new Set<string>();
      const fields: Record<string, unknown>[] = [];
      for (const r of rows) {
        // Floor: strip a leading F only before a number ("F1"->"1"); labels like GF are kept.
        const flat = String(r.flat ?? '').trim().replace(/^F(?=[0-9])/i, '');
        const item = String(r.item ?? '').trim().toUpperCase();
        if (!item) continue;
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, floor: flat, item });
        if (seen.has(full_code)) continue; seen.add(full_code);
        fields.push({
          tenant_id: ctx.tenant_id, job_id: job.id, stage: 'scanned',
          // The mapping "floor" is stored in the floor field (not flat), so the Items tab's
          // Flat column stays empty for mapped items. The full_code above keeps F{floor} in place.
          block, elevation, floor: flat || null, item_code: item,
          item_type: String(r.item_type ?? '').trim() || null, full_code,
        });
      }
      try {
        const inserted = await bulkInsertSurveyItems(fields);
        send(res, 200, { ok: true, inserted, skipped: fields.length - inserted });
      } catch (err: any) { send(res, 500, { error: err?.message ?? String(err) }); }
      return;
    }
    if (p === '/api/jobs' && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const b = await readJson(req);
      const client_code = String(b.client_code ?? '').trim().toUpperCase();
      const job_code = String(b.job_code ?? '').trim().toUpperCase();
      const name = String(b.name ?? '').trim();
      if (!client_code || !job_code) { send(res, 400, { error: 'Client code and job code are required (they form the job code, e.g. AXS.LAB).' }); return; }
      if (!name) { send(res, 400, { error: 'A job name is required.' }); return; }
      try {
        const job = await createJob(ctx.tenant_id, { client_code, job_code, name, site_address: b.site_address || null });
        send(res, 200, { ok: true, code: `${job.client_code}.${job.job_code}` });
      } catch (err: any) {
        if (err?.code === '23505') { send(res, 409, { error: `Job ${client_code}.${job_code} already exists.` }); return; }
        send(res, 500, { error: err?.message ?? String(err) });
      }
      return;
    }

    // Delete a job — only when it has no items.
    if (p.startsWith('/api/job/') && req.method === 'DELETE' && p.split('/').length === 4) {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const n = await countItemsForJob(job.id);
      if (n > 0) { send(res, 409, { error: `This job has ${n} item${n === 1 ? '' : 's'}. Delete or move them first — a job can only be removed when it's empty.` }); return; }
      await deleteJob(job.id, ctx.tenant_id);
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
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const items = await listSurveyItems(job.id);
      send(res, 200, {
        job: { code, name: job.name, board: job.monday_board_id },
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        items: items.map((it) => itemRow(it, job, teams)), role: ctx.role,
      });
      return;
    }

    // Create a new survey item from the desk (populates a fresh board without the mobile app).
    if (p === '/api/items' && req.method === 'POST') {
      if (!allow('items.create')) return;
      const b = await readJson(req);
      const [c, j] = String(b.job ?? '').split('.');
      const job = await getJobByCode(c, j);
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
      };
      try {
        const created = await insertSurveyItem(fields);
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
      if (action === 'block' || action === 'elevation' || action === 'floor' || action === 'flat' || action === 'room') {
        if (!allow('items.edit')) return;
        // Sets the field AND rebuilds each item's code — skipped for items already synced to Monday.
        const raw = String(value ?? '').trim();
        const jobCache: Record<string, any> = {};
        let updated = 0, locked = 0, dupes = 0;
        for (const id of allowed) {
          const it: any = await getSurveyItem(id);
          if (it.monday_item_id) { locked++; continue; } // code locked after sync
          const job = jobCache[it.job_id] || (jobCache[it.job_id] = await getJob(it.job_id));
          let block = it.block, elevation = it.elevation, flat = it.flat, floor = it.floor, room = it.room_code;
          if (action === 'block') block = raw.toUpperCase() || null;
          else if (action === 'elevation') elevation = raw.toUpperCase() || null;
          else if (action === 'floor') { floor = raw.replace(/^F(?=[0-9])/i, '').toUpperCase() || null; if (floor) flat = null; } // floor becomes the level
          else if (action === 'flat') { flat = raw.replace(/^F(?=[0-9])/i, '').toUpperCase() || null; if (flat) floor = null; } // flat becomes the level
          else if (action === 'room') room = raw.toUpperCase() || null;
          const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block, elevation, flat, floor, room, item: it.item_code });
          if (await codeExists(ctx.tenant_id, full_code, id)) { dupes++; continue; }
          const { error } = await db().from('survey_items').update({ block, elevation, flat, floor, room_code: room, full_code }).eq('id', id).eq('tenant_id', ctx.tenant_id);
          if (!error) updated++;
        }
        send(res, 200, { ok: true, updated, skipped: locked + dupes, locked, dupes }); return;
      }
      if (action === 'delete') {
        // Destructive — managers only (matches the DB delete policy: admin/office).
        if (!(ctx.role === 'admin' || ctx.role === 'office')) { send(res, 403, { error: `Your role (${ctx.role}) can't delete items.` }); return; }
        const n = await bulkDeleteItems(allowed, ctx.tenant_id);
        send(res, 200, { ok: true, deleted: n }); return;
      }
      if (action === 'sync') {
        if (!allow('monday.sync')) return;
        let created = 0, updated = 0, failed = 0; const errors: string[] = [];
        for (const id of allowed) {
          try { const r = await promoteItem(id); r.action === 'created' ? created++ : updated++; }
          catch (err: any) { failed++; if (errors.length < 3) errors.push(err?.message ?? String(err)); }
        }
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
      send(res, 200, {
        item: it, team: team?.name ?? null, teams: allTeams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        effective_rate: formatPennies(effectiveRatePennies(it, team ? [team] : [])),
        monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
        photos: photoOut, snags: snagOut, is_snag: (it as any).kind === 'snag',
      });
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
      const SPEC_STR = ['material', 'item_type', 'window_type', 'glass', 'safety_glass', 'glazing', 'open_in_out', 'add_ons', 'coupled', 'design_code', 'comments'];
      const SPEC_NUM = ['width_mm', 'height_mm', 'cill_depth_mm', 'transom1_mm', 'transom2_mm', 'transom3_mm', 'mullion1_mm', 'mullion2_mm', 'mullion3_mm'];
      // Spec/rate/team edits need items.edit; a status-only change needs items.fit (or edit).
      const touchesSpec = ('rate_override_pennies' in body) || ('team_id' in body)
        || SPEC_STR.some((k) => k in body) || SPEC_NUM.some((k) => k in body);
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
      // Editing Flat / Room rebuilds the item code — allowed only until it's synced to Monday.
      if ('flat' in body || 'room' in body) {
        if (!allow('items.edit')) return;
        if (item.monday_item_id) { send(res, 400, { error: 'This item is synced to Monday — its code is locked. Un-sync it first to change Flat/Room.' }); return; }
        const job = await getJob(item.job_id);
        const newFlat = 'flat' in body ? (String(body.flat ?? '').trim().replace(/^F(?=[0-9])/i, '') || null) : (item.flat ?? null);
        const newRoom = 'room' in body ? (String(body.room ?? '').trim().toUpperCase() || null) : (item.room_code ?? null);
        // Flat supersedes the mapping floor as the level segment: clear floor once a flat is set.
        const newFloor = newFlat ? null : (item.floor ?? null);
        const full_code = buildItemCode({ client: job.client_code, job: job.job_code, block: item.block, elevation: item.elevation, flat: newFlat, floor: newFloor, room: newRoom, item: item.item_code });
        if (await codeExists(ctx.tenant_id, full_code, id)) { send(res, 409, { error: `Code ${full_code} already exists — pick a different Flat/Room.` }); return; }
        patch.flat = newFlat; patch.room_code = newRoom; patch.floor = newFloor; patch.full_code = full_code;
      }
      const { error } = await db().from('survey_items').update(patch).eq('id', id);
      if (error) { send(res, 500, { error: error.message }); return; }
      send(res, 200, { ok: true });
      return;
    }

    if (p.startsWith('/api/promote/') && req.method === 'POST') {
      if (!allow('monday.sync')) return;
      const id = p.split('/').pop()!;
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const r = await promoteItem(id);
      send(res, 200, { ok: true, action: r.action, mondayItemId: r.mondayItemId, photosPushed: r.photosPushed, photoError: r.photoError });
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
          code: `${j.client_code}.${j.job_code}`, name: j.name, board: j.monday_board_id ?? null,
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
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const { board } = await readJson(req);
      const { board: boardId, slug } = parseMondayRef(board);
      await setJobBoard(job.id, boardId, slug);
      send(res, 200, { ok: true, board: boardId, slug });
      return;
    }

    // Batch-sync every item on a job to its board. Idempotent (create or update per item).
    if (p.startsWith('/api/job/') && p.endsWith('/sync') && req.method === 'POST') {
      if (!allow('monday.sync')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
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
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
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
      const [c, j] = code.split('.');
      const qt = url.searchParams.get('type');
      const type = (qt === 'install' ? 'install' : qt === 'customer_install' ? 'customer_install' : 'survey') as 'survey' | 'install' | 'customer_install';
      // Customers may ONLY pull the rate-free customer_install, and only for their own client.
      if (ctx.role === 'customer') {
        if (type !== 'customer_install' || c !== ctx.client_code) { send(res, 403, { error: 'forbidden' }); return; }
      } else if (!allow('dashboard.view')) return;
      try {
        const { buffer } = await buildJobReportPdf(c, j, ctx.tenant_id, type);
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${c}.${j}-${type}-report.pdf"`,
          'cache-control': 'no-store',
        });
        res.end(buffer);
      } catch (e: any) {
        send(res, e?.message === 'forbidden' ? 403 : 500, { error: e?.message ?? String(e) });
      }
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/plans') && req.method === 'GET') {
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const plans = await listJobPlans(job.id);
      const withUrls = await Promise.all(plans.map(async (pl) => ({ id: pl.id, name: pl.name, url: await signedPlanUrl(pl.storage_path) })));
      const items = await listPinnedItems(job.id);
      const multiPlan = await getPinsMultiPlan(ctx.tenant_id);
      send(res, 200, { plans: withUrls, items, multiPlan, canManage: can(ctx.role, 'jobs.manage'), canPin: can(ctx.role, 'items.edit') });
      return;
    }
    if (p.startsWith('/api/job/') && p.endsWith('/plans') && req.method === 'POST') {
      if (!allow('jobs.manage')) return;
      const code = decodeURIComponent(p.split('/')[3] ?? '');
      const [c, j] = code.split('.'); const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const b = await readJson(req);
      const name = String(b.name ?? '').trim() || 'Plan';
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.image || ''));
      if (!m) { send(res, 400, { error: 'A plan image is required.' }); return; }
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > 15 * 1024 * 1024) { send(res, 400, { error: 'Plan image too large (max 15 MB).' }); return; }
      const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
      const path = `${ctx.tenant_id}/plans/${job.id}/${Date.now()}.${ext}`;
      await ensurePlanBucket();
      await uploadPlan(path, bytes, m[1]);
      const plan = await createJobPlan(ctx.tenant_id, job.id, name, path);
      send(res, 200, { ok: true, id: plan.id });
      return;
    }
    if (p.startsWith('/api/plans/') && req.method === 'DELETE') {
      if (!allow('jobs.manage')) return;
      const id = p.split('/')[3];
      await deleteJobPlan(id, ctx.tenant_id); // items pinned to it get plan_id NULL via FK
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith('/api/item/') && p.endsWith('/pin') && req.method === 'PUT') {
      if (!allow('items.edit')) return;
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
      send(res, 200, {
        me: ctx.id, roles: ROLES,
        teams: teams.map((t) => ({ id: t.id, name: t.name, active: t.active })),
        users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, has_login: !!u.auth_user_id, team_id: u.team_id, client_code: u.client_code ?? '' })),
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
      await resetUserPassword(u.email, password, u.auth_user_id);
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
      await updateAppUser(id, patch as any, ctx.tenant_id);
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

const RATE = 'rate_override_pennies', ISTAT = 'install_status', TEAM = 'team_id';
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ACE — Office</title>
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
        <div style="display:flex;gap:10px;align-items:center">
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
          <button class="bulk bapply" onclick="bulkEditApply()">Apply</button>
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
        <th>ITEM</th><th>STAGE</th><th>RATE (£)</th>
        <th>INSTALL STATUS<br><select id="statusFilter" class="colfilter" onchange="setStatusFilter(this.value)"></select></th>
        <th>TEAM<br><select id="teamFilter" class="colfilter" onchange="setTeamFilter(this.value)"></select></th><th>MONDAY</th>
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
      <div class="sub">Upload a floor plan or elevation per job, then pin each item to its spot. Field staff see the pins on the phone. Click an item on the right, then click its location on the plan.</div>
      <div class="planbar">
        <select id="planJob" class="tinput" onchange="loadPlans()"></select>
        <select id="planSel" class="tinput" onchange="renderPlan()"></select>
        <button class="add" id="planUploadBtn" onclick="document.getElementById('planFile').click()">Upload plan</button>
        <input type="file" id="planFile" accept="image/*" style="display:none" onchange="uploadPlan(this)">
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
        <button class="calnav" onclick="calShift(-1)">‹</button>
        <div class="calmonth" id="calMonth">—</div>
        <button class="calnav" onclick="calShift(1)">›</button>
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
        <span id="fpMsg" class="itemcount"></span>
      </div>
      <div id="fpBreak"></div>
    </main>
  </div>

  <div id="testsView" style="display:none">
    <main style="max-width:1000px">
      <div class="titlerow">
        <div><h2>QA test run</h2><div class="sub" id="testProg">—</div></div>
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
        <th>NAME</th><th>EMAIL</th><th>ROLE</th><th>CLIENT</th><th>TEAM</th><th>LOGIN</th><th>STATUS</th><th></th>
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
    <div class="sheethead"><h3 id="modalTitle">—</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div id="modalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  var STAGE={scanned:'Scanned',in_survey:'In survey',surveyed:'Surveyed',synced:'Synced'};
  var ISTATUS=[['','—'],['scheduled','Scheduled'],['installed_no_snag','Installed no snag'],['installed_snag','Installed + snag'],['snag','Snag'],['misfit','MisFit'],['delayed','Delayed']];
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
  var flatFilter='', statusFilter='', teamFilter='', blockFilter='', elevFilter='', floorFilter='', roomFilter='';
  function restoreTab(){
    var t=sessionStorage.getItem('ace_tab')||(myRole==='scanner'?'mapping':'dashboard');
    var need={dashboard:'dashboard.view',teams:'teams.manage',sync:'monday.sync',plans:'dashboard.view',mapping:'items.create'};
    if((t==='users'||t==='roles')&&myRole!=='admin')t='items';
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
    else{logout();document.getElementById('loginErr').textContent='No ACE account for this email — ask an admin to add you first.';}
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
  var JOB_STATUS={}, JOB_MAPDATE={};
  // ---- Mapping (scanner pre-load) ----
  function loadMapping(){
    var box=document.getElementById('mapBody');
    if(!current||current==='ALL'){ document.getElementById('mapSub').textContent='Pick a job from the left to start mapping.'; box.innerHTML='<div class="empty">Pick a job from the left.</div>'; return; }
    var status=JOB_STATUS[current]||'';
    document.getElementById('mapSub').innerHTML='Job <b>'+esc(current)+'</b> · status: <b>'+esc(status.replace('_',' '))+'</b>';
    if(status!=='pending_mapping'){
      if(canCap('jobs.manage')){
        box.innerHTML='<div class="card2" style="padding:16px;max-width:480px">'
          +'<div style="font-weight:800;margin-bottom:4px">Release this job for mapping</div>'
          +'<div class="sub" style="margin-bottom:10px">Assign a mapping start date to make this job visible to scanners.</div>'
          +'<div style="display:flex;gap:10px;align-items:center"><input type="date" id="mapDate" value="'+esc(JOB_MAPDATE[current]||'')+'"><button class="save" id="mapDateBtn">Assign date</button></div></div>';
        document.getElementById('mapDateBtn').addEventListener('click',assignMapDate);
      } else box.innerHTML='<div class="empty">This job isn\\'t ready for mapping yet — an admin needs to assign a mapping start date.</div>';
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
  function mapWirePrefix(id,p){
    var el=document.getElementById(id);
    el.addEventListener('input',function(){
      var v=el.value.toUpperCase().replace(new RegExp('^'+p+'+'),''); v=v?(p+v):'';
      if(v!==el.value){el.value=v;try{el.setSelectionRange(v.length,v.length);}catch(_){}}
      maybeRevealFloors();
    });
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
    el.textContent='Total: '+nf+' floor'+(nf===1?'':'s')+' · '+tw+' windows · '+td+' doors · '+(tw+td)+' items';
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
    updateFloorTotals();
    var rows=document.querySelectorAll('#floorRows .frow');
    if(div!==rows[rows.length-1]) return;
    var f=div.querySelector('.fr-floor').value.trim(), w=div.querySelector('.fr-win').value.trim(), d=div.querySelector('.fr-door').value.trim();
    if(f!==''&&w!==''&&d!=='') addFloorRow();
  }
  // Floor segment: prefix F only for a plain number (1 -> F1); leave labels like GF as-is.
  function floorSeg(flat){ if(!flat) return ''; return /^[0-9]+$/.test(flat) ? ('F'+flat) : flat.toUpperCase(); }
  function mapCode(block,elev,flat,item){
    var parts=current.split('.');
    return [parts[0],parts[1],block,elev,floorSeg(flat),item].filter(function(x){return x;}).join('.');
  }
  function stripF(v){ return String(v||'').trim().replace(/^F(?=[0-9])/i,''); } // "F1"->"1", "GF" stays
  function mapPreload(){
    var floors=[];
    document.querySelectorAll('#floorRows .frow').forEach(function(div){
      var f=stripF(div.querySelector('.fr-floor').value);
      var w=parseInt(div.querySelector('.fr-win').value,10)||0;
      var d=parseInt(div.querySelector('.fr-door').value,10)||0;
      if(f!==''&&(w>0||d>0)) floors.push({floor:f,windows:w,doors:d});
    });
    if(!floors.length){tShow('Add at least one floor with windows or doors');return;}
    var rows=[];
    floors.forEach(function(fl){
      for(var i=1;i<=fl.windows;i++) rows.push({flat:fl.floor,item:'W'+i,type:'Window'});
      for(var j=1;j<=fl.doors;j++) rows.push({flat:fl.floor,item:'D'+j,type:'Door'});
    });
    renderMapRows(rows);
  }
  function renderMapRows(rows){
    var wrap=document.getElementById('mapTableWrap');
    var head='<tr><th>CODE</th><th>FLOOR</th><th>ITEM</th><th>TYPE</th><th>COUPLE</th><th>#</th><th></th><th></th></tr>';
    wrap.innerHTML='<div class="groupt" style="padding:0 0 6px">PRELOADED ITEMS &mdash; review, edit, split couples, then Save</div>'
      +'<div class="card2" style="padding:0;overflow:auto"><table id="mapTable"><thead>'+head+'</thead><tbody id="mapTbody"></tbody></table></div>';
    var tb=document.getElementById('mapTbody');
    rows.forEach(function(r){ tb.appendChild(makeMapRow(r)); });
    document.getElementById('mapFooter').style.display='flex';
    updateSaveCount();
  }
  function makeMapRow(r){
    var be=getMapBE();
    var tr=document.createElement('tr');
    tr.innerHTML=''
      +'<td class="mono mapcode" style="font-size:11px;white-space:nowrap">'+esc(mapCode(be.block.trim(),be.elev.trim(),r.flat,r.item))+'</td>'
      +'<td><input class="mr-flat" value="'+esc(r.flat)+'" style="width:64px"></td>'
      +'<td><input class="mr-item" value="'+esc(r.item)+'" style="width:90px"></td>'
      +'<td><select class="mr-type"><option'+(r.type==='Window'?' selected':'')+'>Window</option><option'+(r.type==='Door'?' selected':'')+'>Door</option></select></td>'
      +'<td style="text-align:center"><input type="checkbox" class="mr-couple"></td>'
      +'<td><input type="number" min="2" value="2" class="mr-n" style="width:52px" disabled></td>'
      +'<td><button class="add mr-split" disabled title="Split into couple lines">Add</button></td>'
      +'<td style="text-align:right"><button class="del mr-del" title="Delete line">&#10005;</button></td>';
    wireMapRow(tr);
    return tr;
  }
  function wireMapRow(tr){
    function recode(){ var be=getMapBE(); tr.querySelector('.mapcode').textContent=mapCode(be.block.trim(),be.elev.trim(),stripF(tr.querySelector('.mr-flat').value),tr.querySelector('.mr-item').value.trim().toUpperCase()); }
    tr.querySelector('.mr-flat').addEventListener('input',recode);
    tr.querySelector('.mr-item').addEventListener('input',function(){var s=this.selectionStart;this.value=this.value.toUpperCase();try{this.setSelectionRange(s,s);}catch(_){}recode();});
    var cp=tr.querySelector('.mr-couple'), n=tr.querySelector('.mr-n'), sp=tr.querySelector('.mr-split');
    cp.addEventListener('change',function(){ n.disabled=!cp.checked; sp.disabled=!cp.checked; });
    sp.addEventListener('click',function(){ splitMapRow(tr); });
    tr.querySelector('.mr-del').addEventListener('click',function(){ tr.remove(); updateSaveCount(); });
  }
  function splitMapRow(tr){
    var n=parseInt(tr.querySelector('.mr-n').value,10)||0;
    if(n<2){tShow('Set a couple count of 2 or more');return;}
    var flat=tr.querySelector('.mr-flat').value.trim();
    var base=tr.querySelector('.mr-item').value.trim().toUpperCase();
    var type=tr.querySelector('.mr-type').value;
    if(!base){tShow('Enter an item code first');return;}
    for(var i=1;i<=n;i++){ tr.parentNode.insertBefore(makeMapRow({flat:flat,item:base+'.'+i,type:type}),tr); }
    tr.remove(); updateSaveCount();
  }
  function mapAddRow(){ var tb=document.getElementById('mapTbody'); if(!tb)return; tb.appendChild(makeMapRow({flat:'',item:'',type:'Window'})); updateSaveCount(); }
  function updateSaveCount(){ var n=document.querySelectorAll('#mapTbody tr').length; var b=document.getElementById('mapSaveBtn'); if(b)b.textContent='Save '+n+' item'+(n===1?'':'s'); }
  async function mapSave(){
    var be=getMapBE(); var block=be.block.trim(), elev=be.elev.trim();
    var out=[];
    document.querySelectorAll('#mapTbody tr').forEach(function(tr){
      var flat=stripF(tr.querySelector('.mr-flat').value);
      var item=tr.querySelector('.mr-item').value.trim().toUpperCase();
      var type=tr.querySelector('.mr-type').value;
      if(!item) return;
      var couple=tr.querySelector('.mr-couple').checked;
      var nn=parseInt(tr.querySelector('.mr-n').value,10)||0;
      if(couple&&nn>=2){ for(var i=1;i<=nn;i++) out.push({flat:flat,item:item+'.'+i,item_type:type}); }
      else out.push({flat:flat,item:item,item_type:type});
    });
    if(!out.length){tShow('Nothing to save');return;}
    tShow('Saving '+out.length+' item(s)…');
    var d=await (await api('/api/job/'+encodeURIComponent(current)+'/mapping-items',{method:'POST',body:JSON.stringify({block:block,elevation:elev,rows:out})})).json();
    if(d.ok){ document.getElementById('mapSaveNote').textContent=d.inserted+' created'+(d.skipped?(', '+d.skipped+' already existed'):''); tShow(d.inserted+' item(s) created'); }
    else tShow(d.error||'Save failed');
  }

  async function loadJobs(){
    var jobs=await (await api('/api/jobs')).json(); var el=document.getElementById('jobs');el.innerHTML='';
    JOB_STATUS={}; JOB_MAPDATE={};
    jobs.forEach(function(j){ JOB_STATUS[j.code]=j.status||'pending_mapping'; JOB_MAPDATE[j.code]=j.mapping_start_date||''; });
    function mk(code,label){var d=document.createElement('div');d.className='job'+(code===current?' on':'');d.textContent=label;d.setAttribute('data-code',code);
      d.onclick=function(){current=code;itemFilter='all';flatFilter='';statusFilter='';teamFilter='';blockFilter='';elevFilter='';floorFilter='';roomFilter='';document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)});if(sessionStorage.getItem('ace_tab')==='mapping')loadMapping();else loadItems();};el.appendChild(d);}
    if(myRole!=='scanner')mk('ALL','▦ All jobs');
    jobs.forEach(function(j){mk(j.code,j.code);});
    // Scanner (or an empty current) lands on the first available job.
    if((myRole==='scanner'||current==='ALL')&&jobs.length&&(current==='ALL'||!JOB_STATUS[current])){ current=jobs[0].code; document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)}); }
  }
  function opt(v,l,sel){return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+l+'</option>';}
  async function openNewJob(){
    var ruleField='';
    if(canCap('finance.manage')){
      var rules=[]; try{rules=await (await api('/api/pricing-rules')).json();}catch(e){}
      ruleField='<div class="field full"><label>Pricing rule (optional)</label><select id="nj_rule"><option value="">— none —</option>'
        +rules.map(function(r){return '<option value="'+r.id+'">'+esc(r.name)+(r.customer?(' · '+esc(r.customer)):'')+'</option>';}).join('')+'</select></div>';
    }
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="njPrev">CLIENT.JOB</div>'
      +field('nj_client','Client code *','e.g. AXS')+field('nj_job','Job code *','e.g. LAB')
      +'<div class="field full"><label>Job name *</label><input id="nj_name" placeholder="e.g. Laburnum Road, Waterlooville"></div>'
      +'<div class="field full"><label>Site address</label><input id="nj_addr" placeholder="Full site address (optional)"></div>'
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
      closeModal();tShow('Created '+d.code);loadJobs();
    }
    else document.getElementById('njErr').textContent=d.error||'Could not create job';
  }
  async function loadItems(){
    var data=await (await api('/api/items?job='+encodeURIComponent(current))).json(); teams=data.teams; itemsData=data; applyJobsHidden();
    bulkFieldPick(); // render the bulk value control for the selected field
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> — '+data.job.name;
    document.getElementById('subtitle').textContent=(current==='ALL'?'All jobs · ':'Monday board: '+(data.job.board||'(not linked)')+' · ')+'edits save to the store; use Sync to push to Monday';
    document.getElementById('newBtn').style.display=(current==='ALL')?'none':'';
    document.getElementById('delJobBtn').style.display=(current!=='ALL'&&canCap('jobs.manage'))?'':'none';
    // header column filters: distinct flats (this job) + all statuses
    var flats=[]; (itemsData.items||[]).forEach(function(it){var f=it.flat||''; if(f&&flats.indexOf(f)<0)flats.push(f);});
    flats.sort(function(a,b){return (parseInt(a,10)||0)-(parseInt(b,10)||0)||String(a).localeCompare(String(b));});
    if(flatFilter&&flats.indexOf(flatFilter)<0)flatFilter='';
    document.getElementById('flatFilter').innerHTML='<option value="">All flats</option>'+flats.map(function(f){return '<option value="'+av(f)+'">'+esc(f)+'</option>';}).join('');
    document.getElementById('flatFilter').value=flatFilter;
    document.getElementById('statusFilter').innerHTML='<option value="">All statuses</option><option value="__none">— no status —</option>'+ISTATUS.filter(function(s){return s[0];}).map(function(s){return '<option value="'+s[0]+'">'+esc(s[1])+'</option>';}).join('');
    document.getElementById('statusFilter').value=statusFilter;
    // team filter: distinct teams present on this job's items (plus "no team")
    var tids=[], hasNoTeam=false;
    (itemsData.items||[]).forEach(function(it){ if(it.team_id){ if(tids.indexOf(it.team_id)<0)tids.push(it.team_id); } else hasNoTeam=true; });
    tids.sort(function(a,b){return teamName(a).localeCompare(teamName(b));});
    if(teamFilter&&teamFilter!=='__none'&&tids.indexOf(teamFilter)<0)teamFilter='';
    if(teamFilter==='__none'&&!hasNoTeam)teamFilter='';
    document.getElementById('teamFilter').innerHTML='<option value="">All teams</option>'
      +(hasNoTeam?'<option value="__none">— no team —</option>':'')
      +tids.map(function(id){return '<option value="'+av(id)+'">'+esc(teamName(id))+'</option>';}).join('');
    document.getElementById('teamFilter').value=teamFilter;
    // block / elevation / floor filters: distinct values on this job's items (+ "none")
    fillColFilter('blockFilter','block',function(v){blockFilter=v;},blockFilter,'All blocks');
    fillColFilter('elevFilter','elevation',function(v){elevFilter=v;},elevFilter,'All elevations');
    fillColFilter('floorFilter','floor',function(v){floorFilter=v;},floorFilter,'All floors');
    fillColFilter('roomFilter','room',function(v){roomFilter=v;},roomFilter,'All rooms');
    renderItems();
  }
  function setFlatFilter(v){flatFilter=v;renderItems();}
  function setStatusFilter(v){statusFilter=v;renderItems();}
  function setTeamFilter(v){teamFilter=v;renderItems();}
  function setBlockFilter(v){blockFilter=v;renderItems();}
  function setElevFilter(v){elevFilter=v;renderItems();}
  function setFloorFilter(v){floorFilter=v;renderItems();}
  function setRoomFilter(v){roomFilter=v;renderItems();}
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
      // Flat & Room are editable until the item is synced to Monday (editing rebuilds the code).
      var editable=canEdit&&!r.synced;
      var flatCell=editable?'<input class="cedit" value="'+(r.flat||'')+'" placeholder="—" onchange="saveCode(\\''+r.id+'\\',\\'flat\\',this.value)">':(r.flat||'—');
      var roomCell=editable?'<input class="cedit" value="'+(r.room||'')+'" placeholder="—" onchange="saveCode(\\''+r.id+'\\',\\'room\\',this.value)">':(r.room||'—');
      tr.innerHTML='<td class="cbcell">'+(canSelect?'<input type="checkbox" class="rowcb" data-id="'+r.id+'"'+(sel[r.id]?' checked':'')+' onclick="toggleRow(\\''+r.id+'\\',this)">':'')+'</td>'+
        '<td>'+snagTag+'<a class="codelink mono" onclick="openDetail(\\''+r.id+'\\')">'+(r.full_code||'')+'</a></td>'+
        '<td>'+(r.block||'—')+'</td><td>'+(r.elevation||'—')+'</td><td>'+flatCell+'</td><td>'+(r.floor||'—')+'</td><td>'+roomCell+'</td><td>'+(r.item||'—')+'</td>'+
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
  function bulkFieldPick(){
    var sel=document.getElementById('bulkField'); if(!sel)return;
    var f=sel.value; var w=document.getElementById('bulkValWrap');
    if(f==='team') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">— team —</option>'+teamOptionList('')+'</select>';
    else if(f==='status') w.innerHTML='<select id="bulkVal" class="bulk bsel"><option value="">— status —</option>'+ISTATUS.filter(function(s){return s[0]}).map(function(s){return opt(s[0],s[1],'')}).join('')+'</select>';
    else w.innerHTML='<input id="bulkVal" class="bulk" placeholder="'+(f.charAt(0).toUpperCase()+f.slice(1))+' value" style="width:130px;text-transform:uppercase">';
  }
  async function bulkEditApply(){
    var f=document.getElementById('bulkField').value;
    var vEl=document.getElementById('bulkVal'); var value=vEl?vEl.value:'';
    var ids=selectedIds(); if(!ids.length){tShow('Select some items first');return;}
    var action=(f==='status')?'status':f;
    var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:action,value:value})})).json();
    if(vEl&&vEl.tagName==='INPUT')vEl.value='';
    if(d.ok){tShow((d.updated||0)+' updated'+(d.skipped?(' · '+d.skipped+' skipped (synced/dupe)'):''));loadItems();}else tShow(d.error||'Update failed');
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
  }
  var ROLE_MATRIX=__ROLE_MATRIX_JSON__;
  function canCap(cap){if(myRole==='admin')return true;return (ROLE_MATRIX.matrix[myRole]||[]).indexOf(cap)>=0;}
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
      el.setAttribute('onclick',"openItemsFiltered('"+j.code+"','all')");
      el.innerHTML='<div class="jobtop"><div><b class="mono">'+esc(j.code)+'</b> <span style="color:var(--muted)">'+esc(j.name)+'</span></div>'
        +'<div class="jobmeta">'+(j.board?'<span class="count green">board linked</span>':'<span class="count amber">no board</span>')+' · '+j.items+' items · '+j.snags+' snags · labour '+esc(j.labour)+'</div></div>'
        +bar('Synced',pct(j.synced,j.items),'')+bar('Installed',pct(j.installed,j.items),'green')
        +(j.openSnags?'<div class="opensnag" onclick="event.stopPropagation();openItemsFiltered(\\''+j.code+'\\',\\'open_snags\\')">⚠ '+j.openSnags+' open snag'+(j.openSnags>1?'s':'')+' →</div>':'');
      jc.appendChild(el);
    });
  }
  function applyRole(){
    var isAdmin=(myRole==='admin');
    function show(id,ok){var el=document.getElementById(id);if(el)el.style.display=ok?'block':'none';}
    var isCustomer=(myRole==='customer');
    var navEl=document.querySelector('#appView nav.nav'); if(navEl)navEl.style.display=isCustomer?'none':'flex';
    show('tabItems',!isCustomer);
    show('tabMapping',canCap('items.create')&&!isCustomer);
    show('tabUsers',isAdmin);
    show('tabRoles',isAdmin);
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
        ? '<input class="board" placeholder="board id or URL" value="'+(jb.board||'')+'" onchange="saveBoard(\\''+jb.code+'\\',this.value)">'
        : (jb.board?'<a class="mlink" target="_blank" href="https://'+bhost+'/boards/'+jb.board+'">'+jb.board+' ↗</a>':'<span style="color:var(--muted)">not linked</span>');
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
  async function saveBoard(code,value){var d=await (await api('/api/job/'+encodeURIComponent(code)+'/board',{method:'PUT',body:JSON.stringify({board:value})})).json();if(d.ok){tShow(d.board?'Board linked':'Board unlinked');loadSync();}else tShow(d.error||'Failed');}
  async function syncJob(code,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Syncing…';tShow('Syncing '+code+'…');
    try{var d=await (await api('/api/job/'+encodeURIComponent(code)+'/sync',{method:'POST'})).json();
      if(d.ok){tShow(code+': '+d.created+' created, '+d.updated+' updated'+(d.failed?', '+d.failed+' failed':''));loadSync();}
      else tShow(d.error||'Sync failed');
    }catch(e){tShow('Sync failed');}
    btn.textContent=old;btn.disabled=false;
  }
  async function pullFitters(code,btn){
    btn.disabled=true;var old=btn.textContent;btn.textContent='Pulling…';tShow('Reading fitters from Monday…');
    try{var d=await (await api('/api/job/'+encodeURIComponent(code)+'/pull-fitters',{method:'POST'})).json();
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
    sel.innerHTML=jobs.map(function(j){return '<option value="'+j.code+'">'+esc(j.code)+' — '+esc(j.name)+'</option>';}).join('');
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
  async function uploadPlan(input){
    var f=input.files&&input.files[0]; input.value=''; if(!f)return;
    var code=document.getElementById('planJob').value;
    if(!code){tShow('Pick a job first');return;}
    if(!confirm('Add this plan to job '+code+'?\\n\\n(Plans belong to the job selected above — switch the job first if this is wrong.)'))return;
    var name=prompt('Plan name (e.g. Ground floor, Elevation E1):', f.name.replace(/\\.[^.]+$/,''))||'Plan';
    var reader=new FileReader();
    reader.onload=async function(){
      document.getElementById('planMsg').textContent='Uploading…';
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
      var teamOpts='<option value="">— none —</option>'+allTeams.filter(function(t){return t.active!==false||t.id===u.team_id;}).map(function(t){return '<option value="'+t.id+'"'+(u.team_id===t.id?' selected':'')+'>'+esc(t.name)+(t.active===false?' (retired)':'')+'</option>';}).join('');
      var teamSel='<select class="sel" onchange="saveUserField(\\''+u.id+'\\',\\'team_id\\',this.value)">'+teamOpts+'</select>';
      var clientCell=(u.role==='customer')
        ? '<input class="tname" style="width:80px;text-transform:uppercase" placeholder="e.g. AXS" value="'+attr(u.client_code||'')+'" onchange="saveUserField(\\''+u.id+'\\',\\'client_code\\',this.value)">'
        : '<span style="color:var(--muted)">—</span>';
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
      +'<p style="font-size:13px;color:var(--muted);margin-bottom:14px">'+(isReset?'Password reset. ':'Login created. ')+'Share these securely — the password is shown only once.</p>'
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
    var topts='<option value="">— no team —</option>'+teamOptionList('');
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="codePrev">'+current+'</div>'
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
        var v=el.value.toUpperCase();
        var p=PFX[id];
        if(p){ v=v.replace(new RegExp('^'+p+'+'),''); v=v?(p+v):''; }
        if(v!==el.value){ el.value=v; try{el.setSelectionRange(v.length,v.length);}catch(_){} }
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
    jsel.innerHTML=jobs.map(function(j){return '<option value="'+j.code+'">'+esc(j.code)+' — '+esc(j.name)+'</option>';}).join('');
    if(keep)jsel.value=keep;
    await loadJobPricing();
  }
  async function loadJobPricing(){
    var code=document.getElementById('fpJob').value; if(!code){document.getElementById('fpBreak').innerHTML='';return;}
    var d=await (await api('/api/job/'+encodeURIComponent(code)+'/pricing')).json();
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
    var card=function(v,l,s,warn){return '<div class="stat'+(warn?' warn':'')+'"><div class="v">'+v+'</div><div class="l">'+l+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>';};
    var cards='<div class="statgrid" style="margin:14px 0">'
      +card(gbp(b.saleTotal),'Customer price','')
      +card(gbp(b.costTotal),'Our cost (budget)','')
      +card(gbp(b.margin),'Margin',marginPct+'%',b.margin<0)+'</div>';
    var rows=b.flats.map(function(f){
      return '<tr><td><b>'+esc(f.flat)+'</b></td><td>'+f.windows+'</td><td>'+gbp(f.base)+'</td>'
        +'<td>'+(f.extraWindows?(f.extraWindows+' · '+f.extraM2+' m²'):'—')+'</td>'
        +'<td>'+(f.extraAmount?gbp(f.extraAmount):'—')+'</td><td><b>'+gbp(f.total)+'</b></td></tr>';
    }).join('');
    var extra='';
    if(b.doors.count)extra+='<tr><td colspan="5">Doors × '+b.doors.count+'</td><td><b>'+gbp(b.doors.amount)+'</b></td></tr>';
    if(b.communal.windows)extra+='<tr><td colspan="5">Communal windows × '+b.communal.windows+' ('+b.communal.m2+' m²)</td><td><b>'+gbp(b.communal.amount)+'</b></td></tr>';
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
    host.innerHTML=cards+table+itemsHtml;
  }
  async function downloadPricePdf(){
    var code=document.getElementById('fpJob').value; if(!code){tShow('Pick a job first');return;}
    var btn=document.getElementById('fpPdfBtn'); var was=btn.textContent; btn.textContent='Building…'; btn.disabled=true;
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
      +rMoney('r_rm','Rate per m² (communal / extra windows)',sa.rate_per_m2_extra)+rNum('r_wi','Windows included per flat',sa.windows_included_per_flat)
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
    wrap.innerHTML='<div class="spbox"><div class="sphead"><b>Choose a Clearview style</b><span class="spclose" onclick="closeStylePicker()">✕</span></div>'
      +'<div class="spfilters"><input id="spQ" placeholder="Search code…" oninput="spSetQ(this.value)"><span id="spTypes"></span><span id="spWide"></span><span id="spHigh"></span></div>'
      +'<div class="spgrid" id="spGrid"></div></div>';
    await loadStyles(); spRenderChips(); renderStyleGrid();
  }
  function istatLabel(v){var m=ISTATUS.filter(function(s){return s[0]===(v||'')});return (m[0]||['','—'])[1];}
  async function openDetail(id){
    openModal('Loading…','<div class="empty">Loading…</div>');
    var d=await (await api('/api/item/'+id+'/detail')).json(); var it=d.item;
    function row(k,v){return (v==null||v==='')?'':'<div class="drow"><dt>'+k+'</dt><dd>'+v+'</dd></div>';}
    function attr(v){return (v==null?'':esc(String(v))).replace(/"/g,'&quot;');}
    function fieldV(id,label,val,ph,type){return '<div class="field"><label>'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+attr(val)+'" placeholder="'+(ph||'')+'"></div>';}
    var html='<dl class="dl">'
      +row('Full code','<span class="mono">'+esc(it.full_code)+'</span>')
      +row('Stage',esc(STAGE[it.stage]||it.stage))
      +row('Location',[it.block,it.elevation,(it.flat?('Flat '+it.flat):''),(it.floor?('Floor '+it.floor):''),it.room_code,it.item_code].filter(function(x){return x;}).map(esc).join(' · '))
      +row('Team',esc(d.team||'—'))+row('Fitting rate',esc(d.effective_rate))
      +row('Install status',esc(istatLabel(it.install_status)))
      +row('Install date',esc(it.actual_install_date))
      +row('Monday',d.monday_url?'<a class="mlink" target="_blank" href="'+d.monday_url+'">open ↗</a>':'not synced')
      +'</dl>';
    var specEditable=!d.is_snag&&canCap('items.edit');
    if(specEditable){
      html+='<div class="groupt" style="padding:12px 22px 0">SPECIFICATION</div><div class="fgrid" style="padding:6px 22px 12px">'
        +'<div class="field full"><label>Design code (Clearview style)</label><div style="display:flex;gap:8px;align-items:center">'
          +'<input id="f_design" type="text" value="'+attr(it.design_code)+'" placeholder="e.g. 27" style="flex:1" oninput="stylePreview()">'
          +'<button type="button" class="add" onclick="openStylePicker()">Choose style…</button>'
          +'<img id="f_design_prev" alt="" style="display:none;width:46px;height:46px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff"></div></div>'
        +fieldV('f_material','Material',it.material,'uPVC / Alu / Timber')+fieldV('f_type','Item type',it.item_type,'Window / Door')
        +fieldV('f_wtype','Window type',it.window_type,'e.g. Casement')+fieldV('f_glass','Glass',it.glass,'e.g. 4-20-4')
        +fieldV('f_safety','Safety glass',it.safety_glass,'Toughened / Laminated')+fieldV('f_glazing','Glazing',it.glazing,'Double / Triple')
        +fieldV('f_width','Width (mm)',it.width_mm,'','number')+fieldV('f_height','Height inc cill (mm)',it.height_mm,'','number')
        +fieldV('f_cill','Cill depth (mm)',it.cill_depth_mm,'','number')+fieldV('f_openinout','Open in / out',it.open_in_out,'In / Out')
        +fieldV('f_t1','Transom 1 (mm)',it.transom1_mm,'','number')+fieldV('f_t2','Transom 2 (mm)',it.transom2_mm,'','number')
        +fieldV('f_t3','Transom 3 (mm)',it.transom3_mm,'','number')+fieldV('f_m1','Mullion 1 (mm)',it.mullion1_mm,'','number')
        +fieldV('f_m2','Mullion 2 (mm)',it.mullion2_mm,'','number')+fieldV('f_m3','Mullion 3 (mm)',it.mullion3_mm,'','number')
        +fieldV('f_coupled','Coupled',it.coupled,'e.g. to W03')+fieldV('f_addons','Add-ons',it.add_ons,'Trickle vents / etc')
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
    if(!d.is_snag){
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
    } else {
      html+='<div class="empty">This is a snag item — set its team and labour cost above, then sync and fit it like any item.</div>';
    }
    if(specEditable){ // sticky Save pinned to the bottom of the drawer, always visible while scrolling
      html+='<div class="sheetfoot"><button class="save" onclick="saveDetail(\\''+it.id+'\\')">Save details</button><span class="sub" style="margin:0">Changes mark the item to re-sync to Monday.</span></div>';
    }
    document.getElementById('modalTitle').innerHTML=(d.is_snag?'Snag ':'Item ')+'<span class="mono">'+esc(it.full_code)+'</span>';
    document.getElementById('modalBody').innerHTML=html;
    if(document.getElementById('f_design'))stylePreview(); // show the design sketch if a code is set
  }
  async function saveDetail(id){
    function g(x){var e=document.getElementById(x);return e?e.value:undefined;}
    var body={material:g('f_material'),item_type:g('f_type'),window_type:g('f_wtype'),glass:g('f_glass'),
      safety_glass:g('f_safety'),glazing:g('f_glazing'),open_in_out:g('f_openinout'),add_ons:g('f_addons'),
      coupled:g('f_coupled'),design_code:g('f_design'),comments:g('f_comments'),
      width_mm:g('f_width'),height_mm:g('f_height'),cill_depth_mm:g('f_cill'),
      transom1_mm:g('f_t1'),transom2_mm:g('f_t2'),transom3_mm:g('f_t3'),
      mullion1_mm:g('f_m1'),mullion2_mm:g('f_m2'),mullion3_mm:g('f_m3')};
    var d=await (await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(body)})).json();
    if(d.ok){tShow('Details saved');loadItems();openDetail(id);}else tShow(d.error||'Save failed');
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
  } else if(token){document.getElementById('appView').style.display='block';document.getElementById('loginView').style.display='none';applyRole();loadJobs().then(loadItems).then(function(){showTab(restoreTab());}).catch(logout);}
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
