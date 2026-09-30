// Report confirmations: an interactive "raport do potwierdzenia" HTML (Acemark technology report)
// shared as a secret link. The recipient's page is served sandboxed (own opaque origin — its scripts
// can't reach the office app's session), and we plug the report's shared-save hook
// (`window.claude.use("db")`) into our own /c/<token>/state endpoint, so every decision is saved
// server-side. After signing, the recipient clicks Approve → the record locks.
import PDFDocument from 'pdfkit';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './supabase';

const BUCKET = 'confirmations';
const FONTS = join(dirname(fileURLToPath(import.meta.url)), '../assets/labels');
const COLS = 'id,tenant_id,token,title,file_name,storage_path,filled_path,meta,state,status,created_by,created_by_name,created_at,updated_at,last_activity_at,approved_at,approved_by_name,approved_by_role';

// What we could read from this particular report. Every field is optional in practice — reports differ
// in items, sections and layout, so nothing downstream may assume a fixed structure.
export interface ConfirmationMeta {
  items: string[]; titles: Record<string, string>; questions: Record<string, string>; eyebrow: string;
  autosave: boolean;      // report exposes the shared-save hook → decisions are saved as the recipient works
  ownSignature: boolean;  // report has its own signature/acceptance section (#sig-save)
}

// ---- reading the report ----------------------------------------------------------------------
// The generator writes plain JS literals: const ITEMS = [...]; const TITLES = {...}; const QT = {...}
function jsLiteral(html: string, name: string): any {
  const m = html.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\})\\s*;`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export function readReport(html: string): { ok: boolean; error?: string; title: string; meta: ConfirmationMeta } {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const eyebrow = html.match(/EYEBROW_PDF = "([^"]*)"/)?.[1] ?? html.match(/EYEBROW = "([^"]*)"/)?.[1] ?? '';
  const arr = jsLiteral(html, 'ITEMS'), obj = (n: string) => { const v = jsLiteral(html, n); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  const meta: ConfirmationMeta = {
    items: Array.isArray(arr) ? arr.map(String) : [], titles: obj('TITLES'), questions: obj('QT'), eyebrow,
    autosave: /claude\.use\(\s*["']db["']\s*\)/.test(html),
    ownSignature: /id=["']sig-save["']/.test(html),
  };
  if (!/<(html|body)[\s>]/i.test(html)) return { ok: false, error: 'That file is not an HTML report.', title, meta };
  return { ok: true, title, meta };
}

// ---- storage + rows --------------------------------------------------------------------------
async function ensureBucket(): Promise<void> {
  const { data } = await db().storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function createConfirmation(tenantId: string, by: { id: string; name: string }, fileName: string, html: string, title: string, meta: ConfirmationMeta): Promise<any> {
  await ensureBucket();
  const token = randomBytes(24).toString('base64url');
  const path = `${tenantId}/${token}.html`;
  const up = await db().storage.from(BUCKET).upload(path, Buffer.from(html, 'utf8'), { contentType: 'text/html; charset=utf-8', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await db().from('confirmations').insert({
    tenant_id: tenantId, token, title, file_name: fileName, storage_path: path, meta, created_by: by.id, created_by_name: by.name,
  }).select(COLS).single();
  if (error) { await db().storage.from(BUCKET).remove([path]); throw error; }
  return data;
}
export async function listConfirmations(tenantId: string): Promise<any[]> {
  const { data, error } = await db().from('confirmations')
    .select('id,token,title,file_name,status,created_by,created_by_name,created_at,last_activity_at,approved_at,approved_by_name,approved_by_role')
    .eq('tenant_id', tenantId).order('created_at', { ascending: false });
  if (error) throw error; return data ?? [];
}
export async function getConfirmation(id: string, tenantId: string): Promise<any | null> {
  const { data, error } = await db().from('confirmations').select(COLS).eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error; return data ?? null;
}
export async function getConfirmationByToken(token: string): Promise<any | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data, error } = await db().from('confirmations').select(COLS).eq('token', token).maybeSingle();
  if (error) throw error; return data ?? null;
}
export async function loadConfirmationHtml(path: string): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('Report file missing');
  return await data.text();
}
export async function deleteConfirmation(row: any): Promise<void> {
  await db().storage.from(BUCKET).remove([row.storage_path, ...(row.filled_path ? [row.filled_path] : [])]);
  const { error } = await db().from('confirmations').delete().eq('id', row.id);
  if (error) throw error;
}

// The report sends `set` (whole state) or `update` (a patch: items/answers merge per key, the rest replaces).
export function mergeState(cur: any, mode: 'set' | 'update', patch: any): any {
  const base = mode === 'set' ? {} : (cur && typeof cur === 'object' ? cur : {});
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if ((k === 'items' || k === 'answers') && v && typeof v === 'object' && mode === 'update') out[k] = { ...(base[k] ?? {}), ...(v as any) };
    else out[k] = v;
  }
  return out;
}
export async function saveState(row: any, state: any): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from('confirmations').update({ state, last_activity_at: now, updated_at: now }).eq('id', row.id).eq('status', 'pending');
  if (error) throw error;
}
// Approve. The approver is the report's own signature if it has one, otherwise the name / signature
// entered in our Approve box. `snapshot` is the page exactly as filled in (any report structure).
export async function approveConfirmation(row: any, body: any): Promise<{ ok: boolean; error?: string; row?: any }> {
  const own = row.state?.signature && String(row.state.signature.name ?? '').trim() ? row.state.signature : null;
  const typed = String(body?.name ?? '').trim();
  if (row.meta?.ownSignature && !own) return { ok: false, error: 'Najpierw wpisz imię i nazwisko, złóż podpis i kliknij „Zapisz akceptację” w sekcji Akceptacja. / Please sign in the Akceptacja section first.' };
  if (!own && !typed) return { ok: false, error: 'Wpisz imię i nazwisko. / Please enter your name.' };
  if (!own && body?.confirm !== true) return { ok: false, error: 'Zaznacz potwierdzenie. / Please tick the confirmation box.' };
  const now = new Date().toISOString();
  const approval = own ? null : {
    name: typed.slice(0, 200), role: String(body?.role ?? '').trim().slice(0, 200) || null, at: now,
    png: typeof body?.png === 'string' && body.png.startsWith('data:image/png;base64,') && body.png.length < 400_000 ? body.png : null,
  };
  let filled_path: string | null = null;
  const snap = typeof body?.snapshot === 'string' ? body.snapshot : '';
  if (snap && snap.length < 30 * 1024 * 1024) {
    filled_path = `${row.tenant_id}/${row.token}-approved.html`;
    const up = await db().storage.from(BUCKET).upload(filled_path, Buffer.from(snap, 'utf8'), { contentType: 'text/html; charset=utf-8', upsert: true });
    if (up.error) filled_path = null;
  }
  const who = own ?? approval!;
  const { data, error } = await db().from('confirmations').update({
    status: 'approved', approved_at: now, approved_by_name: String(who.name).slice(0, 200), approved_by_role: who.role ? String(who.role).slice(0, 200) : null,
    updated_at: now, filled_path, ...(approval ? { state: { ...(row.state ?? {}), approval } } : {}),
  }).eq('id', row.id).eq('status', 'pending').select(COLS).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: 'Ten raport został już zatwierdzony. / Already approved.' };
  return { ok: true, row: data };
}

// ---- serving the recipient page --------------------------------------------------------------
// /c/<token>        → a small trusted wrapper page (our code, same origin as the API)
// /c/<token>/page   → the uploaded report, sandboxed (opaque origin: its scripts can't reach office
//                     logins/cookies) inside the wrapper's iframe. It makes NO network requests of its
//                     own: saves/approve go to the wrapper by postMessage, which calls the API same-origin.
export const REPORT_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; frame-ancestors 'self'",
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
export const WRAPPER_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '');

// Inside the sandboxed report: an RPC to the wrapper, and the report's `window.claude.use("db")` hook on top of it.
// Must run before the report's own script.
const BRIDGE = `<script>(function(){
  var LOCKED=__LOCKED__, seq=0, wait={}, framed=window.parent!==window;
  window.addEventListener('message',function(e){ if(e.source!==window.parent) return; var d=e.data||{}; if(!d.__ace||!wait[d.id]) return;
    var w=wait[d.id]; delete wait[d.id]; if(d.ok) w[0](d.body); else w[1](new Error((d.body&&d.body.error)||('HTTP '+d.status))); });
  window.aceRpc=function(op,payload){ return new Promise(function(res,rej){ if(!framed) return rej(new Error('not framed'));
    var id=++seq; wait[id]=[res,rej]; window.parent.postMessage({__ace:1,id:id,op:op,payload:payload},'*');
    setTimeout(function(){ if(wait[id]){ delete wait[id]; rej(new Error('timeout')); } },30000); }); };
  function put(mode,v){ if(LOCKED) return Promise.resolve({ok:true}); return window.aceRpc('put',{mode:mode,data:v}); }
  function snap(d){ return {exists:!!d.state, data:function(){ return d.state||{}; }}; }
  window.claude={use:function(k){ if(k!=='db'||!framed) return Promise.resolve(null); return Promise.resolve({doc:function(){ return {
    get:function(){ return window.aceRpc('get').then(snap); },
    set:function(v){ return put('set',v); },
    update:function(v){ return put('update',v); },
    onSnapshot:function(cb){ window.aceRpc('get').then(function(d){ if(d.state) cb(snap(d)); }).catch(function(){}); return function(){}; }
  }; }}); }};
})();</script>`;

// The trusted outer page: hosts the sandboxed report and relays its requests to the API.
export function renderWrapper(row: any, print: boolean): string {
  const src = `/c/${row.token}/page${print ? '?print=1' : ''}`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(row.title)}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="r" title="${esc(row.title)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src="${esc(src)}"></iframe>
<script>(function(){
  var f=document.getElementById('r'), B='/c/${row.token}';
  function reply(id,ok,status,body){ f.contentWindow.postMessage({__ace:1,id:id,ok:ok,status:status,body:body},'*'); }
  window.addEventListener('message',function(e){
    if(e.source!==f.contentWindow) return; var d=e.data||{}; if(!d.__ace) return;
    if(d.op==='reload'){ location.reload(); return; }
    var req=d.op==='get'?fetch(B+'/state'):d.op==='put'?fetch(B+'/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(d.payload||{})})
      :d.op==='approve'?fetch(B+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d.payload||{})}):null;
    if(!req) return;
    req.then(function(r){ return r.json().catch(function(){ return {}; }).then(function(b){ reply(d.id,r.ok,r.status,b); }); })
       .catch(function(){ reply(d.id,false,0,{error:'Brak połączenia — spróbuj ponownie. / No connection.'}); });
  });
})();</script></body></html>`;
}

