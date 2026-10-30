/** What a GitHubError says about the request that failed. Every field is optional. */
export interface GitHubErrorDetails {
  method?: string | null;    // the HTTP method of the failed request; null (the default) when none was sent
  rateLimited?: boolean;     // 429, or 403 with a retry-after header, x-ratelimit-remaining 0 or an API message that says rate limit
  retryable?: boolean;       // a network error, a timeout, any 5xx, 429 or a rate limited 403 (headers or message)
  waitMs?: number | null;    // the wait GitHub asked for in retry-after or x-ratelimit-reset; null when it named none
}

/**
 * An expected failure from the GitHub API or its input. The message is plain, meant for the user, and
 * never holds the token, a query or a request header. status is the HTTP status, or null when there was
 * none. rateLimited tells a rate limit 403 from a permission 403, by its headers or by an API message that
 * says rate limit (a secondary rate limit 403 may come with no header), following
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 */
export class GitHubError extends Error {
  readonly status: number | null;
  readonly method: string | null;
  readonly rateLimited: boolean;
  readonly retryable: boolean;
  readonly waitMs: number | null;

  constructor(message: string, status: number | null = null, details: GitHubErrorDetails = {}) {
    super(message);
    this.status = status;
    this.method = details.method ?? null;
    this.rateLimited = details.rateLimited ?? false;
    this.retryable = details.retryable ?? false;
    this.waitMs = details.waitMs ?? null;
  }
}

/** The pull request a pull_request event is about. */
export interface PullRequestInfo {
  owner: string;             // of the base repository
  repo: string;              // the base repository name
  number: number;
  baseRepo: string;          // owner/name of the base repository
  headRepo: string | null;   // owner/name of the head repository; null when the event has none
  isFork: boolean;           // the head repository is missing or not the base repository
}

/** One API answer: the status, the parsed JSON body (null when empty) and the link header. */
export interface ApiResponse {
  status: number;
  json: unknown;
  link: string | null;
}

export interface GitHubClient {
  readonly apiUrl: string;
  /**
   * target is a path that starts with /, or a full URL on the origin of apiUrl. A GET or PATCH that fails
   * in a retryable way is tried again; a POST is sent once.
   */
  request(method: string, target: string, body?: unknown): Promise<ApiResponse>;
  /**
   * Waits as request does before retry number attempt after error: the wait GitHub asked for, or the
   * backoff. Throws a GitHubError at once when GitHub asked for longer than the retry limit.
   */
  waitToRetry(error: GitHubError, attempt: number): Promise<void>;
}

/** The fields of an issue comment this tool reads. */
export interface IssueComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string; type: string } | null;
}

/** The account whose comment is the sticky one: a login and the user type GitHub gives it. */
export interface CommentAuthor {
  login: string;
  type: 'Bot' | 'User';
}
