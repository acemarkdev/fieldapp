// Settings split (app_config = public, server_config = server-only): getConfig / setConfig against a
// tiny fake PostgREST, in the three states the server can meet. Run: npx tsx apps/api/src/configStore.test.ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type Table = Map<string, string | null>;
const tables: Record<string, Table | null> = { app_config: new Map(), server_config: null };   // null = table does not exist

const srv = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const name = url.pathname.replace('/rest/v1/', '');
  const t = tables[name];
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (t === undefined || t === null) return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` });
  if (req.method === 'GET') {
    const key = (url.searchParams.get('key') ?? '').replace(/^eq\./, '');
    return send(200, t.has(key) ? [{ value: t.get(key) }] : []);
  }
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    const rows = JSON.parse(raw); for (const r of Array.isArray(rows) ? rows : [rows]) t.set(r.key, r.value);
    send(201, []);
  });
});

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got ?? ''); } };

srv.listen(0, async () => {
  process.env.SUPABASE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const { getConfig, setConfig } = await import('./store');
  const app = tables.app_config!;

  // 1. Before migration 0066: server_config does not exist → everything behaves as it always did.
  app.set('fin_sync_hour', '7'); app.set('demo_leads_email', 'sales@example.com');
  ok('before: private key read from app_config', (await getConfig('fin_sync_hour')) === '7');
  ok('before: unset key → null', (await getConfig('eq_board_id')) === null);
  await setConfig('fin_labour_rate', '45');
  ok('before: private key written to app_config', app.get('fin_labour_rate') === '45');

  // 2. Migration runs: table created, private rows moved, app_config keeps only the public key.
  const server: Table = new Map([...app].filter(([k]) => k !== 'demo_leads_email'));
  tables.server_config = server;
  for (const k of [...app.keys()]) if (k !== 'demo_leads_email') app.delete(k);

  ok('after: private key read from server_config', (await getConfig('fin_sync_hour')) === '7' && (await getConfig('fin_labour_rate')) === '45');
  await setConfig('schedule_pull_last_result', '{"jobs":3}');
  ok('after: private key written to server_config only', server.get('schedule_pull_last_result') === '{"jobs":3}' && !app.has('schedule_pull_last_result'));
  ok('after: public key still read from app_config', (await getConfig('demo_leads_email')) === 'sales@example.com');
  await setConfig('demo_leads_email', 'quotes@example.com');
  ok('after: public key still written to app_config only', app.get('demo_leads_email') === 'quotes@example.com' && !server.has('demo_leads_email'));
  ok('after: nothing private is left in the public table', [...app.keys()].join(',') === 'demo_leads_email', [...app.keys()]);
  ok('after: unset key → null', (await getConfig('eq_board_id')) === null);
  await setConfig('fin_sync_hour', '');
  ok('after: an emptied value stays empty (does not fall back)', (await getConfig('fin_sync_hour')) === '');

  // 3. A key the migration did not move (written to app_config in between) is still found.
  app.set('po_email_from', 'po@example.com');
  ok('legacy key still readable', (await getConfig('po_email_from')) === 'po@example.com');

  srv.close();
  if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
  console.log('All config-store tests passed.');
});
