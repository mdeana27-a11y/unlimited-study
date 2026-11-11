import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { normalizeArabic, namesMatch } = require('../server/lib/arabic');
describe('normalizeArabic', () => {
  it('unifies hamza, ya, ta marbuta, strips tashkeel/tatweel/zero-width', () => {
    expect(normalizeArabic('أَحْمَد')).toBe('احمد');
    expect(normalizeArabic('مصطفى')).toBe('مصطفي');
    expect(normalizeArabic('فاطمة')).toBe('فاطمه');
    expect(normalizeArabic('عبدالـلـه')).toBe('عبدالله');
    expect(normalizeArabic('a\u200Fb')).toBe('ab');
  });
  it('converts Arabic-Indic digits and collapses whitespace', () => {
    expect(normalizeArabic('  ٢٥٧٠٠٠١   x ')).toBe('2570001 x');
  });
  it('namesMatch tolerates spacing of compound names but not different letters', () => {
    const stored = normalizeArabic('احمد عبدالرحمن محمد علي');
    expect(namesMatch('أحمد عبد الرحمن محمد على', stored)).toBe(true);
    expect(namesMatch('احمد عبدالرحمن محمد حسن', stored)).toBe(false);
    expect(namesMatch('', stored)).toBe(false);
  });
});
