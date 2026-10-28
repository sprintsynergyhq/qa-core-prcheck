// The one sticky PR comment. Pull requests are issues, so the issue comment endpoints are used:
// https://docs.github.com/en/rest/issues/comments
//   GET   /repos/{owner}/{repo}/issues/{issue_number}/comments   (per_page at most 100)
//   POST  /repos/{owner}/{repo}/issues/{issue_number}/comments
//   PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}

import { MAX_SUMMARY_BYTES, SUMMARY_MARKER } from '../report/index.js';
import { getAllPages } from './api.js';
import { GitHubError, type GitHubClient, type IssueComment } from './types.js';

// The author of comments made with the workflow GITHUB_TOKEN. Not confirmed by the GitHub docs, which
// name no bot account; the live checks confirm it on a real pull request.
export const BOT_LOGIN = 'github-actions[bot]';
export const BOT_TYPE = 'Bot';

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
 * The sticky comment among comments, or null. A comment matches only when github-actions[bot] (a Bot)
 * wrote it and its body starts with marker, so a person's comment is never picked. When several match,
 * the oldest (lowest id) wins and the others are counted as duplicates. Pure.
 */
export function findStickyComment(comments: unknown[], marker: string): StickyMatch | null {
  const matches = comments
    .map(asComment)
    .filter((c): c is IssueComment => c !== null && c.user?.login === BOT_LOGIN && c.user.type === BOT_TYPE && c.body.startsWith(marker))
    .sort((a, b) => a.id - b.id);
  return matches.length === 0 ? null : { comment: matches[0]!, duplicates: matches.length - 1 };
}

function repoPath({ owner, repo }: Pick<PullRequestTarget, 'owner' | 'repo'>): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function issuePath(target: Omit<PullRequestTarget, 'client'>): string {
  return `${repoPath(target)}/issues/${target.number}`;
}

/** Reads every page of the pull request's comments and returns the sticky one, or null. */
export async function findStickyCommentOnPullRequest(target: PullRequestTarget): Promise<StickyMatch | null> {
  const comments = await getAllPages(target.client, `${issuePath(target)}/comments?per_page=100`);
  return findStickyComment(comments, SUMMARY_MARKER);
}

function checkBody(body: string): void {
  if (!body.startsWith(SUMMARY_MARKER)) throw new GitHubError('The summary does not start with the qa-core-prcheck marker');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_SUMMARY_BYTES) throw new GitHubError(`The summary has ${bytes} bytes, more than the cap of ${MAX_SUMMARY_BYTES}`);
}

function createdOrUpdated(json: unknown, action: 'created' | 'updated'): { id: number; url: string } {
  const comment = asComment({ body: '', ...(json as object) });
  if (comment === null) throw new GitHubError(`The GitHub API did not return the ${action} comment`);
  return { id: comment.id, url: comment.html_url };
}

/**
 * Updates the sticky comment in place, or creates it when there is none. The body must start with
 * SUMMARY_MARKER and fit in MAX_SUMMARY_BYTES; otherwise nothing is sent. Duplicates are left as they are.
 */
export async function upsertStickyComment(
  options: PullRequestTarget & { body: string },
): Promise<{ action: 'created' | 'updated'; id: number; url: string; duplicates: number }> {
  const { client, body } = options;
  checkBody(body);
  const match = await findStickyCommentOnPullRequest(options);
  if (match === null) {
    const response = await client.request('POST', `${issuePath(options)}/comments`, { body });
    return { action: 'created', ...createdOrUpdated(response.json, 'created'), duplicates: 0 };
  }
  const response = await client.request('PATCH', `${repoPath(options)}/issues/comments/${match.comment.id}`, { body });
  return { action: 'updated', ...createdOrUpdated(response.json, 'updated'), duplicates: match.duplicates };
}
