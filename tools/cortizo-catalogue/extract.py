"""
Cortizo catalogues -> profile and accessory lists.

Reads the Cortizo Center catalogue PDFs (one folder per group, plus index.csv, as downloaded) and
writes, per catalogue, the rows of its "Relación de perfiles / Profile list" and "Relación de
accesorios / Accessories list" tables:
    <out>/raw/<catalogue file>.json      one object per table row
    <out>/sketches/<ref>__<file>_p<page>.png   the profile's DESIGN cell, trimmed (profiles only)
Then `build.py` merges them into one record per reference.

    python3 extract.py "<catalogue folder>" "<out folder>" [file filter]

Needs pdfplumber, pypdfium2 and Pillow. Each catalogue is independent, so they run in parallel.
"""
import csv, json, os, re, sys, traceback
from multiprocessing import Pool

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageChops

SKETCH_DPI = 400

def norm(s):
    return re.sub(r'\s+\.$', '', re.sub(r'\s+', ' ', s or '').strip())

def page_kind(text):
    """'profiles', 'accessories' or None, from the page's plain text."""
    t = text.upper()
    if not ('REFERENCIA' in t or 'REFERENCE' in t):
        return None
    titled = 'RELACIÓN DE PERFILES' in t or 'PROFILE LIST' in t or 'PROFILES LIST' in t
    if ('DISEÑO' in t or 'DESIGN' in t) and ('PESO' in t or 'WEIGHT' in t):
        return 'profiles' if titled else 'profiles?'
    if ('COLOR' in t or 'COLOUR' in t) and ('TIPO' in t or 'TYPE' in t) and ('RELACIÓN DE ACCESORIOS' in t or 'ACCESSORIES LIST' in t):
        return 'accessories'
    return None

def is_grey(w):
    c = w.get('non_stroking_color')
    if not c:
        return False
    try:
        vals = [float(v) for v in (c if isinstance(c, (list, tuple)) else [c])]
    except (TypeError, ValueError):
        return False
    if len(vals) == 4:            # CMYK: grey = low ink, no strong K
        return vals[3] < 0.6 and max(vals[:3]) < 0.3
    return min(vals) > 0.3

def cluster(vals, gap):
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]

HEADER = {
    'ref': ('REFERENCIA', 'REFERENCE'),
    'design': ('DISEÑO', 'DESIGN'),
    'desc': ('DESCRIPCIÓN', 'DESCRIPTION'),
    'weight': ('PESO', 'WEIGHT'),
    'surface': ('SUPERF.', 'SURFACE', 'SUPERF'),
    'page': ('PÁG', 'PAG'),
    'colour': ('COLOR', 'COLOUR'),
    'type': ('TIPO', 'TYPE'),
}

def lines_of(words):
    """Words -> list of (text, grey) lines, top to bottom."""
    rows = []
    for w in sorted(words, key=lambda w: (round(w['top']), w['x0'])):
        if rows and abs(w['top'] - rows[-1][0]) < 2.5 and is_grey(w) == rows[-1][2]:
            rows[-1][1].append(w)
        else:
            rows.append([w['top'], [w], is_grey(w)])
    return [(norm(' '.join(x['text'] for x in sorted(ws, key=lambda x: x['x0']))), g) for _, ws, g in rows]

def split_lang(words):
    """(primary, secondary): dark text and grey text of a cell."""
    ls = lines_of(words)
    return norm(' '.join(t for t, g in ls if not g)), norm(' '.join(t for t, g in ls if g))

def num(s):
    s = norm(s).replace(' ', '')
    if not s or s in ('-', '–'):
        return None
    s = s.replace('.', '').replace(',', '.') if re.match(r'^\d{1,3}(\.\d{3})+(,\d+)?$', s) else s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None

def trim(img):
    g = img.convert('L')
    bg = Image.new('L', g.size, 255)
    diff = ImageChops.difference(g, bg).point(lambda p: 255 if p > 18 else 0)
    box = diff.getbbox()
    if not box:
        return None
    l, t, r, b = box
    return g.crop((max(0, l - 4), max(0, t - 4), min(g.width, r + 4), min(g.height, b + 4)))

