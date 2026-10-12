// Install plan proposal (Items ▸ "Propose install plan"): given the selected items, the teams and a few
// rules, work out which team fits which flat on which day. Pure — no database, no monday — so the
// same function serves the preview and the apply, and is unit-testable.
//
// Rules (from how the plans were being made by hand):
//   • one team per flat: teams never work in the same flat; a flat stays with its team even when it
//     takes more than one day;
//   • each team has a daily capacity (items per day);
//   • flats are taken in order: block by block (optional), top floor down or ground floor up, then by
//     flat number; the next flat goes to whichever team can start it soonest;
//   • "keep a flat on one day": a flat that fits in a day is not started on a day that cannot finish it
//     (off = pack every day to capacity, splitting flats);
//   • communal items either go at the end, or fill the spare capacity left on the flats' days;
//   • work happens Mon–Fri (optionally Saturdays), never on the listed days off (bank holidays);
//   • a team can join late (`from`) or leave early (`until`).

export interface PlanItem {
  id: string; block?: string | null; flat?: string | null; floor?: string | null;
  room_code?: string | null; item_code?: string | null; kind?: string | null; install_status?: string | null;
}
export interface PlanTeam { id: string; name: string; capacity: number; from?: string | null; until?: string | null }
export interface PlanParams {
  startDate: string;                       // YYYY-MM-DD
  teams: PlanTeam[];
  order: 'top_down' | 'bottom_up';
  communal: 'end' | 'with_flats';
  keepFlatTogether: boolean;
  byBlock: boolean;
  workSaturday: boolean;
  daysOff: string[];                       // YYYY-MM-DD
}
export interface PlanAssignment { id: string; team_id: string; date: string }
export interface PlanDay { date: string; team_id: string; team: string; flats: string[]; items: number }
export interface PlanResult {
  assignments: PlanAssignment[];
  days: PlanDay[];
  skipped: { installed: number; omitted: number; snags: number };
  unplaced: string[];
  warnings: string[];
  summary: {
    items: number; flats: number; communalItems: number; first: string | null; last: string | null; workingDays: number; splitFlats: number;
    perTeam: { team_id: string; team: string; items: number; flats: number; days: number; first: string | null; last: string | null }[];
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (iso: string) => new Date(iso + 'T00:00:00Z');
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const clean = (v: unknown) => String(v ?? '').trim();
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Communal items have no flat, or a flat label like "Comm.", "Comm1", "Communal", "CW". */
export function isCommunal(flat: unknown): boolean {
  const f = clean(flat);
  return !f || /^(comm|common|cw$|cr$)/i.test(f);
}

/** Floor as a number for ordering: GF = 0, F1/1 = 1, LG/B = -1. Null when it cannot be read. */
export function floorRank(floor: unknown): number | null {
  const f = clean(floor).toUpperCase().replace(/\s+/g, '');
  if (!f) return null;
  if (/^(GF|G|0|F0|GROUND|GROUNDFLOOR)$/.test(f)) return 0;
  if (/^(LG|LGF|B|BF|B1|BASEMENT|-1)$/.test(f)) return -1;
  const m = /^(?:F|FLOOR)?(\d{1,2})(?:F|ST|ND|RD|TH)?$/.exec(f);
  return m ? Number(m[1]) : null;
}

export function validatePlanParams(p: any, knownTeamIds?: Set<string>): { ok: true; params: PlanParams } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!p || typeof p !== 'object') return bad('Missing plan settings.');
  if (!ISO.test(clean(p.startDate)) || Number.isNaN(toDate(p.startDate).getTime())) return bad('Pick a start date.');
  if (!Array.isArray(p.teams) || p.teams.length === 0) return bad('Pick at least one team.');
  if (p.teams.length > 12) return bad('At most 12 teams in one plan.');
  const teams: PlanTeam[] = []; const seen = new Set<string>();
  for (const t of p.teams) {
    const id = clean(t?.id), cap = Number(t?.capacity);
    if (!id || seen.has(id)) return bad('Each team can be picked once.');
    if (knownTeamIds && !knownTeamIds.has(id)) return bad('Unknown team.');
    if (!Number.isInteger(cap) || cap < 1 || cap > 100) return bad(`Daily capacity for ${clean(t?.name) || 'a team'} must be a whole number from 1 to 100.`);
    const from = clean(t?.from) || null, until = clean(t?.until) || null;
    if ((from && !ISO.test(from)) || (until && !ISO.test(until))) return bad('Team dates must be real dates.');
    if (from && until && from > until) return bad(`${clean(t?.name) || 'A team'}: “available from” is after “until”.`);
    seen.add(id); teams.push({ id, name: clean(t?.name) || id, capacity: cap, from, until });
  }
  const daysOff = (Array.isArray(p.daysOff) ? p.daysOff : []).map(clean).filter(Boolean);
  if (daysOff.some((d: string) => !ISO.test(d))) return bad('Days off must be dates like 2026-12-25.');
  if (daysOff.length > 400) return bad('Too many days off.');
  return { ok: true, params: {
    startDate: p.startDate, teams, daysOff,
    order: p.order === 'bottom_up' ? 'bottom_up' : 'top_down',
    communal: p.communal === 'with_flats' ? 'with_flats' : 'end',
    keepFlatTogether: p.keepFlatTogether !== false,
    byBlock: p.byBlock !== false,
    workSaturday: p.workSaturday === true,
  } };
}

