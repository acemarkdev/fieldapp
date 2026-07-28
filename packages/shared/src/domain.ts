// Shared domain logic — used identically by the mobile app, web app and backend.
// Pure functions, no I/O, so they're trivially testable.

import type { PickEvent, StyleCatalogueRow, SurveyItem, FitterTeam } from './types';

// ---------------------------------------------------------------
//  Full item code, e.g. AXS.LAB.B1.E1.F21.LR.W02.F1
//  Flat number is prefixed with F. Empty segments are skipped.
// ---------------------------------------------------------------
export interface CodeParts {
  client: string; job: string;
  block?: string; elevation?: string; flat?: string;
  room?: string; item?: string; floor?: string;
}

export function assembleFullCode(p: CodeParts, separator = '.'): string {
  const flat = p.flat ? `F${String(p.flat).replace(/\D/g, '')}` : undefined;
  return [p.client, p.job, p.block, p.elevation, flat, p.room, p.item, p.floor]
    .filter((s) => s != null && s !== '')
    .join(separator);
}

// ---------------------------------------------------------------
//  Fitting rate: override if set, else the assigned team's default.
// ---------------------------------------------------------------
export function effectiveRatePennies(
  item: Pick<SurveyItem, 'rate_override_pennies' | 'team_id'>,
  teams: Pick<FitterTeam, 'id' | 'default_rate_pennies'>[],
): number | null {
  if (item.rate_override_pennies != null) return item.rate_override_pennies;
  const team = teams.find((t) => t.id === item.team_id);
  return team ? team.default_rate_pennies : null;
}

export const formatPennies = (p: number | null): string =>
  p == null ? '—' : `£${(p / 100).toFixed(2)}`;

// ---------------------------------------------------------------
//  "Most used" style ranking (frecency + context).
//  See the architecture doc, section 3. Weights are tunable.
// ---------------------------------------------------------------
export const HALF_LIFE_DAYS = 75;

export const RANK_WEIGHTS = {
  job: 5.0,     // same job (repeated flats) — dominant signal
  room: 3.0,    // same room type
  global: 1.5,  // company-wide "house style"
  me: 1.0,      // this surveyor's habit
  seed: 0.2,    // cold-start catalogue prior
};

export interface RankContext {
  jobId?: string | null;
  roomCode?: string | null;
  surveyorId?: string | null;
  now?: Date;
}

function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

// Time-decayed count of a set of events.
function decay(events: PickEvent[], now: Date): number {
  return events.reduce(
    (sum, e) => sum + Math.pow(0.5, ageDays(e.created_at, now) / HALF_LIFE_DAYS),
    0,
  );
}

export function scoreStyle(
  style: StyleCatalogueRow,
  events: PickEvent[],
  ctx: RankContext,
  catalogueOrderIndex: number,
): number {
  const now = ctx.now ?? new Date();
  const forStyle = events.filter((e) => e.style_number === style.style_number);

  const inJob = forStyle.filter((e) => ctx.jobId && e.job_id === ctx.jobId).length;
  const inRoom = decay(forStyle.filter((e) => ctx.roomCode && e.room_code === ctx.roomCode), now);
  const global = decay(forStyle, now);
  const mine = decay(forStyle.filter((e) => ctx.surveyorId && e.surveyor_id === ctx.surveyorId), now);
  // cold-start prior: earlier catalogue numbers rank slightly higher when there's no history
  const seed = 1 / (1 + catalogueOrderIndex);

  return (
    RANK_WEIGHTS.job * inJob +
    RANK_WEIGHTS.room * inRoom +
    RANK_WEIGHTS.global * global +
    RANK_WEIGHTS.me * mine +
    RANK_WEIGHTS.seed * seed
  );
}

// Returns styles ordered most-used-first for the given context.
// Stable tie-break on style number keeps the grid from reshuffling.
export function rankStyles(
  styles: StyleCatalogueRow[],
  events: PickEvent[],
  ctx: RankContext,
): StyleCatalogueRow[] {
  const scored = styles.map((s, i) => ({ s, score: scoreStyle(s, events, ctx, i) }));
  scored.sort((a, b) => b.score - a.score || a.s.style_number.localeCompare(b.s.style_number, undefined, { numeric: true }));
  return scored.map((x) => x.s);
}
