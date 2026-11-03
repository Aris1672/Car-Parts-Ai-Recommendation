/**
 * lib/normalize.js -- the ONE place where model names, part numbers and VINs
 * are normalised (external review R2, 03.11).
 *
 * Contract:
 *  - latinizeCodes(s): Cyrillic letters that look like Latin ones (Х5, М3, Е70,
 *    61615А3F9D8 typed on a Russian keyboard) become Latin -- but only inside a
 *    "code" token: a run of letters/digits that contains a digit or a Latin
 *    letter and otherwise only look-alike letters. Plain Russian words («ТО»,
 *    «серия», «Купе») are never touched.
 *  - normalizeOem / normalizeVin: latinizeCodes + upper case + no spaces/dots/dashes.
 *  - extractSeries: first token of a model string, latinized, upper case
 *    ("x5 e70", "Х5 E70" -> "X5"). seriesVariants() gives the spellings the
 *    compatibility table may store ("I3" / "i3"), for an indexed "series = any(...)" query.
 *  - normalizeModel: the matching form of a whole model string (moved here
 *    unchanged from api/chat.js, plus latinizeCodes first).
 *  - norm (lib/laximo.js, wizard option matching) calls latinizeCodes too.
 * Tests: scripts/test-normalize.js (npm test).
 */

// Cyrillic look-alikes of Latin letters, both cases.
const LOOKALIKE = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};
const LOOKALIKE_RE = /[АВЕКМНОРСТУХавекмнорстух]/g;
const CODE_TOKEN_RE = /[0-9A-Za-zА-Яа-яЁё]+/g;
const ONLY_CODE_CHARS_RE = /^[0-9A-Za-zАВЕКМНОРСТУХавекмнорстух]+$/;

function latinizeCodes(s) {
  return String(s == null ? '' : s).replace(CODE_TOKEN_RE, tok =>
    /[0-9A-Za-z]/.test(tok) && ONLY_CODE_CHARS_RE.test(tok) ? tok.replace(LOOKALIKE_RE, c => LOOKALIKE[c]) : tok);
}