interface Unit { key: string; label: string; block: string; floor: number | null; communal: boolean; items: PlanItem[] }

export function proposeInstallPlan(allItems: PlanItem[], params: PlanParams): PlanResult {
  const warnings: string[] = [];
  const off = new Set(params.daysOff);
  const isWorking = (iso: string) => { const wd = toDate(iso).getUTCDay(); return wd !== 0 && (wd !== 6 || params.workSaturday) && !off.has(iso); };
  const nextWorking = (iso: string) => { let d = addDays(iso, 1); while (!isWorking(d)) d = addDays(d, 1); return d; };
  const firstWorking = (iso: string) => { let d = iso; while (!isWorking(d)) d = addDays(d, 1); return d; };

  // ---- what is being planned ----
  const skipped = { installed: 0, omitted: 0, snags: 0 };
  const items = allItems.filter((it) => {
    if ((it.kind ?? 'item') === 'snag') { skipped.snags++; return false; }
    if (it.install_status === 'installed_no_snag' || it.install_status === 'installed_snag') { skipped.installed++; return false; }
    if (it.install_status === 'omit') { skipped.omitted++; return false; }
    return true;
  });

  const unitMap = new Map<string, Unit>();
  for (const it of items) {
    const block = clean(it.block).toUpperCase(), communal = isCommunal(it.flat);
    const flat = clean(it.flat).replace(/^flat\s*/i, '');
    const label = communal ? (flat || 'Communal') : flat;
    const key = block + '|' + (communal ? 'c:' : 'f:') + label.toUpperCase();
    let u = unitMap.get(key);
    if (!u) { u = { key, label, block, floor: null, communal, items: [] }; unitMap.set(key, u); }
    u.items.push(it);
  }
  for (const u of unitMap.values()) {
    // a unit's floor = the floor most of its items are on (ties → the higher one)
    const counts = new Map<number, number>();
    for (const it of u.items) { const r = floorRank(it.floor); if (r !== null) counts.set(r, (counts.get(r) ?? 0) + 1); }
    u.floor = counts.size ? [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] : null;
    u.items.sort((a, b) => natural(clean(a.room_code), clean(b.room_code)) || natural(clean(a.item_code), clean(b.item_code)) || natural(a.id, b.id));
  }
  const dir = params.order === 'top_down' ? -1 : 1;
  const byFloor = (a: Unit, b: Unit) => (a.floor === null ? 1 : 0) - (b.floor === null ? 1 : 0) || ((a.floor ?? 0) - (b.floor ?? 0)) * dir;
  const order = (a: Unit, b: Unit) => (params.byBlock ? natural(a.block, b.block) || byFloor(a, b) : byFloor(a, b) || natural(a.block, b.block)) || natural(a.label, b.label);
  const flats = [...unitMap.values()].filter((u) => !u.communal).sort(order);
  const communals = [...unitMap.values()].filter((u) => u.communal).sort(order);
  if (flats.some((u) => u.floor === null) && flats.some((u) => u.floor !== null)) warnings.push('Some flats have no readable floor; they are planned after the others.');

  // ---- teams ----
  interface TeamState { team: PlanTeam; date: string; used: number; total: number }
  const states: TeamState[] = params.teams.map((team) => ({ team, used: 0, total: 0, date: firstWorking(team.from && team.from > params.startDate ? team.from : params.startDate) }));
  const assignments: PlanAssignment[] = []; const unplaced: string[] = [];
  const load = new Map<string, number>();                       // `${team}|${date}` → items that day
  const k = (teamId: string, date: string) => teamId + '|' + date;
  const open = (s: TeamState, date: string) => !s.team.until || date <= s.team.until;

  /** The day this team would start a unit of n items (null = the team has gone by then). */
  const startDay = (s: TeamState, n: number, keep: boolean): { date: string; used: number } | null => {
    let date = s.date, used = s.used;
    if (used >= s.team.capacity) { date = nextWorking(date); used = 0; }
    if (keep && n <= s.team.capacity && used > 0 && used + n > s.team.capacity) { date = nextWorking(date); used = 0; }
    return open(s, date) ? { date, used } : null;
  };
  const placeUnit = (u: Unit, keep: boolean) => {
    let best: { s: TeamState; at: { date: string; used: number } } | null = null;
    for (const s of states) {
      const at = startDay(s, u.items.length, keep);
      if (!at) continue;
      if (!best || at.date < best.at.date || (at.date === best.at.date && (at.used / s.team.capacity < best.at.used / best.s.team.capacity
        || (at.used / s.team.capacity === best.at.used / best.s.team.capacity && s.total < best.s.total)))) best = { s, at };
    }
    if (!best) { for (const it of u.items) unplaced.push(it.id); return; }
    const s = best.s; s.date = best.at.date; s.used = best.at.used;
    for (const it of u.items) {
      if (s.used >= s.team.capacity) { s.date = nextWorking(s.date); s.used = 0; }
      if (!open(s, s.date)) { unplaced.push(it.id); continue; }
      assignments.push({ id: it.id, team_id: s.team.id, date: s.date });
      s.used++; s.total++; load.set(k(s.team.id, s.date), (load.get(k(s.team.id, s.date)) ?? 0) + 1);
    }
  };

  for (const u of flats) placeUnit(u, params.keepFlatTogether);

  // ---- communal items ----
  let communalQueue = communals.flatMap((u) => u.items.map((it) => ({ it, u })));
  const communalCount = communalQueue.length;
  if (params.communal === 'with_flats' && communalQueue.length && assignments.length) {
    // fill the spare capacity on the days the flats already use, earliest day first
    const dates = [...new Set(assignments.map((a) => a.date))].sort();
    for (const date of dates) {
      for (const s of states) {
        const used = load.get(k(s.team.id, date)) ?? 0;
        if (!used) continue;                                    // only days the team is already on site
        let spare = s.team.capacity - used;
        while (spare > 0 && communalQueue.length) {
          const { it } = communalQueue.shift()!;
          assignments.push({ id: it.id, team_id: s.team.id, date });
          load.set(k(s.team.id, date), (load.get(k(s.team.id, date)) ?? 0) + 1); s.total++; spare--;
          if (date === s.date) s.used++;
        }
      }
    }
  }
  if (communalQueue.length) {
    // whatever is left (or everything, when communal goes at the end): after the flats, packed to capacity
    const rest = new Map<string, Unit>();
    for (const { it, u } of communalQueue) { let r = rest.get(u.key); if (!r) { r = { ...u, items: [] }; rest.set(u.key, r); } r.items.push(it); }
    for (const u of rest.values()) placeUnit(u, false);
    communalQueue = [];
  }

  // ---- what the user sees ----
  const unitOf = new Map<string, Unit>(); for (const u of unitMap.values()) for (const it of u.items) unitOf.set(it.id, u);
  const teamName = new Map(params.teams.map((t) => [t.id, t.name]));
  const dayMap = new Map<string, PlanDay>();
  for (const a of assignments) {
    const key = a.date + '|' + a.team_id; let d = dayMap.get(key);
    if (!d) { d = { date: a.date, team_id: a.team_id, team: teamName.get(a.team_id) ?? a.team_id, flats: [], items: 0 }; dayMap.set(key, d); }
    const label = unitOf.get(a.id)?.label ?? ''; if (label && !d.flats.includes(label)) d.flats.push(label);
    d.items++;
  }
  const teamOrder = new Map(params.teams.map((t, i) => [t.id, i]));
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date) || (teamOrder.get(a.team_id) ?? 0) - (teamOrder.get(b.team_id) ?? 0));
  for (const d of days) d.flats.sort(natural);

  const datesOf = new Map<string, Set<string>>();               // unit → dates it is worked on
  for (const a of assignments) { const u = unitOf.get(a.id); if (!u || u.communal) continue; (datesOf.get(u.key) ?? datesOf.set(u.key, new Set()).get(u.key)!).add(a.date); }
  const allDates = [...new Set(assignments.map((a) => a.date))].sort();
  const perTeam = params.teams.map((t) => {
    const mine = assignments.filter((a) => a.team_id === t.id);
    const ds = [...new Set(mine.map((a) => a.date))].sort();
    const fl = new Set(mine.map((a) => unitOf.get(a.id)).filter((u) => u && !u.communal).map((u) => u!.key));
    return { team_id: t.id, team: t.name, items: mine.length, flats: fl.size, days: ds.length, first: ds[0] ?? null, last: ds[ds.length - 1] ?? null };
  });
  for (const t of perTeam) if (!t.items && items.length) warnings.push(`${t.team} gets no items in this plan.`);
  if (unplaced.length) warnings.push(`${unplaced.length} item${unplaced.length === 1 ? '' : 's'} could not be planned: every team has left by then. Extend a team’s “until” date or add a team.`);
  if (!items.length) warnings.push('Nothing to plan: the selected items are all installed, omitted or snags.');

  return {
    assignments, days, skipped, unplaced, warnings,
    summary: {
      items: assignments.length, flats: flats.length, communalItems: communalCount,
      first: allDates[0] ?? null, last: allDates[allDates.length - 1] ?? null, workingDays: allDates.length,
      splitFlats: [...datesOf.values()].filter((s) => s.size > 1).length, perTeam,
    },
  };
}

