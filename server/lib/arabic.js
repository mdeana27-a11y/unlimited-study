// Comparison-only normalisation. Never store the normalised form as the display name.
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const TASHKEEL = /[\u064B-\u065F\u0670\u0640]/g;            // harakat, dagger alef, tatweel
// Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> ASCII, so a code typed on an Arabic keyboard still matches.
const toAsciiDigits = s => String(s).replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x0660).replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 0x06F0);
function normalizeArabic(input = '') {
  return toAsciiDigits(String(input).replace(ZERO_WIDTH, ''))
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
// "عبد الرحمن" vs "عبدالرحمن" is the most common harmless variation, so we compare
// token lists in order AND, as a fallback, the space-stripped strings (same letters, same order).
function namesMatch(typed, storedNormalized) {
  const a = normalizeArabic(typed);
  if (!a) return false;
  return a === storedNormalized || a.replace(/ /g, '') === storedNormalized.replace(/ /g, '');
}
module.exports = { normalizeArabic, namesMatch, toAsciiDigits };
