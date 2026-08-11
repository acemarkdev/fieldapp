// ACE Office web app (Stage 1): real Supabase-Auth login, view jobs/items,
// edit fitting rate / install status / team, and push an item to Monday.
// The service-role key and Monday token stay on the server; the browser only
// ever holds the logged-in user's short-lived JWT.
//
// Run:  node --env-file=.env --import tsx apps/api/src/office.ts
// Then open http://localhost:3000. Needs SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env, and a login created via create-admin.

import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { db, ACE_TENANT } from './supabase';
import { listJobs, getJob, getJobByCode, listSurveyItems, listTeams, getSurveyItem,
  getTeam, createTeam, updateTeam, deleteTeam, countItemsUsingTeam, setJobBoard,
  insertSurveyItem, listItemPhotos, signedPhotoUrl,
  filterItemIdsByTenant, bulkUpdateItems,
  listAppUsers, getAppUser, updateAppUser,
  listChildSnags, createSnagItem, addItemPhoto, uploadPhoto, ensurePhotoBucket } from './store';
import { inviteUser, resetUserPassword, updateAuthEmail } from './adminUser';
import { promoteItem } from './promote';

const ROLES = ['admin', 'office', 'surveyor', 'scanner', 'fitter'];
const genPassword = () => 'ACE-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
import { effectiveRatePennies, formatPennies, assembleFullCode, APP_VERSION, CHANGELOG } from '@ace/shared';

const PHOTO_KIND_LABEL: Record<string, string> = { reference: 'Reference', survey: 'Survey', sketch: 'Sketch', install: 'Install' };

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
    const labourP = items.reduce((s, it) => s + (effectiveRatePennies(it, teams) ?? 0), 0);
    for (const it of items) statusCounts[it.install_status ?? 'none'] = (statusCounts[it.install_status ?? 'none'] ?? 0) + 1;
    return {
      code: `${j.client_code}.${j.job_code}`, name: j.name, board: !!j.monday_board_id,
      items: items.length, windows: items.length - snags.length, snags: snags.length,
      synced, installed, openSnags, labour: formatPennies(labourP), labourP,
    };
  }));
  const t = perJob.reduce((a, j) => ({
    items: a.items + j.items, synced: a.synced + j.synced, installed: a.installed + j.installed,
    snags: a.snags + j.snags, openSnags: a.openSnags + j.openSnags, labourP: a.labourP + j.labourP,
  }), { items: 0, synced: 0, installed: 0, snags: 0, openSnags: 0, labourP: 0 });
  const breakdown = STATUS_ORDER.map(([key, label]) => ({ key, label, count: statusCounts[key] ?? 0 })).filter((s) => s.count > 0);
  return {
    totals: { jobs: jobs.length, items: t.items, synced: t.synced, installed: t.installed,
      snags: t.snags, openSnags: t.openSnags, labour: formatPennies(t.labourP) },
    breakdown, jobs: perJob,
  };
}

// One item row for the Items table (shared by single-job and All-jobs views).
const itemRow = (it: any, job: any, teams: any[]) => ({
  id: it.id, full_code: it.full_code, room: it.room_code, item: it.item_code, stage: it.stage,
  kind: it.kind ?? 'item', snag_comment: it.snag_comment ?? null,
  install_status: it.install_status, team_id: it.team_id, rate_override_pennies: it.rate_override_pennies,
  effective_rate: formatPennies(effectiveRatePennies(it, teams)),
  synced: !!it.monday_item_id,
  monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
});

