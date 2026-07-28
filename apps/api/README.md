# Sync API — Monday connector

Turns a canonical survey item into a Monday board item. Matches every field **by column title**
(never a hard-coded id), so it works on any board however it was created. Idempotent: keyed on the
item name = full location code, so re-running updates the same item instead of duplicating it.

## Files

| File | Purpose |
|---|---|
| `src/monday.ts`   | Minimal Monday GraphQL client (token from `MONDAY_API_TOKEN`, server-side only) |
| `src/mapItem.ts`  | Survey item → column values, matched by title; normalises dropdown/status labels |
| `src/syncItem.ts` | `upsertSurveyItem()` — create if new, update if it already exists |
| `src/sampleItem.ts` | A fully-surveyed example item |
| `src/demo-sync.ts`  | One-shot CLI demo |
| `src/mapItem.test.ts` | Offline test — asserts the built values match the live board |

## Verify the mapping (no token needed)

```bash
npm --workspace @ace/api run test
# → "All 10 mapping assertions passed — output matches the live board."
```

## Push a real item to a board

```bash
MONDAY_API_TOKEN=your-fresh-token npx tsx src/demo-sync.ts 18424137545
```

Prints the created/updated item id and its Monday URL. Run it twice — the second run **updates**
the same item (no duplicate), proving idempotency.

## Notes

- The token is read from the environment and never leaves the server.
- `Labour Cost` receives the effective fitting rate in **pounds** (the app stores pennies; the
  connector converts). Wire it to `effectiveRatePennies(...) / 100` from `@ace/shared`.
- Label matching ignores case and extra whitespace, so `"Team P01"` maps to the board's
  `"Team  P01"` (double space) rather than creating a duplicate label.
