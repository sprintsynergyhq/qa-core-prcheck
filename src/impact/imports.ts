// Finds module specifiers, and the local names that import declarations bind, in TypeScript and
// JavaScript source without a parser. A scanner walks the text once and turns it into tokens.
// Comments are dropped, and the text inside strings, template literals and regular expression
// literals never becomes code tokens. A second pass reads the import, export and require forms
// from the tokens.

type Token =
  | { kind: 'name'; value: string }
  | { kind: 'punct'; value: string }
  | { kind: 'string'; value: string }   // a quoted string, or a template literal without placeholders
  | { kind: 'other' };                   // a template literal with placeholders, or a regular expression literal

const NAME_CHAR = /[\w$]/;

// After these words a / starts a regular expression, not a division.
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
  'yield', 'await', 'export', 'import', 'default', 'extends',
]);

// "export" followed by one of these declares something; it is not a re-export.
const NOT_A_REEXPORT = new Set([
  'function', 'class', 'const', 'let', 'var', 'default', 'interface', 'enum', 'namespace', 'module',
  'declare', 'abstract', 'async', 'as',
]);

function isSpace(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x20 || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029;
}

function isNameChar(char: string): boolean {
  return NAME_CHAR.test(char) || (char.charCodeAt(0) > 0x7f && !isSpace(char));
}

/** Reads a '...' or "..." string that starts at start. A line break ends an unterminated string. */
function readQuoted(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  let value = '';
  let i = start + 1;
  while (i < source.length) {
    const char = source[i]!;
    if (char === quote) return { value, end: i + 1 };
    if (char === '\n') return { value, end: i };
    if (char === '\\') {
      const next = source[i + 1] ?? '';
      if (next !== '\n') value += next;
      i += 2;
      continue;
    }
    value += char;
    i += 1;
  }
  return { value, end: i };
}

/**
 * Reads template text from start, either just after the opening backtick or just after the }
 * that closes a placeholder (resumed). Returns the index after the closing backtick, or after
 * a ${ that opens a placeholder, which it records on the stack.
 */
function readTemplate(source: string, start: number, resumed: boolean, tokens: Token[], stack: string[]): number {
  let text = '';
  let i = start;
  while (i < source.length) {
    const char = source[i]!;
    if (char === '\\') {
      text += source[i + 1] ?? '';
      i += 2;
    } else if (char === '`') {
      tokens.push(resumed ? { kind: 'other' } : { kind: 'string', value: text });
      return i + 1;
    } else if (char === '$' && source[i + 1] === '{') {
      if (!resumed) tokens.push({ kind: 'other' });
      stack.push('template');
      return i + 2;
    } else {
      text += char;
      i += 1;
    }
  }
  tokens.push({ kind: 'other' });
  return i;
}

/** The index after a regular expression literal that starts at start, or -1 when the line has no closing slash. */
function regexpEnd(source: string, start: number): number {
  let inClass = false;
  let i = start + 1;
  while (i < source.length) {
    const char = source[i]!;
    if (char === '\n') return -1;
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      i += 1;
      while (i < source.length && isNameChar(source[i]!)) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

function regexpAllowedAfter(token: Token | undefined): boolean {
  if (token === undefined) return true;
  if (token.kind === 'punct') return token.value !== ')' && token.value !== ']' && token.value !== '}';
  if (token.kind === 'name') return KEYWORDS_BEFORE_EXPRESSION.has(token.value);
  return false;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  // One entry per open { in code: 'brace' for a block or object, 'template' for a ${ placeholder.
  const stack: string[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];
    if (isSpace(char)) {
      i += 1;
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '\'' || char === '"') {
      const { value, end } = readQuoted(source, i);
      tokens.push({ kind: 'string', value });
      i = end;
    } else if (char === '`') {
      i = readTemplate(source, i + 1, false, tokens, stack);
    } else if (char === '/' && regexpAllowedAfter(tokens.at(-1)) && regexpEnd(source, i) !== -1) {
      tokens.push({ kind: 'other' });
      i = regexpEnd(source, i);
    } else if (char === '{') {
      stack.push('brace');
      tokens.push({ kind: 'punct', value: char });
      i += 1;
    } else if (char === '}') {
      if (stack.pop() === 'template') {
        i = readTemplate(source, i + 1, true, tokens, stack);
      } else {
        tokens.push({ kind: 'punct', value: char });
        i += 1;
      }
    } else if (isNameChar(char)) {
      let end = i + 1;
      while (end < source.length && isNameChar(source[end]!)) end += 1;
      tokens.push({ kind: 'name', value: source.slice(i, end) });
      i = end;
    } else {
      tokens.push({ kind: 'punct', value: char });
      i += 1;
    }
  }
  return tokens;
}

function isName(token: Token | undefined, value: string): boolean {
  return token?.kind === 'name' && token.value === value;
}

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punct' && token.value === value;
}

