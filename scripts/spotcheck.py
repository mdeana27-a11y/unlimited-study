#!/usr/bin/env python3
"""Independent check: render 30 random roster rows from the PDF, OCR them with Arabic Tesseract,
compare token-by-token with the extracted names, append results to data/roster-report.md.
Needs: pymupdf, pdfplumber, pytesseract-less CLI `tesseract` with ara data (TESSDATA_PREFIX)."""
import sys, json, re, os, csv, subprocess, tempfile, difflib, fitz, pdfplumber
ROOT = os.path.join(os.path.dirname(__file__), '..')
pdf_path = sys.argv[1]
sample = json.load(open(os.path.join(ROOT, 'data/.spot-sample.json')))
norm = lambda s: re.sub(r'[\u064B-\u0652\u0640]', '', s).replace('أ','ا').replace('إ','ا').replace('آ','ا').replace('ى','ي').replace('ة','ه')
doc, plumb = fitz.open(pdf_path), pdfplumber.open(pdf_path)
out, scores = [], []
for s in sample:
    page = plumb.pages[s['page'] - 1]
    w = next((w for w in page.extract_words() if w['text'] == s['code']), None)
    if not w: out.append((s, None, 'row not located')); continue
    clip = fitz.Rect(page.bbox[0], w['top'] - 2, page.bbox[2], w['bottom'] + 2)
    img = os.path.join(tempfile.gettempdir(), f"row_{s['code']}.png")
    doc[s['page'] - 1].get_pixmap(clip=clip, dpi=300).save(img)
    ocr = subprocess.run(['tesseract', img, '-', '-l', 'ara', '--psm', '7'], capture_output=True, text=True).stdout
    toks = [norm(t) for t in re.findall(r'[\u0600-\u06FF]+', ocr)]
    mine = [norm(t) for t in s['name'].split()]
    hit = sum(1 for t in mine if any(difflib.SequenceMatcher(None, t, o).ratio() >= .75 for o in toks))
    sc = hit / len(mine); scores.append(sc); out.append((s, sc, ' '.join(re.findall(r'[\u0600-\u06FF]+', ocr))))
avg = sum(scores) / max(1, len(scores))
# computed from the CSV (previously this line of the report was a hard-coded "0 hits")
bad_pat = re.compile(r'اال|الء|[\u064B-\u0652\u0640]')
inversion_hits = sum(1 for r in csv.DictReader(open(os.path.join(ROOT, 'data/students.csv'), encoding='utf-8-sig')) if bad_pat.search(r['name']))
low = [(s['code'], s['name'], sc, o) for s, sc, o in out if sc is not None and sc < .75]
with open(os.path.join(ROOT, 'data/roster-report.md'), 'a', encoding='utf-8') as f:
    f.write(f"\n## Spot-check (30 random rows, page render + Arabic OCR)\n\n- Rows checked: {len(out)}\n- Mean token agreement: {avg:.0%}\n- Rows below 75% agreement: {len(low)} (OCR on Arabic is imperfect; these were meant to be eyeballed)\n")
    for c, n, sc, o in low: f.write(f"  - `{c}` extracted: {n} | OCR: {o} | {sc:.0%}\n")
    f.write(f"- Lam-alef inversion scan over all names (`اال`, `الء`, tatweel, harakat): {inversion_hits} hits\n")
print(f'checked {len(out)} rows, mean agreement {avg:.0%}, low={len(low)}')
for c, n, sc, o in low: print(c, n, '|', o, f'{sc:.0%}')
