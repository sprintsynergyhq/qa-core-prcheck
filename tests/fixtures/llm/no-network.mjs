// Loaded with node --import by the check CLI tests. It replaces the built-in fetch with one that
// records the call in $PRCHECK_TEST_FETCH_RECORD and throws, so a CLI test can prove that no LLM request
// was made and no request can ever leave the process. Not a test file.

import fs from 'node:fs';

globalThis.fetch = async (url) => {
  if (process.env.PRCHECK_TEST_FETCH_RECORD) fs.appendFileSync(process.env.PRCHECK_TEST_FETCH_RECORD, `${String(url)}\n`);
  throw new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } });
};
