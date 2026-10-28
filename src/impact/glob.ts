// Glob syntax for repo-relative POSIX paths. Case sensitive, and the match covers the whole path.
//   **/  at the start or after a /: zero or more whole folders
//   **   anywhere else: any run of characters, including /
//   *    any run of characters except /
//   ?    one character except /
// Every other character is literal. There are no braces, negation or character classes.

const REGEXP_SPECIAL = /[\\^$.|+()[\]{}]/g;

/** Turns a glob into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i]!;
    if (char === '*' && glob[i + 1] === '*') {
      const startsFolder = i === 0 || glob[i - 1] === '/';
      if (startsFolder && glob[i + 2] === '/') {
        source += '(?:[^/]+/)*';
        i += 3;
      } else {
        source += '.*';
        i += 2;
      }
    } else if (char === '*') {
      source += '[^/]*';
      i += 1;
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else {
      source += char.replace(REGEXP_SPECIAL, '\\$&');
      i += 1;
    }
  }
  // s: a dot also matches a line break, which a quoted git path can hold.
  return new RegExp(`^${source}$`, 's');
}

/** True when the glob matches the whole path. */
export function matchesGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}
