import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  searchUsers,
  searchRepos,
  getUser,
  getUserContributions,
  getContributorStats,
  getRepoPRs,
  getRepoIssues,
  getRateLimitStatus,
} from "@/lib/github";
import { TRACKED_LANGUAGES } from "@/types/metrics";

const USER_BANDS: Array<{
  tier: "top" | "mid" | "casual";
  minFollowers: number;
  maxFollowers: number | null;
  target: number;
}> = [
  { tier: "top", minFollowers: 10000, maxFollowers: null, target: 100 },
  { tier: "top", minFollowers: 5000, maxFollowers: 10000, target: 100 },
  { tier: "mid", minFollowers: 2000, maxFollowers: 5000, target: 100 },
  { tier: "mid", minFollowers: 1000, maxFollowers: 2000, target: 100 },
  { tier: "mid", minFollowers: 500, maxFollowers: 1000, target: 100 },
  { tier: "casual", minFollowers: 300, maxFollowers: 500, target: 100 },
  { tier: "casual", minFollowers: 200, maxFollowers: 300, target: 100 },
  { tier: "casual", minFollowers: 150, maxFollowers: 200, target: 100 },
  { tier: "casual", minFollowers: 100, maxFollowers: 150, target: 100 },
  { tier: "casual", minFollowers: 50, maxFollowers: 100, target: 100 },
];

const BASELINE_YEARS = [2020, 2021] as const;
const baselineMinRaw = Number(process.env.BASELINE_MIN_CONTRIBUTIONS ?? 50);
const BASELINE_MIN_CONTRIBUTIONS = Number.isFinite(baselineMinRaw)
  ? baselineMinRaw
  : 50;
const seedRaw = Number(process.env.SAMPLING_SEED ?? 42);
const DEFAULT_SAMPLING_SEED = Number.isFinite(seedRaw) ? seedRaw : 42;

const usersPerBandEnvRaw = process.env.USERS_PER_BAND
  ? Number(process.env.USERS_PER_BAND)
  : NaN;
const USERS_PER_BAND_ENV = Number.isFinite(usersPerBandEnvRaw)
  ? usersPerBandEnvRaw
  : null;

const userSearchPerPageEnvRaw = process.env.USER_SEARCH_PER_PAGE
  ? Number(process.env.USER_SEARCH_PER_PAGE)
  : NaN;
const USER_SEARCH_PER_PAGE_ENV = Number.isFinite(userSearchPerPageEnvRaw)
  ? userSearchPerPageEnvRaw
  : 100;

const userSearchPagesPerOrderEnvRaw = process.env.USER_SEARCH_PAGES_PER_ORDER
  ? Number(process.env.USER_SEARCH_PAGES_PER_ORDER)
  : NaN;
const USER_SEARCH_PAGES_PER_ORDER_ENV = Number.isFinite(userSearchPagesPerOrderEnvRaw)
  ? userSearchPagesPerOrderEnvRaw
  : 2;

const repoLanguageCountEnvRaw = process.env.REPO_LANGUAGE_COUNT
  ? Number(process.env.REPO_LANGUAGE_COUNT)
  : NaN;
const REPO_LANGUAGE_COUNT_ENV = Number.isFinite(repoLanguageCountEnvRaw)
  ? repoLanguageCountEnvRaw
  : 5;

const reposPerLanguageEnvRaw = process.env.REPOS_PER_LANGUAGE
  ? Number(process.env.REPOS_PER_LANGUAGE)
  : NaN;
const REPOS_PER_LANGUAGE_ENV = Number.isFinite(reposPerLanguageEnvRaw)
  ? reposPerLanguageEnvRaw
  : 10;

const repoMinStarsEnvRaw = process.env.REPO_MIN_STARS
  ? Number(process.env.REPO_MIN_STARS)
  : NaN;
const REPO_MIN_STARS_ENV = Number.isFinite(repoMinStarsEnvRaw)
  ? repoMinStarsEnvRaw
  : 5000;

const repoPrPagesEnvRaw = process.env.REPO_PR_PAGES
  ? Number(process.env.REPO_PR_PAGES)
  : NaN;
