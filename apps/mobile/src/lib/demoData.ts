// Seed dataset for the mobile DEMO mode. Pure data (no React Native imports) so it can be
// unit-tested in Node. A fresh copy is produced on every demo start; edits made during a demo
// live only in memory and are discarded when the user exits.

export interface DemoDb {
  tenants: any[];
  app_users: any[];
  fitter_teams: any[];
  jobs: any[];
  survey_items: any[];
  job_plans: any[];
  item_photos: any[];
  pick_events: any[];
}

const T = 'demo-tenant';
const TEAM_A = 'demo-team-a';
const TEAM_B = 'demo-team-b';
const JOB1 = 'demo-job-1';
const JOB2 = 'demo-job-2';
const PLAN1 = 'demo-plan-1';

// A hosted placeholder so plan/photo images render in the demo without bundling assets.
const img = (w: number, h: number, label: string) =>
  `https://placehold.co/${w}x${h}/ede9fe/6d28d9?text=${encodeURIComponent(label)}`;

function item(o: Partial<any>): any {
  return {
    id: o.id, tenant_id: T, job_id: o.job_id ?? JOB1,
    full_code: o.full_code ?? null, item_code: o.item_code ?? null, room_code: o.room_code ?? null,
    block: o.block ?? 'A', elevation: o.elevation ?? 'E1', flat: o.flat ?? null, floor: o.floor ?? 'F1',
    kind: o.kind ?? 'item', parent_item_id: o.parent_item_id ?? null,
    stage: o.stage ?? 'surveyed', install_status: o.install_status ?? 'scheduled',
    team_id: o.team_id ?? TEAM_A,
    plan_id: o.plan_id ?? null, plan_x: o.plan_x ?? null, plan_y: o.plan_y ?? null,
    material: o.material ?? 'uPVC', window_type: o.window_type ?? 'Casement', item_type: o.item_type ?? 'Window',
    glass: o.glass ?? 'Clear', safety_glass: o.safety_glass ?? null, glazing: o.glazing ?? 'None',
    design_code: o.design_code ?? '27', width_mm: o.width_mm ?? 1200, height_mm: o.height_mm ?? 1050,
    cill_depth: o.cill_depth ?? '150mm', open_in_out: o.open_in_out ?? 'Out',
    comments: o.comments ?? null, snag_comment: o.snag_comment ?? null,
    actual_install_date: o.actual_install_date ?? null,
    planned_install_date: o.planned_install_date ?? null,
    created_at: o.created_at ?? '2026-09-01T09:00:00Z',
    ...o,
  };
}