const APPROVE_CSS = `<style>
  .ace-bar{max-width:980px;margin:28px auto;padding:20px 22px;border-radius:14px;border:2px solid #16a34a;background:#f0fbf3;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a1f}
  .ace-bar h2{margin:0 0 6px;font-size:19px}
  .ace-bar button{margin-top:10px;background:#16a34a;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}
  .ace-bar button[disabled]{opacity:.5;cursor:wait}
  .ace-bar .msg{display:block;margin-top:8px;color:#b42318;font-weight:600}
  .ace-f{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.ace-f label{flex:1;min-width:200px;font-size:13px;font-weight:600;display:flex;flex-direction:column;gap:4px}
  .ace-f input{font:inherit;font-weight:400;padding:9px 10px;border:1px solid #c9d8cc;border-radius:8px;background:#fff}
  .ace-padwrap{margin-top:12px}#ace-pad{display:block;width:100%;max-width:520px;height:140px;background:#fff;border:1px dashed #9bb8a1;border-radius:8px;touch-action:none}
  .ace-link{background:none!important;color:#15803d!important;padding:4px 0!important;margin-top:4px!important;font-size:13px!important;font-weight:600!important}
  .ace-chk{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:14px}
  .ace-locked{position:sticky;top:0;z-index:50;background:#16a34a;color:#fff;text-align:center;padding:10px 14px;font:600 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  body.ace-approved .accept .seg button, body.ace-approved #pad, body.ace-approved #pad-clear, body.ace-approved #sig-save,
  body.ace-approved #sig-reset, body.ace-approved #all-reset{pointer-events:none;opacity:.55}
  @media print{.ace-bar,.ace-locked{display:none}}
</style>`;

