"""
Merge the per-catalogue rows from extract.py into one record per Cortizo reference.

    python3 build.py "<out folder of extract.py>"

Writes into that folder:
    items.json        [{ref, kind, desc_en, desc_es, weight_g_m, surface_dm2_m, colour_*, type_*,
                        sketch, systems, sources}]  — what upload.mjs loads into cortizo_items
    final/<ref>.png   one sketch per profile (from the newest catalogue that has one)
    report.txt        counts, references whose weight / description differ between catalogues,
                      and cells that do not look like a reference
A reference listed as a profile anywhere is a profile. Texts, weight and surface come from the
newest catalogue (by its version date); disagreements are reported, not guessed away.
"""
import json, os, re, shutil, sys
from collections import Counter, defaultdict
from datetime import datetime

REF_OK = re.compile(r'^(COR-?[0-9A-Z]{3,}|[0-9]{3,8}[A-Z]{0,3}|[A-Z]{1,4}[-]?[0-9]{3,}[0-9A-Z-]*)$')

def vdate(v):
    try:
        return datetime.strptime(v or '', '%d/%m/%Y')
    except ValueError:
        return datetime(1900, 1, 1)

def clean_ref(r):
    return re.sub(r'\s+', '', r or '').upper()

def main():
    out = sys.argv[1]
    rows = []
    cats = []
    for f in sorted(os.listdir(os.path.join(out, 'raw'))):
        d = json.load(open(os.path.join(out, 'raw', f), encoding='utf-8'))
        cats.append(d)
        for r in d['rows']:
            r['_system'], r['_file'], r['_version'] = d['system'], d['file'], d['version']
            rows.append(r)
    by = defaultdict(list)
    odd = []
    for r in rows:
        ref = clean_ref(r['ref'])
        if not REF_OK.match(ref):
            odd.append(r)
            continue
        by[ref].append(r)
    final = os.path.join(out, 'final')
    if os.path.isdir(final):
        shutil.rmtree(final)
    os.makedirs(final)
    items, conflicts = [], []
    for ref, rs in sorted(by.items()):
        rs.sort(key=lambda r: vdate(r['_version']), reverse=True)
        profs = [r for r in rs if r['kind'] == 'profile']
        kind = 'profile' if profs else 'accessory'
        main_rows = profs or rs
        top = main_rows[0]
        first = lambda key: next((r.get(key) for r in main_rows if r.get(key) not in (None, '')), None)
        it = {'ref': ref, 'kind': kind, 'desc_en': first('desc_en'), 'desc_es': first('desc_es')}
        if kind == 'profile':
            it['weight_g_m'] = first('weight_g_m')
            it['surface_dm2_m'] = first('surface_dm2_m')
            ws = {r['weight_g_m'] for r in profs if r.get('weight_g_m') is not None}
            if len(ws) > 1:
                conflicts.append(f"{ref}: weight differs {sorted(ws)} — kept {it['weight_g_m']} ({top['_system']})")
            sk = next((r for r in profs if r.get('sketch')), None)
            if sk:
                name = re.sub(r'[^A-Za-z0-9._-]+', '_', ref) + '.png'
                shutil.copyfile(os.path.join(out, 'sketches', sk['sketch']), os.path.join(final, name))
                it['sketch'] = name
        else:
            for k in ('colour_en', 'colour_es', 'type_en', 'type_es'):
                it[k] = first(k)
        it['systems'] = sorted({r['_system'] for r in rs if r['_system']})
        seen, src = set(), []
        for r in rs:
            key = (r['_file'], r['pdf_page'])
            if key in seen:
                continue
            seen.add(key)
            src.append({'system': r['_system'], 'file': r['_file'], 'version': r['_version'], 'kind': r['kind'],
                        'pdf_page': r['pdf_page'], 'cat_page': r.get('cat_page')})
        it['sources'] = src
        items.append(it)
    json.dump(items, open(os.path.join(out, 'items.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    kinds = Counter(i['kind'] for i in items)
    with open(os.path.join(out, 'report.txt'), 'w', encoding='utf-8') as f:
        f.write(f"catalogues read: {len(cats)}\ntable rows read: {len(rows)}\n")
        f.write(f"references: {len(items)} ({kinds['profile']} profiles, {kinds['accessory']} accessories)\n")
        f.write(f"profiles with a sketch: {sum(1 for i in items if i.get('sketch'))}\n\n")
        f.write('== catalogues ==\n')
        for d in sorted(cats, key=lambda d: d['file']):
            p = sum(1 for r in d['rows'] if r['kind'] == 'profile')
            f.write(f"{d['file']}: {p} profiles, {len(d['rows']) - p} accessories" + (f", problems: {d['problems']}" if d['problems'] else '') + '\n')
        f.write(f"\n== cells that do not look like a reference ({len(odd)}) ==\n")
        for r in odd:
            f.write(f"{r['ref']!r}  — {r['_file']} p{r['pdf_page']} ({r['kind']}) {r.get('desc_en') or r.get('desc_es')}\n")
        f.write(f"\n== weight differs between catalogues ({len(conflicts)}) ==\n" + '\n'.join(conflicts) + '\n')
    print(open(os.path.join(out, 'report.txt'), encoding='utf-8').read()[:3000])

if __name__ == '__main__':
    main()
