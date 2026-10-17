// Plain-node tests — run with: npx tsx packages/shared/src/spec.test.ts
import assert from 'node:assert';
import {
  resolveItemSpec, resolveJobSpec, specFieldsAtLevel, specScopeKey, specType, normaliseSpecValue, specAllowedAt,
  SPEC_FIELDS, SPEC_TYPE_FIELDS, ITEM_TYPES, type SpecValueRow,
} from './spec';

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };

const JOB = 'job-1', CUST = 'cust-1';
const item = { id: 'it-1', item_type: 'Casement', block: null, elevation: 'E1', flat: '21', room_code: 'KT', item_code: 'W01', safety_glass: null, width_mm: 1200 };
const row = (level: SpecValueRow['level'], owner: string, scope: string, key: string, value: string): SpecValueRow => ({ level, owner_id: owner, scope_key: scope, param_key: key, value });
const get = (rs: ReturnType<typeof resolveItemSpec>, key: string) => rs.find((r) => r.key === key)!;

t('every catalogue entry points at a defined field', () => {
  for (const t of ITEM_TYPES) for (const e of SPEC_TYPE_FIELDS[t] ?? []) assert.ok(SPEC_FIELDS[e.key], t + ' → ' + e.key);
});

t('specType matches the order-form types case-insensitively; Window is legacy', () => {
  assert.strictEqual(specType('flush casement'), 'Flush Casement');
  assert.strictEqual(specType('Window'), null);
});

t('scope keys qualify elevation and flat by block; room is the room code', () => {
  assert.strictEqual(specScopeKey('elevation', { block: 'B1', elevation: 'E2' }), 'B1/E2');
  assert.strictEqual(specScopeKey('flat', { flat: '21' }), '21');
  assert.strictEqual(specScopeKey('room', { room_code: 'kt' }), 'KT');
  assert.strictEqual(specScopeKey('flat', { flat: null }), '');
});

t('the most specific level wins: elevation over job', () => {
  const rows = [row('job', JOB, '', 'finish', 'White'), row('elevation', JOB, 'E1', 'finish', 'Foil')];
  const r = get(resolveItemSpec(item, rows, { jobId: JOB, customerId: CUST }), 'finish');
  assert.strictEqual(r.value, 'Foil');
  assert.strictEqual(r.source, 'Elevation E1');
});

t('a value on another elevation does not leak in', () => {
  const rows = [row('job', JOB, '', 'finish', 'White'), row('elevation', JOB, 'E2', 'finish', 'Foil')];
  assert.strictEqual(get(resolveItemSpec(item, rows, { jobId: JOB }), 'finish').value, 'White');
});

t('room type rule applies to every kitchen; the item column overrides it', () => {
  const rows = [row('room', JOB, 'KT', 'tl', 'Laminated')];
  assert.strictEqual(get(resolveItemSpec(item, rows, { jobId: JOB }), 'tl').source, 'Room type KT');
  const r = get(resolveItemSpec({ ...item, safety_glass: 'Toughened' }, rows, { jobId: JOB }), 'tl');
  assert.strictEqual(r.value, 'Toughened');
  assert.strictEqual(r.source, 'Item');
});

t('customer value is used when the job sets none; job beats customer', () => {
  const rows = [row('customer', CUST, '', 'sbd', 'Yes')];
  assert.strictEqual(get(resolveItemSpec(item, rows, { jobId: JOB, customerId: CUST }), 'sbd').value, 'Yes');
  rows.push(row('job', JOB, '', 'sbd', 'No'));
  assert.strictEqual(get(resolveItemSpec(item, rows, { jobId: JOB, customerId: CUST }), 'sbd').value, 'No');
});

t('the matrix default fills in when nothing is set (U-value)', () => {
  const r = get(resolveItemSpec(item, [], { jobId: JOB }), 'uvalue');
  assert.strictEqual(r.source, 'Default');
  assert.ok(String(r.value).includes('1.4'));
});

t('notes from every level are kept, top-down', () => {
  const rows = [row('job', JOB, '', 'notes', 'Job note'), row('flat', JOB, '21', 'notes', 'Flat note')];
  assert.strictEqual(get(resolveItemSpec({ ...item, comments: 'Item note' }, rows, { jobId: JOB }), 'notes').value, 'Job note · Flat note · Item note');
});

t('a legacy Window item gets only the regulations', () => {
  const rs = resolveItemSpec({ ...item, item_type: 'Window' }, [], { jobId: JOB });
  assert.ok(rs.length > 0 && rs.every((r) => r.def.section === 'regs'));
});

t('fields at a level: Elevation offers frame finish, Customer offers the company', () => {
  assert.ok(specFieldsAtLevel('elevation').some((f) => f.key === 'finish' && f.types.includes('Bay')));
  assert.ok(specAllowedAt('company', 'customer'));
  assert.ok(!specAllowedAt('width', 'job'));
});

t('values are normalised per kind', () => {
  assert.strictEqual(normaliseSpecValue('sbd', 'true'), 'Yes');
  assert.strictEqual(normaliseSpecValue('mullion', ' 600 '), '600');
  assert.strictEqual(normaliseSpecValue('finish', ''), null);
  assert.throws(() => normaliseSpecValue('mullion', 'abc'));
  assert.throws(() => normaliseSpecValue('nope', 'x'));
});

t('job spec lists job and customer values for the PO header', () => {
  const rows = [row('customer', CUST, '', 'company', 'Axis Ltd'), row('job', JOB, '', 'tvsize', '5,000 EA')];
  const js = resolveJobSpec(rows, { jobId: JOB, customerId: CUST });
  assert.strictEqual(js.find((x) => x.key === 'company')?.source, 'Customer');
  assert.strictEqual(js.find((x) => x.key === 'tvsize')?.value, '5,000 EA');
});

console.log(`\nAll ${passed} spec tests passed`);
