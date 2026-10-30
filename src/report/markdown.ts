// Markdown building blocks for the summary. Pure. Every value that comes from the PR (test titles,
// projects, errors, reasons, warnings and paths) goes through one of these before it reaches Markdown.

// Longest text kept in one table cell or list item, in characters (code points). Longer text is cut
// and ends in "...". A chosen limit, not a measurement.
export const CELL_MAX_CHARS = 300;

// A plain @ becomes &#64; plus a zero width space (&#8203;), so the Markdown holds no @ and no name
// follows one directly. GitHub's docs do not say how to stop a mention. Muhammad's live check on PR #14:
// @ and $x$ rendered as plain text in the PR comment and in the job summary.
const AT = '&#64;&#8203;';

// A zero width space after the # of #26 and after the - of GH-26, so no issue or pull request
// reference can start. GitHub's docs list #26, GH-26 and owner/repo#26 (the last is covered by the #):
// https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls
// The same live check showed that a backslash alone does not stop #1 in a PR comment. That the zero
// width space stops it is not confirmed, so PR 7 checks it live.
const ZERO_WIDTH_SPACE = '&#8203;';
const ASCII_DIGIT = /^[0-9]$/;
const GH = /^[Gg][Hh]$/;
const WHITESPACE = /^\s$/;

// URLs (PR 7b). GFM 6.9 (extended autolinks, https://github.github.com/gfm/#autolinks-extension-)
// links http:// and https:// URLs in plain text. GitHub's cmark-gfm takes the link address from the
// raw Markdown (extensions/autolink.c, url_match: cmark_chunk_dup of the source), so a backslash
// escape stays in the address: on PR #19 the text https://example.com/docs\#1-intro became the href
// https://example.com/docs%5C#1-intro. So a URL that url_match would link is written raw, with no
// backslash and no zero width space, from its scheme to the next whitespace or $. Inside it:
// - left raw: every other character, including # _ * ~ [ ] \ ( ) ! > and an & that does not
//   start something like an entity;
// - a backtick keeps its backslash: two raw backticks in two URLs would make a code span, which stops
//   the second autolink and would leave the rest of that URL (a [text](address) link, say) as Markdown;
// - | becomes \| (a table cell needs it; GFM tables remove that backslash before inline parsing, so
//   in a table the address keeps the |), and a \ just before a | or at the end of the URL becomes \\
//   (so it cannot escape the | or the <span> of a $ that ends the URL);
// - < becomes &lt; (a raw < could start HTML), and an & followed by an entity-like run (&lt; &#64;
//   &#x40;) becomes &amp;, so the address shows that text literally;
// - @ and $ are written as everywhere else, and a $ ends the URL, because its <span> would end the
//   link and leave the rest of the URL as plain Markdown.
// The checks mirror url_match: the scheme (any case) has no ASCII letter just before it, the first
// character after :// is not a space or punctuation, and no _ is in the last two parts of the domain
// (check_domain). Anything else is escaped as plain text.
const URL_STARTS = ['http://', 'https://'];
const ASCII_LETTER = /^[A-Za-z]$/;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const UNICODE_PUNCTUATION = /^\p{P}$/u;
const ENTITY_LIKE = /^&#?[A-Za-z0-9]+;/;
// Punctuation that check_domain reads past: - . _, and \ with | because a | is written \|.
const DOMAIN_PUNCTUATION = new Set(['-', '.', '_', '\\', '|']);

// GitHub renders the text between two $ signs as math, and its docs write a plain $ as <span>$</span>:
// https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions
const DOLLAR = '<span>$</span>';

// ASCII punctuation that may be escaped with a backslash (GFM spec, section 6.1).
const BACKSLASHED = new Set(['\\', '`', '*', '_', '[', ']', '#', '|', '~']);

const LINE_BREAKS = /\r\n|\r|\n/g;

/** The text on one line: every line break becomes one space. */
function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, ' ');
}

/** True for a space or punctuation, as cmark-gfm's is_valid_hostchar sees it (it is false for those). */
function notHostChar(char: string): boolean {
  return WHITESPACE.test(char) || ASCII_PUNCTUATION.test(char) || UNICODE_PUNCTUATION.test(char);
}

/** True when cmark-gfm's check_domain accepts the domain at the start of out (the text after ://). */
function domainOk(out: string[]): boolean {
  if (out.length === 0 || notHostChar(out[0]!)) return false;
  let periods = 0;
  let underscores1 = 0;
  let underscores2 = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i] === '\\' && i < out.length - 1) i++;
    const char = out[i]!;
    if (char === '_') underscores2++;
    else if (char === '.') {
      underscores1 = underscores2;
      underscores2 = 0;
      periods++;
    } else if (notHostChar(char) && char !== '-') break;
  }
  // check_domain accepts underscores anyway past 10 periods (a guard against slow input).
  return (underscores1 === 0 && underscores2 === 0) || periods > 10;
}

