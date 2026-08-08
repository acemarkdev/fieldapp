// Demo: a fitter marks an item installed → Install Status, Actual Install Date, after-photo on Monday.
//
// Run:  node --env-file=.env --import tsx apps/api/src/demo-install.ts
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MONDAY_API_TOKEN in .env
// and migration 0002_install.sql applied.

import { getJobByCode, setJobBoard, upsertSurveyItem, ensurePhotoBucket, uploadPhoto } from './store';
import { promoteItem } from './promote';
import { installItem } from './install';
import { sampleSurveyItem } from './sampleItem';
import { placeholderPhotoBytes } from './placeholderPhoto';
import { ACE_TENANT } from './supabase';

const TEST_BOARD = process.argv[2] ?? '18424137545';

const job = await getJobByCode('AXS', 'LAB');
await setJobBoard(job.id, TEST_BOARD);

// make sure the item exists and is on Monday
const s = sampleSurveyItem();
const item = await upsertSurveyItem({
  tenant_id: ACE_TENANT, job_id: job.id, full_code: s.full_code,
  block: s.block, elevation: s.elevation, flat: s.flat, room_code: s.room_code,
  item_code: s.item_code, floor: s.floor,
  material: s.material, item_type: s.item_type, glass: s.glass,
  width_mm: s.width_mm, height_mm: s.height_mm,
  install_status: 'scheduled', stage: 'surveyed',
});
const p = await promoteItem(item.id);
console.log(`1. Item on Monday: ${p.mondayItemId} (${item.full_code})`);

// placeholder after-install photo in storage
await ensurePhotoBucket();
const photoPath = `install/${item.id}-after.png`;
await uploadPhoto(photoPath, placeholderPhotoBytes(), 'image/png');

// fitter marks it installed (no snag), with the after-photo
const r = await installItem(item.id, { snag: false, photoPath });
console.log(`2. ✓ marked installed`);
console.log(`   Install Status: Installed no snag · Actual Install Date: ${r.date} · after-photo → Picture After: ${r.photoUploaded}`);
console.log(`   https://monday.com/boards/${TEST_BOARD}/pulses/${r.mondayItemId}`);
