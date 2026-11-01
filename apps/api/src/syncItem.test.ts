// Run: npx tsx apps/api/src/syncItem.test.ts
import { mondayItemName, renameOnMonday, upsertSurveyItem } from './syncItem';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const fake = (o: { changeFails?: boolean; found?: string | null } = {}) => {
  const calls: any[] = [];
  return { calls, monday: {
    getColumns: async () => [],
    changeColumnValues: async (b: string, i: string, cv: any) => { calls.push(['change', i, cv]); if (o.changeFails) throw new Error('no such item'); },
    findItemIdByName: async (b: string, n: string) => { calls.push(['find', n]); return o.found ?? null; },
    createItem: async (b: string, n: string) => { calls.push(['create', n]); return 'NEW'; },
  } as any };
};
const inputs = (item: any) => ({ item: { full_code: 'AXS.RES.B1.E1.COMM.BA.W24', ...item }, ratePounds: null, teamName: null }) as any;

ok('name: the code; a snag adds its defect', mondayItemName('A.B', {}) === 'A.B' && mondayItemName('A.B', { kind: 'snag', snag_comment: 'Scratch' }) === 'A.B — Scratch' && mondayItemName('A.B', { kind: 'item', snag_comment: 'x' }) === 'A.B');

(async () => {
  const r = fake();
  await renameOnMonday(r.monday, 'b', '13427191002', 'AXS.RES.B1.E1.COMM.BA.W24', {});
  ok('rename: the stored row gets the new code as its name', JSON.stringify(r.calls) === JSON.stringify([['change', '13427191002', { name: 'AXS.RES.B1.E1.COMM.BA.W24' }]]), r.calls);

  // synced: the stored row is updated and named, never searched for or created (no duplicate after a rename)
  const a = fake();
  const ra = await upsertSurveyItem(a.monday, 'b', inputs({ monday_item_id: '777' }));
  ok('synced item: updates its own row', ra.itemId === '777' && ra.action === 'updated' && a.calls.length === 1 && a.calls[0][1] === '777' && a.calls[0][2].name === 'AXS.RES.B1.E1.COMM.BA.W24', a.calls);

  // the row is gone from Monday: by name, as before
  const b = fake({ changeFails: true });
  const rb = await upsertSurveyItem(b.monday, 'b', inputs({ monday_item_id: '777' }));
  ok('row gone from Monday: created again', rb.itemId === 'NEW' && rb.action === 'created' && b.calls.some((c) => c[0] === 'find'), b.calls);

  // never synced: by name, then create
  const c = fake({ found: '555' });
  const rc = await upsertSurveyItem(c.monday, 'b', inputs({}));
  ok('not synced, same name on Monday: taken over', rc.itemId === '555' && rc.action === 'updated', rc);
  const d = fake();
  const rd = await upsertSurveyItem(d.monday, 'b', inputs({}));
  ok('not synced: created', rd.itemId === 'NEW' && rd.action === 'created', rd);

  if (fail) { console.error(fail + ' failed'); process.exit(1); }
  console.log('syncItem: all passed');
})();