/** The raw Markdown for the URL chars (scheme to the next whitespace or $), as the rules above say. */
function urlText(chars: string[]): string {
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    if (char === '|') out += '\\|';
    else if (char === '`') out += '\\`';
    else if (char === '\\' && (chars[i + 1] === '|' || i === chars.length - 1)) out += '\\\\';
    else if (char === '<') out += '&lt;';
    else if (char === '&' && ENTITY_LIKE.test(chars.slice(i, i + 40).join(''))) out += '&amp;';
    else if (char === '@') out += AT;
    else out += char;
  }
  return out;
}

/**
 * For each code point of chars, the end (exclusive) of the URL that starts there, or -1. A URL starts at
 * http:// or https:// (any case) with no ASCII letter just before it, runs to the next whitespace or $,
 * and counts only when cmark-gfm would link it (see the rules above).
 */
function urlEnds(chars: string[]): number[] {
  const ends: number[] = new Array<number>(chars.length).fill(-1);
  // stop[i]: the first index at or after i that is whitespace or $ (chars.length when none).
  const stop: number[] = new Array<number>(chars.length + 1).fill(chars.length);
  for (let i = chars.length - 1; i >= 0; i--) stop[i] = WHITESPACE.test(chars[i]!) || chars[i] === '$' ? i : stop[i + 1]!;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== 'h' && chars[i] !== 'H') continue;
    if (i > 0 && ASCII_LETTER.test(chars[i - 1]!)) continue;
    const start = URL_STARTS.find((scheme) => chars.slice(i, i + scheme.length).join('').toLowerCase() === scheme);
    if (start === undefined) continue;
    const end = stop[i]!;
    // Only the domain matters here: up to the first character that surely ends it, so a long text
    // full of URL starts stays linear.
    let domainEnd = i + start.length;
    while (domainEnd < end && !(notHostChar(chars[domainEnd]!) && !DOMAIN_PUNCTUATION.has(chars[domainEnd]!))) domainEnd++;
    if (domainOk(Array.from(urlText(chars.slice(i + start.length, Math.min(end, domainEnd + 1)))))) {
      ends[i] = end;
      i = end - 1;
    }
  }
  return ends;
}

/**
 * Text for a paragraph, list item or table cell. Markdown characters get a backslash, & < > become
 * entities, @ and $ are written so they cannot mention anyone or start math, a # or the - of GH- before
 * a digit gets a zero width space so it should not start an issue reference, every line break becomes
 * one space, and a leading list marker (-, +, 1. or 1)) is escaped so a list item cannot nest a list.
 * A URL that GitHub autolinks is written raw instead, with the few exceptions listed above.
 */
export function escapeText(text: string): string {
  const chars = Array.from(oneLine(text));
  const urlEnd = urlEnds(chars);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const end = urlEnd[i]!;
    if (end !== -1) {
      out += urlText(chars.slice(i, end));
      i = end - 1;
      continue;
    }
    const char = chars[i]!;
    const beforeDigit = ASCII_DIGIT.test(chars[i + 1] ?? '');
    if (char === '#' && beforeDigit) out += `\\#${ZERO_WIDTH_SPACE}`;
    else if (char === '-' && beforeDigit && GH.test(`${chars[i - 2] ?? ''}${chars[i - 1] ?? ''}`)) out += `-${ZERO_WIDTH_SPACE}`;
    else if (BACKSLASHED.has(char)) out += `\\${char}`;
    else if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (char === '@') out += AT;
    else if (char === '$') out += DOLLAR;
    else out += char;
  }
  return out.replace(/^([-+])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * An inline code span for a table cell. The backtick fence is one longer than the longest run of
 * backticks in the text (CommonMark), so the text cannot close it. A space pads both sides when the
 * text starts or ends with a backtick or a space, because CommonMark removes one such space from each
 * side. A | is escaped, which GFM tables undo inside code spans too; line breaks become spaces.
 */
export function codeSpan(text: string): string {
  const inner = oneLine(text).split('|').join('\\|');
  const longest = (inner.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(inner) ? ' ' : '';
  return `${fence}${pad}${inner}${pad}${fence}`;
}

/**
 * escapeText for one table cell or list item, cut at max characters first and ended with "...".
 * The cut comes first so an entity is never split, and it counts code points so a surrogate pair is
 * never split.
 */
export function cell(text: string, max: number = CELL_MAX_CHARS): string {
  const chars = Array.from(oneLine(text));
  return escapeText(chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join(''));
}

/** "1 test", "2 tests", "0 tests". */
export function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}
