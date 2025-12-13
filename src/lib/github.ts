import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { rateLimiter } from "./rate-limiter";
import { prisma } from "./prisma";

const requestTimeoutRaw = Number(process.env.GITHUB_REQUEST_TIMEOUT_MS ?? 30_000);
const GITHUB_REQUEST_TIMEOUT_MS = Number.isFinite(requestTimeoutRaw)
  ? Math.max(0, requestTimeoutRaw)
  : 30_000;

// Initialize Octokit with auth token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: {
    timeout: GITHUB_REQUEST_TIMEOUT_MS,
  },
});

// Initialize GraphQL client
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
  request: {
    timeout: GITHUB_REQUEST_TIMEOUT_MS,
  },
});

// Cache TTL in seconds
const CACHE_TTL = {
  USER_PROFILE: 24 * 60 * 60, // 24 hours
  REPO_STATS: 6 * 60 * 60, // 6 hours
  SEARCH_RESULTS: 12 * 60 * 60, // 12 hours
  CONTRIBUTION_DATA: 1 * 60 * 60, // 1 hour
};

const graphqlThrottleRaw = Number(process.env.GRAPHQL_THROTTLE_MS ?? 800);
const GRAPHQL_THROTTLE_MS = Number.isFinite(graphqlThrottleRaw)
  ? graphqlThrottleRaw
  : 800;

async function throttleGraphql() {
  if (GRAPHQL_THROTTLE_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, GRAPHQL_THROTTLE_MS));
  }
}

const retryAttemptsRaw = Number(process.env.GITHUB_RETRY_ATTEMPTS ?? 3);
const GITHUB_RETRY_ATTEMPTS = Number.isFinite(retryAttemptsRaw)
  ? Math.max(1, retryAttemptsRaw)
  : 3;

const retryBaseDelayRaw = Number(process.env.GITHUB_RETRY_BASE_DELAY_MS ?? 800);
const GITHUB_RETRY_BASE_DELAY_MS = Number.isFinite(retryBaseDelayRaw)
  ? Math.max(0, retryBaseDelayRaw)
  : 800;

const retryMaxDelayRaw = Number(process.env.GITHUB_RETRY_MAX_DELAY_MS ?? 8000);
const GITHUB_RETRY_MAX_DELAY_MS = Number.isFinite(retryMaxDelayRaw)
  ? Math.max(0, retryMaxDelayRaw)
  : 8000;

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  const code = e.code;
  if (typeof code === "string") return code;
  const cause = e.cause;
  if (cause && typeof cause === "object") {
    const c = cause as Record<string, unknown>;
    if (typeof c.code === "string") return c.code;
  }
  return undefined;
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.status === "number") return e.status;
  const response = e.response;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (typeof r.status === "number") return r.status;
  }
  return undefined;
}

function isRetryableError(error: unknown) {
  const status = getStatusCode(error);
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;

  const code = getErrorCode(error);
  if (
    code &&
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"].includes(code)
  ) {
    return true;
  }

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (e.name === "AbortError") return true;
    if (typeof e.message === "string" && e.message.includes("fetch failed")) return true;
  }

  return false;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GITHUB_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === GITHUB_RETRY_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      const backoff = Math.min(
        GITHUB_RETRY_MAX_DELAY_MS,
        GITHUB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      );
      const jitter = Math.floor(Math.random() * 200);
      console.warn(`[GitHub] retry ${attempt}/${GITHUB_RETRY_ATTEMPTS} (${context})`);
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}

// Helper to get cached data or fetch fresh
async function getCachedOrFetch<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  // Check cache first
  const cached = await prisma.aPICache.findUnique({
    where: { cacheKey },
  });

  if (cached && cached.expiresAt > new Date()) {
    return JSON.parse(cached.responseData) as T;
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Store in cache
  await prisma.aPICache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      endpoint: cacheKey.split(":")[0],
      responseData: JSON.stringify(data),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
    update: {
      responseData: JSON.stringify(data),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });

  return data;
}

