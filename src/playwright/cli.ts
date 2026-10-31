// The one helper that finds the Playwright CLI, builds its environment and runs it. The inventory
// (src/inventory/list.ts) and the runner (src/run/runner.ts) both go through it.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Upper limit, in bytes, for what one Playwright run may print. A chosen limit, not a measurement.
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

/**
 * Taken out of every Playwright environment. In Playwright 1.60.0 (node_modules/playwright/lib/runner/index.js):
 * - GITHUB_ACTIONS (654), GITLAB_CI (670), and JENKINS_URL with BUILD_URL (678) are the only keys ciInfo
 *   reads. When it finds one and the config leaves captureGitInfo unset (636, 643), a test run runs git
 *   log and git diff through a shell (712, 744 to 753); with GITHUB_ACTIONS and a pull request event it
 *   also runs git fetch on the base commit (737). A --list run never does: list mode has no plugin
 *   setup task (6467 to 6470).
 * - PW_TEST_REPORTER adds a second reporter (4767), and PLAYWRIGHT_JSON_OUTPUT_FILE, _DIR and _NAME move
 *   the JSON report (1483, 1488, 1495).
 * CI is passed through: it is not read by ciInfo, so it starts no git, and a user config may read it.
 * It switches the progress reporter on stdout to dot (4781), which is not read. --forbid-only is always
 * passed, so a focused test no longer depends on a config that reads CI.
 */
export const REMOVED_ENV_KEYS: readonly string[] = [
  'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
  'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR',
];

/** An expected failure. The message is plain and meant for the user. */
export class PlaywrightError extends Error {}

export interface PlaywrightRun {
  exitCode: number | null;   // null when a signal stopped the process
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;         // true when the kill timeout stopped the process
}

function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

/** The path of @playwright/test/cli as Node resolves it from root. */
export function findPlaywrightCli(root: string): string {
  try {
    return createRequire(path.join(root, 'package.json')).resolve('@playwright/test/cli');
  } catch {
    throw new PlaywrightError(`@playwright/test was not found from ${root}. Run npm ci first.`);
  }
}

/**
 * A copy of base without REMOVED_ENV_KEYS and without the names in remove, then with extra added. base
 * is not changed. check passes the LLM key env var names in remove, so test code in the PR under check
 * can never read the key (CLAUDE.md invariant 24).
 */
export function cleanPlaywrightEnv(
  base: NodeJS.ProcessEnv, extra: Record<string, string> = {}, remove: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of [...REMOVED_ENV_KEYS, ...remove]) delete env[key];
  return { ...env, ...extra };
}

/**
 * Runs node with an argument array, never through a command string. args start with the CLI path.
 * A non-zero exit, a signal or the kill timeout is returned for the caller to judge. It rejects only
 * when the process cannot start or prints more than the buffer limit. timeoutMs 0 means no limit.
 */
export function runPlaywright(root: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<PlaywrightRun> {
  return new Promise((resolve, reject) => {
    const options = { cwd: root, env, encoding: 'utf8' as const, maxBuffer: MAX_BUFFER_BYTES, timeout: timeoutMs, killSignal: 'SIGTERM' as const };
    execFile(process.execPath, args, options, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, signal: null, stdout, stderr, timedOut: false });
      } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        reject(new PlaywrightError('Playwright printed more output than the buffer limit'));
      } else if (typeof error.code === 'number' || typeof error.signal === 'string') {
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : null,
          signal: error.signal ?? null,
          stdout,
          stderr,
          // Node sets killed only when it stopped the process itself; the buffer case is handled above.
          timedOut: error.killed === true,
        });
      } else {
        reject(new PlaywrightError(`Playwright could not start: ${firstLine(error.message)}`));
      }
    });
  });
}
