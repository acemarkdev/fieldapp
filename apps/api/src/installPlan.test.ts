// Run: npx tsx apps/api/src/installPlan.test.ts
import { proposeInstallPlan, validatePlanParams, floorRank, isCommunal, UK_BANK_HOLIDAYS, type PlanItem, type PlanParams } from './installPlan';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

let seq = 0;
const flat = (flatNo: string, floor: string, n: number, block = 'B1', extra: Partial<PlanItem> = {}): PlanItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${++seq}`, block, flat: flatNo, floor, room_code: 'BD', item_code: `W${i + 1}`, kind: 'item', install_status: null, ...extra }));
const P = (over: Partial<PlanParams> = {}): PlanParams => ({
  startDate: '2026-10-19', teams: [{ id: 'a', name: 'Team A', capacity: 5 }], order: 'top_down', communal: 'end',
  keepFlatTogether: true, byBlock: true, workSaturday: false, daysOff: [], ...over });
const dayOf = (r: ReturnType<typeof proposeInstallPlan>, ids: PlanItem[]) => [...new Set(ids.map((it) => r.assignments.find((a) => a.id === it.id)?.date))];
const teamOf = (r: ReturnType<typeof proposeInstallPlan>, ids: PlanItem[]) => [...new Set(ids.map((it) => r.assignments.find((a) => a.id === it.id)?.team_id))];

// helpers
ok('floor ranks', floorRank('GF') === 0 && floorRank('F3') === 3 && floorRank('2') === 2 && floorRank('LG') === -1 && floorRank('roof') === null && floorRank('') === null);
ok('communal labels', isCommunal('Comm.') && isCommunal('comm1') && isCommunal('') && isCommunal(null) && isCommunal('CW') && !isCommunal('26B') && !isCommunal('C12'));

// 1. One team, top floor first, one flat a day when it fits.
{
  const g = flat('1', 'GF', 4), f1 = flat('5', 'F1', 4), f2 = flat('9', 'F2', 4);
  const r = proposeInstallPlan([...g, ...f1, ...f2], P());
  ok('top-down: F2 first, then F1, then GF — one flat per day', dayOf(r, f2)[0] === '2026-10-19' && dayOf(r, f1)[0] === '2026-10-20' && dayOf(r, g)[0] === '2026-10-21', r.days);
  ok('a flat that fits is not split', r.summary.splitFlats === 0 && r.summary.workingDays === 3);
  const b = proposeInstallPlan([...g, ...f1, ...f2], P({ order: 'bottom_up' }));
  ok('bottom-up: GF first', dayOf(b, g)[0] === '2026-10-19' && dayOf(b, f2)[0] === '2026-10-21');
}

// 2. Packing to capacity (keep-together off): 7 → 5 + 2, then 3 from the next flat.
{
  const a = flat('1', 'F1', 7), b = flat('2', 'F1', 6);
  const r = proposeInstallPlan([...a, ...b], P({ keepFlatTogether: false }));
  const perDay = r.days.map((d) => d.items).join(',');
  ok('every day is filled to 5 until the work runs out', perDay === '5,5,3', r.days);
  ok('flat 1 spans two days, and the second day also takes 3 of flat 2', dayOf(r, a).length === 2 && r.days[1].flats.join(',') === '1,2', r.days);
}

// 3. A flat bigger than a day's capacity is split over consecutive days and stays with one team.
{
  const big = flat('7', 'F1', 12), small = flat('8', 'F1', 3);
  const r = proposeInstallPlan([...big, ...small], P({ teams: [{ id: 'a', name: 'A', capacity: 5 }, { id: 'b', name: 'B', capacity: 5 }] }));
  ok('big flat: one team, three consecutive working days', teamOf(r, big).length === 1 && dayOf(r, big).join(',') === '2026-10-19,2026-10-20,2026-10-21', dayOf(r, big));
  ok('the other team takes the other flat on day one', teamOf(r, small)[0] !== teamOf(r, big)[0] && dayOf(r, small)[0] === '2026-10-19');
}

// 4. Two teams: never in the same flat, both busy every day, work shared.
{
  const fl = ['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => flat(n, 'F1', 5));
  const r = proposeInstallPlan(fl.flat(), P({ teams: [{ id: 'a', name: 'A', capacity: 5 }, { id: 'b', name: 'B', capacity: 5 }] }));
  ok('each flat has exactly one team', fl.every((f) => teamOf(r, f).length === 1));
  ok('8 flats, 2 teams, 5 a day → 4 working days, 20 items each', r.summary.workingDays === 4 && r.summary.perTeam.every((t) => t.items === 20 && t.days === 4), r.summary);
  ok('no team exceeds its capacity on any day', r.days.every((d) => d.items <= 5));
}

// 5. Different capacities (P03 with 8 a day, P04 with 5).
{
  const fl = Array.from({ length: 10 }, (_, i) => flat(String(i + 1), 'F1', 4));
  const r = proposeInstallPlan(fl.flat(), P({ keepFlatTogether: false, teams: [{ id: 'p3', name: 'P03', capacity: 8 }, { id: 'p4', name: 'P04', capacity: 5 }] }));
  ok('capacities respected per team', r.days.every((d) => d.items <= (d.team_id === 'p3' ? 8 : 5)), r.days);
  ok('the bigger team does more', r.summary.perTeam[0].items > r.summary.perTeam[1].items, r.summary.perTeam);
}

// 6. Weekends and bank holidays are skipped; Saturdays only when asked.
{
  const fl = Array.from({ length: 4 }, (_, i) => flat(String(i + 1), 'F1', 5));
  const r = proposeInstallPlan(fl.flat(), P({ startDate: '2026-08-27', daysOff: ['2026-08-31'] }));       // Thu; Mon 31 Aug is a bank holiday
  ok('Thu, Fri, (weekend + bank holiday skipped), Tue, Wed', r.days.map((d) => d.date).join(',') === '2026-08-27,2026-08-28,2026-09-01,2026-09-02', r.days.map((d) => d.date));
  const s = proposeInstallPlan(fl.flat(), P({ startDate: '2026-08-27', workSaturday: true, daysOff: ['2026-08-31'] }));
  ok('with Saturdays: Thu, Fri, Sat, Tue', s.days.map((d) => d.date).join(',') === '2026-08-27,2026-08-28,2026-08-29,2026-09-01', s.days.map((d) => d.date));
  const w = proposeInstallPlan(flat('1', 'F1', 2), P({ startDate: '2026-10-17' }));                         // a Saturday
  ok('a start date on a weekend moves to Monday', w.days[0].date === '2026-10-19');
  ok('bank holiday list includes 31 Aug 2026 and Christmas', UK_BANK_HOLIDAYS.includes('2026-08-31') && UK_BANK_HOLIDAYS.includes('2026-12-25'));
}

// 7. Communal items: at the end, or filling spare capacity on the flats' days.
{
  const f1 = flat('1', 'F1', 4), f2 = flat('2', 'GF', 3), comm = flat('Comm.', 'GF', 3);
  const end = proposeInstallPlan([...comm, ...f1, ...f2], P());
  ok('at the end: communal after the last flat', dayOf(end, comm).every((d) => d! >= dayOf(end, f2)[0]!) && dayOf(end, f1)[0] === '2026-10-19', end.days);
  const fill = proposeInstallPlan([...comm, ...f1, ...f2], P({ communal: 'with_flats' }));
  ok('with flats: 4+1 communal on day one, 3+2 on day two — two days in all', fill.days.map((d) => d.items).join(',') === '5,5' && fill.summary.workingDays === 2, fill.days);
  ok('the day cell lists the communal label too', fill.days[0].flats.includes('Comm.'));
  const only = proposeInstallPlan(comm, P({ communal: 'with_flats' }));
  ok('only communal items selected → still planned', only.assignments.length === 3 && only.days[0].date === '2026-10-19');
}

// 8. Block by block, each block top-down; or floor by floor across blocks.
{
  const b1g = flat('1', 'GF', 5, 'B1'), b1t = flat('2', 'F1', 5, 'B1'), b2g = flat('3', 'GF', 5, 'B2'), b2t = flat('4', 'F1', 5, 'B2');
  const all = [...b1g, ...b1t, ...b2g, ...b2t];
  const r = proposeInstallPlan(all, P());
  ok('block by block: B1 top, B1 ground, B2 top, B2 ground', [b1t, b1g, b2t, b2g].map((f) => dayOf(r, f)[0]).join(',') === '2026-10-19,2026-10-20,2026-10-21,2026-10-22', r.days);
  const x = proposeInstallPlan(all, P({ byBlock: false }));
  ok('across blocks: both top floors first', [b1t, b2t, b1g, b2g].map((f) => dayOf(x, f)[0]).join(',') === '2026-10-19,2026-10-20,2026-10-21,2026-10-22', x.days);
}

// 9. Installed, omitted and snag rows are left alone; the same flat number in two blocks is two flats.
{
  const done = flat('1', 'F1', 2, 'B1', { install_status: 'installed_no_snag' }), om = flat('2', 'F1', 1, 'B1', { install_status: 'omit' });
  const sn = flat('3', 'F1', 1, 'B1', { kind: 'snag', install_status: 'snag' }), todo = flat('4', 'F1', 2, 'B1', { install_status: 'delayed' });
  const r = proposeInstallPlan([...done, ...om, ...sn, ...todo], P());
  ok('only the open items are planned', r.assignments.length === 2 && r.skipped.installed === 2 && r.skipped.omitted === 1 && r.skipped.snags === 1, r.skipped);
  const two = proposeInstallPlan([...flat('1', 'F1', 5, 'B1'), ...flat('1', 'F1', 5, 'B2')], P({ teams: [{ id: 'a', name: 'A', capacity: 5 }, { id: 'b', name: 'B', capacity: 5 }] }));
  ok('flat 1 in B1 and flat 1 in B2 are separate flats', two.summary.flats === 2 && two.days.length === 2 && two.days[0].date === two.days[1].date);
  const none = proposeInstallPlan(done, P());
  ok('nothing left to plan → a clear warning', none.assignments.length === 0 && none.warnings.some((w) => /Nothing to plan/.test(w)));
}

// 10. A team that joins late or leaves early.
{
  const fl = Array.from({ length: 6 }, (_, i) => flat(String(i + 1), 'F1', 5));
  const late = proposeInstallPlan(fl.flat(), P({ teams: [{ id: 'a', name: 'A', capacity: 5 }, { id: 'b', name: 'B', capacity: 5, from: '2026-10-21' }] }));
  ok('B has nothing before the day it joins', late.days.filter((d) => d.team_id === 'b').every((d) => d.date >= '2026-10-21') && late.summary.perTeam[1].items > 0, late.days);
  const early = proposeInstallPlan(fl.flat(), P({ teams: [{ id: 'a', name: 'A', capacity: 5, until: '2026-10-20' }, { id: 'b', name: 'B', capacity: 5 }] }));
  ok('A has nothing after the day it leaves; B finishes the job', early.days.filter((d) => d.team_id === 'a').every((d) => d.date <= '2026-10-20') && early.unplaced.length === 0 && early.assignments.length === 30, early.days);
  const gone = proposeInstallPlan(fl.flat(), P({ teams: [{ id: 'a', name: 'A', capacity: 5, until: '2026-10-20' }] }));
  ok('nobody left → the rest is reported, not silently dropped', gone.assignments.length === 10 && gone.unplaced.length === 20 && gone.warnings.some((w) => /could not be planned/.test(w)), gone.warnings);
}

// 11. Same input → same plan (preview and apply must agree), and the input list is not changed.
{
  const fl = Array.from({ length: 7 }, (_, i) => flat(String(i + 1), i % 2 ? 'F1' : 'GF', 3 + (i % 3))).flat();
  const before = JSON.stringify(fl), p = P({ communal: 'with_flats', teams: [{ id: 'a', name: 'A', capacity: 5 }, { id: 'b', name: 'B', capacity: 6 }] });
  const r1 = JSON.stringify(proposeInstallPlan(fl, p)), r2 = JSON.stringify(proposeInstallPlan([...fl].reverse(), p));
  ok('deterministic, whatever order the items arrive in', r1 === r2);
  ok('input untouched', JSON.stringify(fl) === before);
  ok('every open item gets exactly one assignment', (() => { const r = proposeInstallPlan(fl, p); return r.assignments.length === fl.length && new Set(r.assignments.map((a) => a.id)).size === fl.length; })());
}

// 12. Settings validation.
{
  const good = { startDate: '2026-10-19', teams: [{ id: 'a', name: 'A', capacity: 5 }], order: 'top_down', communal: 'end', keepFlatTogether: true, byBlock: true, workSaturday: false, daysOff: ['2026-12-25'] };
  ok('valid settings accepted', validatePlanParams(good, new Set(['a'])).ok === true);
  ok('no team → refused', validatePlanParams({ ...good, teams: [] }).ok === false);
  ok('capacity 0 → refused', validatePlanParams({ ...good, teams: [{ id: 'a', name: 'A', capacity: 0 }] }).ok === false);
  ok('same team twice → refused', validatePlanParams({ ...good, teams: [good.teams[0], good.teams[0]] }).ok === false);
  ok('unknown team → refused', validatePlanParams(good, new Set(['zzz'])).ok === false);
  ok('bad start date → refused', validatePlanParams({ ...good, startDate: '19/10/2026' }).ok === false);
  ok('from after until → refused', validatePlanParams({ ...good, teams: [{ id: 'a', name: 'A', capacity: 5, from: '2026-11-01', until: '2026-10-01' }] }).ok === false);
  ok('bad day off → refused', validatePlanParams({ ...good, daysOff: ['Christmas'] }).ok === false);
}

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All install-plan tests passed.');