/** England & Wales bank holidays, for the "days off" default. Extend as years are published. */
export const UK_BANK_HOLIDAYS = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
];

/** The calendar's day list from items as they stand in the database (planned date + team set). */
export function daysFromItems(
  items: (PlanItem & { team_id?: string | null; planned_install_date?: string | null })[],
  teamName: Map<string, string>,
): { days: PlanDay[]; totalFlats: number; scheduledFlats: number; scheduledItems: number; unscheduledItems: number } {
  const labelOf = (it: PlanItem) => { const f = clean(it.flat).replace(/^flat\s*/i, ''); return isCommunal(it.flat) ? (f || 'Communal') : f; };
  const unitKey = (it: PlanItem) => clean(it.block).toUpperCase() + '|' + labelOf(it).toUpperCase();
  const real = items.filter((it) => (it.kind ?? 'item') !== 'snag' && it.install_status !== 'omit');
  const dayMap = new Map<string, PlanDay>(); const all = new Set<string>(), sched = new Set<string>();
  let scheduledItems = 0, unscheduledItems = 0;
  for (const it of real) {
    all.add(unitKey(it));
    const date = clean(it.planned_install_date).slice(0, 10);
    if (!ISO.test(date)) { if (it.install_status !== 'installed_no_snag' && it.install_status !== 'installed_snag') unscheduledItems++; continue; }
    sched.add(unitKey(it)); scheduledItems++;
    const tid = clean(it.team_id), key = date + '|' + tid; let d = dayMap.get(key);
    if (!d) { d = { date, team_id: tid, team: tid ? (teamName.get(tid) ?? 'Unknown team') : 'No team', flats: [], items: 0 }; dayMap.set(key, d); }
    const label = labelOf(it); if (label && !d.flats.includes(label)) d.flats.push(label);
    d.items++;
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date) || natural(a.team, b.team));
  for (const d of days) d.flats.sort(natural);
  return { days, totalFlats: all.size, scheduledFlats: sched.size, scheduledItems, unscheduledItems };
}