// Search for users by contribution count (for stratified sampling)
export async function searchUsers(
  minFollowers: number,
  maxFollowers: number | null,
  perPage = 30,
  page = 1,
  order: "asc" | "desc" = "desc"
) {
  await rateLimiter.waitIfNeeded("search");

  const query = maxFollowers
    ? `followers:${minFollowers}..${maxFollowers} type:user`
    : `followers:>=${minFollowers} type:user`;

  const cacheKey = `search:users:${minFollowers}-${maxFollowers ?? "plus"}:${perPage}:${page}:${order}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () =>
          octokit.search.users({
            q: query,
            sort: "followers",
            order,
            per_page: perPage,
            page,
          }),
        `search:users:${minFollowers}-${maxFollowers ?? "plus"}:${page}:${order}`
      );

      // Update rate limit info
      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "search"
      );

      return response.data.items;
    },
    CACHE_TTL.SEARCH_RESULTS
  );
}

// Search for popular repositories by language
export async function searchRepos(
  language: string,
  minStars = 1000,
  perPage = 30,
  page = 1,
  order: "asc" | "desc" = "desc"
) {
  await rateLimiter.waitIfNeeded("search");

  const cacheKey = `search:repos:${language}:${minStars}:${perPage}:${page}:${order}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () =>
          octokit.search.repos({
            q: `language:${language} stars:>=${minStars}`,
            sort: "stars",
            order,
            per_page: perPage,
            page,
          }),
        `search:repos:${language}:${minStars}:${page}:${order}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "search"
      );

      return response.data.items;
    },
    CACHE_TTL.SEARCH_RESULTS
  );
}

// Get user profile
export async function getUser(username: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `user:${username}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () => octokit.users.getByUsername({ username }),
        `rest:user:${username}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      return response.data;
    },
    CACHE_TTL.USER_PROFILE
  );
}

// Get repository info
export async function getRepo(owner: string, repo: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `repo:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () => octokit.repos.get({ owner, repo }),
        `rest:repo:${owner}/${repo}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      return response.data;
    },
    CACHE_TTL.REPO_STATS
  );
}

// Get repository contributor stats (includes weekly commit counts)
export async function getContributorStats(owner: string, repo: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `stats:contributors:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () => octokit.repos.getContributorsStats({ owner, repo }),
        `rest:contributors-stats:${owner}/${repo}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      // GitHub may return 202 if stats are being computed
      if (response.status === 202) {
        return null;
      }

      return response.data;
    },
    CACHE_TTL.REPO_STATS
  );
}

// Get code frequency stats (weekly additions/deletions)
export async function getCodeFrequency(owner: string, repo: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `stats:code_frequency:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () => octokit.repos.getCodeFrequencyStats({ owner, repo }),
        `rest:code-frequency:${owner}/${repo}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      if (response.status === 202) {
        return null;
      }

      return response.data;
    },
    CACHE_TTL.REPO_STATS
  );
}

// Get user contribution data via GraphQL
export async function getUserContributions(
  username: string,
  from: string,
  to: string
) {
  await rateLimiter.waitIfNeeded("graphql");

  const cacheKey = `contributions:${username}:${from}:${to}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      try {
        const query = `
          query($username: String!, $from: DateTime!, $to: DateTime!) {
            user(login: $username) {
              contributionsCollection(from: $from, to: $to) {
                totalCommitContributions
                totalPullRequestContributions
                totalPullRequestReviewContributions
                totalIssueContributions
                contributionCalendar {
                  totalContributions
                  weeks {
                    contributionDays {
                      contributionCount
                      date
                    }
                  }
                }
              }
            }
          }
        `;

        const response = await withRetries(
          () =>
            graphqlWithAuth<{
              user: {
                contributionsCollection: {
                  totalCommitContributions: number;
                  totalPullRequestContributions: number;
                  totalPullRequestReviewContributions: number;
                  totalIssueContributions: number;
                  contributionCalendar: {
                    totalContributions: number;
                    weeks: Array<{
                      contributionDays: Array<{
                        contributionCount: number;
                        date: string;
                      }>;
                    }>;
                  };
                };
              };
            }>(query, {
              username,
              from,
              to,
            }),
          `graphql:contributions:${username}:${from}:${to}`
        );

        return response.user.contributionsCollection;
      } finally {
        await throttleGraphql();
      }
    },
    CACHE_TTL.CONTRIBUTION_DATA
  );
}

// Get PRs for a repository
export async function getRepoPRs(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "all",
  perPage = 100,
  page = 1
) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `prs:${owner}/${repo}:${state}:${perPage}:${page}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () =>
          octokit.pulls.list({
            owner,
            repo,
            state,
            per_page: perPage,
            page,
            sort: "updated",
            direction: "desc",
          }),
        `rest:prs:${owner}/${repo}:${state}:${page}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      return response.data;
    },
    CACHE_TTL.REPO_STATS
  );
}

// Get issues for a repository
export async function getRepoIssues(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "all",
  perPage = 100,
  page = 1
) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `issues:${owner}/${repo}:${state}:${perPage}:${page}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      const response = await withRetries(
        () =>
          octokit.issues.listForRepo({
            owner,
            repo,
            state,
            per_page: perPage,
            page,
            sort: "updated",
            direction: "desc",
          }),
        `rest:issues:${owner}/${repo}:${state}:${page}`
      );

      rateLimiter.updateFromHeaders(
        response.headers as Record<string, string>,
        "rest"
      );

      // Filter out PRs (GitHub includes PRs in issues endpoint)
      return response.data.filter((issue) => !issue.pull_request);
    },
    CACHE_TTL.REPO_STATS
  );
}

// Get repository README text (decoded)
export async function getRepoReadme(owner: string, repo: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `readme:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      try {
        const response = await octokit.repos.getReadme({ owner, repo });

        rateLimiter.updateFromHeaders(
          response.headers as Record<string, string>,
          "rest"
        );

        const content = response.data.content
          ? Buffer.from(response.data.content, "base64").toString("utf8")
          : "";
        return content;
      } catch {
        return null;
      }
    },
    CACHE_TTL.REPO_STATS
  );
}

// List files at the repository root (names only)
export async function listRepoRootFiles(owner: string, repo: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `contents:root:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      try {
        const response = await octokit.repos.getContent({
          owner,
          repo,
          path: "",
        });

        rateLimiter.updateFromHeaders(
          response.headers as Record<string, string>,
          "rest"
        );

        if (Array.isArray(response.data)) {
          return response.data.map((item) => item.name);
        }
        return [];
      } catch {
        return [];
      }
    },
    CACHE_TTL.REPO_STATS
  );
}

export async function listRepoDirFiles(owner: string, repo: string, path: string) {
  await rateLimiter.waitIfNeeded("rest");

  const cacheKey = `contents:${path}:${owner}/${repo}`;

  return getCachedOrFetch(
    cacheKey,
    async () => {
      try {
        const response = await octokit.repos.getContent({
          owner,
          repo,
          path,
        });

        rateLimiter.updateFromHeaders(
          response.headers as Record<string, string>,
          "rest"
        );

        if (Array.isArray(response.data)) {
          return response.data.map((item) => item.name);
        }
        return [];
      } catch {
        return [];
      }
    },
    CACHE_TTL.REPO_STATS
  );
}

// Export rate limiter status for monitoring
export function getRateLimitStatus() {
  return rateLimiter.getStatus();
}
