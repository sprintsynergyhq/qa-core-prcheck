import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { LLM_MAX_NOTE_CHARS, LlmError, validateAnswer } from '../dist/llm/index.js';
import { guardGlobalFetch } from './fixtures/llm/fake-fetch.mjs';

/** validateAnswer: only an exact permutation with short one line notes is accepted. Hand-written values. */

guardGlobalFetch(after);

const PICKED = ['demo/a.spec.ts', 'demo/b.spec.ts'];
const answer = (specs, suggestions) => JSON.stringify({ specs, suggestions });
const spec = (file, note = '') => ({ file, note });
const sug = (index, note = '') => ({ index, note });
const GOOD_SPECS = [spec('demo/b.spec.ts', 'first'), spec('demo/a.spec.ts')];
const GOOD_SUGS = [sug(1), sug(0, 'n')];

function rejects(text, reason, picked = PICKED, count = 2) {
  assert.throws(() => validateAnswer(text, picked, count), (e) => {
    assert.ok(e instanceof LlmError, `expected LlmError, got ${e}`);
    assert.equal(e.message, reason);
    return true;
  });
}

test('validate: an exact permutation with notes is accepted in the LLM order', () => {
  assert.deepEqual(validateAnswer(answer(GOOD_SPECS, GOOD_SUGS), PICKED, 2), {
    specs: [{ file: 'demo/b.spec.ts', note: 'first' }, { file: 'demo/a.spec.ts', note: '' }],
    suggestions: [{ index: 1, note: '' }, { index: 0, note: 'n' }],
  });
});

test('validate: whitespace around the JSON is trimmed', () => {
  assert.equal(validateAnswer(`\n  ${answer(GOOD_SPECS, GOOD_SUGS)}  \n`, PICKED, 2).specs.length, 2);
});

test('validate: empty lists are accepted when nothing of that kind was sent', () => {
  assert.deepEqual(validateAnswer(answer([], [sug(0)]), [], 1), { specs: [], suggestions: [{ index: 0, note: '' }] });
});

test('validate: an extra spec file rejects the whole answer', () => {
  rejects(answer([...GOOD_SPECS, spec('demo/x.spec.ts')], GOOD_SUGS), 'the answer lists a spec the rules did not pick');
});

test('validate: a spec file swapped for another rejects the answer', () => {
  rejects(answer([spec('demo/b.spec.ts'), spec('demo/x.spec.ts')], GOOD_SUGS), 'the answer lists a spec the rules did not pick');
});

