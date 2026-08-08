// Demo: a fitter raises snags on an item → they appear as Monday sub-items.
//
// Run:  node --env-file=.env --import tsx apps/api/src/demo-snags.ts
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env.

import { getJobByCode, setJobBoard, upsertSurveyItem, upsertSnag, ensurePhotoBucket, uploadPhoto } from './store';
import { promoteItem } from './promote';
import { syncSnagsForItem } from './snags';
import { sampleSurveyItem } from './sampleItem';
import { placeholderPhotoBytes } from './placeholderPhoto';
import { ACE_TENANT } from './supabase';

const TEST_BOARD = process.argv[2] ?? '18424137545';

const job = await getJobByCode('AXS', 'LAB');
await setJobBoard(job.id, TEST_BOARD);

// make sure the item exists and is on Monday (snags attach to its Monday item)
const s = sampleSurveyItem();
const item = await upsertSurveyItem({
  tenant_id: ACE_TENANT, job_id: job.id, full_code: s.full_code,
  block: s.block, elevation: s.elevation, flat: s.flat, room_code: s.room_code,
  item_code: s.item_code, floor: s.floor,
  material: s.material, item_type: s.item_type, glass: s.glass,
  width_mm: s.width_mm, height_mm: s.height_mm,
  install_status: 'installed_snag', stage: 'surveyed',
});
const p = await promoteItem(item.id);
console.log(`1. Item on Monday: ${p.mondayItemId} (${item.full_code})`);

// put a placeholder snag photo into Supabase Storage (stands in for a real fitter photo)
await ensurePhotoBucket();
const photoPath = `snags/${item.id}-cill.png`;
await uploadPhoto(photoPath, placeholderPhotoBytes(), 'image/png');

// a fitter raises two snags (stored in Supabase); the first carries the photo
await upsertSnag({ tenant_id: ACE_TENANT, item_id: item.id, description: 'Cill damaged in transit', status: 'open', photo_path: photoPath });
await upsertSnag({ tenant_id: ACE_TENANT, item_id: item.id, description: 'Trickle vent to be re-checked on next visit', status: 'open' });
console.log('2. Raised 2 snags in the store (one with a photo)');

// push snags to Monday as duplicate items (Install Status = Snag, no Labour Cost, photo → Design Sketch)
const r = await syncSnagsForItem(item.id);
console.log(`3. ✓ snags synced as items — created ${r.created}, updated ${r.updated}, photos → Design Sketch: ${r.photos}`);
console.log(`   Board: https://monday.com/boards/${TEST_BOARD}`);
console.log('\nEach snag is a copy of the original item named "<code> — <comment>",');
console.log('Install Status = Snag, Labour Cost blank, and its photo in the Design Sketch column.');