export function renderReportPage(html: string, row: any, print: boolean): string {
  const note = html.match(/"pb_note": "([^"]*)"/)?.[1];
  if (note) html = html.replace(/"pb_note_framed": "[^"]*"/, `"pb_note_framed": "${note}"`);
  const locked = row.status === 'approved';
  const own = !!row.meta?.ownSignature;
  const head = BRIDGE.replace('__LOCKED__', locked ? 'true' : 'false') + APPROVE_CSS;
  let out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;

  // Approve box. Reports with their own signature section use that; others get name/role/signature here.
  const fields = own ? '' : `
        <div class="ace-f"><label>Imię i nazwisko / Name<input id="ace-name" autocomplete="name"></label>
        <label>Rola / Role<input id="ace-role" placeholder="np. w imieniu klienta"></label></div>
        <div class="ace-padwrap"><canvas id="ace-pad" height="140"></canvas><button type="button" class="ace-link" id="ace-pad-clear">Wyczyść podpis</button></div>
        <label class="ace-chk"><input type="checkbox" id="ace-confirm"> Sprawdziłem(-am) raport i potwierdzam zaznaczone decyzje</label>`;
  const bar = locked ? '' : `<section class="ace-bar" id="ace-approve"><h2>Zatwierdzenie raportu</h2>
        <div>${own ? 'Po zapisaniu akceptacji z podpisem (sekcja „Akceptacja” powyżej) kliknij' : 'Wpisz imię i nazwisko, złóż podpis i kliknij'} <b>Zatwierdź raport</b>, aby przekazać decyzje do Acemark. Po zatwierdzeniu raportu nie można już zmieniać.</div>${fields}
        <button type="button" id="ace-approve-btn">Zatwierdź raport</button><span class="msg" id="ace-approve-msg"></span></section>`;
  const banner = locked ? `<div class="ace-locked">Raport zatwierdzony ${esc(fmt(row.approved_at))} — ${esc(row.approved_by_name)}. Zmiany nie są już możliwe.</div>` : '';

  const tail = `<script>(function(){
    ${locked ? LOCK_JS : APPROVE_JS.replace('__OWN__', own ? 'true' : 'false')}
    ${print ? `setTimeout(function(){ var p=document.getElementById('make-pdf'); if(p) p.click(); setTimeout(function(){ window.print(); },500); },900);` : ''}
  })();</script>`;

  out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => m + banner) : banner + out;
  const foot = out.lastIndexOf('<footer class="foot"');
  if (foot >= 0) out = out.slice(0, foot) + bar + out.slice(foot);
  else out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, bar + '</body>') : out + bar;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, tail + '</body>') : out + tail;
}

