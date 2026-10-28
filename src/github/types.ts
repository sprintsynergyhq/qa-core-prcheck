/**
 * An expected failure from the GitHub API or its input. The message is plain, meant for the user, and
 * never holds the token or a request header. status is the HTTP status, or null when there was none.
 */
export class GitHubError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
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
  /** target is a path that starts with /, or a full URL on the origin of apiUrl. */
  request(method: string, target: string, body?: unknown): Promise<ApiResponse>;
}

/** The fields of an issue comment this tool reads. */
export interface IssueComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string; type: string } | null;
}
