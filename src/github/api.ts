// A small GitHub REST client on Node's built-in fetch. The token goes only into the Authorization header
// of requests to the origin of the API URL, and never into a message.
//
// Docs used:
// - Headers and versions: https://docs.github.com/en/rest/about-the-rest-api/api-versions
// - Pagination and the link header: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api

import { VERSION } from '../version.js';
import { GitHubError, type ApiResponse, type GitHubClient } from './types.js';

// The newest version listed in the API versions docs; 2022-11-28 is still supported until 2028-03-10.
export const API_VERSION = '2026-03-10';
// Longest API error message kept, in characters; longer ones are cut and end in "...". A chosen limit.
export const MESSAGE_MAX_CHARS = 200;
// Most pages read for one list, 100 items each. A chosen limit that stops a runaway loop.
export const MAX_PAGES = 50;

// Hosts that may use plain http, so tests can run a fake API on this machine. Everything else needs https.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export interface ClientOptions {
  token: string;
  apiUrl: string;
  fetch: typeof fetch;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

/** The error code of a failed fetch (for example ECONNREFUSED), never its message or request. */
function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.name : 'unknown error';
}

/** The API URL as a URL object, or a GitHubError that does not repeat the URL. */
function checkApiUrl(apiUrl: string): URL {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new GitHubError('GITHUB_API_URL is not a valid URL');
  }
  if (url.username !== '' || url.password !== '') throw new GitHubError('GITHUB_API_URL must not hold a user name or password');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new GitHubError('GITHUB_API_URL must use https (plain http only for 127.0.0.1, ::1 or localhost)');
}

/**
 * A client for the REST API at apiUrl. Every request sends the documented Accept header, the API
 * version, a User-Agent and the token as a Bearer token. A status outside 200 to 299 throws a
 * GitHubError with the method, the path without its query, the status and the API message.
 */
export function createGitHubClient(options: ClientOptions): GitHubClient {
  const { token, fetch: fetchFn } = options;
  if (token === '') throw new GitHubError('GITHUB_TOKEN is not set');
  const base = checkApiUrl(options.apiUrl);
  const root = base.href.replace(/\/+$/, '');
  // A second guard: no message can carry the token, even if an API message repeated it.
  const scrub = (text: string): string => text.split(token).join('***');

  async function request(method: string, target: string, body?: unknown): Promise<ApiResponse> {
    const url = new URL(target.startsWith('/') ? `${root}${target}` : target);
    if (url.origin !== base.origin) throw new GitHubError(`Refusing a ${method} request outside the GitHub API URL`);
    const where = `${method} ${url.pathname}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': `qa-core-prcheck/${VERSION}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchFn(url.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      throw new GitHubError(`GitHub API ${where} could not be reached: ${causeCode(error)}`);
    }

    const text = await response.text();
    let json: unknown = null;
    let validJson = true;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        validJson = false;
      }
    }
    if (response.status < 200 || response.status > 299) {
      const message = validJson && typeof (json as { message?: unknown } | null)?.message === 'string'
        ? `: ${oneLine(scrub((json as { message: string }).message), MESSAGE_MAX_CHARS)}`
        : '';
      throw new GitHubError(`GitHub API ${where} failed with status ${response.status}${message}`, response.status);
    }
    if (!validJson) throw new GitHubError(`GitHub API ${where} returned a body that is not JSON`, response.status);
    return { status: response.status, json, link: response.headers.get('link') };
  }

  return { apiUrl: base.href, request };
}

/**
 * The rel="next" URL of a link header, or null when there is none or it is on another origin than
 * apiUrl, so a page link can never send the token somewhere else. Pure.
 */
export function parseNextLink(link: string | null, apiUrl: string): string | null {
  if (link === null) return null;
  for (const match of link.matchAll(/<([^>]*)>\s*;\s*rel="([^"]*)"/g)) {
    if (!match[2]!.split(/\s+/).includes('next')) continue;
    try {
      const next = new URL(match[1]!);
      return next.origin === new URL(apiUrl).origin ? next.href : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Every item of a list, following rel="next" links for at most MAX_PAGES pages. */
export async function getAllPages(client: GitHubClient, path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let target: string | null = path;
  for (let page = 1; target !== null; page++) {
    if (page > MAX_PAGES) throw new GitHubError(`GitHub API GET ${path.split('?')[0]} has more than ${MAX_PAGES} pages`);
    const response = await client.request('GET', target);
    if (!Array.isArray(response.json)) throw new GitHubError(`GitHub API GET ${new URL(target, client.apiUrl).pathname} did not return a list`);
    items.push(...(response.json as unknown[]));
    target = parseNextLink(response.link, client.apiUrl);
  }
  return items;
}
