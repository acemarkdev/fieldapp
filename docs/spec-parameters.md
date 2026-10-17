# Specification parameters

The Emplas order-form fields and the Building Regulations checks, each set at one level and inherited by the items below it.

| Level | Set where | Stored as (`spec_values`) |
|---|---|---|
| 1 Customer | Customer card ▸ Specification | `level='customer'`, `owner_id` = customer id |
| 2 Job | Job ▸ Spec ▸ Job | `level='job'`, `owner_id` = job id |
| 3 Elevation | Job ▸ Spec ▸ Elevation | `scope_key` = elevation code, block-qualified (`B1/E1`) when the items have a block |
| 4 Flat | Job ▸ Spec ▸ Flat | `scope_key` = flat number, block-qualified the same way |
| 5 Room type | Job ▸ Spec ▸ Room type | `scope_key` = room code (`KT`): one rule for every kitchen in the job |
| 6 Item | Item window ▸ Order form | `level='item'`, `owner_id` = item id |

The most specific level wins: item > room type > flat > elevation > job > customer > matrix default.
Fields that already have a `survey_items` column (width, height, mullion, transom, cill, safety glass, glass, open in/out, comments) keep using that column at item level. A value set higher up fills the field only while the column is empty.
Notes are joined from every level, top-down.

## Where things live

- `packages/shared/src/specCatalogue.ts` is generated. It lists the fields, the levels each may be set at, and who fills it in (Office / Mapper / Surveyor). It comes from the Spec Matrix decisions; regenerate it with `tools/spec-catalogue/gen.js`. Rows left blank in the matrix use the suggested level and are marked `decided: false`. The office shows these as "level not decided yet".
- `packages/shared/src/spec.ts` holds the item types, scopes and the resolver (`resolveItemSpec`, `resolveJobSpec`). Its tests are in `spec.test.ts`.
- `apps/api/src/specStore.ts` handles storage, and `office.ts` has the routes (`/api/spec/*`, `/api/job/:ref/spec`, `/api/item/:id/spec`) and the UI. `poPdf.ts` prints the spec on the PO.
- `supabase/migrations/0080_spec_values.sql` creates the table. It is server-only, like `time_edit_log`. Until it is applied, reads return nothing and saving says the migration is missing.

## Permissions

- Customer level: `customers.manage`.
- Job, elevation, flat and room type: `jobs.manage`.
- Item: `items.edit`.

## Not done yet

- The mobile mapping and survey screens do not show these fields yet. The "who" in the catalogue (Mapper = the `scanner` role, Surveyor) says which screen each field belongs on.
