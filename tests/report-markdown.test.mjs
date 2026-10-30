import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_MAX_CHARS, cell, codeSpan, escapeText, plural } from '../dist/report/index.js';

/**
 * The Markdown building blocks. Every expected value is written by hand from the escaping rules in
 * src/report/markdown.ts. Pure functions: no files, no processes.
 */

const AT = '&#64;&#8203;';
const DOLLAR = '<span>$</span>';

// Splits a table row on the pipes that are not escaped, as GFM does, and drops the outer two.
const tableCells = (row) => row.split(/(?<!\\)\|/).slice(1, -1).map((part) => part.trim());

const ESCAPES = [
  ['back\\slash', 'back\\\\slash'],
  ['a `tick`', 'a \\`tick\\`'],
  ['*bold*', '\\*bold\\*'],
  ['snake_case_name', 'snake\\_case\\_name'],
  ['[link](https://www.saucedemo.com)', '\\[link\\](https://www.saucedemo.com)'],
  ['# heading', '\\# heading'],
  ['a | b', 'a \\| b'],
  ['~~gone~~', '\\~\\~gone\\~\\~'],
  ['<b>bold</b>', '&lt;b&gt;bold&lt;/b&gt;'],
  ['Tom & Jerry', 'Tom &amp; Jerry'],
  // # before a digit also gets the zero width space (PR 7).
  ['literal &#64; entity', 'literal &amp;\\#&#8203;64; entity'],
  ['costs $29.99 and $9.99', `costs ${DOLLAR}29.99 and ${DOLLAR}9.99`],
  ['adds @cart item', `adds ${AT}cart item`],
  ['line one\nline two\r\nline three\rline four', 'line one line two line three line four'],
  ['- starts like a list', '\\- starts like a list'],
  ['+ starts like a list', '\\+ starts like a list'],
  ['1. starts like a list', '1\\. starts like a list'],
  ['12) starts like a list', '12\\) starts like a list'],
  ['cart - checkout + 1. ok', 'cart - checkout + 1. ok'],
  ['plain words, with (parens) and a/b: ok!', 'plain words, with (parens) and a/b: ok!'],
  ['fixes #1', 'fixes \\#&#8203;1'],
  ['see GH-12', 'see GH-&#8203;12'],
  ['see gh-12', 'see gh-&#8203;12'],
  ['sprintsynergyhq/qa-core-prcheck#3', 'sprintsynergyhq/qa-core-prcheck\\#&#8203;3'],
  ['#cart', '\\#cart'],
  ['C# 1', 'C\\# 1'],
  ['GH-cart and GH- 1', 'GH-cart and GH- 1'],
  ['-1 starts like a list', '\\-1 starts like a list'],
];

for (const [input, expected] of ESCAPES) {
  test(`escapeText(${JSON.stringify(input)})`, () => {
    assert.equal(escapeText(input), expected);
  });
}

test('@cart becomes &#64; and a zero width space, so no plain @ is left', () => {
  assert.equal(escapeText('@cart'), '&#64;&#8203;cart');
  assert.ok(!escapeText('ping @cart and @sauce/team').includes('@'));
});

test('a title holding the summary marker is escaped, so it is no longer a marker', () => {
  assert.equal(escapeText('<!-- qa-core-prcheck:summary -->'), '&lt;!-- qa-core-prcheck:summary --&gt;');
});

test('codeSpan uses one backtick for plain text', () => {
  assert.equal(codeSpan('demo/saucedemo/tests/cart/cart.spec.ts:12'), '`demo/saucedemo/tests/cart/cart.spec.ts:12`');
});

test('codeSpan with a backtick inside uses a longer fence', () => {
  assert.equal(codeSpan('a`b.spec.ts'), '``a`b.spec.ts``');
  assert.equal(codeSpan('a``b'), '```a``b```');
});

test('codeSpan with a backtick or a space at the start or end pads with a space', () => {
  assert.equal(codeSpan('`cart.spec.ts'), '`` `cart.spec.ts ``');
  assert.equal(codeSpan('cart.spec.ts`'), '`` cart.spec.ts` ``');
  assert.equal(codeSpan(' cart.spec.ts '), '`  cart.spec.ts  `');
});

test('codeSpan escapes | for tables and turns line breaks into spaces', () => {
  assert.equal(codeSpan('a|b.spec.ts'), '`a\\|b.spec.ts`');
  assert.equal(codeSpan('a\nb.spec.ts'), '`a b.spec.ts`');
});