const CASES = [
  ['an empty answer', '   ', 'the answer is empty'],
  ['a code fence', `\`\`\`json\n${answer(GOOD_SPECS, GOOD_SUGS)}\n\`\`\``, 'the answer is not JSON'],
  ['text before the JSON', `Here you go: ${answer(GOOD_SPECS, GOOD_SUGS)}`, 'the answer is not JSON'],
  ['an array', '[]', 'the answer is not a JSON object with exactly the keys specs and suggestions'],
  ['null', 'null', 'the answer is not a JSON object with exactly the keys specs and suggestions'],
  ['an extra top key', JSON.stringify({ specs: GOOD_SPECS, suggestions: GOOD_SUGS, add: ['demo/x.spec.ts'] }), 'the answer is not a JSON object with exactly the keys specs and suggestions'],
  ['a missing key', JSON.stringify({ specs: GOOD_SPECS }), 'the answer is not a JSON object with exactly the keys specs and suggestions'],
  ['specs as an object', JSON.stringify({ specs: {}, suggestions: GOOD_SUGS }), 'specs and suggestions must be arrays'],
  ['a spec entry with an extra key', answer([{ file: 'demo/a.spec.ts', note: '', run: true }, spec('demo/b.spec.ts')], GOOD_SUGS), 'a specs entry is not an object with exactly the keys file and note'],
  ['a spec entry as a string', answer(['demo/a.spec.ts', spec('demo/b.spec.ts')], GOOD_SUGS), 'a specs entry is not an object with exactly the keys file and note'],
  ['a duplicate spec', answer([spec('demo/a.spec.ts'), spec('demo/a.spec.ts')], GOOD_SUGS), 'the answer lists a spec twice'],
  ['a missing spec', answer([spec('demo/a.spec.ts')], GOOD_SUGS), 'the answer leaves out a picked spec'],
  ['a spec file that is not a string', answer([{ file: 1, note: '' }, spec('demo/b.spec.ts')], GOOD_SUGS), 'the answer lists a spec the rules did not pick'],
  ['a suggestion index out of range', answer(GOOD_SPECS, [sug(0), sug(2)]), 'the answer lists a suggestion index that does not exist'],
  ['a negative suggestion index', answer(GOOD_SPECS, [sug(-1), sug(0)]), 'the answer lists a suggestion index that does not exist'],
  ['a suggestion index that is not an integer', answer(GOOD_SPECS, [sug(0.5), sug(0)]), 'the answer lists a suggestion index that does not exist'],
  ['a suggestion index as a string', answer(GOOD_SPECS, [sug('1'), sug(0)]), 'the answer lists a suggestion index that does not exist'],
  ['a duplicate suggestion', answer(GOOD_SPECS, [sug(0), sug(0)]), 'the answer lists a suggestion twice'],
  ['a missing suggestion', answer(GOOD_SPECS, [sug(1)]), 'the answer leaves out a suggestion'],
  ['a suggestion entry with a file key', answer(GOOD_SPECS, [{ index: 0, note: '', file: 'x' }, sug(1)]), 'a suggestions entry is not an object with exactly the keys index and note'],
  ['a note that is a number', answer([spec('demo/a.spec.ts', 3), spec('demo/b.spec.ts')], GOOD_SUGS), 'a note is not a string'],
  ['a note with a line break', answer([spec('demo/a.spec.ts', 'one\ntwo'), spec('demo/b.spec.ts')], GOOD_SUGS), 'a note is not one line'],
  ['a note with a carriage return', answer(GOOD_SPECS, [sug(0, 'a\rb'), sug(1)]), 'a note is not one line'],
  ['a note with a line separator', answer(GOOD_SPECS, [sug(0, `a${String.fromCodePoint(0x2028)}b`), sug(1)]), 'a note is not one line'],
  ['a note with a tab', answer(GOOD_SPECS, [sug(0, 'a\tb'), sug(1)]), 'a note is not one line'],
  ['a note over 200 characters', answer([spec('demo/a.spec.ts', 'x'.repeat(201)), spec('demo/b.spec.ts')], GOOD_SUGS), 'a note is over 200 characters'],
];

for (const [label, text, reason] of CASES) {
  test(`validate: ${label} is rejected with "${reason}"`, () => rejects(text, reason));
}

test('validate: a note of exactly 200 characters is accepted, counted in code points', () => {
  assert.equal(LLM_MAX_NOTE_CHARS, 200);
  const emoji = String.fromCodePoint(0x1f600);
  const note = emoji.repeat(200);
  const v = validateAnswer(answer([spec('demo/a.spec.ts', note), spec('demo/b.spec.ts')], GOOD_SUGS), PICKED, 2);
  assert.equal(v.specs[0].note, note);
});

test('validate: an answer over 262144 bytes is rejected before parsing', () => {
  rejects(`${answer(GOOD_SPECS, GOOD_SUGS)}${' '.repeat(262_144)}`, 'the answer is over 262144 bytes');
});

test('validate: no reason holds text from the answer', () => {
  const marker = 'MARKER_FROM_THE_ANSWER';
  const texts = [
    marker,
    answer([spec(marker)], GOOD_SUGS),
    answer([spec('demo/a.spec.ts', `${marker}\n`), spec('demo/b.spec.ts')], GOOD_SUGS),
    JSON.stringify({ [marker]: 1 }),
  ];
  for (const text of texts) {
    assert.throws(() => validateAnswer(text, PICKED, 2), (e) => !e.message.includes(marker));
  }
});
