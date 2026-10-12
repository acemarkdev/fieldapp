// What "Propose install plan ▸ Apply" writes to Monday: the column values for a scheduled item, and the
// batched mutation that sends them. Run: npx tsx apps/api/src/schedulePush.test.ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const seen: string[] = []; let failNext = 0;
const srv = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    const q = String(JSON.parse(raw).query); seen.push(q);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (failNext > 0) { failNext--; res.end(JSON.stringify({ errors: [{ message: 'Item not found' }] })); return; }
    res.end(JSON.stringify({ data: {} }));
  });
});

srv.listen(0, async () => {
  process.env.MONDAY_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.MONDAY_API_TOKEN = 'test';
  const { scheduleColumnValues, pickPlanDateColumn } = await import('./mapItem');
  const { Monday } = await import('./monday');

  // The Padnell Avenue board's relevant columns (ids as on the real board).
  const cols: any[] = [
    { id: 'date_mm4a6z1n', title: 'Required Delivery Date', type: 'date', settings: {} },
    { id: 'dropdown_mm4wd0nr', title: 'Fitters', type: 'dropdown', settings: { labels: [{ id: 1, name: 'Team P01' }, { id: 5, name: 'Team  P05' }] } },
    { id: 'color_mm4ksrf6', title: 'Install Status', type: 'status', settings: { labels: { 0: 'Scheduled', 1: 'Installed no snag' } } },
    { id: 'date_mm4k17z', title: 'Actual Install Date', type: 'date', settings: {} },
    { id: 'date_mm4kscwe', title: 'Plan Install Date', type: 'date', settings: {} },
    { id: 'lookup_mm49jq7q', title: 'Install Status', type: 'mirror', settings: {} },
    { id: 'date_mm2sda43', title: 'Job Done Date', type: 'date', settings: {} },
  ];
  ok('planned date column is "Plan Install Date", never Actual / Done / Delivery', pickPlanDateColumn(cols)?.id === 'date_mm4kscwe');
  const a = scheduleColumnValues(cols, { teamName: 'Team P05', date: '2026-10-20', markScheduled: true });
  ok('for writing, a board with only delivery / actual / done dates has no planned-date column', pickPlanDateColumn(cols.filter((x) => x.title !== 'Plan Install Date'), true) === null && pickPlanDateColumn(cols.filter((x) => x.title !== 'Plan Install Date')) === null);
  ok('for reading, a single unlabelled date column is still accepted', pickPlanDateColumn([{ id: 'd', title: 'When', type: 'date' }])?.id === 'd' && pickPlanDateColumn([{ id: 'd', title: 'When', type: 'date' }], true) === null);
  ok('team → Fitters, using the board\'s own spelling of the label', JSON.stringify(a.values.dropdown_mm4wd0nr) === JSON.stringify({ labels: ['Team  P05'] }), a.values);
  ok('date → Plan Install Date', JSON.stringify(a.values.date_mm4kscwe) === JSON.stringify({ date: '2026-10-20' }));
  ok('status → Scheduled on the real status column, not the mirror', JSON.stringify(a.values.color_mm4ksrf6) === JSON.stringify({ label: 'Scheduled' }) && !('lookup_mm49jq7q' in a.values) && a.missing.length === 0);
  const b = scheduleColumnValues(cols, { teamName: 'Team P09', date: '2026-10-21', markScheduled: false });
  ok('a team the board does not list yet is sent by name (Monday adds the label)', JSON.stringify(b.values.dropdown_mm4wd0nr) === JSON.stringify({ labels: ['Team P09'] }) && !('color_mm4ksrf6' in b.values));
  const c = scheduleColumnValues(cols.filter((x) => x.title !== 'Fitters' && x.title !== 'Plan Install Date'), { teamName: 'Team P05', date: '2026-10-20', markScheduled: false });
  ok('a board without those columns reports what is missing', c.missing.join(',') === 'Fitters,Plan Install Date' && Object.keys(c.values).length === 0, c);

  // Batched write: 45 items in chunks of 20 → 3 requests; a failed chunk is reported, the rest still go.
  const mon = new Monday();
  const rows = Array.from({ length: 45 }, (_, i) => ({ itemId: String(13204000000 + i), values: a.values }));
  failNext = 0; seen.length = 0;
  const r1 = await mon.changeColumnValuesBatch('18433951393', rows);
  ok('45 items → 3 requests, none failed', seen.length === 3 && r1.failed.length === 0, { n: seen.length, r1 });
  ok('each item is one aliased change_multiple_column_values with label creation on', (seen[0].match(/change_multiple_column_values\(board_id: 18433951393, item_id: \d+, column_values: "/g) ?? []).length === 20 && seen[0].includes('create_labels_if_missing: true'), seen[0].slice(0, 300));
  const m = /column_values: ("(?:[^"\\]|\\.)*")/.exec(seen[0]);
  ok('the column values survive as JSON inside the GraphQL string', !!m && JSON.stringify(JSON.parse(JSON.parse(m![1]))) === JSON.stringify(a.values), m?.[1]);
  seen.length = 0; failNext = 1;
  const r2 = await mon.changeColumnValuesBatch('18433951393', rows);
  ok('first chunk refused → its 20 items are reported, the other 25 are still written', r2.failed.length === 20 && seen.length === 3 && /Item not found/.test(r2.error ?? ''), r2);
  let threw = false; try { await mon.changeColumnValuesBatch('18433951393', [{ itemId: '1); drop', values: {} }]); } catch { threw = true; }
  ok('a non-numeric item id is refused before anything is sent', threw);

  srv.close();
  if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
  console.log('All schedule-push tests passed.');
});
