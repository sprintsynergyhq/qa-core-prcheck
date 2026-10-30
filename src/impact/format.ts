import type { Selection } from './types.js';

/** The documented JSON shape: keys in the order of the types in types.ts. */
export function formatSelectionJson(selection: Selection): string {
  return `${JSON.stringify(selection, null, 2)}\n`;
}

/**
 * The mode, the selected specs with their reasons, then one line per changed file, the warnings and
 * the suggested tests. The last two blocks are left out when empty.
 */
export function formatSelectionText(selection: Selection): string {
  const lines: string[] = [];
  if (selection.source.type === 'git') lines.push(`Merge base: ${selection.source.mergeBaseSha}`);
  lines.push(`Mode: ${selection.mode}`);
  lines.push(`Selected specs: ${selection.selected.length} of ${selection.totalSpecs}`);
  for (const spec of selection.selected) {
    lines.push(`  ${spec.file}`);
    for (const reason of spec.reasons) lines.push(`    - ${reason}`);
  }
  if (selection.mode === 'full') {
    lines.push('Full suite reasons:');
    for (const reason of selection.fullSuiteReasons) lines.push(`  - ${reason}`);
  }
  lines.push(`Changed files: ${selection.decisions.length}`);
  for (const decision of selection.decisions) {
    lines.push([decision.outcome.padEnd(7), decision.path, decision.reason].join('  '));
  }
  if (selection.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of selection.warnings) lines.push(`  - ${warning}`);
  }
  if (selection.suggestions.length > 0) {
    lines.push(`Suggested tests: ${selection.suggestions.length}`);
    for (const suggestion of selection.suggestions) lines.push(`  - ${suggestion.file}: ${suggestion.idea}`);
  }
  return `${lines.join('\n')}\n`;
}
