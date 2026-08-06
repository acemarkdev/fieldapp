// Seed a realistic mix of survey items for AXS.LAB into the canonical store,
// so the board + report look like a live job. Safe to re-run (upsert on full code).
//
// Run:  node --env-file=.env --import tsx apps/api/src/seed-items.ts
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.

import { getJobByCode, upsertSurveyItem, listTeams } from './store';
import { assembleFullCode } from '@ace/shared';
import { ACE_TENANT } from './supabase';

const job = await getJobByCode('AXS', 'LAB');
const teams = await listTeams(job.tenant_id);
const P01 = teams.find((t) => t.name === 'Team P01')?.id ?? null;
const P02 = teams.find((t) => t.name === 'Team P02')?.id ?? null;

type Def = {
  block: string; elev: string; flat: string; room: string; item: string; floor: string;
  material: string; item_type: string; glass: string; width: number; height: number;
  design: string | null; stage: 'scanned' | 'surveyed'; team: string | null; rate?: number;
};

const defs: Def[] = [
  { block:'B1', elev:'E1', flat:'21', room:'LR', item:'W01', floor:'F1', material:'PVC', item_type:'Casement', glass:'Clear',   width:1180, height:1050, design:'Style 3',   stage:'surveyed', team:P01 },
  { block:'B1', elev:'E1', flat:'22', room:'KT', item:'W03', floor:'F1', material:'PVC', item_type:'Casement', glass:'Obscure', width:1800, height:1050, design:'Style 24',  stage:'surveyed', team:P01, rate:12000 },
  { block:'B1', elev:'E5', flat:'11', room:'HW', item:'D01', floor:'GF', material:'Composite', item_type:'Door', glass:'Obscure', width:900, height:2100, design:'Style 259', stage:'surveyed', team:P02 },
  { block:'B1', elev:'E1', flat:'12', room:'KT', item:'W02', floor:'F1', material:'PVC', item_type:'Casement', glass:'Clear',   width:900,  height:1050, design:null,       stage:'scanned',  team:null },
  { block:'B1', elev:'E2', flat:'14', room:'BD', item:'W01', floor:'F2', material:'PVC', item_type:'Fixed',    glass:'Clear',   width:1200, height:1200, design:'Style 1',   stage:'surveyed', team:P01 },
  { block:'B1', elev:'E2', flat:'14', room:'BA', item:'W01', floor:'F2', material:'PVC', item_type:'Casement', glass:'Obscure', width:600,  height:1050, design:'Style 32',  stage:'surveyed', team:P01 },
];

let n = 0;
for (const d of defs) {
  const full_code = assembleFullCode({
    client: 'AXS', job: 'LAB', block: d.block, elevation: d.elev,
    flat: d.flat, room: d.room, item: d.item, floor: d.floor,
  });
  await upsertSurveyItem({
    tenant_id: ACE_TENANT, job_id: job.id,
    block: d.block, elevation: d.elev, flat: d.flat, room_code: d.room, item_code: d.item, floor: d.floor, full_code,
    material: d.material, item_type: d.item_type, glass: d.glass, width_mm: d.width, height_mm: d.height,
    design_code: d.design, install_status: 'scheduled',
    team_id: d.team, rate_override_pennies: d.rate ?? null,
    stage: d.stage,
  });
  n++;
  console.log(`  seeded ${full_code}  (${d.stage})`);
}
console.log(`\nSeeded ${n} items into Supabase for AXS.LAB. Run promote-all to push the surveyed ones to Monday.`);
