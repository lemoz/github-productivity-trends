import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { rateLimiter } from "./rate-limiter";
import { prisma } from "./prisma";

// Initialize Octokit with auth token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize GraphQL client
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
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
      const response = await octokit.search.users({
        q: query,
        sort: "followers",
        order,
        per_page: perPage,
        page,
      });

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
      const response = await octokit.search.repos({
        q: `language:${language} stars:>=${minStars}`,
        sort: "stars",
        order,
        per_page: perPage,
        page,
      });

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
      const response = await octokit.users.getByUsername({ username });

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
      const response = await octokit.repos.get({ owner, repo });

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
      const response = await octokit.repos.getContributorsStats({ owner, repo });

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
      const response = await octokit.repos.getCodeFrequencyStats({ owner, repo });

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

      const response = await graphqlWithAuth<{
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
      });

      await throttleGraphql();
      return response.user.contributionsCollection;
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
      const response = await octokit.pulls.list({
        owner,
        repo,
        state,
        per_page: perPage,
        page,
        sort: "updated",
        direction: "desc",
      });

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
      const response = await octokit.issues.listForRepo({
        owner,
        repo,
        state,
        per_page: perPage,
        page,
        sort: "updated",
        direction: "desc",
      });

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
