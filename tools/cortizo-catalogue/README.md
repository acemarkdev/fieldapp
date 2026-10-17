# Cortizo catalogue → office app

Builds the reference list behind Production ▸ Cortizo profiles from the Cortizo Center catalogue
PDFs (downloaded from cortizocenter.com ▸ Katalogi, one folder per group plus `index.csv`).

1. `python3 extract.py "<catalogues>" "<out>"` — reads every catalogue's *Relación de perfiles /
   Profile list* (reference, sketch, ES/EN description, weight g/m, surface dm²/m, page) and
   *Relación de accesorios / Accessories list* (reference, description, colour, type, page) tables.
   One JSON per catalogue in `<out>/raw`, the profile sketches in `<out>/sketches`. Resumes: a
   catalogue already in `raw/` is skipped (delete its JSON to read it again). Needs `pdfplumber`,
   `pypdfium2`, `Pillow`.
2. `python3 build.py "<out>"` — one record per reference (`items.json`), one sketch each
   (`final/`), and `report.txt`: rows per catalogue, cells that are not a reference, and weights
   that differ between catalogues. Texts, weight and sketch come from the newest catalogue.
3. `npx tsx tools/cortizo-catalogue/upload.mts "<out>"` (dry run), then with `--write`, with
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` of the test project, then prod. Needs migration 0079.

The hardware catalogues (Herraje …) have no reference tables and give no rows; their references
appear in the systems' accessory lists. Accessories have no sketch of their own in the list
tables — the detail window shows the catalogue page where they are drawn.
