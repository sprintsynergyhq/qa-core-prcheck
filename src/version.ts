import { readFileSync } from 'node:fs';

// package.json sits one level above both src/ (typecheck) and dist/ (runtime).
const packageJsonUrl = new URL('../package.json', import.meta.url);

function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('version' in pkg) || typeof pkg.version !== 'string') {
    throw new Error(`No version string in ${packageJsonUrl.pathname}`);
  }
  return pkg.version;
}

export const VERSION: string = readVersion();