// The page as the recipient filled it in (captured on Approve), served static + sandboxed.
export function renderFilledPage(html: string, print: boolean): string {
  const t = print ? `<script>setTimeout(function(){ window.print(); },600);</script>` : '';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, t + '</body>') : html + t;
}

// After approval: read-only. Structure-agnostic — disable every form control and swallow clicks on
// buttons, except the report's own print/PDF controls and zoom.
const LOCK_JS = `document.body.classList.add('ace-approved');
    function lock(){ document.querySelectorAll('input,textarea,select').forEach(function(el){ el.readOnly=true; el.disabled=true; }); }
    lock(); setTimeout(lock,800); setTimeout(lock,2500);
    var ALLOW=['make-pdf','pb-print','pb-back'];
    document.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('button,[role=button],canvas'); if(!b) return;
      if(ALLOW.indexOf(b.id)>=0||b.classList.contains('zoom')||b.closest('.lb')) return; e.stopPropagation(); e.preventDefault(); },true);
    document.addEventListener('pointerdown',function(e){ if(e.target.tagName==='CANVAS'){ e.stopPropagation(); e.preventDefault(); } },true);`;

// Approve flow + a snapshot of the filled page (values, ticks, drawn signatures baked into static HTML).
const APPROVE_JS = `var OWN=__OWN__, b=document.getElementById('ace-approve-btn'), m=document.getElementById('ace-approve-msg');
    var pad=document.getElementById('ace-pad'), strokes=0;
    if(pad){ var ctx=pad.getContext('2d'), drawing=false;
      function fit(){ var r=pad.getBoundingClientRect(), d=window.devicePixelRatio||1; pad.width=Math.round(r.width*d); pad.height=Math.round(140*d); ctx.setTransform(d,0,0,d,0,0); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#111'; strokes=0; }
      function pos(e){ var r=pad.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; }
      pad.addEventListener('pointerdown',function(e){ drawing=true; pad.setPointerCapture(e.pointerId); var p=pos(e); ctx.beginPath(); ctx.moveTo(p[0],p[1]); });
      pad.addEventListener('pointermove',function(e){ if(!drawing) return; var p=pos(e); ctx.lineTo(p[0],p[1]); ctx.stroke(); strokes++; });
      ['pointerup','pointercancel','pointerleave'].forEach(function(ev){ pad.addEventListener(ev,function(){ drawing=false; }); });
      document.getElementById('ace-pad-clear').addEventListener('click',fit); fit(); }
    function snapshot(){
      var src=document.documentElement, d=src.cloneNode(true);
      var a=src.querySelectorAll('input,textarea,select,canvas'), c=d.querySelectorAll('input,textarea,select,canvas');
      for(var i=0;i<a.length;i++){ var o=a[i], k=c[i]; if(!k) continue;
        if(o.tagName==='TEXTAREA'){ k.textContent=o.value; }
        else if(o.tagName==='SELECT'){ for(var j=0;j<k.options.length;j++){ if(o.options[j]&&o.options[j].selected) k.options[j].setAttribute('selected',''); else k.options[j].removeAttribute('selected'); } }
        else if(o.tagName==='CANVAS'){ try{ var im=document.createElement('img'); im.src=o.toDataURL('image/png'); im.style.cssText=o.style.cssText; im.style.maxWidth='100%'; k.parentNode.replaceChild(im,k); }catch(e){} }
        else if(o.type==='checkbox'||o.type==='radio'){ if(o.checked) k.setAttribute('checked',''); else k.removeAttribute('checked'); }
        else if(o.type!=='file'&&o.type!=='password'){ k.setAttribute('value',o.value); }
      }
      d.querySelectorAll('script').forEach(function(s){ s.remove(); });
      var ab=d.querySelector('#ace-approve');
      if(ab){ if(OWN){ ab.remove(); } else {
        var box=document.createElement('section'); box.className='ace-bar';
        var nm=(document.getElementById('ace-name').value||'').trim(), rl=(document.getElementById('ace-role').value||'').trim();
        box.innerHTML='<h2>Zatwierdzono</h2><div></div>'; box.lastChild.textContent=nm+(rl?' ('+rl+')':'')+' \u00b7 '+new Date().toLocaleString('pl-PL');
        try{ var sg=document.createElement('img'); sg.src=pad.toDataURL('image/png'); sg.style.cssText='display:block;max-width:360px;margin-top:8px;background:#fff'; box.appendChild(sg); }catch(e){}
        ab.parentNode.replaceChild(box,ab); } }
      return '<!doctype html>'+d.outerHTML;
    }
    b.addEventListener('click',function(){
      m.textContent='';
      var body={};
      if(!OWN){
        body.name=(document.getElementById('ace-name').value||'').trim(); body.role=(document.getElementById('ace-role').value||'').trim();
        body.confirm=document.getElementById('ace-confirm').checked;
        if(!body.name){ m.textContent='Wpisz imię i nazwisko.'; return; }
        if(!strokes){ m.textContent='Złóż podpis w polu.'; return; }
        if(!body.confirm){ m.textContent='Zaznacz potwierdzenie.'; return; }
        try{ body.png=pad.toDataURL('image/png'); }catch(e){}
      }
      b.disabled=true;
      try{ body.snapshot=snapshot(); }catch(e){}
      window.aceRpc('approve',body).then(function(){ return window.aceRpc('reload'); })
        .catch(function(err){ m.textContent=(err&&err.message)||'Nie udało się zatwierdzić.'; b.disabled=false; });
    });`;

