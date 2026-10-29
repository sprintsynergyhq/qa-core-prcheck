// The one sticky PR comment. Pull requests are issues, so the issue comment endpoints are used:
// https://docs.github.com/en/rest/issues/comments
//   GET   /repos/{owner}/{repo}/issues/{issue_number}/comments   (per_page at most 100)
//   POST  /repos/{owner}/{repo}/issues/{issue_number}/comments   ("Creating content too quickly using this
//                                                                endpoint may result in secondary rate limiting.")
//   PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
// and, only for a person as the comment author, GET /user (https://docs.github.com/en/rest/users/users).

import { MAX_SUMMARY_BYTES, SUMMARY_MARKER } from '../report/index.js';
import { getAllPages } from './api.js';
import { GitHubError, type CommentAuthor, type GitHubClient, type IssueComment } from './types.js';

// The default author: comments made with the workflow GITHUB_TOKEN. Not confirmed by the GitHub docs,
// which say the token "is a GitHub App installation access token" and that an installation token
// "identifies the app as a GitHub App bot account, such as @jenkins[bot]", but name no login for it.
// The live checks confirm it on a real pull request.
export const BOT_LOGIN = 'github-actions[bot]';
export const BOT_TYPE = 'Bot';
export const DEFAULT_COMMENT_AUTHOR: CommentAuthor = { login: BOT_LOGIN, type: BOT_TYPE };

// A login PRCHECK_COMMENT_AUTHOR may name: letters, digits and single hyphens, not at either end, then
// optionally [bot]. From the docs page
// https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication
// ("can only contain alphanumeric characters and dashes", "can't start or end with a dash", "can't contain
// two consecutive dashes"); [bot] from the @jenkins[bot] example above. That page also says managed user
// logins hold an underscore and a short code: they are refused.
const LOGIN_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\[bot\])?$/;

export interface StickyMatch { comment: IssueComment; duplicates: number }

export interface PullRequestTarget { client: GitHubClient; owner: string; repo: string; number: number }

function asComment(value: unknown): IssueComment | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, body, html_url: url, user } = value as Record<string, unknown>;
  if (typeof id !== 'number' || typeof body !== 'string' || typeof url !== 'string') return null;
  const login = (user as { login?: unknown } | null)?.login;
  const type = (user as { type?: unknown } | null)?.type;
  return { id, body, html_url: url, user: typeof login === 'string' && typeof type === 'string' ? { login, type } : null };
}

/**
 * The author a PRCHECK_COMMENT_AUTHOR value names: empty or unset gives DEFAULT_COMMENT_AUTHOR, a login
 * ending in [bot] a Bot, any other login a User. Null when the value is not a login. Pure.
 */
export function parseCommentAuthor(value: string | undefined): CommentAuthor | null {
  if (value === undefined || value === '') return DEFAULT_COMMENT_AUTHOR;
  if (!LOGIN_PATTERN.test(value)) return null;
  return { login: value, type: value.endsWith('[bot]') ? 'Bot' : 'User' };
}

/**
 * The author whose comment may be edited. A Bot is returned as it is, with no request. For a User, GET
 * /user must return the same login, compared without case (that logins ignore case is not confirmed by
 * the GitHub docs), and GitHub's own spelling is returned. Otherwise a GitHubError is thrown, so a
 * person's comment is only ever edited with that person's own token.
 */
export async function confirmCommentAuthor(client: GitHubClient, author: CommentAuthor): Promise<CommentAuthor> {
  if (author.type === 'Bot') return author;
  const failure = (reason: string, cause: GitHubError | null = null): GitHubError => new GitHubError(
    `PRCHECK_COMMENT_AUTHOR is ${author.login}, but the token's account could not be confirmed as ${author.login} (${reason})`,
    cause?.status ?? null,
    { method: 'GET', rateLimited: cause?.rateLimited ?? false },
  );
  let json: unknown;
  try {
    json = (await client.request('GET', '/user')).json;
  } catch (error) {
    if (error instanceof GitHubError) throw failure(error.message, error);
    throw error;
  }
  const login = (json as { login?: unknown } | null)?.login;
  if (typeof login !== 'string') throw failure('GET /user returned no login');
  if (login.toLowerCase() !== author.login.toLowerCase()) throw failure(`GET /user returned ${login}`);
  return { login, type: 'User' };
}

