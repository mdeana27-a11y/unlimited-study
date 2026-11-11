#!/usr/bin/env python3
"""Roster PDF -> data/students.csv + data/roster-report.md  (reproducible, idempotent).
Why chars and not text: the PDF stores lam-alef as ONE glyph ("لا"). Reversing the extracted
*string* swaps it into "ال" (بلال -> بالل). We reverse the list of glyphs instead.
Usage: python3 scripts/extract-roster.py <roster.pdf>"""
import sys, re, csv, json, random, collections, pdfplumber, os
ROOT = os.path.join(os.path.dirname(__file__), '..')
pdf_path = sys.argv[1]
rows, seen_codes, dup_events = [], collections.defaultdict(list), []
last_hall = None

def hall_of(text):
    t = text.replace('\u200f', '')
    m = re.search(r'SEM\s*(\d)', t)
    if m: return f'F-SEM{m.group(1)}'
    m = re.search(r'A\s*(\d{1,3})|(\d{1,3})\s*A', t)
    return f'A{m.group(1) or m.group(2)}' if m else None

def logical(chars):
    # visual left-to-right glyphs -> logical RTL order = descending x
    s = ''.join(c['text'] for c in sorted(chars, key=lambda c: -c['x0']))
    return re.sub(r'\s+', ' ', s.replace('\u0640', '')).strip()

with pdfplumber.open(pdf_path) as pdf:
    n_pages = len(pdf.pages)
    for pno, page in enumerate(pdf.pages, 1):
        hall = hall_of(page.extract_text() or '') or last_hall   # continuation pages carry no header
        last_hall = hall
        for tb in page.find_tables():
            for r in tb.rows:
                cells = [c for c in r.cells if c]
                texts = []
                for bb in cells:
                    ch = page.crop(bb).chars
                    texts.append((''.join(c['text'] for c in ch).strip(), ch))
                code = next((t for t, _ in texts if re.fullmatch(r'\d{7}', t)), None)
                if not code: continue
                seq = next((int(t) for t, _ in texts if re.fullmatch(r'\d{1,3}', t)), None)
                name_ch = [ch for t, ch in texts if ch and not re.fullmatch(r'\d+', t) and any('\u0600' <= c['text'][0] <= '\u06FF' for c in ch)]
                if not name_ch: continue
                raw = ''.join(c['text'] for c in name_ch[0]).strip()       # as the PDF emits it (visual order)
                rec = dict(code=code, name=logical(name_ch[0]), name_raw=raw, hall=hall, seq=seq, page=pno)
                seen_codes[code].append(rec)

# one record per unique code; keep first occurrence, remember conflicts
students, conflicts = [], []
for code, recs in seen_codes.items():
    names = {r['name'] for r in recs}
    if len(names) > 1: conflicts.append((code, names))
    students.append(recs[0])
students.sort(key=lambda r: (r['seq'] or 0, r['code']))
dups = {c: [(r['page'], r['hall'], r['seq']) for r in v] for c, v in seen_codes.items() if len(v) > 1}

by_name = collections.defaultdict(list)
for s in students: by_name[s['name']].append(s['code'])
same_name = {n: c for n, c in by_name.items() if len(c) > 1}
bad_pat = re.compile(r'اال|الء|[\u064B-\u0652\u0640]')           # inversion / stray marks
suspicious = [s for s in students if bad_pat.search(s['name']) or len(s['name'].split()) < 3 or len(s['code']) != 7]
non_2570 = [s['code'] for s in students if not s['code'].startswith('2570')]

os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
with open(os.path.join(ROOT, 'data/students.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f); w.writerow(['code', 'name', 'name_raw', 'hall', 'seq'])
    for s in students: w.writerow([s['code'], s['name'], s['name_raw'], s['hall'], s['seq']])

# spot-check sample (rendered + OCR'd by scripts/spotcheck.py, which reads this file)
random.seed(7)
json.dump(random.sample(students, 30), open(os.path.join(ROOT, 'data/.spot-sample.json'), 'w'), ensure_ascii=False)

halls = collections.Counter(s['hall'] for s in students)
with open(os.path.join(ROOT, 'data/roster-report.md'), 'w', encoding='utf-8') as f:
    f.write(f"# Roster report\n\nSource: `{os.path.basename(pdf_path)}`\n\n- Pages: {n_pages}\n- Code-bearing rows scanned: {sum(len(v) for v in seen_codes.values())}\n- **Unique student codes: {len(students)}**\n- Codes seen more than once: {len(dups)}\n- Codes with conflicting names: {len(conflicts)}\n- Names shared by 2+ codes: {len(same_name)}\n- Codes outside `2570xxx` (older cohorts, valid): {len(non_2570)}\n- Suspicious rows (inversion pattern / <3 name tokens / bad code): {len(suspicious)}\n\n## Per hall\n\n| Hall | Students |\n|---|---|\n")
    for h, c in sorted(halls.items(), key=lambda x: str(x[0])): f.write(f"| {h} | {c} |\n")
    f.write("\n## Duplicated codes (page, hall, seq)\n\n")
    f.write('\n'.join(f"- `{c}`: {v}" for c, v in sorted(dups.items())) or 'None')
    f.write("\n\n## Same name under different codes\n\n" + ('\n'.join(f"- {n}: {c}" for n, c in same_name.items()) or 'None'))
    f.write("\n\n## Same code under different names\n\n" + ('\n'.join(f"- `{c}`: {n}" for c, n in conflicts) or 'None'))
    f.write("\n\n## Suspicious rows\n\n" + ('\n'.join(f"- `{s['code']}` {s['name']}" for s in suspicious) or 'None'))
    f.write("\n\n## Older-range codes\n\n" + ', '.join(f'`{c}`' for c in non_2570) + "\n")
print(len(students), 'unique;', len(dups), 'dup codes;', len(conflicts), 'conflicts;', len(suspicious), 'suspicious')