export function seedDemoDb(): DemoDb {
  return {
    tenants: [{ id: T, name: 'Acemark (Demo)', pins_multi_plan: false }],
    app_users: [{ id: 'demo-user', tenant_id: T, role: 'admin', team_id: TEAM_A, name: 'Demo User', email: 'demo@acegroup-uk.com', active: true, auth_user_id: null }],
    fitter_teams: [
      { id: TEAM_A, tenant_id: T, name: 'Team Alpha', default_rate_pennies: 12000, door_rate_pennies: 14000, active: true },
      { id: TEAM_B, tenant_id: T, name: 'Team Bravo', default_rate_pennies: 11500, door_rate_pennies: 13500, active: true },
    ],
    jobs: [
      { id: JOB1, tenant_id: T, client_code: 'AXS', job_code: 'DEMO', name: 'Padnell Rise (Demo)', site_address: 'Padnell Rise, Waterlooville', postcode: 'PO8 8DZ', active: true, monday_board_id: null, status: 'new' },
      { id: JOB2, tenant_id: T, client_code: 'AXS', job_code: 'BELL', name: 'Bell Court (Demo)', site_address: 'Bell Court, Havant', postcode: 'PO9 1AA', active: true, monday_board_id: null, status: 'new' },
    ],
    survey_items: [
      item({ id: 'demo-i1', full_code: 'AXS.DEMO.A.E1.F1.LOUNGE.W1', item_code: 'W1', room_code: 'LOUNGE', flat: '1', install_status: 'scheduled', planned_install_date: '2026-09-15', plan_id: PLAN1, plan_x: 0.24, plan_y: 0.32, window_type: 'Casement' }),
      item({ id: 'demo-i2', full_code: 'AXS.DEMO.A.E1.F1.KITCHEN.W2', item_code: 'W2', room_code: 'KITCHEN', flat: '1', install_status: 'installed_no_snag', actual_install_date: '2026-09-10', plan_id: PLAN1, plan_x: 0.55, plan_y: 0.30, window_type: 'Fixed', glass: 'Obscure', safety_glass: 'Toughened' }),
      item({ id: 'demo-i3', full_code: 'AXS.DEMO.A.E1.F1.BED1.W3', item_code: 'W3', room_code: 'BED1', flat: '1', install_status: 'scheduled', planned_install_date: '2026-09-15', window_type: 'Tilt & Turn' }),
      item({ id: 'demo-i4', full_code: 'AXS.DEMO.A.E1.F1.BATH.W4', item_code: 'W4', room_code: 'BATH', flat: '1', install_status: 'installed_snag', actual_install_date: '2026-09-10', glass: 'Obscure', safety_glass: 'Toughened', comments: 'Cill scratched on delivery' }),
      item({ id: 'demo-i5', full_code: 'AXS.DEMO.A.E1.F2.LOUNGE.W1', item_code: 'W1', room_code: 'LOUNGE', flat: '2', floor: 'F2', install_status: 'scheduled', planned_install_date: '2026-09-16', team_id: TEAM_B }),
      item({ id: 'demo-i6', full_code: 'AXS.DEMO.A.E1.F2.KITCHEN.D1', item_code: 'D1', room_code: 'KITCHEN', flat: '2', floor: 'F2', item_type: 'Door', install_status: 'scheduled', planned_install_date: '2026-09-16', team_id: TEAM_B, width_mm: 900, height_mm: 2100 }),
      item({ id: 'demo-i7', full_code: 'AXS.DEMO.A.E1.F2.BED1.W2', item_code: 'W2', room_code: 'BED1', flat: '2', floor: 'F2', install_status: 'delayed', team_id: TEAM_B }),
      // A snag child of i4, to show the snag flow read-only.
      item({ id: 'demo-i4s1', full_code: 'AXS.DEMO.A.E1.F1.BATH.W4-S1', item_code: 'W4', room_code: 'BATH', flat: '1', kind: 'snag', parent_item_id: 'demo-i4', install_status: 'snag', snag_comment: 'Replace scratched cill', comments: 'Replace scratched cill' }),
      // Job 2
      item({ id: 'demo-j2i1', job_id: JOB2, full_code: 'AXS.BELL.A.E1.F1.LOUNGE.W1', item_code: 'W1', room_code: 'LOUNGE', flat: '1', install_status: 'scheduled', planned_install_date: '2026-09-22' }),
      item({ id: 'demo-j2i2', job_id: JOB2, full_code: 'AXS.BELL.A.E1.F1.KITCHEN.W2', item_code: 'W2', room_code: 'KITCHEN', flat: '1', install_status: 'scheduled', planned_install_date: '2026-09-22' }),
      item({ id: 'demo-j2i3', job_id: JOB2, full_code: 'AXS.BELL.A.E1.F1.BED1.W3', item_code: 'W3', room_code: 'BED1', flat: '1', install_status: 'scheduled', planned_install_date: '2026-09-23' }),
    ],
    job_plans: [
      { id: PLAN1, tenant_id: T, job_id: JOB1, name: 'Ground floor', storage_path: img(1200, 800, 'Demo Floor Plan'), sort: 0 },
    ],
    item_photos: [
      { id: 'demo-ph1', tenant_id: T, item_id: 'demo-i2', kind: 'after', storage_path: img(800, 600, 'Installed W2'), created_at: '2026-09-10T12:00:00Z' },
      { id: 'demo-ph2', tenant_id: T, item_id: 'demo-i4', kind: 'before', storage_path: img(800, 600, 'Before W4'), created_at: '2026-09-09T12:00:00Z' },
    ],
    pick_events: [
      { id: 'demo-pe1', tenant_id: T, style_number: '27', room_code: 'LOUNGE', job_id: JOB1 },
      { id: 'demo-pe2', tenant_id: T, style_number: '27', room_code: 'BED1', job_id: JOB1 },
      { id: 'demo-pe3', tenant_id: T, style_number: '15', room_code: 'KITCHEN', job_id: JOB1 },
    ],
  };
}
