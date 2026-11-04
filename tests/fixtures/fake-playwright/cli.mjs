// A fake Playwright CLI for the unit tests, run as `node cli.mjs <args>`. Not a test file:
// node --test runs tests/*.test.mjs only.
//
// FAKE_PW_RECORD  append one JSON line { argv, env } to this file (env: only the keys below that are set)
// FAKE_PW_REPORT  copy this file to PLAYWRIGHT_JSON_OUTPUT_FILE
// FAKE_PW_STDERR  write this text to stderr
// FAKE_PW_HANG=1  wait forever, so the kill timeout can be tested
// FAKE_PW_EXIT    the exit code (default 0)

import fs from 'node:fs';

// The keys the runner removes, plus CI, which it keeps, and PLAYWRIGHT_JSON_OUTPUT_FILE, which it sets again.
// PRCHECK_LLM_API_KEY: check takes the LLM key env var out, so a test can prove the key never reaches
// Playwright.
const RECORDED_KEYS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
  'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR',
  'PRCHECK_LLM_API_KEY',
];

const env = {};
for (const key of RECORDED_KEYS) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
if (process.env.FAKE_PW_RECORD) {
  fs.appendFileSync(process.env.FAKE_PW_RECORD, `${JSON.stringify({ argv: process.argv.slice(2), env })}\n`);
}
if (process.env.FAKE_PW_REPORT) fs.copyFileSync(process.env.FAKE_PW_REPORT, process.env.PLAYWRIGHT_JSON_OUTPUT_FILE);
if (process.env.FAKE_PW_STDERR) process.stderr.write(process.env.FAKE_PW_STDERR);
if (process.env.FAKE_PW_HANG === '1') {
  // A pending promise alone lets Node exit (code 13), so stdin is held open as well. No timer.
  process.stdin.resume();
  await new Promise(() => {});
}
process.exitCode = Number(process.env.FAKE_PW_EXIT ?? '0');
