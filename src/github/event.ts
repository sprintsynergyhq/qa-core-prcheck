// Reads the pull request from the event payload GitHub writes to GITHUB_EVENT_PATH. Pure.
//
// The fields come from the pull request object, whose schema the webhook payload docs refer to:
// https://docs.github.com/en/rest/pulls/pulls
// pull_request.number, pull_request.base.repo.full_name and pull_request.head.repo.full_name. That
// schema lists head.repo as required. A head.repo of null (a deleted fork) is not confirmed by the docs,
// so it is handled as a fork rather than trusted never to happen.

import { GitHubError, type PullRequestInfo } from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function missing(field: string): never {
  throw new GitHubError(`The pull_request event has no ${field}`);
}

/** owner/name from a full_name, or the error for field. */
function fullName(repo: unknown, field: string): string {
  if (!isObject(repo) || typeof repo.full_name !== 'string') missing(field);
  const parts = repo.full_name.split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') missing(field);
  return repo.full_name;
}

/**
 * The pull request of a pull_request event, or null for any other event name, pull_request_target
 * included. isFork is true when the head repository is missing or differs from the base repository.
 * Throws GitHubError when a needed field is missing.
 */
export function readPullRequestEvent(event: unknown, eventName: string): PullRequestInfo | null {
  if (eventName !== 'pull_request') return null;
  if (!isObject(event) || !isObject(event.pull_request)) missing('pull_request');
  const pr = event.pull_request;
  if (typeof pr.number !== 'number' || !Number.isInteger(pr.number) || pr.number < 1) missing('pull_request.number');
  if (!isObject(pr.base)) missing('pull_request.base');
  const baseRepo = fullName(pr.base.repo, 'pull_request.base.repo.full_name');
  if (!isObject(pr.head)) missing('pull_request.head');
  const headRepo = pr.head.repo === null ? null : fullName(pr.head.repo, 'pull_request.head.repo.full_name');
  const [owner, repo] = baseRepo.split('/') as [string, string];
  return { owner, repo, number: pr.number, baseRepo, headRepo, isFork: headRepo === null || headRepo !== baseRepo };
}
