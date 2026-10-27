import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { parseUnifiedDiff } from './parse.js';
import { DiffError, type DiffResult } from './types.js';

export interface ReadGitDiffOptions {
  base: string;
  head?: string;                 // default 'HEAD'
  cwd?: string;                  // default process.cwd()
  env?: NodeJS.ProcessEnv;       // merged over process.env; tests use it for the isolated environment
}

// Upper limit, in bytes, for what one git command may print.
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

interface GitResult { code: number; stdout: string; stderr: string }

/**
 * Runs git with an argument array, never through a command string.
 * A non-zero exit is returned for the caller to judge; failing to run git at all is a DiffError.
 */
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error === null) resolve({ code: 0, stdout, stderr });
      else if (error.code === 'ENOENT') reject(new DiffError('git was not found on PATH.'));
      else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new DiffError('The diff is too large to read'));
      else if (typeof error.code === 'number') resolve({ code: error.code, stdout, stderr });
      else reject(new DiffError(`git ${args[0]} failed: ${firstLine(error.message)}`));
    });
  });
}

function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

function failed(args: string[], result: GitResult): DiffError {
  return new DiffError(`git ${args[0]} failed: ${firstLine(result.stderr) || `exit code ${result.code}`}`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function resolveRef(ref: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd, env);
  const sha = result.stdout.trim();
  if (result.code !== 0 || sha === '') {
    throw new DiffError(`Unknown ref: ${ref}. Fetch it first, for example git fetch origin <branch>`);
  }
  return sha;
}

async function findMergeBase(
  base: string, head: string, baseSha: string, headSha: string, cwd: string, env: NodeJS.ProcessEnv,
): Promise<string> {
  const args = ['merge-base', baseSha, headSha];
  const result = await runGit(args, cwd, env);
  // No common ancestor: git prints nothing and exits 1.
  if (result.code !== 0 && result.code !== 1) throw failed(args, result);
  const sha = result.stdout.trim();
  if (sha !== '') return sha;

  // In a shallow clone a missing fork point looks the same, so say which case this is.
  const shallow = await runGit(['rev-parse', '--is-shallow-repository'], cwd, env).catch(() => null);
  if (shallow !== null && shallow.code === 0 && shallow.stdout.trim() === 'true') {
    throw new DiffError(
      `No merge base found between ${base} and ${head}, and this is a shallow clone. ` +
      'Fetch the full history: in GitHub Actions set fetch-depth: 0 on actions/checkout, or run git fetch --unshallow.',
    );
  }
  throw new DiffError(`No merge base found between ${base} and ${head}: the two refs share no history.`);
}

/** Lists the files changed between the merge base of base and head, and head. */
export async function readGitDiff(options: ReadGitDiffOptions): Promise<DiffResult> {
  const base = options.base;
  const head = options.head ?? 'HEAD';
  const cwd = options.cwd ?? process.cwd();
  const env = { ...process.env, ...options.env };

  for (const ref of [base, head]) {
    // git would read a ref that starts with - as an option.
    if (ref === '' || ref.startsWith('-')) throw new DiffError(`Invalid ref: ${ref}`);
  }
  if (!isDirectory(cwd)) throw new DiffError(`Not a git repository: ${cwd}`);

  const gitDir = await runGit(['rev-parse', '--git-dir'], cwd, env);
  if (gitDir.code !== 0) throw new DiffError(`Not a git repository: ${cwd}`);

  const baseSha = await resolveRef(base, cwd, env);
  const headSha = await resolveRef(head, cwd, env);
  const mergeBaseSha = await findMergeBase(base, head, baseSha, headSha, cwd, env);

  // Explicit flags keep the output the same whatever the user's git config says.
  // No -C: copy detection stays off, so 'copied' only comes from a saved diff.
  const diffArgs = [
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--find-renames',
    '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', mergeBaseSha, headSha, '--',
  ];
  const diff = await runGit(diffArgs, cwd, env);
  if (diff.code !== 0) throw failed(diffArgs, diff);

  return {
    schemaVersion: 1,
    source: { type: 'git', base, head, baseSha, headSha, mergeBaseSha },
    files: parseUnifiedDiff(diff.stdout),
  };
}