const REPO_PR_PAGES_ENV = Number.isFinite(repoPrPagesEnvRaw) ? repoPrPagesEnvRaw : 3;

const repoIssuePagesEnvRaw = process.env.REPO_ISSUE_PAGES
  ? Number(process.env.REPO_ISSUE_PAGES)
  : NaN;
const REPO_ISSUE_PAGES_ENV = Number.isFinite(repoIssuePagesEnvRaw)
  ? repoIssuePagesEnvRaw
  : 3;

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function upsertUserContributionMetricsBatch(
  rows: Array<{ id: string; date: Date; userId: string; contributionCount: number }>
) {
  if (rows.length === 0) return;
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO UserContributionMetrics (id, date, userId, contributionCount)
      VALUES ${Prisma.join(
        rows.map(
          (r) => Prisma.sql`(${r.id}, ${r.date}, ${r.userId}, ${r.contributionCount})`
        )
      )}
      ON CONFLICT(date, userId)
      DO UPDATE SET contributionCount = excluded.contributionCount
    `
  );
}

function resolveUserBands(usersPerBandOverride: number | null) {
  if (usersPerBandOverride != null) {
    return USER_BANDS.map((b) => ({ ...b, target: usersPerBandOverride }));
  }
  if (USERS_PER_BAND_ENV != null) {
    return USER_BANDS.map((b) => ({ ...b, target: USERS_PER_BAND_ENV }));
  }
  return USER_BANDS;
}

// POST /api/sync - Trigger data collection
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all"; // users, repos, all
  const shouldSyncUsers = type === "users" || type === "all";
  const shouldSyncRepos = type === "repos" || type === "all";
  const seedParam = searchParams.get("seed");
  const samplingSeedRaw = seedParam ? Number(seedParam) : DEFAULT_SAMPLING_SEED;
  const samplingSeed = Number.isFinite(samplingSeedRaw)
    ? samplingSeedRaw
    : DEFAULT_SAMPLING_SEED;
  const usersPerBandParam = searchParams.get("usersPerBand");
  const usersPerBandRaw = usersPerBandParam ? Number(usersPerBandParam) : NaN;
  const usersPerBandOverride = Number.isFinite(usersPerBandRaw)
    ? usersPerBandRaw
    : null;

  const userPerPageParam = searchParams.get("userPerPage");
  const userPerPageRaw = userPerPageParam ? Number(userPerPageParam) : USER_SEARCH_PER_PAGE_ENV;
  const userPerPage = clampInt(userPerPageRaw, 1, 100);

  const userPagesPerOrderParam = searchParams.get("userPagesPerOrder");
  const userPagesPerOrderRaw = userPagesPerOrderParam
    ? Number(userPagesPerOrderParam)
    : USER_SEARCH_PAGES_PER_ORDER_ENV;
  const userPagesPerOrder = clampInt(userPagesPerOrderRaw, 1, 10);

  const repoLanguageCountParam = searchParams.get("repoLanguageCount");
  const repoLanguageCountRaw = repoLanguageCountParam
    ? Number(repoLanguageCountParam)
    : REPO_LANGUAGE_COUNT_ENV;
  const repoLanguageCount = clampInt(repoLanguageCountRaw, 1, TRACKED_LANGUAGES.length);

  const reposPerLanguageParam = searchParams.get("reposPerLanguage");
  const reposPerLanguageRaw = reposPerLanguageParam
    ? Number(reposPerLanguageParam)
    : REPOS_PER_LANGUAGE_ENV;
  const reposPerLanguage = clampInt(reposPerLanguageRaw, 1, 1000);

  const repoMinStarsParam = searchParams.get("repoMinStars");
  const repoMinStarsRaw = repoMinStarsParam ? Number(repoMinStarsParam) : REPO_MIN_STARS_ENV;
  const repoMinStars = Number.isFinite(repoMinStarsRaw) ? Math.max(0, repoMinStarsRaw) : REPO_MIN_STARS_ENV;

  const repoPrPagesParam = searchParams.get("repoPRPages");
  const repoPrPagesRaw = repoPrPagesParam ? Number(repoPrPagesParam) : REPO_PR_PAGES_ENV;
  const repoPrPages = clampInt(repoPrPagesRaw, 0, 50);

  const repoIssuePagesParam = searchParams.get("repoIssuePages");
  const repoIssuePagesRaw = repoIssuePagesParam
    ? Number(repoIssuePagesParam)
    : REPO_ISSUE_PAGES_ENV;
  const repoIssuePages = clampInt(repoIssuePagesRaw, 0, 50);

  const effectiveBands =
    shouldSyncUsers
      ? resolveUserBands(usersPerBandOverride)
      : USER_BANDS;

  const samplingParams = (shouldSyncUsers || shouldSyncRepos)
    ? JSON.stringify({
        users: shouldSyncUsers
          ? {
              baselineYears: BASELINE_YEARS,
              baselineMinContributions: BASELINE_MIN_CONTRIBUTIONS,
              bands: effectiveBands,
              usersPerBand: usersPerBandOverride ?? USERS_PER_BAND_ENV,
              perPage: userPerPage,
              pagesPerOrder: userPagesPerOrder,
              orders: ["desc", "asc"],
            }
          : null,
        repos: shouldSyncRepos
          ? {
              languages: TRACKED_LANGUAGES.slice(0, repoLanguageCount),
              reposPerLanguage,
              minStars: repoMinStars,
              prPages: repoPrPages,
              issuePages: repoIssuePages,
            }
          : null,
      })
    : null;

  const job = await prisma.syncJob.create({
    data: {
      jobType: type,
      status: "running",
      startedAt: new Date(),
      samplingSeed: shouldSyncUsers ? samplingSeed : null,
      samplingParams,
    },
  });

  let itemsProcessed = 0;
  try {
    if (shouldSyncUsers) {
      itemsProcessed += await syncUsers(samplingSeed, effectiveBands, {
        perPage: userPerPage,
        pagesPerOrder: userPagesPerOrder,
      });
    }

    if (shouldSyncRepos) {
      itemsProcessed += await syncRepos({
        languageCount: repoLanguageCount,
        reposPerLanguage,
        minStars: repoMinStars,
        prPages: repoPrPages,
        issuePages: repoIssuePages,
      });
    }

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        itemsProcessed,
        rateLimitRemaining: getRateLimitStatus().rest.remaining,
      },
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      itemsProcessed,
      rateLimitStatus: getRateLimitStatus(),
    });
  } catch (error) {
    console.error("Sync error:", error);
    try {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          itemsProcessed,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } catch (dbError) {
      console.error("Failed to update sync job status after error:", dbError);
    }

    return NextResponse.json(
      {
        error: "Sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET /api/sync - Get sync status
export async function GET() {
  try {
    const [lastJob, usersCount, reposCount] = await Promise.all([
      prisma.syncJob.findFirst({
        orderBy: { createdAt: "desc" },
      }),
      prisma.sampledUser.count(),
      prisma.sampledRepo.count(),
    ]);

    const runningJob = await prisma.syncJob.findFirst({
      where: { status: "running" },
    });

    return NextResponse.json({
      lastSyncAt: lastJob?.completedAt?.toISOString() || null,
      isRunning: !!runningJob,
      usersTracked: usersCount,
      reposTracked: reposCount,
      rateLimitStatus: getRateLimitStatus(),
    });
  } catch (error) {
    console.error("Error getting sync status:", error);
    return NextResponse.json(
      { error: "Failed to get sync status" },
      { status: 500 }
    );
  }
}

// Sample users across tiers - 1000 users total
async function syncUsers(
  baseSeed: number,
  bands: typeof USER_BANDS,
  options?: { perPage?: number; pagesPerOrder?: number }
): Promise<number> {
  let processed = 0;
  const perPage = clampInt(options?.perPage ?? 100, 1, 100);
  const pagesPerOrder = clampInt(options?.pagesPerOrder ?? 2, 1, 10);

  for (const band of bands) {
    const bandSeed = makeBandSeed(
      baseSeed,
      band.minFollowers,
      band.maxFollowers
    );
    const candidates = await sampleUsersFromBand(
      band.minFollowers,
      band.maxFollowers,
      band.target,
      bandSeed,
      perPage,
      pagesPerOrder
    );

    for (const user of candidates) {
      try {
        const ok = await upsertUser(user, band.tier);
        if (ok) processed++;
      } catch (error) {
        console.error(`Failed to sync user ${user.login}:`, error);
      }
    }
  }

  return processed;
}

type SearchUserResult = {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBandSeed(
  baseSeed: number,
  minFollowers: number,
  maxFollowers: number | null
) {
  const max = maxFollowers ?? 0;
  return (
    (baseSeed + minFollowers * 31 + max * 17) >>> 0
  );
}

function shuffleInPlace<T>(items: T[], seed: number) {
  const rng = mulberry32(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

async function sampleUsersFromBand(
  minFollowers: number,
  maxFollowers: number | null,
  target: number,
  seed: number,
  perPage = 100,
  pagesPerOrder = 2
): Promise<SearchUserResult[]> {
  const results: SearchUserResult[] = [];
  const orders: Array<"asc" | "desc"> = ["desc", "asc"];

  for (const order of orders) {
    for (let page = 1; page <= pagesPerOrder; page++) {
      const pageResults = await searchUsers(minFollowers, maxFollowers, perPage, page, order);
      results.push(...pageResults);
    }
  }

  const deduped = Array.from(new Map(results.map((r) => [r.id, r])).values());
  shuffleInPlace(deduped, seed);
  return deduped.slice(0, target);
}

async function upsertUser(
  searchResult: { id: number; login: string; avatar_url: string; html_url: string },
  tier: string
): Promise<boolean> {
  // Get full user details
  let userDetails: Awaited<ReturnType<typeof getUser>>;
  try {
    userDetails = await getUser(searchResult.login);
  } catch (error) {
    console.error(`Failed to fetch user profile for ${searchResult.login}:`, error);
    return false;
  }

  // Skip orgs and obvious bots
  if (userDetails.type !== "User" || searchResult.login.endsWith("[bot]")) {
    return false;
  }

  // Upsert the user first to get the userId
  const user = await prisma.sampledUser.upsert({
    where: { githubId: searchResult.id },
    create: {
      githubId: searchResult.id,
      username: searchResult.login,
      tier,
      avatarUrl: searchResult.avatar_url,
      profileUrl: searchResult.html_url,
      publicRepos: userDetails.public_repos,
      followers: userDetails.followers,
      totalContributions: 0,
      lastSyncedAt: new Date(),
    },
    update: {
      tier,
      avatarUrl: searchResult.avatar_url,
      publicRepos: userDetails.public_repos,
      followers: userDetails.followers,
      lastSyncedAt: new Date(),
    },
  });

  // Collect contribution data for multiple years (2020-2025)
  // GitHub GraphQL only allows 1 year at a time
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  const baselineYears = new Set<number>(BASELINE_YEARS);
  const postYears = years.filter((y) => !baselineYears.has(y));
  let totalContributions = 0;
  let baselineContributions = 0;

  const collectYear = async (year: number) => {
    const startDate = new Date(year, 0, 1); // Jan 1
    const endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31

    const now = new Date();
    if (startDate > now) return;
    const effectiveEndDate = endDate > now ? now : endDate;

	    const contributions = await getUserContributions(
	      searchResult.login,
	      startDate.toISOString(),
	      effectiveEndDate.toISOString()
	    );

	    const rows: Array<{
	      id: string;
	      date: Date;
	      userId: string;
	      contributionCount: number;
	    }> = [];

	    for (const week of contributions.contributionCalendar.weeks) {
	      for (const day of week.contributionDays) {
	        if (day.contributionCount > 0) {
	          const dayDate = new Date(day.date);
	          rows.push({
	            id: `${user.id}:${day.date}`,
	            date: dayDate,
	            userId: user.id,
	            contributionCount: day.contributionCount,
	          });

	          totalContributions += day.contributionCount;
	          if (baselineYears.has(year)) {
	            baselineContributions += day.contributionCount;
	          }
	        }
	      }
	    }

	    const chunkSize = 200;
	    for (let i = 0; i < rows.length; i += chunkSize) {
	      await upsertUserContributionMetricsBatch(rows.slice(i, i + chunkSize));
	    }
	  };

  let baselineFetchFailed = false;
  for (const year of BASELINE_YEARS) {
    try {
      await collectYear(year);
    } catch (error) {
      baselineFetchFailed = true;
      console.error(
        `Failed to get baseline contributions for ${searchResult.login} in ${year}:`,
        error
      );
    }
  }

  if (baselineFetchFailed || baselineContributions < BASELINE_MIN_CONTRIBUTIONS) {
    await prisma.sampledUser.delete({ where: { id: user.id } });
    return false;
  }

  for (const year of postYears) {
    try {
      await collectYear(year);
    } catch (error) {
      console.error(
        `Failed to get contributions for ${searchResult.login} in ${year}:`,
        error
      );
    }
  }

  // Update total contributions on user
  await prisma.sampledUser.update({
    where: { id: user.id },
    data: { totalContributions, baselineContributions },
  });

  return true;
}

// Sample repos across languages
async function syncRepos(options?: {
  languageCount?: number;
  reposPerLanguage?: number;
  minStars?: number;
  prPages?: number;
  issuePages?: number;
}): Promise<number> {
  let count = 0;

  const languageCount = clampInt(options?.languageCount ?? 5, 1, TRACKED_LANGUAGES.length);
  const reposPerLanguage = clampInt(options?.reposPerLanguage ?? 10, 1, 1000);
  const minStars = Number.isFinite(options?.minStars ?? NaN)
    ? Math.max(0, options?.minStars ?? 0)
    : 5000;
  const prPages = clampInt(options?.prPages ?? 3, 0, 50);
  const issuePages = clampInt(options?.issuePages ?? 3, 0, 50);

  for (const language of TRACKED_LANGUAGES.slice(0, languageCount)) {
    const repos = await fetchReposForLanguage(language, minStars, reposPerLanguage);

    for (const repo of repos) {
      // Skip repos without owner
      if (!repo.owner) continue;

      await upsertRepo(
        {
          id: repo.id,
          full_name: repo.full_name,
          name: repo.name,
          owner: { login: repo.owner.login },
          description: repo.description,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          open_issues_count: repo.open_issues_count,
        },
        language
      );
      count++;

      // Collect contributor stats for this repo
      try {
        const stats = await getContributorStats(repo.owner.login, repo.name);
        if (stats) {
          await processRepoStats(repo.id, stats);
        }
      } catch {
        // Stats may not be available immediately
      }

      // Collect recent PR and issue data for flow metrics
      try {
        const prs = await fetchPagedPRs(repo.owner.login, repo.name, prPages);
        if (prs.length > 0) {
          await processRepoPRs(repo.id, prs);
        }
      } catch (error) {
        console.error(`Failed to sync PRs for ${repo.full_name}:`, error);
      }

      try {
        const issues = await fetchPagedIssues(repo.owner.login, repo.name, issuePages);
        if (issues.length > 0) {
          await processRepoIssues(repo.id, issues);
        }
      } catch (error) {
        console.error(`Failed to sync issues for ${repo.full_name}:`, error);
      }
    }
  }

  return count;
}

async function fetchReposForLanguage(language: string, minStars: number, target: number) {
  const perPage = clampInt(Math.min(100, target), 1, 100);
  const pages = clampInt(Math.ceil(target / perPage), 1, 10);
  const results: Array<Awaited<ReturnType<typeof searchRepos>>[number]> = [];

  for (let page = 1; page <= pages; page++) {
    const pageResults = await searchRepos(language, minStars, perPage, page);
    results.push(...pageResults);
    if (pageResults.length < perPage) break;
  }

  const deduped = Array.from(new Map(results.map((r) => [r.id, r])).values());
  return deduped.slice(0, target);
}

async function upsertRepo(
  repo: {
    id: number;
    full_name: string;
    name: string;
    owner: { login: string };
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
  },
  language: string
) {
  await prisma.sampledRepo.upsert({
    where: { githubId: repo.id },
    create: {
      githubId: repo.id,
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      description: repo.description,
      primaryLanguage: language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      lastSyncedAt: new Date(),
    },
    update: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      lastSyncedAt: new Date(),
    },
  });
}

async function processRepoStats(
  repoGithubId: number,
  stats: Array<{
    author: { id: number; login: string } | null;
    total: number;
    weeks: Array<{ w?: number; a?: number; d?: number; c?: number }>;
  }>
) {
  const repo = await prisma.sampledRepo.findUnique({
    where: { githubId: repoGithubId },
  });

  if (!repo) return;

  const weekMap = new Map<number, { commits: number; added: number; removed: number }>();
  for (const contributor of stats) {
    if (!contributor.author) continue;
    for (const week of contributor.weeks) {
      if (!week.w) continue;
      if (!week.c || week.c === 0) continue;

      const key = week.w;
      const existing = weekMap.get(key) || { commits: 0, added: 0, removed: 0 };
      weekMap.set(key, {
        commits: existing.commits + (week.c || 0),
        added: existing.added + (week.a || 0),
        removed: existing.removed + (week.d || 0),
      });
    }
  }

  const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => a[0] - b[0]);
  for (const [weekTs, totals] of sortedWeeks) {
    const weekDate = new Date(weekTs * 1000);
    const existing = await prisma.commitMetrics.findFirst({
      where: {
        date: weekDate,
        repoId: repo.id,
        language: repo.primaryLanguage,
        userId: null,
      },
    });

    if (existing) {
      await prisma.commitMetrics.update({
        where: { id: existing.id },
        data: {
          commitCount: totals.commits,
          linesAdded: totals.added,
          linesRemoved: totals.removed,
        },
      });
    } else {
      await prisma.commitMetrics.create({
        data: {
          date: weekDate,
          repoId: repo.id,
          language: repo.primaryLanguage,
          commitCount: totals.commits,
          linesAdded: totals.added,
          linesRemoved: totals.removed,
        },
      });
    }
  }
}

interface RepoPullRequest {
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

interface RepoIssue {
  created_at: string;
  closed_at: string | null;
}

async function fetchPagedPRs(
  owner: string,
  repo: string,
  maxPages = 3,
  perPage = 100
): Promise<RepoPullRequest[]> {
  const all: RepoPullRequest[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const pageResults = (await getRepoPRs(
      owner,
      repo,
      "all",
      perPage,
      page
    )) as unknown as RepoPullRequest[];

    for (const pr of pageResults) {
      if (pr?.created_at) {
        all.push({
          created_at: pr.created_at,
          closed_at: pr.closed_at ?? null,
          merged_at: pr.merged_at ?? null,
        });
      }
    }

    if (pageResults.length < perPage) break;
  }
  return all;
}

async function fetchPagedIssues(
  owner: string,
  repo: string,
  maxPages = 3,
  perPage = 100
): Promise<RepoIssue[]> {
  const all: RepoIssue[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const pageResults = (await getRepoIssues(
      owner,
      repo,
      "all",
      perPage,
      page
    )) as unknown as RepoIssue[];

    for (const issue of pageResults) {
      if (issue?.created_at) {
        all.push({
          created_at: issue.created_at,
          closed_at: issue.closed_at ?? null,
        });
      }
    }

    if (pageResults.length < perPage) break;
  }
  return all;
}

function normalizeToDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

type PRDayAggregate = {
  opened: number;
  closed: number;
  merged: number;
  mergeHoursTotal: number;
  mergeCount: number;
};

type IssueDayAggregate = {
  opened: number;
  closed: number;
  resolutionHoursTotal: number;
  resolutionCount: number;
};

async function processRepoPRs(repoGithubId: number, prs: RepoPullRequest[]) {
  const repo = await prisma.sampledRepo.findUnique({
    where: { githubId: repoGithubId },
  });
  if (!repo) return;

  const dayMap = new Map<string, PRDayAggregate>();

  const addToDay = (
    dateStr: string | null | undefined,
    fn: (entry: PRDayAggregate) => void
  ) => {
    if (!dateStr) return;
    const day = normalizeToDay(dateStr);
    const key = day.toISOString().slice(0, 10);
    const entry =
      dayMap.get(key) || {
        opened: 0,
        closed: 0,
        merged: 0,
        mergeHoursTotal: 0,
        mergeCount: 0,
      };
    fn(entry);
    dayMap.set(key, entry);
  };

  for (const pr of prs) {
    addToDay(pr.created_at, (e) => { e.opened += 1; });
    addToDay(pr.closed_at, (e) => { e.closed += 1; });

    if (pr.merged_at) {
      const mergedAt = pr.merged_at;
      addToDay(mergedAt, (e) => {
        e.merged += 1;
        if (pr.created_at) {
          const hours =
            (new Date(mergedAt).getTime() - new Date(pr.created_at).getTime()) /
            (1000 * 60 * 60);
          if (Number.isFinite(hours)) {
            e.mergeHoursTotal += hours;
            e.mergeCount += 1;
          }
        }
      });
    }
  }

  for (const [key, data] of dayMap.entries()) {
    const date = new Date(`${key}T00:00:00.000Z`);
    const avgTimeToMergeHrs =
      data.mergeCount > 0 ? data.mergeHoursTotal / data.mergeCount : null;

    const existing = await prisma.pRMetrics.findFirst({
      where: {
        date,
        repoId: repo.id,
        language: repo.primaryLanguage,
        userId: null,
      },
    });

    if (existing) {
      await prisma.pRMetrics.update({
        where: { id: existing.id },
        data: {
          prsOpened: data.opened,
          prsClosed: data.closed,
          prsMerged: data.merged,
          avgTimeToMergeHrs,
        },
      });
    } else {
      await prisma.pRMetrics.create({
        data: {
          date,
          repoId: repo.id,
          language: repo.primaryLanguage,
          prsOpened: data.opened,
          prsClosed: data.closed,
          prsMerged: data.merged,
          avgTimeToMergeHrs,
        },
      });
    }
  }
}

async function processRepoIssues(repoGithubId: number, issues: RepoIssue[]) {
  const repo = await prisma.sampledRepo.findUnique({
    where: { githubId: repoGithubId },
  });
  if (!repo) return;

  const dayMap = new Map<string, IssueDayAggregate>();

  const addToDay = (
    dateStr: string | null | undefined,
    fn: (entry: IssueDayAggregate) => void
  ) => {
    if (!dateStr) return;
    const day = normalizeToDay(dateStr);
    const key = day.toISOString().slice(0, 10);
    const entry =
      dayMap.get(key) || {
        opened: 0,
        closed: 0,
        resolutionHoursTotal: 0,
        resolutionCount: 0,
      };
    fn(entry);
    dayMap.set(key, entry);
  };

  for (const issue of issues) {
    addToDay(issue.created_at, (e) => { e.opened += 1; });

    if (issue.closed_at) {
      const closedAt = issue.closed_at;
      addToDay(closedAt, (e) => {
        e.closed += 1;
        if (issue.created_at) {
          const hours =
            (new Date(closedAt).getTime() - new Date(issue.created_at).getTime()) /
            (1000 * 60 * 60);
          if (Number.isFinite(hours)) {
            e.resolutionHoursTotal += hours;
            e.resolutionCount += 1;
          }
        }
      });
    }
  }

  for (const [key, data] of dayMap.entries()) {
    const date = new Date(`${key}T00:00:00.000Z`);
    const avgResolutionHrs =
      data.resolutionCount > 0
        ? data.resolutionHoursTotal / data.resolutionCount
        : null;

    await prisma.issueMetrics.upsert({
      where: {
        date_repoId_language: {
          date,
          repoId: repo.id,
          language: repo.primaryLanguage,
        },
      },
      create: {
        date,
        repoId: repo.id,
        language: repo.primaryLanguage,
        issuesOpened: data.opened,
        issuesClosed: data.closed,
        avgResolutionHrs,
      },
      update: {
        issuesOpened: data.opened,
        issuesClosed: data.closed,
        avgResolutionHrs,
      },
    });
  }
}