// ---- approval record PDF ---------------------------------------------------------------------
export function buildConfirmationPdf(row: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46, info: { Title: row.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(FONTS, 'LiberationSerif-Regular.ttf'));
    doc.registerFont('B', join(FONTS, 'LiberationSerif-Bold.ttf'));

    const meta: ConfirmationMeta = row.meta ?? { items: [], titles: {}, questions: {}, eyebrow: '' };
    const st = row.state ?? {};
    const items: Record<string, any> = st.items ?? {};
    const answers: Record<string, any> = st.answers ?? {};
    const sig = (st.signature && st.signature.name) ? st.signature : (st.approval ?? null);
    const W = doc.page.width - 92;
    const GREEN = '#15803d', RED = '#b42318', GREY = '#6b6786';
    const ensure = (h: number) => { if (doc.y + h > doc.page.height - 56) doc.addPage(); };

    doc.font('R').fontSize(9).fillColor(GREY).text(meta.eyebrow || 'Acemark · potwierdzenie ustaleń technologicznych', { width: W });
    doc.moveDown(0.3).font('B').fontSize(18).fillColor('#000').text(row.title, { width: W });
    doc.moveDown(0.4).font('R').fontSize(10).fillColor('#000');
    const approved = row.status === 'approved';
    doc.font('B').fillColor(approved ? GREEN : '#b45309').text(approved ? 'ZATWIERDZONO' : 'OCZEKUJE NA ZATWIERDZENIE', { continued: true })
      .font('R').fillColor('#000').text(approved ? `   ${fmt(row.approved_at)} · ${row.approved_by_name}${row.approved_by_role ? ' (' + row.approved_by_role + ')' : ''}` : '');
    doc.fillColor(GREY).fontSize(9).text(`Link utworzył(a): ${row.created_by_name ?? '—'} · ${fmt(row.created_at)} · plik: ${row.file_name ?? '—'}`);

    const ids = meta.items.length ? meta.items : Object.keys(items);
    const n = { ok: 0, no: 0, none: 0 };
    ids.forEach((id) => { const s = items[id]?.status; if (s === 'ok') n.ok++; else if (s === 'no') n.no++; else n.none++; });
    if (!ids.length) {
      doc.moveDown(0.8).font('R').fontSize(10.5).fillColor('#000')
        .text('Ten raport nie zawiera listy elementów do decyzji. Wszystkie odpowiedzi klienta są w wypełnionym raporcie (ACE Office ▸ Confirmations ▸ „Filled report”).', { width: W });
    } else {
    doc.moveDown(0.6).fillColor('#000').fontSize(10.5).font('B').text('Bilans decyzji: ', { continued: true }).font('R')
      .text(`elementów ${ids.length} · zaakceptowane ${n.ok} · nie zaakceptowane ${n.no} · bez decyzji ${n.none}`);

    doc.moveDown(0.8).font('B').fontSize(13).text('Decyzje');
    doc.moveTo(46, doc.y + 2).lineTo(46 + W, doc.y + 2).strokeColor('#ddd').stroke(); doc.moveDown(0.4);
    for (const id of ids) {
      const s = items[id] ?? {};
      ensure(40);
      const label = s.status === 'ok' ? 'Zaakceptowano' : s.status === 'no' ? 'Nie zaakceptowano' : 'Bez decyzji';
      const color = s.status === 'ok' ? GREEN : s.status === 'no' ? RED : GREY;
      const y = doc.y;
      doc.font('R').fontSize(10).fillColor('#000').text(meta.titles[id] ?? id, 46, y, { width: W - 120 });
      const yEnd = doc.y;
      doc.font('B').fontSize(10).fillColor(color).text(label, 46 + W - 115, y, { width: 115, align: 'right' });
      doc.y = Math.max(yEnd, doc.y); doc.x = 46;
      if (s.status === 'no') {
        doc.font('B').fontSize(9.5).fillColor('#000').text('Co się nie zgadza: ', 58, doc.y, { continued: true, width: W - 12 }).font('R').text(s.why || '—');
        doc.font('B').text('Jak ma być: ', 58, doc.y, { continued: true, width: W - 12 }).font('R').text(s.want || '—');
        doc.x = 46;
      }
      doc.moveDown(0.35);
    }
    }

    const qs = Object.keys(meta.questions);
    if (qs.length) {
      ensure(60);
      doc.moveDown(0.6).font('B').fontSize(13).fillColor('#000').text('Pytania', 46);
      doc.moveTo(46, doc.y + 2).lineTo(46 + W, doc.y + 2).strokeColor('#ddd').stroke(); doc.moveDown(0.4);
      for (const q of qs) {
        ensure(40);
        doc.font('B').fontSize(10).fillColor('#000').text(meta.questions[q], 46, doc.y, { width: W });
        const a = String(answers[q]?.text ?? '').trim();
        doc.font('R').fillColor(a ? '#000' : GREY).text(a || 'Brak odpowiedzi', 58, doc.y, { width: W - 12 });
        doc.x = 46; doc.moveDown(0.35);
      }
    }

    ensure(170);
    doc.moveDown(0.8).font('B').fontSize(13).fillColor('#000').text('Akceptacja', 46);
    doc.moveTo(46, doc.y + 2).lineTo(46 + W, doc.y + 2).strokeColor('#ddd').stroke(); doc.moveDown(0.5);
    if (sig && sig.name) {
      doc.font('R').fontSize(10.5).text(`Podpisał(a): ${sig.name}${sig.role ? ' (' + sig.role + ')' : ''} · ${fmt(sig.at)}`);
      if (typeof sig.png === 'string' && sig.png.startsWith('data:image/png;base64,')) {
        try { doc.image(Buffer.from(sig.png.split(',')[1], 'base64'), 46, doc.y + 6, { fit: [220, 80] }); doc.y += 92; } catch { /* unreadable signature image */ }
      }
    } else {
      doc.font('R').fontSize(10.5).fillColor(GREY).text('Brak podpisu.');
    }
    doc.end();
  });
}
