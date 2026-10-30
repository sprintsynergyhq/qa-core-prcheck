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
// Inside a URL (http:// or https://, any case, up to the next whitespace) neither gets a zero width space:
// the space would become part of the autolinked address and could break its #anchor. A # before a digit
// there gets only the backslash, as before PR 7. GFM 6.9 (extended autolinks) says a URL autolink is
// http:// or https:// with a valid domain, then non space, non < characters:
// https://github.github.com/gfm/#autolinks-extension-
// Whether GitHub keeps the backslash out of the link address is not confirmed; it is a live check.
const ZERO_WIDTH_SPACE = '&#8203;';
const ASCII_DIGIT = /^[0-9]$/;
const GH = /^[Gg][Hh]$/;
const WHITESPACE = /^\s$/;
const URL_STARTS = ['http://', 'https://'];

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

/** For each code point of chars, true when it is part of a URL: from http:// or https:// (any case) to the next whitespace. */
function urlMask(chars: string[]): boolean[] {
  const mask: boolean[] = [];
  let inUrl = false;
  for (let i = 0; i < chars.length; i++) {
    if (WHITESPACE.test(chars[i]!)) inUrl = false;
    else if (!inUrl) {
      inUrl = URL_STARTS.some((start) => chars.slice(i, i + start.length).join('').toLowerCase() === start);
    }
    mask.push(inUrl);
  }
  return mask;
}

/**
 * Text for a paragraph, list item or table cell. Markdown characters get a backslash, & < > become
 * entities, @ and $ are written so they cannot mention anyone or start math, a # or the - of GH- before
 * a digit gets a zero width space so it should not start an issue reference (not inside a URL, where a
 * # before a digit gets only the backslash), every line break becomes one space, and a leading list
 * marker (-, +, 1. or 1)) is escaped so a list item cannot nest a list.
 */
export function escapeText(text: string): string {
  const chars = Array.from(oneLine(text));
  const inUrl = urlMask(chars);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const beforeDigit = ASCII_DIGIT.test(chars[i + 1] ?? '') && !inUrl[i];
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
