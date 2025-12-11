import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  searchUsers,
  searchRepos,
  getUser,
  getUserContributions,
  getContributorStats,
  getRateLimitStatus,
} from "@/lib/github";
import { TRACKED_LANGUAGES } from "@/types/metrics";

// POST /api/sync - Trigger data collection
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all"; // users, repos, all

  try {
    // Create sync job
    const job = await prisma.syncJob.create({
      data: {
        jobType: type,
        status: "running",
        startedAt: new Date(),
      },
    });

    let itemsProcessed = 0;

    // Sync users
    if (type === "users" || type === "all") {
      itemsProcessed += await syncUsers();
    }

    // Sync repos
    if (type === "repos" || type === "all") {
      itemsProcessed += await syncRepos();
    }

    // Update job status
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
async function syncUsers(): Promise<number> {
  let count = 0;

  // Top tier: 10000+ followers (200 users)
  const topUsers = await searchUsers(10000, null, 100);
  for (const user of topUsers) {
    await upsertUser(user, "top");
    count++;
  }
  // Get more top users with different sort
  const topUsers2 = await searchUsers(5000, 10000, 100);
  for (const user of topUsers2) {
    await upsertUser(user, "top");
    count++;
  }

  // Mid tier: 1000-5000 followers (300 users)
  const midUsers = await searchUsers(2000, 5000, 100);
  for (const user of midUsers) {
    await upsertUser(user, "mid");
    count++;
  }
  const midUsers2 = await searchUsers(1000, 2000, 100);
  for (const user of midUsers2) {
    await upsertUser(user, "mid");
    count++;
  }
  const midUsers3 = await searchUsers(500, 1000, 100);
  for (const user of midUsers3) {
    await upsertUser(user, "mid");
    count++;
  }

  // Casual tier: 100-500 followers (500 users)
  const casualUsers = await searchUsers(300, 500, 100);
  for (const user of casualUsers) {
    await upsertUser(user, "casual");
    count++;
  }
  const casualUsers2 = await searchUsers(200, 300, 100);
  for (const user of casualUsers2) {
    await upsertUser(user, "casual");
    count++;
  }
  const casualUsers3 = await searchUsers(150, 200, 100);
  for (const user of casualUsers3) {
    await upsertUser(user, "casual");
    count++;
  }
  const casualUsers4 = await searchUsers(100, 150, 100);
  for (const user of casualUsers4) {
    await upsertUser(user, "casual");
    count++;
  }
  const casualUsers5 = await searchUsers(50, 100, 100);
  for (const user of casualUsers5) {
    await upsertUser(user, "casual");
    count++;
  }

  return count;
}

async function upsertUser(
  searchResult: { id: number; login: string; avatar_url: string; html_url: string },
  tier: string
) {
  // Get full user details
  const userDetails = await getUser(searchResult.login);

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
  let totalContributions = 0;

  for (const year of years) {
    try {
      const startDate = new Date(year, 0, 1); // Jan 1
      const endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31

      // Don't fetch future dates
      const now = new Date();
      if (startDate > now) continue;
      const effectiveEndDate = endDate > now ? now : endDate;

      const contributions = await getUserContributions(
        searchResult.login,
        startDate.toISOString(),
        effectiveEndDate.toISOString()
      );

      // Store daily contribution data
      for (const week of contributions.contributionCalendar.weeks) {
        for (const day of week.contributionDays) {
          if (day.contributionCount > 0) {
            const dayDate = new Date(day.date);

            // Upsert daily contribution
            await prisma.userContributionMetrics.upsert({
              where: {
                date_userId: {
                  date: dayDate,
                  userId: user.id,
                },
              },
              create: {
                date: dayDate,
                userId: user.id,
                contributionCount: day.contributionCount,
              },
              update: {
                contributionCount: day.contributionCount,
              },
            });

            totalContributions += day.contributionCount;
          }
        }
      }
    } catch (error) {
      console.error(`Failed to get contributions for ${searchResult.login} in ${year}:`, error);
      // Continue with other years
    }
  }

  // Update total contributions on user
  await prisma.sampledUser.update({
    where: { id: user.id },
    data: { totalContributions },
  });
}

// Sample repos across languages
async function syncRepos(): Promise<number> {
  let count = 0;

  for (const language of TRACKED_LANGUAGES.slice(0, 5)) {
    // Top 5 languages
    const repos = await searchRepos(language, 5000, 10);

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
    }
  }

  return count;
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

  // Process weekly data into daily metrics
  for (const contributor of stats) {
    if (!contributor.author) continue;

    for (const week of contributor.weeks) {
      if (!week.c || week.c === 0) continue; // Skip weeks with no commits
      if (!week.w) continue; // Skip if no timestamp

      const weekDate = new Date(week.w * 1000);

      // Find existing record or create new one
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
            commitCount: { increment: week.c || 0 },
            linesAdded: { increment: week.a || 0 },
            linesRemoved: { increment: week.d || 0 },
          },
        });
      } else {
        await prisma.commitMetrics.create({
          data: {
            date: weekDate,
            repoId: repo.id,
            language: repo.primaryLanguage,
            commitCount: week.c || 0,
            linesAdded: week.a || 0,
            linesRemoved: week.d || 0,
          },
        });
      }
    }
  }
}