def parse_page(page, kind, primary_lang):
    words = page.extract_words(extra_attrs=['non_stroking_color', 'size'], keep_blank_chars=False)
    ref_head = [w for w in words if w['text'].upper() in HEADER['ref']]
    if not ref_head:
        return [], 'no header'
    head_top = min(w['top'] for w in ref_head)
    head_words = [w for w in words if head_top - 8 <= w['top'] <= head_top + 16]
    # table borders
    vx = [e['x0'] for e in page.edges if e['orientation'] == 'v' and e['bottom'] > head_top + 20 and e['height'] > 8]
    hy = [e['top'] for e in page.edges if e['orientation'] == 'h' and e['top'] > head_top + 6 and e['width'] > 15]
    cols = cluster(vx, 4)
    if len(cols) < 4:
        return [], 'no column lines'
    # name the columns from the header words
    names = {}
    for w in head_words:
        key = next((k for k, vs in HEADER.items() if w['text'].upper() in vs), None)
        if not key:
            continue
        cx = (w['x0'] + w['x1']) / 2
        for i in range(len(cols) - 1):
            if cols[i] <= cx < cols[i + 1]:
                names.setdefault(key, (cols[i], cols[i + 1]))
    need = ('ref', 'desc', 'page') + (('design',) if kind == 'profiles' else ('colour', 'type'))
    if any(k not in names for k in need):
        return [], 'columns not found: ' + ','.join(k for k in need if k not in names)
    ys = cluster(hy, 2.5)
    head_bottom = max(w['bottom'] for w in head_words)
    ys = [y for y in ys if y >= head_bottom - 1]
    rows = []
    for top, bot in zip(ys, ys[1:]):
        if bot - top < 9:
            continue
        cell = lambda k: [w for w in words if top < (w['top'] + w['bottom']) / 2 < bot and names[k][0] <= (w['x0'] + w['x1']) / 2 < names[k][1]]
        ref = norm(' '.join(w['text'] for w in sorted(cell('ref'), key=lambda w: (round(w['top']), w['x0']))))
        if not ref or ref.upper() in HEADER['ref']:
            continue
        p1, p2 = split_lang(cell('desc'))
        es, en = (p1, p2) if primary_lang == 'es' else (p2, p1)
        pg = re.findall(r'\d+', ' '.join(w['text'] for w in cell('page')))
        r = {'ref': ref, 'desc_es': es, 'desc_en': en, 'cat_page': int(pg[0]) if pg else None,
             'bbox': [round(top, 1), round(bot, 1)]}
        if kind == 'profiles':
            r['weight_g_m'] = num(' '.join(w['text'] for w in cell('weight'))) if 'weight' in names else None
            r['surface_dm2_m'] = num(' '.join(w['text'] for w in cell('surface'))) if 'surface' in names else None
            r['design_x'] = [round(names['design'][0], 1), round(names['design'][1], 1)]
        else:
            c1, c2 = split_lang(cell('colour'))
            t1, t2 = split_lang(cell('type'))
            r['colour_es'], r['colour_en'] = (c1, c2) if primary_lang == 'es' else (c2, c1)
            r['type_es'], r['type_en'] = (t1, t2) if primary_lang == 'es' else (t2, t1)
        rows.append(r)
    return rows, None

def safe(s):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', s)[:80]

def do_catalogue(args):
    path, rel, meta, out = args
    stem = os.path.splitext(os.path.basename(path))[0]
    res = {'file': rel, 'system': meta.get('System'), 'group': meta.get('Group'), 'version': meta.get('Version date'),
           'pages': {}, 'rows': [], 'problems': []}
    try:
        doc = pdfium.PdfDocument(path)
        kinds = {}
        for i in range(len(doc)):
            tp = doc[i].get_textpage()
            k = page_kind(tp.get_text_range())
            tp.close()
            if k:
                kinds[i] = k
        primary_lang = 'en' if stem.endswith('_EN') else 'es'
        sk_dir = os.path.join(out, 'sketches')
        with pdfplumber.open(path) as pdf:
            for i, k in kinds.items():
                page = pdf.pages[i]
                rows, problem = parse_page(page, k.rstrip('?'), primary_lang)
                if k.endswith('?'):           # a profile-like table without the list title: keep only if it parses
                    if problem or not rows:
                        continue
                    k = 'profiles'
                res['pages'][i + 1] = {'kind': k, 'rows': len(rows)}
                if problem:
                    res['problems'].append({'page': i + 1, 'kind': k, 'problem': problem})
                for r in rows:
                    r.update(kind='profile' if k == 'profiles' else 'accessory', pdf_page=i + 1)
                    if k == 'profiles':
                        x0, x1 = r.pop('design_x')
                        t, b = r['bbox']
                        scale = SKETCH_DPI / 72
                        bmp = doc[i].render(scale=scale, crop=(x0 + 1.5, page.height - b + 1.5, page.width - x1 + 1.5, t + 1.5))
                        img = trim(bmp.to_pil())
                        if img is not None:
                            name = f"{safe(r['ref'])}__{safe(stem)}_p{i + 1}.png"
                            img.save(os.path.join(sk_dir, name), optimize=True)
                            r['sketch'] = name
                    res['rows'].append(r)
    except Exception as e:
        res['problems'].append({'error': repr(e), 'trace': traceback.format_exc()[-800:]})
    with open(os.path.join(out, 'raw', safe(stem) + '.json'), 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    prof = sum(1 for r in res['rows'] if r['kind'] == 'profile')
    acc = len(res['rows']) - prof
    return f"{rel}: {prof} profiles, {acc} accessories, {len(res['problems'])} problem(s)"

def main():
    src, out = sys.argv[1], sys.argv[2]
    flt = sys.argv[3] if len(sys.argv) > 3 else ''
    os.makedirs(os.path.join(out, 'raw'), exist_ok=True)
    os.makedirs(os.path.join(out, 'sketches'), exist_ok=True)
    meta = {}
    with open(os.path.join(src, 'index.csv'), encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            meta[r['File'].replace('\\', '/')] = r
    done = lambda rel: os.path.exists(os.path.join(out, 'raw', safe(os.path.splitext(os.path.basename(rel))[0]) + '.json'))
    jobs = [(os.path.join(src, rel), rel, m, out) for rel, m in meta.items() if flt.lower() in rel.lower() and not done(rel)]   # resumes: done catalogues are skipped
    print(f'{len(jobs)} catalogue(s) to read', flush=True)
    jobs.sort(key=lambda j: -os.path.getsize(j[0]))   # big ones first
    with Pool(max(1, (os.cpu_count() or 2) - 2)) as pool:
        for line in pool.imap_unordered(do_catalogue, jobs):
            print(line, flush=True)

if __name__ == '__main__':
    main()