test('a | in a cell or a code span does not split the table row', () => {
  const row = `| ${codeSpan('tests/a|b.spec.ts:3')} | ${cell('cart | checkout')} |`;
  assert.deepEqual(tableCells(row), ['`tests/a\\|b.spec.ts:3`', 'cart \\| checkout']);
});

test('CELL_MAX_CHARS is 300', () => {
  assert.equal(CELL_MAX_CHARS, 300);
});

test('cell keeps text up to the limit and cuts longer text with ...', () => {
  assert.equal(cell('x'.repeat(300)), 'x'.repeat(300));
  assert.equal(cell('x'.repeat(301)), `${'x'.repeat(300)}...`);
  assert.equal(cell('abcdef', 3), 'abc...');
});

test('cell cuts before it escapes, so an entity is never split', () => {
  assert.equal(cell('<'.repeat(301)), `${'&lt;'.repeat(300)}...`);
});

test('cell counts code points, so a surrogate pair is never split', () => {
  const smile = String.fromCodePoint(0x1f600);
  assert.equal(cell(smile.repeat(301)), `${smile.repeat(300)}...`);
});

test('cell turns line breaks into spaces and escapes', () => {
  assert.equal(cell('Error: a\nb | c'), 'Error: a b \\| c');
});

test('plural for 0, 1 and 2', () => {
  assert.equal(plural(0, 'test'), '0 tests');
  assert.equal(plural(1, 'test'), '1 test');
  assert.equal(plural(2, 'spec'), '2 specs');
});

test('a mention, three issue references and math in one title: no @, no reference, no math', () => {
  assert.equal(
    escapeText('mentions @sprintsynergyhq in #1, GH-1 and sprintsynergyhq/qa-core-prcheck#1 with $x$'),
    `mentions ${AT}sprintsynergyhq in \\#&#8203;1, GH-&#8203;1 and sprintsynergyhq/qa-core-prcheck\\#&#8203;1 with ${DOLLAR}x${DOLLAR}`,
  );
  assert.equal(escapeText('@sprintsynergyhq in #1 with $x$'), `${AT}sprintsynergyhq in \\#&#8203;1 with ${DOLLAR}x${DOLLAR}`);
});

test('cell cuts before it escapes, so a cut next to #1 or GH-1 never splits the zero width space entity', () => {
  assert.equal(cell('ab#1', 3), 'ab\\#...');
  assert.equal(cell('ab#1', 4), 'ab\\#&#8203;1');
  assert.equal(cell('see GH-12', 7), 'see GH-...');
  assert.equal(cell('see GH-12', 8), 'see GH-&#8203;1...');
});

test('codeSpan keeps a # before a digit as it is: an entity would show as text in a code span', () => {
  assert.equal(codeSpan('tests/#1/cart.spec.ts'), '`tests/#1/cart.spec.ts`');
});

