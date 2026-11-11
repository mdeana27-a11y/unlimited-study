import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fs = require('fs'); const path = require('path');
const { parse } = require('csv-parse/sync');
const rows = parse(fs.readFileSync(path.join(__dirname, '../data/students.csv'), 'utf8'), { columns: true, bom: true });
describe('roster data', () => {
  it('has 384 unique 7-digit codes', () => { expect(rows.length).toBe(384); expect(new Set(rows.map(r => r.code)).size).toBe(384); rows.forEach(r => expect(r.code).toMatch(/^\d{7}$/)); });
  it('no lam-alef inversion, no tatweel/harakat in cleaned names', () => rows.forEach(r => expect(r.name).not.toMatch(/اال|الء|[\u064B-\u0652\u0640]/)));
  it('known tricky names are logically correct', () => {
    const n = c => rows.find(r => r.code === c).name;
    expect(n('2570010')).toBe('احمد بلال اسماعيل عبدالرحمن');
    expect(n('2570062')).toBe('بسنت حسن رمضان عبدالله');
  });
  it('keeps hall and seq, and the raw extraction', () => rows.forEach(r => { expect(r.hall).toBeTruthy(); expect(+r.seq).toBeGreaterThan(0); expect(r.name_raw.length).toBeGreaterThan(5); }));
});
