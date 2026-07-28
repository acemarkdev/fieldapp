import { assembleFullCode } from '@ace/shared';
import type { SurveyItem } from '@ace/shared';

// A fully-surveyed sample item (mirrors the one we verified live on the test board).
export function sampleSurveyItem(): SurveyItem {
  const full_code = assembleFullCode({
    client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1',
    flat: '21', room: 'LR', item: 'W02', floor: 'F1',
  });
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_id: '00000000-0000-0000-0000-0000000000ac',
    job_id: '00000000-0000-0000-0000-000000000010',
    block: 'B1', elevation: 'E1', flat: '21', room_code: 'LR', item_code: 'W02', floor: 'F1',
    full_code,
    material: 'PVC', item_type: 'Casement', glass: 'Obscure', safety_glass: 'N/A', glazing: null,
    width_mm: 1180, height_mm: 1050, cill_depth_mm: 150,
    transom1_mm: 450, transom2_mm: null, transom3_mm: null,
    mullion1_mm: 600, mullion2_mm: null, mullion3_mm: null,
    open_in_out: 'Out', add_ons: 'L,H', coupled: 'Yes W01,W02',
    design_code: 'Style 24',
    comments: 'Obscure glass; trickle vent + cill. Access via communal stairwell.',
    stage: 'surveyed', surveyed_by: null, scanned_by: null,
    team_id: null, rate_override_pennies: null,
    install_status: 'scheduled',
    monday_item_id: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}