function normalizeOem(code) {
  return latinizeCodes(code).toUpperCase().replace(/[\s.-]/g, '');
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
function normalizeVin(vin) {
  if (!vin) return null;
  const v = latinizeCodes(vin).toUpperCase().replace(/[\s-]/g, '');
  return VIN_RE.test(v) ? v : null;
}

// Extracts BMW series from a model string. Works on both shapes in play:
// the catalog's own "3 (E46)" / "X5 Touring (E70)" style, and the extracted
// "3 E46 320i" / "X1 F48 xDrive20i" style -- both just need the first
// whitespace-delimited token once any "(...)" is stripped. Upper case and
// latinized since 03.11: "x5 e70" and "Х5 E70" (Cyrillic Х) used to give
// "x5" / "Х5" and found nothing in the table.
function extractSeries(model) {
  if (!model) return 'unknown';
  const beforeParen = String(model).split('(')[0].trim();
  const firstToken = latinizeCodes(beforeParen.split(/\s+/)[0].trim()).toUpperCase();
  return firstToken || 'unknown';
}

/** Spellings of a series the compatibility table may hold ("I3" -> I3, i3, i3 lower). */
function seriesVariants(series) {
  const s = String(series || '');
  if (!s || s === 'unknown') return [];
  return [...new Set([s, s.charAt(0).toLowerCase() + s.slice(1), s.toLowerCase()])];
}

function normalizeModel(s) {
  if (!s) return '';

  return latinizeCodes(s)
    .toUpperCase()

    // Keep chassis codes inside parentheses:
    // (E46) -> E46
    // (B8)  -> B8
    .replace(/\(([^)]*)\)/g, ' $1 ')

    // Remove punctuation
    .replace(/[^A-ZА-Я0-9\s]/g, ' ')

    // Strip BMW body-style/generation descriptor words entirely. The
    // catalog's `model` field routinely wedges a body-style word (or a
    // ", N поколение" generation marker) BETWEEN the series number and
    // the chassis code -- e.g. "1 Купе (E82)", "5 (G30) Седан, 7
    // поколение", "5 Gran Turismo (F07)". Customers never mention these
    // ("BMW 1M E82", never "BMW 1 Coupe E82") -- Haiku extracts what the
    // customer actually said, so the user's series-number and chassis end
    // up directly adjacent with nothing between them, while the catalog's
    // don't. That positional difference then interacts badly with the
    // digit+letter merge below: the user's "1"+"E82" (nothing between)
    // merges into one token "1E82", but the catalog's "1"+"Купе"+"E82"
    // never merges the same way (a Cyrillic word, not digits, precedes
    // "E82"), so "1E82" is never a substring of it. Confirmed real
    // incident: BMW 1M (E82) brake parts matched zero results this way.
    // Stripping these words here (before the merge step) means the
    // catalog's own string collapses to "1 E82" too, so it merges
    // identically to the user's version instead of diverging.
    //
    // NOTE: no \b word-boundary anchors around the Cyrillic terms --
    // JS regex's \b is defined relative to \w ([A-Za-z0-9_] only), and
    // Cyrillic letters are NOT \w characters by default, so \b silently
    // never matches next to them (confirmed by testing: \bКУПЕ\b matched
    // nothing at all, the whole clause was a no-op). Plain literal match
    // works fine here since these are distinctive enough strings.
    .replace(/КУПЕ|КАБРИОЛЕТ|СЕДАН|УНИВЕРСАЛ|ХЭТЧБЕК/g, ' ')
    .replace(/\b(TOURING|GRAN\s+COUPE|GRAN\s+TURISMO)\b/g, ' ') // Latin words -- \b works normally here
    .replace(/\d+\s*ПОКОЛЕНИЕ/g, ' ') // ", 7 поколение" etc. -- generation ordinal customers never mention

    // Strip BMW's xDrive (AWD) marker entirely before merging. It's
    // written inconsistently: catalog data spells it out as its own word
    // ("xDrive 50 i"), while customers/Haiku commonly use the colloquial
    // shorthand of a trailing "x" fused to the trim number ("50iX").
    // Confirmed real incident: user "X6 F16 50iX" normalized to
    // "X6F16 50IX", but the catalog's "X6 (F16, F86) xDrive 50 i"
    // normalized to "...XDRIVE50I" -- the trailing "X" in "50IX" has no
    // equivalent adjacent character in the catalog string (its "X" is a
    // separate word, far away after compacting), so the token never
    // matched and a correctly-catalogued part (11427583220) returned zero
    // results. Rather than try to keep xDrive/non-xDrive apart reliably
    // across both spellings, drop it from both sides -- a false positive
    // (occasionally matching a non-xDrive variant) is far less costly
    // than a false negative (telling a customer a real part isn't there).
    .replace(/\bXDRIVE/g, ' ')

    // Merge BMW style names:
    // 320 I -> 320I
    // 330 XD -> 330XD
    // 740 LI -> 740LI
    // EXCEPT standalone "M" (BMW's M-performance division, e.g. "X5 M",
    // "M3") -- unlike engine-suffix letters (i/d/xd/li), "M" is always
    // written as its own word and is never concatenated to the preceding
    // number. Merging it anyway breaks matching whenever a chassis code
    // sits between the base model number and "M" in one of the two
    // strings being compared but not the other (e.g. user says "X5 M",
    // catalog stores "X5 (E70) M" -- confirmed real incident: correctly
    // catalogued BMW X5 M records matched zero results because "X5M" is
    // not a substring of "X5E70M").
    .replace(/(\d+)\s+([A-Z]+)/g, (match, num, letters) => (letters === 'M' ? match : num + letters))

    // Strip a leftover xDrive shorthand "x" now fused to a trim number
    // (e.g. "50IX" -> "50I"), now that the word form has already been
    // removed above. Only strips when it directly follows an existing
    // digit+letter pair, so body-style prefixes like "X5"/"X6" (letter
    // before digit, not after) are untouched.
    .replace(/([0-9][A-Z])X\b/g, '$1')

    // Strip a trailing "M" fused directly onto a model number with NO
    // space in the ORIGINAL text (e.g. "1M") -- distinct from the M-merge
    // exclusion above, which only stops US from fusing a space-separated
    // "X5 M" into "X5M". Some BMW M-cars are marketed and commonly typed
    // as one fused word from the start ("1M" Coupe, unlike "X5 M" or "M3"
    // which keep a space) -- Haiku faithfully extracts it that way since
    // that's genuinely how people write it. Confirmed real incident: user
    // "1M E82" normalized/compacted to "1M E82"; the catalog stores this
    // as model "1 Купе (E82)" + modificationName "M" (separate fields,
    // chassis between them), compacting to "1КУПЕE82M" -- "1M" is not a
    // contiguous substring of that (chassis sits between the "1" and the
    // "M"), so a correctly-catalogued 1M brake part matched zero results.
    // Same tradeoff as xDrive: drop the M rather than try to keep the
    // M/non-M distinction reliable across every possible way it's written.
    .replace(/(\d+)M\b/g, '$1')

    // Remove duplicate spaces
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { latinizeCodes, normalizeOem, normalizeVin, VIN_RE, extractSeries, seriesVariants, normalizeModel };