// Inside a URL (PR 7b): an http:// or https:// URL that GitHub's cmark-gfm autolinks is written raw, with
// no Markdown backslash, so the link address is the URL itself. PR #19 showed the PR 7a output
// https://example.com/docs\#1-intro became the href https://example.com/docs%5C#1-intro.
// The exceptions inside a URL: | becomes \| (a table cell needs it), a backtick keeps its backslash,
// a \ just before a | or at the end of the URL becomes \\,
// < becomes &lt;, an & that starts something like an entity (&lt; &#64; &#x40;) becomes &amp;,
// @ and $ are written as everywhere else, and a $ ends the URL.
const URL_CASES = [
  ['see https://example.com/docs#1-intro', 'see https://example.com/docs#1-intro'],
  ['HTTPS://EXAMPLE.COM/a#2', 'HTTPS://EXAMPLE.COM/a#2'],
  ['https://example.com/GH-1', 'https://example.com/GH-1'],
  ['https://example.com/x #1', 'https://example.com/x \\#&#8203;1'],
  ['www.example.com/#1', 'www.example.com/\\#&#8203;1'],
  ['Http://example.com/#3 and #4', 'Http://example.com/#3 and \\#&#8203;4'],
  ['http:/example.com#1', 'http:/example.com\\#&#8203;1'],
  ['https://example.com/a\t#1', 'https://example.com/a\t\\#&#8203;1'],
  ['https://example.com/a\n#1', 'https://example.com/a \\#&#8203;1'],
  ['https://example.com/a_b?x=1&y=#2', 'https://example.com/a_b?x=1&y=#2'],
  ['https://user@example.com/#1', `https://user${AT}example.com/#1`],
  ['adds a product, see https://example.com/docs#1-intro and #1', 'adds a product, see https://example.com/docs#1-intro and \\#&#8203;1'],
  // Every Markdown character GFM lets a backslash escape, except | and a backtick, stays raw in a URL.
  ['https://example.com/a_b*c~d[e]f#h(i)!', 'https://example.com/a_b*c~d[e]f#h(i)!'],
  ['https://example.com/a\\b', 'https://example.com/a\\b'],
  ['https://example.com/a\\', 'https://example.com/a\\\\'],
  ['https://example.com/x\\$y', `https://example.com/x\\\\${DOLLAR}y`],
  ['https://example.com/a`b', 'https://example.com/a\\`b'],
  // Two raw backticks would make a code span, stop the second autolink and leave its [x](...) as a link.
  ['https://example.com/` https://example.org/`[x](https://example.net)', 'https://example.com/\\` https://example.org/\\`[x](https://example.net)'],
  ['https://example.com/a|b', 'https://example.com/a\\|b'],
  ['https://example.com/a\\|b', 'https://example.com/a\\\\\\|b'],
  ['https://example.com/?a=1&b=2', 'https://example.com/?a=1&b=2'],
  ['https://example.com/a>b', 'https://example.com/a>b'],
  ['https://example.com/a<b>c_d', 'https://example.com/a&lt;b>c_d'],
  ['https://example.com/?q=&lt;b', 'https://example.com/?q=&amp;lt;b'],
  ['https://example.com/&#64;x &#64;y', 'https://example.com/&amp;#64;x &amp;\\#&#8203;64;y'],
  ['https://example.com/&#x40;x', 'https://example.com/&amp;#x40;x'],
  ['https://example.com/<script>', 'https://example.com/&lt;script>'],
  ['https://example.com/&lt;script&gt;', 'https://example.com/&amp;lt;script&amp;gt;'],
  ['https://example.com/&commat;me', 'https://example.com/&amp;commat;me'],
  ['https://example.com/a$b_c', `https://example.com/a${DOLLAR}b\\_c`],
  ['see https://example.com/a_ ok', 'see https://example.com/a_ ok'],
  ['(https://example.com/a_b)', '(https://example.com/a_b)'],
  ['1https://example.com/a_b', '1https://example.com/a_b'],
  // Not autolinked by cmark-gfm, so escaped as plain text: a letter just before the scheme, a scheme
  // not followed by a letter or digit, an _ in the last two parts of the domain, no domain at all.
  ['xhttps://example.com/a_b', 'xhttps://example.com/a\\_b'],
  ['https://_x.example.com/a_b', 'https://\\_x.example.com/a\\_b'],
  ['https://example.a_b/x_y', 'https://example.a\\_b/x\\_y'],
  ['https://www.ex_ample.com/x_y', 'https://www.ex\\_ample.com/x\\_y'],
  ['https:// example.com/a_b', 'https:// example.com/a\\_b'],
  ['https://', 'https://'],
  ['ftp://example.com/a_b', 'ftp://example.com/a\\_b'],
  // A space that is not ASCII ends the URL here; what follows is escaped.
  ['https://example.com/a\u00a0b_c', 'https://example.com/a\u00a0b\\_c'],
  ['two https://example.com/a_b and http://example.org/c#1', 'two https://example.com/a_b and http://example.org/c#1'],
];

for (const [input, expected] of URL_CASES) {
  test(`escapeText in a URL: ${JSON.stringify(input)}`, () => {
    assert.equal(escapeText(input), expected);
  });
}

test('cell cut inside a URL: the cut comes first, and the URL stays raw', () => {
  assert.equal(cell('see https://example.com/docs#1-intro', 30), 'see https://example.com/docs#1...');
  assert.equal(cell('see https://example.com/docs#1-intro', 29), 'see https://example.com/docs#...');
});

test('a URL with | in a table row keeps the row at the same number of cells', () => {
  const row = `| ${cell('see https://example.com/a|b|c')} | ${cell('https://example.com/x\\|y')} | two |`;
  assert.deepEqual(tableCells(row), ['see https://example.com/a\\|b\\|c', 'https://example.com/x\\\\\\|y', 'two']);
});

test('escapeText on a 100000 character text full of URL starts finishes', () => {
  const text = 'https://'.repeat(12500);
  assert.equal(escapeText(text), text);
  assert.equal(escapeText(`${'h'.repeat(100000)}#1`), `${'h'.repeat(100000)}\\#&#8203;1`);
  assert.equal(escapeText('(https://_x'.repeat(10000)), '(https://\\_x'.repeat(10000));
});
