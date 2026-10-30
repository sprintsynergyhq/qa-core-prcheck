// Missing test suggestions: fixed rules over the decisions of src/impact/map.ts. Pure: no file system,
// no environment, no clock. Advisory only: a suggestion never changes a selected spec, a mode, a
// verdict or an exit code, and nothing here writes a test file.
//
//   unmapped-file       rule 11 decided an app-source or test-support file
//   unimported-support  rule 8 decided a support or data script that no spec imports
//   untagged-area       rule 9 gave full: no test has the tag of the matching area
//   unused-member       rule 5 decided a test-support file, and a member declared on one of its added
//                       lines is used by no file that imports it, directly or through other files
//
// A path with status deleted never gets one, so neither does the old path of a rename.

import type { LineRange } from '../diff/index.js';
import { CONFIG_FILE } from '../impact/config.js';
import { findImportedNames } from '../impact/imports.js';
import type { ChangedMember, MemberKind, SuggestEntry, SuggestInput, Suggestion, SuggestionKind } from './types.js';

const KIND_ORDER: SuggestionKind[] = ['unmapped-file', 'unimported-support', 'untagged-area', 'unused-member'];

// Declarations, matched one line at a time from the start of the line. The modifier lists leave out
// private and protected, so those members never match. Text matching, not a parser.
const FUNCTION_DECLARATION = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\(/;
const PROPERTY_DECLARATION = /^\s*(?:(?:public|static)\s+)*readonly\s+([A-Za-z_$#][\w$]*)\s*[:=]/;
const METHOD_DECLARATION = /^\s*(?:(?:public|static|async)\s+)*([A-Za-z_$#][\w$]*)\(/;
// A method line also needs a body: the line ends in {, or a { follows the parameter list (with no
// nested parentheses) and an optional return type, as in the one line async open() { ... }. A call
// such as logStep('x', () => { has a ( inside its arguments, so it never matches this pattern.
const SIGNATURE_THEN_BRACE = /^\s*(?:(?:public|static|async)\s+)*[A-Za-z_$#][\w$]*\([^()]*\)\s*(?::[^(){};=]*)?\{/;
// Words that can start a line followed by ( but declare no member.
const NOT_MEMBERS = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'super']);

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return compareText(a.file, b.file) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareText(a.reason, b.reason);
}

function member(name: string, kind: MemberKind): { name: string; kind: MemberKind } | null {
  return NOT_MEMBERS.has(name) || name.startsWith('_') || name.startsWith('#') ? null : { name, kind };
}

/** The member a line declares, or null. */
function memberOn(line: string): { name: string; kind: MemberKind } | null {
  const fn = line.match(FUNCTION_DECLARATION);
  if (fn !== null) return member(fn[1]!, 'function');
  const property = line.match(PROPERTY_DECLARATION);
  if (property !== null) return member(property[1]!, 'property');
  // A line that ends in ; is a statement, such as a call, not a method with a body.
  if (line.trimEnd().endsWith(';')) return null;
  // Without semicolons a call line such as logStep('checkout') looks like a method; a method line
  // opens its body with { on the same line.
  if (!line.trimEnd().endsWith('{') && !SIGNATURE_THEN_BRACE.test(line)) return null;
  const method = line.match(METHOD_DECLARATION);
  return method === null ? null : member(method[1]!, 'method');
}

/**
 * The members declared on the lines inside ranges, in line order: class methods (name(, async, static
 * and public, with { on the same line), readonly properties and exported functions. Skips the
 * constructor, private, protected, names that start with _ or #, a few keywords, lines that end in ;
 * and a method name that the file binds with import, such as a call logStep('x', async () => { to an
 * imported helper. A signature split over lines with no { on its first line is not seen.
 */
export function findChangedMembers(text: string, ranges: LineRange[]): ChangedMember[] {
  const lines = text.split('\n');
  const wanted = new Set<number>();
  for (const range of ranges) {
    for (let n = Math.max(range.start, 1); n <= Math.min(range.end, lines.length); n++) wanted.add(n);
  }
  const members: ChangedMember[] = [];
  let imported: Set<string> | null = null;
  for (const n of [...wanted].sort((a, b) => a - b)) {
    const found = memberOn(lines[n - 1]!.replace(/\r$/, ''));
    if (found === null) continue;
    if (found.kind === 'method') {
      imported ??= new Set(findImportedNames(text));
      if (imported.has(found.name)) continue;
    }
    members.push({ ...found, line: n });
  }
  return members;
}

/**
 * True when one of texts reads or calls .name, or calls name( directly. An assignment (.name = but not
 * ==, === or =>) is not a use, so the constructor line that sets a property does not count.
 */
export function isMemberUsed(name: string, texts: string[]): boolean {
  const escaped = name.split('$').join('\\$');
  const use = new RegExp(`\\.${escaped}(?![\\w$])(?!\\s*=(?![=>]))|(?<![\\w$])${escaped}\\(`);
  return texts.some((text) => use.test(text));
}

function unusedMembers(entry: SuggestEntry, texts: ReadonlyMap<string, string>): Suggestion[] {
  const file = entry.decision.path;
  const text = texts.get(file);
  const importerTexts = entry.importers.map((importer) => texts.get(importer));
  // Without every text, no member can be shown to be unused.
  if (text === undefined || importerTexts.some((t) => t === undefined)) return [];
  const lines = text.split('\n');
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { name, line, kind } of findChangedMembers(text, entry.ranges)) {
    if (seen.has(name)) continue;
    seen.add(name);
    // The declaring line names the member itself, so it is left out of the file's own text.
    const own = [...lines.slice(0, line - 1), ...lines.slice(line)].join('\n');
    if (isMemberUsed(name, [own, ...(importerTexts as string[])])) continue;
    suggestions.push({
      file,
      kind: 'unused-member',
      reason: `${name} was added or changed here, and no file that imports this one uses it.`,
      idea: kind === 'property' ? `Add a test that uses ${name}.` : `Add a test that calls ${name}.`,
    });
  }
  return suggestions;
}

function suggestionsFor(entry: SuggestEntry, texts: ReadonlyMap<string, string>): Suggestion[] {
  const { decision, rule, area } = entry;
  const file = decision.path;
  if (decision.status === 'deleted') return [];
  if (rule === 11 && (decision.fileClass === 'app-source' || decision.fileClass === 'test-support')) {
    return [{
      file,
      kind: 'unmapped-file',
      reason: 'No rule or spec maps this file, so it falls back to the full suite.',
      idea: `Add a spec that covers the behaviour in ${file}, or map it to a tag with an area in ${CONFIG_FILE}.`,
    }];
  }
  if (rule === 8) {
    return [{
      file,
      kind: 'unimported-support',
      reason: 'No spec imports this file.',
      idea: `Add a spec that imports ${file} and uses it, or remove the file if nothing needs it.`,
    }];
  }
  if (rule === 9 && decision.outcome === 'full' && area !== null) {
    return [{
      file,
      kind: 'untagged-area',
      reason: `Area "${area.glob}" matches this file, but no test has tag ${area.tag}.`,
      idea: `Add a test tagged ${area.tag} that covers ${file}.`,
    }];
  }
  if (rule === 5 && decision.fileClass === 'test-support') return unusedMembers(entry, texts);
  return [];
}

/** The suggestions for every entry, sorted by file, then kind, then reason, one per file, kind and reason. */
export function suggestTests(input: SuggestInput): Suggestion[] {
  const all = input.entries.flatMap((entry) => suggestionsFor(entry, input.texts)).sort(compareSuggestions);
  return all.filter((s, i) => i === 0 || compareSuggestions(s, all[i - 1]!) !== 0);
}
