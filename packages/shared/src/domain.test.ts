// Plain-node tests (no framework) — run with: npx tsx src/domain.test.ts
import assert from 'node:assert';
import { assembleFullCode, effectiveRatePennies, formatPennies, rankStyles } from './domain';
import type { PickEvent, StyleCatalogueRow } from './types';

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };

t('assembleFullCode builds the ACE code', () => {
  const code = assembleFullCode({
    client: 'AXS', job: 'LAB', block: 'B1', elevation: 'E1',
    flat: '21', room: 'LR', item: 'W02', floor: 'F1',
  });
  assert.strictEqual(code, 'AXS.LAB.B1.E1.F21.LR.W02.F1');
});

t('assembleFullCode skips empty segments', () => {
  const code = assembleFullCode({ client: 'AXS', job: 'FUR', flat: '3', item: 'D01' });
  assert.strictEqual(code, 'AXS.FUR.F3.D01');
});

t('effectiveRatePennies inherits team default', () => {
  const teams = [{ id: 't1', default_rate_pennies: 8000 }];
  assert.strictEqual(effectiveRatePennies({ rate_override_pennies: null, team_id: 't1' }, teams), 8000);
});

t('effectiveRatePennies uses override and ignores team', () => {
  const teams = [{ id: 't1', default_rate_pennies: 8000 }];
  assert.strictEqual(effectiveRatePennies({ rate_override_pennies: 12000, team_id: 't1' }, teams), 12000);
});

t('formatPennies', () => {
  assert.strictEqual(formatPennies(8000), '£80.00');
  assert.strictEqual(formatPennies(null), '—');
});

t('rankStyles floats the job-favoured style to the top', () => {
  const styles: StyleCatalogueRow[] = [
    { id: '1', tenant_id: null, source: 'clearview', style_number: '1', product_type: 'Window', wide: 1, high: 1, opening: 0, fixed: 1, drawing_path: null, notes: null },
    { id: '24', tenant_id: null, source: 'clearview', style_number: '24', product_type: 'Window', wide: 2, high: 2, opening: 2, fixed: 1, drawing_path: null, notes: null },
  ];
  const now = new Date();
  const events: PickEvent[] = Array.from({ length: 5 }).map((_, i) => ({
    id: `e${i}`, tenant_id: 'ac', item_id: null, style_number: '24',
    job_id: 'job1', room_code: 'LR', surveyor_id: 'me', created_at: now.toISOString(),
  }));
  const ranked = rankStyles(styles, events, { jobId: 'job1', roomCode: 'LR', surveyorId: 'me', now });
  assert.strictEqual(ranked[0].style_number, '24'); // used 5× on this job → first
});

console.log(`\nAll ${passed} domain tests passed.`);
