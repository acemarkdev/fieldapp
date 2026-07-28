// One-shot demo: pushes the sample surveyed item to a Monday board.
// Run:  MONDAY_API_TOKEN=your-token npx tsx src/demo-sync.ts <boardId>
// Re-run it — the same item is UPDATED, not duplicated (idempotent on full code).

import { Monday } from './monday';
import { upsertSurveyItem } from './syncItem';
import { sampleSurveyItem } from './sampleItem';

const boardId = process.argv[2] ?? process.env.MONDAY_BOARD_ID;
if (!boardId) {
  console.error('Usage:  MONDAY_API_TOKEN=your-token npx tsx src/demo-sync.ts <boardId>');
  process.exit(1);
}

const monday = new Monday(); // reads MONDAY_API_TOKEN from the environment
const res = await upsertSurveyItem(monday, boardId, {
  item: sampleSurveyItem(),
  ratePounds: 80, // effective fitting rate -> Labour Cost
  // teamName is intentionally omitted: assigning the Fitters column is an office
  // web-app action (handled in a later sprint), not part of the survey→Monday sync.
});

console.log(`✓ ${res.action} Monday item ${res.itemId}`);
console.log(`  ${res.fullCode}`);
console.log(`  https://monday.com/boards/${boardId}/pulses/${res.itemId}`);
