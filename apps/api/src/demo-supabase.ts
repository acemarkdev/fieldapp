// Full canonical-store slice:  Supabase  →  Monday.
//   1. point the AXS.LAB job at the TEST board (dev safety — never production)
//   2. write a surveyed item into Supabase (the golden record)
//   3. promote it to Monday and mark it synced
//
// Run:  node --env-file=.env --import tsx apps/api/src/demo-supabase.ts [boardId]
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and MONDAY_API_TOKEN in .env.

import { getJobByCode, setJobBoard, upsertSurveyItem } from './store';
import { promoteItem } from './promote';
import { sampleSurveyItem } from './sampleItem';
import { ACE_TENANT } from './supabase';

const TEST_BOARD = process.argv[2] ?? '18424137545';

// 1 — AXS.LAB → test board (so we never write to the production board while developing)
const job = await getJobByCode('AXS', 'LAB');
await setJobBoard(job.id, TEST_BOARD);
console.log(`1. Job ${job.client_code}.${job.job_code} linked to Monday board ${TEST_BOARD}`);

// 2 — write the surveyed item into Supabase
const s = sampleSurveyItem();
const item = await upsertSurveyItem({
  tenant_id: ACE_TENANT, job_id: job.id,
  block: s.block, elevation: s.elevation, flat: s.flat, room_code: s.room_code,
  item_code: s.item_code, floor: s.floor, full_code: s.full_code,
  material: s.material, item_type: s.item_type, glass: s.glass, safety_glass: s.safety_glass,
  width_mm: s.width_mm, height_mm: s.height_mm, cill_depth_mm: s.cill_depth_mm,
  transom1_mm: s.transom1_mm, mullion1_mm: s.mullion1_mm,
  open_in_out: s.open_in_out, add_ons: s.add_ons, coupled: s.coupled,
  design_code: s.design_code, comments: s.comments,
  install_status: 'scheduled',
  rate_override_pennies: 8000, // £80.00 -> Labour Cost
  stage: 'surveyed',
});
console.log(`2. Stored in Supabase: item ${item.id} — ${item.full_code}`);

// 3 — promote to Monday
const res = await promoteItem(item.id);
console.log(`3. ✓ ${res.action} on Monday board ${res.boardId} (item ${res.mondayItemId})`);
console.log(`   https://monday.com/boards/${res.boardId}/pulses/${res.mondayItemId}`);
console.log('\nSupabase → Monday round-trip complete. The item is now stage=synced in the store.');