/** The plain string argument of a call whose ( is at open, as in import('a') or require('a'). */
function stringArgument(tokens: Token[], open: number): string | null {
  const argument = tokens[open + 1];
  const after = tokens[open + 2];
  if (argument?.kind !== 'string' || !(isPunct(after, ')') || isPunct(after, ','))) return null;
  return argument.value;
}

/**
 * Every module specifier in the source, in order of appearance, without duplicates. Bare specifiers
 * are returned as written. A call with a non-literal argument, such as import(name), is not a specifier.
 */
export function findImportSpecifiers(source: string): string[] {
  const tokens = tokenize(source);
  const found = new Set<string>();
  // True inside an import or export declaration, until its from 'x' or its end.
  let inDeclaration = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    const afterDot = isPunct(tokens[i - 1], '.');

    if (isName(token, 'import') && !afterDot) {
      if (next?.kind === 'string') {
        found.add(next.value);
        i += 1;
      } else if (isPunct(next, '(')) {
        const specifier = stringArgument(tokens, i + 1);
        if (specifier !== null) found.add(specifier);
      } else {
        inDeclaration = !isPunct(next, '.');
      }
      continue;
    }
    if (isName(token, 'export') && !afterDot) {
      inDeclaration = !(next?.kind === 'name' && NOT_A_REEXPORT.has(next.value));
      continue;
    }
    if (isName(token, 'require') && !afterDot && isPunct(next, '(')) {
      const specifier = stringArgument(tokens, i + 1);
      if (specifier !== null) found.add(specifier);
      continue;
    }
    if (!inDeclaration) continue;

    if (isName(token, 'from') && next?.kind === 'string') {
      found.add(next.value);
      inDeclaration = false;
      i += 1;
    } else if (isPunct(token, ';') || isPunct(token, '=') || isPunct(token, '(') || (isPunct(token, '}') && !isName(next, 'from'))) {
      inDeclaration = false;
    }
  }
  return [...found];
}

/** The local name bound by one specifier inside { }, as in a, a as b, type a, default as b or 'a-b' as b. */
function readSpecifier(tokens: Token[], start: number): { local: string | null; end: number } {
  let i = start;
  // An inline type modifier: type a, or type a as b. In { type } or { type as b } the word is the name.
  if (isName(tokens[i], 'type') && tokens[i + 1]?.kind === 'name' && !isName(tokens[i + 1], 'as')) i += 1;
  const imported = tokens[i];
  if (imported?.kind !== 'name' && imported?.kind !== 'string') return { local: null, end: i };
  if (isName(tokens[i + 1], 'as') && tokens[i + 2]?.kind === 'name') {
    return { local: (tokens[i + 2] as { value: string }).value, end: i + 3 };
  }
  return { local: imported.kind === 'name' ? imported.value : null, end: i + 1 };
}

/**
 * The local names that the import declarations in the source bind, in order of appearance, without
 * duplicates: default (import a from), named (import { a, b as c } from, local names a and c),
 * namespace (import * as ns from), import type and inline type specifiers, on one line or several.
 * A side effect import (import 'x'), a dynamic import(), export ... from, require() and
 * import x = require() bind nothing here. A name in a comment or a string is never read.
 */
export function findImportedNames(source: string): string[] {
  const tokens = tokenize(source);
  const found = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (!isName(tokens[i], 'import') || isPunct(tokens[i - 1], '.')) continue;
    if (next?.kind === 'string' || isPunct(next, '(') || isPunct(next, '.')) continue;
    let j = i + 1;
    // import type a from, import type { a } from, import type * as ns from. In import type from 'x'
    // and import type, { a } from 'x' the word type is the default name.
    if (isName(tokens[j], 'type') && !isName(tokens[j + 1], 'from') && !isPunct(tokens[j + 1], ',')) j += 1;
    const first = tokens[j];
    if (first?.kind === 'name' && !isName(first, 'from')) {
      // import a = require('x') is a documented miss.
      if (isPunct(tokens[j + 1], '=')) continue;
      found.add(first.value);
      j += 1;
      if (isPunct(tokens[j], ',')) j += 1;
    }
    if (isPunct(tokens[j], '*') && isName(tokens[j + 1], 'as') && tokens[j + 2]?.kind === 'name') {
      found.add((tokens[j + 2] as { value: string }).value);
      j += 3;
    } else if (isPunct(tokens[j], '{')) {
      j += 1;
      while (j < tokens.length && !isPunct(tokens[j], '}')) {
        const { local, end } = readSpecifier(tokens, j);
        if (local !== null) found.add(local);
        if (isPunct(tokens[end], ',')) j = end + 1;
        else if (isPunct(tokens[end], '}')) j = end;
        else break;
      }
    }
    i = j - 1;
  }
  return [...found];
}
