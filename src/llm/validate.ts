// The strict check of an LLM answer. It is the whole contract with the model: anything other than an
// exact permutation of the picked spec files and of the shown suggestion indexes, with short one line
// notes, rejects the whole answer, and the summary keeps the deterministic order.
// No reason holds text from the answer, so a hostile answer cannot write into a message.

import { LLM_MAX_RESPONSE_BYTES } from './http.js';
import { LLM_MAX_NOTE_CHARS } from './prompt.js';
import { LlmError, type RankedSpec, type RankedSuggestion } from './types.js';

export interface ValidAnswer { specs: RankedSpec[]; suggestions: RankedSuggestion[] }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
};

function checkNote(note: unknown): string {
  if (typeof note !== 'string') throw new LlmError('a note is not a string');
  // Line breaks, other control characters and the Unicode line and paragraph separators.
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(note)) throw new LlmError('a note is not one line');
  if ([...note].length > LLM_MAX_NOTE_CHARS) throw new LlmError(`a note is over ${LLM_MAX_NOTE_CHARS} characters`);
  return note;
}

/** Parses and checks the answer text against the picked files and the number of shown suggestions. */
export function validateAnswer(text: string, picked: readonly string[], suggestionCount: number): ValidAnswer {
  if (Buffer.byteLength(text) > LLM_MAX_RESPONSE_BYTES) throw new LlmError(`the answer is over ${LLM_MAX_RESPONSE_BYTES} bytes`);
  const trimmed = text.trim();
  if (trimmed === '') throw new LlmError('the answer is empty');
  let json: unknown;
  try { json = JSON.parse(trimmed); } catch { throw new LlmError('the answer is not JSON'); }
  if (!isObject(json) || !hasExactKeys(json, ['specs', 'suggestions'])) {
    throw new LlmError('the answer is not a JSON object with exactly the keys specs and suggestions');
  }
  const { specs, suggestions } = json;
  if (!Array.isArray(specs) || !Array.isArray(suggestions)) throw new LlmError('specs and suggestions must be arrays');

  const pickedSet = new Set(picked);
  const seenFiles = new Set<string>();
  const rankedSpecs: RankedSpec[] = specs.map((entry: unknown) => {
    if (!isObject(entry) || !hasExactKeys(entry, ['file', 'note'])) throw new LlmError('a specs entry is not an object with exactly the keys file and note');
    const { file } = entry;
    if (typeof file !== 'string' || !pickedSet.has(file)) throw new LlmError('the answer lists a spec the rules did not pick');
    if (seenFiles.has(file)) throw new LlmError('the answer lists a spec twice');
    seenFiles.add(file);
    return { file, note: checkNote(entry.note) };
  });
  if (seenFiles.size !== pickedSet.size) throw new LlmError('the answer leaves out a picked spec');

  const seenIndexes = new Set<number>();
  const rankedSuggestions: RankedSuggestion[] = suggestions.map((entry: unknown) => {
    if (!isObject(entry) || !hasExactKeys(entry, ['index', 'note'])) throw new LlmError('a suggestions entry is not an object with exactly the keys index and note');
    const { index } = entry;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= suggestionCount) {
      throw new LlmError('the answer lists a suggestion index that does not exist');
    }
    if (seenIndexes.has(index)) throw new LlmError('the answer lists a suggestion twice');
    seenIndexes.add(index);
    return { index, note: checkNote(entry.note) };
  });
  if (seenIndexes.size !== suggestionCount) throw new LlmError('the answer leaves out a suggestion');

  return { specs: rankedSpecs, suggestions: rankedSuggestions };
}
