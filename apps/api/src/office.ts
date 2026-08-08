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
import { db } from './supabase';
import { listJobs, getJobByCode, listSurveyItems, listTeams, getSurveyItem } from './store';
import { promoteItem } from './promote';
import { effectiveRatePennies, formatPennies } from '@ace/shared';

const PORT = Number(process.env.PORT ?? 3000);

function authClient() {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env.');
  return createClient(url, anon, { auth: { persistSession: false } });
}

const send = (res: any, code: number, data: unknown, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : (data as string));
};
const readJson = (req: any): Promise<any> => new Promise((resolve) => {
  let b = ''; req.on('data', (c: any) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

// Resolve the caller's app_users row from their bearer token.
async function context(req: any): Promise<{ id: string; tenant_id: string; role: string; name: string } | null> {
  const h = String(req.headers['authorization'] ?? '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const { data } = await authClient().auth.getUser(token);
  if (!data?.user) return null;
  const { data: u } = await db().from('app_users')
    .select('id,tenant_id,role,name,active').eq('auth_user_id', data.user.id).maybeSingle();
  if (!u || !u.active) return null;
  return u as any;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const p = url.pathname;

    if (p === '/') { send(res, 200, PAGE, 'text/html; charset=utf-8'); return; }

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

    if (p === '/api/jobs') {
      const jobs = await listJobs(ctx.tenant_id);
      send(res, 200, jobs.map((j) => ({ code: `${j.client_code}.${j.job_code}`, name: j.name })));
      return;
    }

    if (p === '/api/items') {
      const code = url.searchParams.get('job') ?? 'AXS.LAB';
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
      if (job.tenant_id !== ctx.tenant_id) { send(res, 403, { error: 'forbidden' }); return; }
      const [items, teams] = await Promise.all([listSurveyItems(job.id), listTeams(job.tenant_id)]);
      const rows = items.map((it) => ({
        id: it.id, full_code: it.full_code, room: it.room_code, item: it.item_code, stage: it.stage,
        install_status: it.install_status, team_id: it.team_id, rate_override_pennies: it.rate_override_pennies,
        effective_rate: formatPennies(effectiveRatePennies(it, teams)),
        synced: !!it.monday_item_id,
        monday_url: it.monday_item_id && job.monday_board_id
          ? `https://monday.com/boards/${job.monday_board_id}/pulses/${it.monday_item_id}` : null,
      }));
      send(res, 200, {
        job: { code, name: job.name, board: job.monday_board_id },
        teams: teams.map((t) => ({ id: t.id, name: t.name })),
        items: rows, role: ctx.role,
      });
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
  /* app */
  header{height:56px;background:var(--purple);color:#fff;display:flex;align-items:center;padding:0 22px;gap:12px}
  .brand{font-weight:800;font-size:17px}.brand b{color:#ff8fc8}.brand span{font-weight:500;font-size:12px;color:#cfc9ea}
  .who{margin-left:auto;font-size:12px;color:#cfc9ea}.who button{margin-left:12px;background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 12px;border-radius:9px;font-size:12px;cursor:pointer}
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
  <div class="err" id="loginErr"></div>
</div></div>

<div id="appView" style="display:none">
  <header>
    <div class="brand">ACE<b>GROUP</b> <span>· Office</span></div>
    <div class="who"><span id="whoName"></span><button onclick="logout()">Sign out</button></div>
  </header>
  <div class="layout">
    <aside><div class="slabel">JOBS</div><div id="jobs"></div></aside>
    <main>
      <h2 id="title">—</h2><div class="sub" id="subtitle"></div>
      <div class="card2"><table><thead><tr>
        <th>FULL CODE</th><th>ROOM</th><th>ITEM</th><th>STAGE</th><th>RATE (£)</th><th>INSTALL STATUS</th><th>TEAM</th><th>MONDAY</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
    </main>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  var STAGE={scanned:'Scanned',in_survey:'In survey',surveyed:'Surveyed',synced:'Synced'};
  var ISTATUS=[['','—'],['scheduled','Scheduled'],['installed_no_snag','Installed no snag'],['installed_snag','Installed + snag'],['snag','Snag'],['misfit','MisFit'],['delayed','Delayed']];
  var token=sessionStorage.getItem('ace_token')||''; var current='AXS.LAB'; var teams=[];
  function tShow(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},1600);}
  async function api(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json',Authorization:'Bearer '+token},opts.headers||{});var r=await fetch(path,opts);if(r.status===401){logout();throw new Error('unauth')}return r;}
  async function login(){
    var email=document.getElementById('email').value, password=document.getElementById('password').value;
    var r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    var d=await r.json();
    if(!r.ok){document.getElementById('loginErr').textContent=d.error||'Login failed';return;}
    token=d.token; sessionStorage.setItem('ace_token',token); document.getElementById('whoName').textContent=d.name;
    showApp();
  }
  function logout(){token='';sessionStorage.removeItem('ace_token');document.getElementById('appView').style.display='none';document.getElementById('loginView').style.display='grid';}
  async function showApp(){document.getElementById('loginView').style.display='none';document.getElementById('appView').style.display='block';await loadJobs();await loadItems();}
  async function loadJobs(){
    var jobs=await (await api('/api/jobs')).json(); var el=document.getElementById('jobs');el.innerHTML='';
    jobs.forEach(function(j){var d=document.createElement('div');d.className='job'+(j.code===current?' on':'');d.textContent=j.code;
      d.onclick=function(){current=j.code;document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.textContent===current)});loadItems();};el.appendChild(d);});
  }
  function opt(v,l,sel){return '<option value="'+v+'"'+(v===sel?' selected':'')+'>'+l+'</option>';}
  async function loadItems(){
    var data=await (await api('/api/items?job='+encodeURIComponent(current))).json(); teams=data.teams;
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> — '+data.job.name;
    document.getElementById('subtitle').textContent='Monday board: '+(data.job.board||'(not linked)')+' · edits save to the store; use Sync to push to Monday';
    var tb=document.getElementById('rows');tb.innerHTML='';
    data.items.forEach(function(r){
      var tr=document.createElement('tr');
      var statusSel='<select class="sel" onchange="save(\\''+r.id+'\\',\\'install_status\\',this.value)">'+ISTATUS.map(function(s){return opt(s[0],s[1],r.install_status||'')}).join('')+'</select>';
      var teamSel='<select class="sel" onchange="save(\\''+r.id+'\\',\\'team_id\\',this.value)">'+opt('','—',r.team_id||'')+teams.map(function(t){return opt(t.id,t.name,r.team_id||'')}).join('')+'</select>';
      var rateVal=r.rate_override_pennies!=null?(r.rate_override_pennies/100):'';
      var rateInput='<input class="rate" type="number" placeholder="'+r.effective_rate.replace('£','')+'" value="'+rateVal+'" onchange="saveRate(\\''+r.id+'\\',this.value)">';
      var monday=r.synced?'<a class="mlink" target="_blank" href="'+r.monday_url+'">open ↗</a>':'<button class="sync" onclick="syncItem(\\''+r.id+'\\')">Sync</button>';
      tr.innerHTML='<td class="mono" style="font-size:10.5px">'+(r.full_code||'')+'</td><td>'+(r.room||'—')+'</td><td>'+(r.item||'—')+'</td>'+
        '<td><span class="pill '+r.stage+'">'+(STAGE[r.stage]||r.stage)+'</span></td>'+
        '<td>'+rateInput+'</td><td>'+statusSel+'</td><td>'+teamSel+'</td><td>'+monday+'</td>';
      tb.appendChild(tr);
    });
  }
  async function save(id,field,value){var b={};b[field]=value;await api('/api/item/'+id,{method:'PUT',body:JSON.stringify(b)});tShow('Saved');}
  async function saveRate(id,value){await api('/api/item/'+id,{method:'PUT',body:JSON.stringify({rate_override_pennies:value===''?null:Math.round(Number(value)*100)})});tShow('Rate saved');}
  async function syncItem(id){tShow('Syncing…');try{var d=await (await api('/api/promote/'+id,{method:'POST'})).json();if(d.ok){tShow('Synced to Monday');loadItems();}else tShow(d.error||'Sync failed');}catch(e){tShow('Sync failed')}}
  if(token){document.getElementById('appView').style.display='block';document.getElementById('loginView').style.display='none';loadJobs().then(loadItems).catch(logout);}
</script></body></html>`;