// Resolve the caller's app_users row from their bearer token.
async function context(req: any): Promise<{ id: string; tenant_id: string; role: string; name: string } | null> {
  const h = String(req.headers['authorization'] ?? '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const { data } = await authClient().auth.getUser(token);
  const user = data?.user;
  if (!user) return null;
  const cols = 'id,tenant_id,role,name,active,email';
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
        .replaceAll('__SUPABASE_URL__', () => process.env.SUPABASE_URL ?? '')
        .replaceAll('__SUPABASE_ANON_KEY__', () => process.env.SUPABASE_ANON_KEY ?? '')
        .replaceAll('__SSO_ENABLED__', () => (process.env.AZURE_SSO_ENABLED === 'true' ? 'true' : 'false'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html); return;
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

    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await readJson(req);
      const { data, error } = await authClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) { send(res, 401, { error: 'Invalid email or password' }); return; }
      const { data: u } = await db().from('app_users').select('name,role').eq('auth_user_id', data.user.id).maybeSingle();
      send(res, 200, { token: data.session.access_token, name: u?.name ?? email, role: u?.role ?? 'user' });
      return;
    }

    const ctx = await context(req);
    if (!ctx) { send(res, 401, { error: 'Not authenticated' }); return; }

    if (p === '/api/me') { send(res, 200, { id: ctx.id, name: ctx.name, role: ctx.role }); return; }

    if (p === '/api/dashboard') { send(res, 200, await dashboardData(ctx.tenant_id)); return; }

    if (p === '/api/jobs') {
      const jobs = await listJobs(ctx.tenant_id);
      send(res, 200, jobs.map((j) => ({ code: `${j.client_code}.${j.job_code}`, name: j.name })));
      return;
    }

    if (p === '/api/items' && req.method === 'GET') {
      const code = url.searchParams.get('job') ?? 'AXS.LAB';
      const teams = await listTeams(ctx.tenant_id);
      if (code === 'ALL') {
        const jobs = await listJobs(ctx.tenant_id);
        const rows: any[] = [];
        for (const jb of jobs) { const items = await listSurveyItems(jb.id); for (const it of items) rows.push(itemRow(it, jb, teams)); }
        send(res, 200, { job: { code: 'ALL', name: 'All jobs', board: null }, teams: teams.map((t) => ({ id: t.id, name: t.name })), items: rows, role: ctx.role });
        return;
      }
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const items = await listSurveyItems(job.id);
      send(res, 200, {
        job: { code, name: job.name, board: job.monday_board_id },
        teams: teams.map((t) => ({ id: t.id, name: t.name })),
        items: items.map((it) => itemRow(it, job, teams)), role: ctx.role,
      });
      return;
    }

    // Create a new survey item from the desk (populates a fresh board without the mobile app).
    if (p === '/api/items' && req.method === 'POST') {
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
      const fields: Record<string, unknown> = {
        tenant_id: ctx.tenant_id, job_id: job.id, stage: 'surveyed',
        block: b.block || null, elevation: b.elevation || null, flat: b.flat || null,
        room_code: room, item_code: item, floor: b.floor || null, full_code,
        material: b.material || null, item_type: b.item_type || null, glass: b.glass || null,
        glazing: b.glazing || null, width_mm: num(b.width_mm), height_mm: num(b.height_mm),
        comments: b.comments || null, team_id: b.team_id || null,
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
        const n = await bulkUpdateItems(allowed, { team_id: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      if (action === 'status') {
        const n = await bulkUpdateItems(allowed, { install_status: value || null }, ctx.tenant_id);
        send(res, 200, { ok: true, updated: n }); return;
      }
      if (action === 'sync') {
        let created = 0, updated = 0, failed = 0; const errors: string[] = [];
        for (const id of allowed) {
          try { const r = await promoteItem(id); r.action === 'created' ? created++ : updated++; }
          catch (err: any) { failed++; if (errors.length < 3) errors.push(err?.message ?? String(err)); }
        }
        send(res, 200, { ok: true, total: allowed.length, created, updated, failed, errors }); return;
      }
      send(res, 400, { error: 'Unknown bulk action.' }); return;
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
        item: it, team: team?.name ?? null, teams: allTeams.map((t) => ({ id: t.id, name: t.name })),
        effective_rate: formatPennies(effectiveRatePennies(it, team ? [team] : [])),
        monday_url: it.monday_item_id && job.monday_board_id ? mondayItemUrl(job, it.monday_item_id) : null,
        photos: photoOut, snags: snagOut, is_snag: (it as any).kind === 'snag',
      });
      return;
    }

    // Raise a snag as its own item (own labour cost + team), optionally with a defect photo.
    if (p.startsWith('/api/item/') && p.endsWith('/snags') && req.method === 'POST') {
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

    if (p.startsWith('/api/item/') && req.method === 'PUT') {
      const id = p.split('/').pop()!;
      const body = await readJson(req);
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const patch: Record<string, unknown> = {};
      if ('rate_override_pennies' in body)
        patch.rate_override_pennies = (body.rate_override_pennies === '' || body.rate_override_pennies == null) ? null : Math.round(Number(body.rate_override_pennies));
      if ('install_status' in body) patch.install_status = body.install_status || null;
      if ('team_id' in body) patch.team_id = body.team_id || null;
      const { error } = await db().from('survey_items').update(patch).eq('id', id);
      if (error) { send(res, 500, { error: error.message }); return; }
      send(res, 200, { ok: true });
      return;
    }

    if (p.startsWith('/api/promote/') && req.method === 'POST') {
      const id = p.split('/').pop()!;
      const item = await getSurveyItem(id);
      if (item.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const r = await promoteItem(id);
      send(res, 200, { ok: true, action: r.action, mondayItemId: r.mondayItemId });
      return;
    }

    // ---- teams & rates (office Stage 2) ----
    if (p === '/api/teams' && req.method === 'GET') {
      const teams = await listTeams(ctx.tenant_id);
      const rows = await Promise.all(teams.map(async (t) => ({
        id: t.id, name: t.name, default_rate_pennies: t.default_rate_pennies,
        default_rate: formatPennies(t.default_rate_pennies), in_use: await countItemsUsingTeam(t.id),
      })));
      send(res, 200, { teams: rows, canManage: ctx.role === 'admin', role: ctx.role });
      return;
    }

    if (p === '/api/teams' && req.method === 'POST') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Only admins can manage teams' }); return; }
      const { name, rate_pennies } = await readJson(req);
      if (!name || !String(name).trim()) { send(res, 400, { error: 'Team name is required' }); return; }
      const pennies = Math.round(Number(rate_pennies));
      if (!Number.isFinite(pennies) || pennies < 0) { send(res, 400, { error: 'Rate must be a positive number' }); return; }
      const t = await createTeam(ctx.tenant_id, String(name).trim(), pennies);
      send(res, 200, { ok: true, id: t.id });
      return;
    }

    if (p.startsWith('/api/teams/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Only admins can manage teams' }); return; }
      const id = p.split('/').pop()!;
      const team = await getTeam(id);
      if (!team || team.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }

      if (req.method === 'PUT') {
        const body = await readJson(req);
        const patch: { name?: string; default_rate_pennies?: number } = {};
        if ('name' in body) { if (!String(body.name).trim()) { send(res, 400, { error: 'Team name is required' }); return; } patch.name = String(body.name).trim(); }
        if ('rate_pennies' in body) { const v = Math.round(Number(body.rate_pennies)); if (!Number.isFinite(v) || v < 0) { send(res, 400, { error: 'Rate must be a positive number' }); return; } patch.default_rate_pennies = v; }
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
      send(res, 200, { jobs: rows, canManage: ctx.role === 'admin' });
      return;
    }

    // Link / unlink a job's Monday board. Accepts a board id or a full board URL.
    if (p.startsWith('/api/job/') && p.endsWith('/board') && req.method === 'PUT') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Only admins can link boards' }); return; }
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

    // ---- user management (office Stage 3, admin only) ----
    if (p === '/api/users' && req.method === 'GET') {
      if (ctx.role !== 'admin') { send(res, 403, { error: 'Admins only' }); return; }
      const users = await listAppUsers(ctx.tenant_id);
      send(res, 200, {
        me: ctx.id, roles: ROLES,
        users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, has_login: !!u.auth_user_id })),
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
      await resetUserPassword(u.email, password);
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
  .bulkbar{display:flex;align-items:center;gap:10px;background:var(--purple);color:#fff;border-radius:12px;padding:9px 14px;margin:14px 0 10px}
  #bulkcount{font-size:12.5px;font-weight:700;margin-right:4px}
  .bulk{font-size:12px;font-weight:600;border-radius:8px;padding:7px 12px;border:none;cursor:pointer}
  .bulk.bsync{background:var(--magenta);color:#fff}
  .bulk.bsel{background:#fff;color:var(--ink);border:1px solid #cfc9ea}
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
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10px;color:#9a97ad;font-weight:700;padding:13px 12px 8px}
  td{padding:9px 12px;border-top:1px solid #f2f0f8;vertical-align:middle}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px}
  .scanned{background:#eef0f4;color:var(--muted)}.in_survey{background:var(--amber-soft);color:var(--amber)}
  .surveyed{background:var(--soft);color:var(--purple)}.synced{background:var(--green-soft);color:var(--green)}
  input.rate{width:74px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px}
  select.sel{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;background:#fff}
  .sync{background:var(--purple);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer}
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
  <div class="loginver">v__APP_VERSION__</div>
</div></div>

<div id="appView" style="display:none">
  <header>
    <div class="brand">ACE<b>GROUP</b> <span>· Office</span></div>
    <button class="verchip" onclick="showChangelog()" title="What's new">v__APP_VERSION__</button>
    <nav class="nav">
      <button id="tabDash" class="tab on" onclick="showTab('dashboard')">Dashboard</button>
      <button id="tabItems" class="tab" onclick="showTab('items')">Items</button>
      <button id="tabTeams" class="tab" onclick="showTab('teams')">Teams &amp; rates</button>
      <button id="tabSync" class="tab" onclick="showTab('sync')">Monday sync</button>
      <button id="tabUsers" class="tab" style="display:none" onclick="showTab('users')">Users</button>
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
    <aside><div class="slabel">JOBS</div><div id="jobs"></div></aside>
    <main>
      <div class="titlerow">
        <div><h2 id="title">—</h2><div class="sub" id="subtitle"></div></div>
        <button id="newBtn" class="newbtn" onclick="openCreate()">+ New item</button>
      </div>
      <div id="itemFilters" class="chips">
        <button class="chip on" data-f="all" onclick="setFilter('all')">All</button>
        <button class="chip" data-f="synced" onclick="setFilter('synced')">Synced</button>
        <button class="chip" data-f="unsynced" onclick="setFilter('unsynced')">Not synced</button>
        <button class="chip" data-f="installed" onclick="setFilter('installed')">Installed</button>
        <button class="chip" data-f="snags" onclick="setFilter('snags')">Snags</button>
        <button class="chip" data-f="open_snags" onclick="setFilter('open_snags')">Open snags</button>
        <span id="itemCount" class="itemcount"></span>
      </div>
      <div id="bulkbar" class="bulkbar" style="display:none">
        <span id="bulkcount">0 selected</span>
        <button class="bulk bsync" onclick="bulkSync()">Sync selected</button>
        <select id="bulkTeam" class="bulk bsel" onchange="bulkApply('team',this)"><option value="">Assign team…</option></select>
        <select id="bulkStatus" class="bulk bsel" onchange="bulkApply('status',this)"><option value="">Set status…</option></select>
        <button class="bulk bclear" onclick="clearSel()">Clear</button>
      </div>
      <div class="card2"><table><thead><tr>
        <th class="cbcell"><input type="checkbox" id="selAll" onclick="toggleAll(this)"></th>
        <th>FULL CODE</th><th>ROOM</th><th>ITEM</th><th>STAGE</th><th>RATE (£)</th><th>INSTALL STATUS</th><th>TEAM</th><th>MONDAY</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
    </main>
  </div>

  <div id="teamsView" style="display:none">
    <main style="max-width:760px">
      <h2>Fitter teams &amp; rates</h2>
      <div class="sub">Each team has a default fitting rate. Items inherit their team's rate unless a per-item override is set. The rate flows to Monday's <b>Labour Cost</b> column when an item is synced.</div>
      <div id="addTeam" class="addrow" style="display:none">
        <input id="newTeamName" class="tinput" placeholder="Team name (e.g. Team P03)">
        <div class="pfx"><span>£</span><input id="newTeamRate" class="tinput rate2" type="number" min="0" step="1" placeholder="80"></div>
        <button class="add" onclick="addTeam()">Add team</button>
      </div>
      <div id="teamsNote" class="sub" style="display:none">You're signed in as <b id="roleName"></b>. Only admins can add or edit teams.</div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>TEAM</th><th>DEFAULT RATE (£)</th><th>ITEMS USING</th><th></th>
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

  <div id="usersView" style="display:none">
    <main style="max-width:860px">
      <h2>Users</h2>
      <div class="sub">Create logins for office and field staff, set their role, and deactivate anyone who leaves. Roles: <b>admin</b> (full access + this tab), <b>office</b>, <b>surveyor</b>, <b>scanner</b>, <b>fitter</b>.</div>
      <div class="addrow" style="flex-wrap:wrap">
        <input id="nuName" class="tinput" placeholder="Full name">
        <input id="nuEmail" class="tinput" type="email" placeholder="email@company.com" style="width:210px">
        <select id="nuRole" class="tinput"></select>
        <input id="nuPass" class="tinput" placeholder="password (blank = auto)" style="width:180px">
        <button class="add" onclick="addUser()">Add user</button>
      </div>
      <div class="ferr" id="userErr" style="padding:6px 2px 0"></div>
      <div class="card2" style="margin-top:14px"><table><thead><tr>
        <th>NAME</th><th>EMAIL</th><th>ROLE</th><th>LOGIN</th><th>STATUS</th><th></th>
      </tr></thead><tbody id="userRows"></tbody></table></div>
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
  var token=sessionStorage.getItem('ace_token')||''; var current='AXS.LAB'; var teams=[]; var sel={};
  var itemsData=null; var itemFilter='all';
  var myRole=sessionStorage.getItem('ace_role')||''; var USER_ROLES=['admin','office','surveyor','scanner','fitter'];
  var CHANGELOG=__CHANGELOG_JSON__;
  var SSO_ENABLED=__SSO_ENABLED__; var SUPA_URL='__SUPABASE_URL__'; var SUPA_ANON='__SUPABASE_ANON_KEY__';
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
    if(r.ok){var me=await r.json();myRole=me.role||'';sessionStorage.setItem('ace_token',token);sessionStorage.setItem('ace_role',myRole);document.getElementById('whoName').textContent=me.name||'';showApp();}
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
    token=d.token; myRole=d.role||''; sessionStorage.setItem('ace_token',token); sessionStorage.setItem('ace_role',myRole);
    document.getElementById('whoName').textContent=d.name;
    showApp();
  }
  function logout(){token='';myRole='';sessionStorage.removeItem('ace_token');sessionStorage.removeItem('ace_role');document.getElementById('appView').style.display='none';document.getElementById('loginView').style.display='grid';}
  async function showApp(){document.getElementById('loginView').style.display='none';document.getElementById('appView').style.display='block';applyRole();await loadJobs();await loadItems();showTab('dashboard');}
  async function loadJobs(){
    var jobs=await (await api('/api/jobs')).json(); var el=document.getElementById('jobs');el.innerHTML='';
    function mk(code,label){var d=document.createElement('div');d.className='job'+(code===current?' on':'');d.textContent=label;d.setAttribute('data-code',code);
      d.onclick=function(){current=code;itemFilter='all';document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-code')===current)});loadItems();};el.appendChild(d);}
    mk('ALL','▦ All jobs');
    jobs.forEach(function(j){mk(j.code,j.code);});
  }
  function opt(v,l,sel){return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+l+'</option>';}
  async function loadItems(){
    var data=await (await api('/api/items?job='+encodeURIComponent(current))).json(); teams=data.teams; itemsData=data;
    document.getElementById('bulkTeam').innerHTML='<option value="">Assign team…</option>'+teams.map(function(t){return opt(t.id,t.name,'')}).join('');
    document.getElementById('bulkStatus').innerHTML='<option value="">Set status…</option>'+ISTATUS.filter(function(s){return s[0]}).map(function(s){return opt(s[0],s[1],'')}).join('');
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> — '+data.job.name;
    document.getElementById('subtitle').textContent=(current==='ALL'?'All jobs · ':'Monday board: '+(data.job.board||'(not linked)')+' · ')+'edits save to the store; use Sync to push to Monday';
    document.getElementById('newBtn').style.display=(current==='ALL')?'none':'';
    renderItems();
  }
  var INSTALLED_SET={installed_no_snag:1,installed_snag:1};
  function matchFilter(r){
    switch(itemFilter){
      case 'synced':return !!r.synced;
      case 'unsynced':return !r.synced;
      case 'installed':return !!INSTALLED_SET[r.install_status];
      case 'open_snags':return r.kind==='snag' && !INSTALLED_SET[r.install_status];
      case 'snags':return r.kind==='snag';
      default:return true;
    }
  }
  function setFilter(f){itemFilter=f;renderItems();}
  function renderItems(){
    sel={};
    document.querySelectorAll('#itemFilters .chip').forEach(function(c){c.classList.toggle('on',c.getAttribute('data-f')===itemFilter);});
    var rows=(itemsData?itemsData.items:[]).filter(matchFilter);
    var tb=document.getElementById('rows');tb.innerHTML='';
    rows.forEach(function(r){
      var tr=document.createElement('tr');
      var statusSel='<select class="sel" onchange="save(\\''+r.id+'\\',\\'install_status\\',this.value)">'+ISTATUS.map(function(s){return opt(s[0],s[1],r.install_status||'')}).join('')+'</select>';
      var teamSel='<select class="sel" onchange="save(\\''+r.id+'\\',\\'team_id\\',this.value)">'+opt('','—',r.team_id||'')+teams.map(function(t){return opt(t.id,t.name,r.team_id||'')}).join('')+'</select>';
      var rateVal=r.rate_override_pennies!=null?(r.rate_override_pennies/100):'';
      var rateInput='<input class="rate" type="number" placeholder="'+r.effective_rate.replace('£','')+'" value="'+rateVal+'" onchange="saveRate(\\''+r.id+'\\',this.value)">';
      var monday=r.synced?'<a class="mlink" target="_blank" href="'+r.monday_url+'">open ↗</a>':'<button class="sync" onclick="syncItem(\\''+r.id+'\\')">Sync</button>';
      var snagTag=r.kind==='snag'?'<span class="snagtag">SNAG</span> ':'';
      tr.innerHTML='<td class="cbcell"><input type="checkbox" class="rowcb" data-id="'+r.id+'"'+(sel[r.id]?' checked':'')+' onclick="toggleRow(\\''+r.id+'\\',this)"></td>'+
        '<td>'+snagTag+'<a class="codelink mono" onclick="openDetail(\\''+r.id+'\\')">'+(r.full_code||'')+'</a></td><td>'+(r.room||'—')+'</td><td>'+(r.item||'—')+'</td>'+
        '<td><span class="pill '+r.stage+'">'+(STAGE[r.stage]||r.stage)+'</span></td>'+
        '<td>'+rateInput+'</td><td>'+statusSel+'</td><td>'+teamSel+'</td><td>'+monday+'</td>';
      tb.appendChild(tr);
    });
    document.getElementById('itemCount').textContent=rows.length+' shown';
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
  async function syncItem(id){tShow('Syncing…');try{var d=await (await api('/api/promote/'+id,{method:'POST'})).json();if(d.ok){tShow('Synced to Monday');loadItems();}else tShow(d.error||'Sync failed');}catch(e){tShow('Sync failed')}}

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
  async function bulkApply(action,selEl){
    var value=selEl.value;if(!value){return;}
    var ids=selectedIds();if(!ids.length){selEl.value='';return;}
    var d=await (await api('/api/items/bulk',{method:'POST',body:JSON.stringify({ids:ids,action:action,value:value})})).json();
    selEl.value='';
    if(d.ok){tShow(d.updated+' item(s) updated');loadItems();}else tShow(d.error||'Update failed');
  }

  // ---- teams & rates ----
  var canManage=false;
  function showTab(name){
    document.getElementById('dashView').style.display=name==='dashboard'?'block':'none';
    document.getElementById('itemsView').style.display=name==='items'?'flex':'none';
    document.getElementById('teamsView').style.display=name==='teams'?'block':'none';
    document.getElementById('syncView').style.display=name==='sync'?'block':'none';
    document.getElementById('usersView').style.display=name==='users'?'block':'none';
    document.getElementById('tabDash').classList.toggle('on',name==='dashboard');
    document.getElementById('tabItems').classList.toggle('on',name==='items');
    document.getElementById('tabTeams').classList.toggle('on',name==='teams');
    document.getElementById('tabSync').classList.toggle('on',name==='sync');
    document.getElementById('tabUsers').classList.toggle('on',name==='users');
    if(name==='dashboard')loadDashboard();
    if(name==='teams')loadTeams();
    if(name==='sync')loadSync();
    if(name==='users')loadUsers();
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
  function applyRole(){document.getElementById('tabUsers').style.display=(myRole==='admin')?'block':'none';}
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
      var del=canManage?'<button class="del" '+(t.in_use>0?'disabled title="Reassign its items first"':'')+' onclick="delTeam(\\''+t.id+'\\','+t.in_use+')">Delete</button>':'';
      tr.innerHTML='<td>'+name+'</td><td>'+rate+'</td><td><span class="count">'+t.in_use+'</span></td><td style="text-align:right">'+del+'</td>';
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
  async function saveTeamRate(id,value){if(value===''||Number(value)<0){tShow('Invalid rate');loadTeams();return;}var d=await (await api('/api/teams/'+id,{method:'PUT',body:JSON.stringify({rate_pennies:Math.round(Number(value)*100)})})).json();tShow(d.ok?'Rate saved':(d.error||'Failed'));}
  async function delTeam(id,inUse){
    if(inUse>0){tShow('Reassign its '+inUse+' item(s) first');return;}
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
      tr.innerHTML='<td class="mono"><b>'+jb.code+'</b><div style="font-size:11px;color:var(--muted);font-weight:400">'+(jb.name||'')+'</div></td>'+
        '<td>'+board+'</td><td>'+jb.total+'</td><td><span class="count green">'+jb.synced+'</span></td><td>'+toSync+'</td>'+
        '<td style="text-align:right">'+btn+'</td>';
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

  // ---- user management (admin only) ----
  var myId='';
  async function loadUsers(){
    var data=await (await api('/api/users')).json();
    var tb=document.getElementById('userRows');
    if(data.error){tb.innerHTML='<tr><td colspan="6" style="padding:16px;color:var(--muted)">'+esc(data.error)+'</td></tr>';return;}
    myId=data.me;
    var nr=document.getElementById('nuRole');
    if(!nr.options.length)nr.innerHTML=USER_ROLES.map(function(r){return '<option value="'+r+'"'+(r==='surveyor'?' selected':'')+'>'+r+'</option>';}).join('');
    tb.innerHTML='';
    data.users.forEach(function(u){
      var self=u.id===myId;
      var attr=function(s){return esc(s).replace(/"/g,'&quot;');};
      var nameInput='<input class="tname" value="'+attr(u.name)+'" onchange="saveUserField(\\''+u.id+'\\',\\'name\\',this.value)">';
      var emailInput='<input class="tname" style="width:205px" value="'+attr(u.email)+'" onchange="saveUserField(\\''+u.id+'\\',\\'email\\',this.value)">';
      var roleSel='<select class="sel" '+(self?'disabled':'')+' onchange="saveUserField(\\''+u.id+'\\',\\'role\\',this.value)">'+USER_ROLES.map(function(r){return opt(r,r,u.role)}).join('')+'</select>';
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
      tr.innerHTML='<td>'+nameInput+'</td><td>'+emailInput+'</td><td>'+roleSel+'</td><td>'+login+'</td><td>'+status+'</td><td style="text-align:right;white-space:nowrap">'+actions+'</td>';
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
  async function saveUserField(id,field,value){var b={};b[field]=value;var d=await (await api('/api/users/'+id,{method:'PUT',body:JSON.stringify(b)})).json();if(d.ok)tShow('Saved');else{tShow(d.error||'Update failed');loadUsers();}}
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
    var topts='<option value="">— no team —</option>'+teams.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join('');
    var html='<div class="fgrid">'
      +'<div class="codeprev" id="codePrev">'+current+'</div>'
      +'<div class="groupt">LOCATION</div>'
      +field('f_block','Block','e.g. B1')+field('f_elev','Elevation','e.g. E1')
      +field('f_flat','Flat / plot','e.g. 21')+field('f_floor','Floor','e.g. F1')
      +field('f_room','Room *','e.g. LR')+field('f_item','Item *','e.g. W02')
      +'<div class="groupt">SPECIFICATION</div>'
      +field('f_material','Material','uPVC / Alu / Timber')+field('f_type','Item type','Window / Door')
      +field('f_glass','Glass','e.g. 4-20-4')+field('f_glazing','Glazing','Double / Triple')
      +field('f_width','Width (mm)','','number')+field('f_height','Height inc cill (mm)','','number')
      +'<div class="field"><label>Team</label><select id="f_team">'+topts+'</select></div>'
      +'<div class="field full"><label>Comments</label><textarea id="f_comments" rows="2"></textarea></div>'
      +'<div class="ferr" id="createErr"></div></div>'
      +'<div class="foot"><button class="cancel" onclick="closeModal()">Cancel</button><button class="save" onclick="submitCreate()">Create item</button></div>';
    openModal('New survey item',html);
    ['f_block','f_elev','f_flat','f_floor','f_room','f_item'].forEach(function(id){document.getElementById(id).addEventListener('input',calcCode);});
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
    var body={job:current,block:g('f_block'),elevation:g('f_elev'),flat:g('f_flat'),floor:g('f_floor'),room:g('f_room'),item:g('f_item'),
      material:g('f_material'),item_type:g('f_type'),glass:g('f_glass'),glazing:g('f_glazing'),width_mm:g('f_width'),height_mm:g('f_height'),
      comments:g('f_comments'),team_id:document.getElementById('f_team').value};
    if(!body.room||!body.item){document.getElementById('createErr').textContent='Room and Item are required.';return;}
    var r=await api('/api/items',{method:'POST',body:JSON.stringify(body)});var d=await r.json();
    if(r.ok&&d.ok){closeModal();tShow('Created '+d.full_code);loadItems();}
    else document.getElementById('createErr').textContent=d.error||'Could not create item';
  }
  function istatLabel(v){var m=ISTATUS.filter(function(s){return s[0]===(v||'')});return (m[0]||['','—'])[1];}
  async function openDetail(id){
    openModal('Loading…','<div class="empty">Loading…</div>');
    var d=await (await api('/api/item/'+id+'/detail')).json(); var it=d.item;
    function row(k,v){return (v==null||v==='')?'':'<div class="drow"><dt>'+k+'</dt><dd>'+v+'</dd></div>';}
    var html='<dl class="dl">'
      +row('Full code','<span class="mono">'+esc(it.full_code)+'</span>')
      +row('Stage',esc(STAGE[it.stage]||it.stage))
      +row('Room / Item',esc(it.room_code||'—')+' / '+esc(it.item_code||'—'))
      +row('Block · Elev · Flat',[it.block,it.elevation,it.flat].map(function(x){return esc(x||'—');}).join(' · '))
      +row('Floor',esc(it.floor))
      +row('Material',esc(it.material))+row('Type',esc(it.item_type))
      +row('Glass',esc(it.glass))+row('Glazing',esc(it.glazing))
      +row('Size (mm)',(it.width_mm||it.height_mm)?(esc(it.width_mm||'?')+' × '+esc(it.height_mm||'?')):'')
      +row('Design code',esc(it.design_code))
      +row('Comments',esc(it.comments))
      +row('Team',esc(d.team||'—'))+row('Fitting rate',esc(d.effective_rate))
      +row('Install status',esc(istatLabel(it.install_status)))
      +row('Install date',esc(it.actual_install_date))
      +row('Monday',d.monday_url?'<a class="mlink" target="_blank" href="'+d.monday_url+'">open ↗</a>':'not synced')
      +'</dl>';
    if(d.photos&&d.photos.length){
      html+='<div class="groupt" style="padding:0 22px">PHOTOS</div><div class="photos">'+d.photos.map(function(ph){return '<figure><img src="'+(ph.url||'')+'" alt=""><figcaption>'+esc(ph.kind)+'</figcaption></figure>';}).join('')+'</div>';
    } else { html+='<div class="empty">No photos yet — these arrive from the mobile survey / install flow.</div>'; }
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
    document.getElementById('modalTitle').innerHTML=(d.is_snag?'Snag ':'Item ')+'<span class="mono">'+esc(it.full_code)+'</span>';
    document.getElementById('modalBody').innerHTML=html;
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
  document.getElementById('modal').addEventListener('click',function(e){if(e.target.id==='modal')closeModal();});
  if(SSO_ENABLED){var w=document.getElementById('ssoWrap');if(w)w.style.display='block';}
  // Returning from Microsoft OAuth: Supabase puts the session in the URL hash.
  if(window.location.hash.indexOf('access_token=')>=0){
    var hp=new URLSearchParams(window.location.hash.slice(1));
    var at=hp.get('access_token');
    history.replaceState(null,'',window.location.pathname);
    if(at){token=at;bootstrapSession();}
  } else if(token){document.getElementById('appView').style.display='block';document.getElementById('loginView').style.display='none';applyRole();loadJobs().then(loadItems).then(function(){showTab('dashboard');}).catch(logout);}
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
