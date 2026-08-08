// Live web dashboard — a tiny read-only server over the canonical store.
// Uses the Supabase service-role key on the server, so no login/RLS needed for a dev view.
//
// Run:  node --env-file=.env --import tsx apps/api/src/server.ts
// Then open http://localhost:3000 in Chrome. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { createServer } from 'node:http';
import { listJobs, getJobByCode, listSurveyItems, listTeams } from './store';
import { effectiveRatePennies, formatPennies } from '@ace/shared';
import { ACE_TENANT } from './supabase';

const PORT = Number(process.env.PORT ?? 3000);
const sendJson = (res: any, code: number, data: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }

    if (url.pathname === '/api/jobs') {
      const jobs = await listJobs(ACE_TENANT);
      sendJson(res, 200, jobs.map((j) => ({
        code: `${j.client_code}.${j.job_code}`, name: j.name, board: j.monday_board_id,
      })));
      return;
    }

    if (url.pathname === '/api/items') {
      const code = url.searchParams.get('job') ?? 'AXS.LAB';
      const [c, j] = code.split('.');
      const job = await getJobByCode(c, j);
      const [items, teams] = await Promise.all([listSurveyItems(job.id), listTeams(job.tenant_id)]);
      const rows = items.map((it) => {
        const rate = effectiveRatePennies(it, teams);
        const team = teams.find((t) => t.id === it.team_id)?.name ?? '—';
        const monday_url = it.monday_item_id && job.monday_board_id
          ? `https://monday.com/boards/${job.monday_board_id}/pulses/${it.monday_item_id}` : null;
        return {
          full_code: it.full_code, room: it.room_code, item: it.item_code,
          stage: it.stage, rate: formatPennies(rate), team, monday_url,
        };
      });
      sendJson(res, 200, { job: { code, name: job.name, board: job.monday_board_id }, items: rows });
      return;
    }

    res.writeHead(404); res.end('Not found');
  } catch (e: any) {
    sendJson(res, 500, { error: e?.message ?? String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  ACE dashboard running →  http://localhost:${PORT}`);
  console.log('  (reads live from Supabase · Ctrl+C to stop)\n');
});

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACE — Jobs & Staging</title>
<style>
  :root{--purple:#3a2b72;--magenta:#e6187e;--ink:#1f1a3d;--muted:#6b6786;--line:#e4e2ee;--bg:#f4f3f9;
    --green:#16a34a;--green-soft:#e7f6ec;--amber:#d97706;--amber-soft:#fef3e2;--red:#dc2626;--red-soft:#fdecec;--soft:#ecebf6}
  *{box-sizing:border-box;margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  body{background:var(--bg);color:var(--ink)}
  header{height:56px;background:var(--purple);color:#fff;display:flex;align-items:center;padding:0 22px;gap:12px}
  .brand{font-weight:800;font-size:17px}.brand b{color:#ff8fc8}.brand span{font-weight:500;font-size:12px;color:#cfc9ea}
  .reload{margin-left:auto;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:12px;font-weight:600;
    padding:7px 14px;border-radius:10px;cursor:pointer}
  .layout{display:flex;min-height:calc(100vh - 56px)}
  aside{width:230px;background:#fff;border-right:1px solid var(--line);padding:16px 0;flex:0 0 auto}
  .slabel{font-size:10px;font-weight:700;color:#9a97ad;letter-spacing:.05em;padding:8px 22px}
  .job{padding:9px 22px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--muted);cursor:pointer;border-left:4px solid transparent}
  .job:hover{background:#faf9fd}
  .job.on{color:var(--purple);font-weight:700;background:var(--soft);border-left-color:var(--magenta)}
  main{flex:1;padding:22px 26px;overflow:auto}
  h1{font-size:20px;color:var(--purple)}h1 .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .sub{font-size:12px;color:var(--muted);margin:4px 0 16px}
  .stat{display:flex;gap:12px;margin-bottom:16px}
  .statc{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px 16px;min-width:120px}
  .statc b{display:block;font-size:22px;color:var(--purple)}.statc span{font-size:11px;color:var(--muted);font-weight:600}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10px;color:#9a97ad;font-weight:700;letter-spacing:.04em;padding:14px 14px 8px}
  td{padding:11px 14px;border-top:1px solid #f2f0f8;vertical-align:top}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace}
  .pill{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .scanned{background:#eef0f4;color:var(--muted)}.in_survey{background:var(--amber-soft);color:var(--amber)}
  .surveyed{background:var(--soft);color:var(--purple)}.synced{background:var(--green-soft);color:var(--green)}
  a.mlink{color:var(--magenta);font-weight:600;text-decoration:none;font-size:11px}a.mlink:hover{text-decoration:underline}
  .empty{padding:26px;color:#9a97ad;font-size:13px}
</style></head>
<body>
<header>
  <div class="brand">ACE<b>GROUP</b> <span>· Jobs & Staging (live)</span></div>
  <button class="reload" onclick="load()">Reload</button>
</header>
<div class="layout">
  <aside><div class="slabel">JOBS</div><div id="jobs"></div></aside>
  <main>
    <h1 id="title">—</h1>
    <div class="sub" id="subtitle"></div>
    <div class="stat" id="stat"></div>
    <div class="card"><table><thead><tr>
      <th>FULL CODE</th><th>ROOM</th><th>ITEM</th><th>STAGE</th><th>RATE</th><th>TEAM</th><th>MONDAY</th>
    </tr></thead><tbody id="rows"></tbody></table><div id="empty"></div></div>
  </main>
</div>
<script>
  var STAGE={scanned:'Scanned',in_survey:'In survey',surveyed:'Surveyed',synced:'Synced → Monday'};
  var current='AXS.LAB';
  async function loadJobs(){
    var jobs=await (await fetch('/api/jobs')).json();
    var el=document.getElementById('jobs'); el.innerHTML='';
    jobs.forEach(function(j){
      var d=document.createElement('div'); d.className='job'+(j.code===current?' on':'');
      d.textContent=j.code; d.onclick=function(){current=j.code; loadItems(); document.querySelectorAll('.job').forEach(function(x){x.classList.toggle('on',x.textContent===current)});};
      el.appendChild(d);
    });
  }
  async function loadItems(){
    var data=await (await fetch('/api/items?job='+encodeURIComponent(current))).json();
    document.getElementById('title').innerHTML='<span class="mono">'+data.job.code+'</span> — '+data.job.name;
    document.getElementById('subtitle').textContent='Monday board: '+(data.job.board||'(not linked)');
    var rows=data.items, c={}; rows.forEach(function(r){c[r.stage]=(c[r.stage]||0)+1});
    document.getElementById('stat').innerHTML=
      '<div class="statc"><b>'+rows.length+'</b><span>ITEMS</span></div>'+
      '<div class="statc"><b style="color:var(--green)">'+(c.synced||0)+'</b><span>ON MONDAY</span></div>'+
      '<div class="statc"><b style="color:var(--amber)">'+((c.surveyed||0)+(c.in_survey||0))+'</b><span>IN SURVEY</span></div>'+
      '<div class="statc"><b style="color:var(--muted)">'+(c.scanned||0)+'</b><span>SCANNED</span></div>';
    var tb=document.getElementById('rows'); tb.innerHTML='';
    rows.forEach(function(r){
      var tr=document.createElement('tr');
      tr.innerHTML='<td class="mono" style="font-size:10.5px">'+(r.full_code||'')+'</td>'+
        '<td>'+(r.room||'—')+'</td><td>'+(r.item||'—')+'</td>'+
        '<td><span class="pill '+r.stage+'">'+(STAGE[r.stage]||r.stage)+'</span></td>'+
        '<td>'+r.rate+'</td><td>'+r.team+'</td>'+
        '<td>'+(r.monday_url?'<a class="mlink" target="_blank" href="'+r.monday_url+'">open ↗</a>':'—')+'</td>';
      tb.appendChild(tr);
    });
    document.getElementById('empty').innerHTML=rows.length?'':'<div class="empty">No items yet for this job.</div>';
  }
  async function load(){ await loadJobs(); await loadItems(); }
  load();
</script></body></html>`;
