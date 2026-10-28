// The one helper that finds the Playwright CLI, builds its environment and runs it. The inventory
// (src/inventory/list.ts) and the runner (src/run/runner.ts) both go through it.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Upper limit, in bytes, for what one Playwright run may print. A chosen limit, not a measurement.
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

/**
 * Taken out of every Playwright environment. In Playwright 1.60.0:
 * - GITHUB_ACTIONS, GITLAB_CI, and JENKINS_URL with BUILD_URL make a test run record git commit info
 *   by running git itself, unless the config sets captureGitInfo. A --list run never does.
 * - CI changes the progress reporter, and a config may read it.
 * - PW_TEST_REPORTER adds a second reporter, and the PLAYWRIGHT_JSON_OUTPUT_* variables move the JSON report.
 */
export const REMOVED_ENV_KEYS: readonly string[] = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
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

/** A copy of base without REMOVED_ENV_KEYS, then with extra added. base is not changed. */
export function cleanPlaywrightEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of REMOVED_ENV_KEYS) delete env[key];
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