/**
 * The sticky comment among comments, or null. A comment matches only when author wrote it, with the
 * same login and user type, and its body starts with marker, so a person's comment is never picked for
 * a bot, nor a bot's for a person. When several match, the oldest (lowest id) wins and the others are
 * counted as duplicates. Pure.
 */
export function findStickyComment(comments: unknown[], marker: string, author: CommentAuthor): StickyMatch | null {
  const matches = comments
    .map(asComment)
    .filter((c): c is IssueComment => c !== null && c.user?.login === author.login && c.user.type === author.type && c.body.startsWith(marker))
    .sort((a, b) => a.id - b.id);
  return matches.length === 0 ? null : { comment: matches[0]!, duplicates: matches.length - 1 };
}

function repoPath({ owner, repo }: Pick<PullRequestTarget, 'owner' | 'repo'>): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function issuePath(target: Omit<PullRequestTarget, 'client'>): string {
  return `${repoPath(target)}/issues/${target.number}`;
}

/** Reads every page of the pull request's comments and returns author's sticky one, or null. */
export async function findStickyCommentOnPullRequest(target: PullRequestTarget, author: CommentAuthor): Promise<StickyMatch | null> {
  const comments = await getAllPages(target.client, `${issuePath(target)}/comments?per_page=100`);
  return findStickyComment(comments, SUMMARY_MARKER, author);
}

function checkBody(body: string): void {
  if (!body.startsWith(SUMMARY_MARKER)) throw new GitHubError('The summary does not start with the qa-core-prcheck marker');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_SUMMARY_BYTES) throw new GitHubError(`The summary has ${bytes} bytes, more than the cap of ${MAX_SUMMARY_BYTES}`);
}

function createdOrUpdated(json: unknown, action: 'created' | 'updated'): { id: number; url: string; author: string | null } {
  const comment = asComment({ body: '', ...(json as object) });
  if (comment === null) throw new GitHubError(`The GitHub API did not return the ${action} comment`);
  return { id: comment.id, url: comment.html_url, author: comment.user?.login ?? null };
}

export interface UpsertResult {
  action: 'created' | 'updated';
  id: number;
  url: string;
  duplicates: number;
  author: string | null;     // the login GitHub gives as the comment's author; null when the answer has none
}

/**
 * Updates author's sticky comment in place, or creates it when there is none. The body must start with
 * SUMMARY_MARKER and fit in MAX_SUMMARY_BYTES; otherwise nothing is sent. Duplicates are left as they are.
 * The client never sends a POST twice. When the POST fails in a way worth retrying, it may still have
 * made the comment, so after the wait the comments are listed again: the sticky comment is updated if
 * one is there now, else one more POST is sent. A second failure is thrown.
 */
export async function upsertStickyComment(options: PullRequestTarget & { body: string; author: CommentAuthor }): Promise<UpsertResult> {
  const { client, body, author } = options;
  checkBody(body);
  const update = async (match: StickyMatch): Promise<UpsertResult> => {
    const response = await client.request('PATCH', `${repoPath(options)}/issues/comments/${match.comment.id}`, { body });
    return { action: 'updated', ...createdOrUpdated(response.json, 'updated'), duplicates: match.duplicates };
  };
  const create = async (): Promise<UpsertResult> => {
    const response = await client.request('POST', `${issuePath(options)}/comments`, { body });
    return { action: 'created', ...createdOrUpdated(response.json, 'created'), duplicates: 0 };
  };

  const match = await findStickyCommentOnPullRequest(options, author);
  if (match !== null) return update(match);
  try {
    return await create();
  } catch (error) {
    if (!(error instanceof GitHubError) || !error.retryable) throw error;
    await client.waitToRetry(error, 1);
    const again = await findStickyCommentOnPullRequest(options, author);
    return again === null ? create() : update(again);
  }
}
