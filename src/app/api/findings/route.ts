import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getLastFullMonthYm(now = new Date()) {
  const year = now.getUTCFullYear();
  const month1 = now.getUTCMonth() + 1; // 1-12
  let y = year;
  let m = month1 - 1;
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${pad2(m)}`;
}

function ymToUtcBounds(ymStart: string, ymEnd: string) {
  const [sy, sm] = ymStart.split("-").map(Number);
  const [ey, em] = ymEnd.split("-").map(Number);
  if (![sy, sm, ey, em].every(Number.isFinite)) {
    throw new Error(`Invalid month range: ${ymStart}..${ymEnd}`);
  }

  const startMs = Date.UTC(sy, sm - 1, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(ey, em, 0, 23, 59, 59, 999);

  let days = 0;
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    days += new Date(Date.UTC(y, m, 0)).getUTCDate();
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }

  return { startMs, endMs, days, startMonth: ymStart, endMonth: ymEnd };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const k = (sorted.length - 1) * clamped;
  const f = Math.floor(k);
  const c = Math.min(sorted.length - 1, f + 1);
  if (f === c) return sorted[f];
  const d = k - f;
  return sorted[f] * (1 - d) + sorted[c] * d;
}

export async function GET() {
  try {
    const pre = ymToUtcBounds("2020-01", "2021-12");
    const post = ymToUtcBounds("2022-01", getLastFullMonthYm());

    const [
      userCount,
      repoCount,
      tierCountsRaw,
      preAggRaw,
      postAggRaw,
      preTierAggRaw,
      postTierAggRaw,
      perUserRaw,
      usersWithAI,
      reposWithAI,
      totalSignals,
      lastUserJob,
      lastRepoJob,
    ] = await Promise.all([
      prisma.sampledUser.count(),
      prisma.sampledRepo.count(),
      prisma.$queryRaw<{ tier: string; n: number }[]>`
        SELECT tier as tier, COUNT(*) as n
        FROM SampledUser
        GROUP BY tier
      `,
      prisma.$queryRaw<{ total: number | null; activeUserDays: number | null }[]>`
        SELECT SUM(contributionCount) as total, COUNT(*) as activeUserDays
        FROM UserContributionMetrics
        WHERE date >= ${pre.startMs} AND date <= ${pre.endMs}
      `,
      prisma.$queryRaw<{ total: number | null; activeUserDays: number | null }[]>`
        SELECT SUM(contributionCount) as total, COUNT(*) as activeUserDays
        FROM UserContributionMetrics
        WHERE date >= ${post.startMs} AND date <= ${post.endMs}
      `,
      prisma.$queryRaw<
        { tier: string; total: number | null; activeUserDays: number | null }[]
      >`
        SELECT u.tier as tier, SUM(m.contributionCount) as total, COUNT(*) as activeUserDays
        FROM UserContributionMetrics m
        JOIN SampledUser u ON u.id = m.userId
        WHERE m.date >= ${pre.startMs} AND m.date <= ${pre.endMs}
        GROUP BY u.tier
      `,
      prisma.$queryRaw<
        { tier: string; total: number | null; activeUserDays: number | null }[]
      >`
        SELECT u.tier as tier, SUM(m.contributionCount) as total, COUNT(*) as activeUserDays
        FROM UserContributionMetrics m
        JOIN SampledUser u ON u.id = m.userId
        WHERE m.date >= ${post.startMs} AND m.date <= ${post.endMs}
        GROUP BY u.tier
      `,
      prisma.$queryRaw<
        { userId: string; preTotal: number | null; postTotal: number | null }[]
      >`
        SELECT
          userId as userId,
          SUM(
            CASE
              WHEN date >= ${pre.startMs} AND date <= ${pre.endMs}
                THEN contributionCount
              ELSE 0
            END
          ) as preTotal,
          SUM(
            CASE
              WHEN date >= ${post.startMs} AND date <= ${post.endMs}
                THEN contributionCount
              ELSE 0
            END
          ) as postTotal
        FROM UserContributionMetrics
        WHERE date >= ${pre.startMs} AND date <= ${post.endMs}
        GROUP BY userId
      `,
      prisma.sampledUser.count({ where: { aiAdoptionScore: { gt: 0 } } }),
      prisma.sampledRepo.count({ where: { aiAdoptionScore: { gt: 0 } } }),
      prisma.aISignal.count(),
      prisma.syncJob.findFirst({
        where: { jobType: "users", status: "completed" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.syncJob.findFirst({
        where: { jobType: "repos", status: "completed" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const tierCounts: Record<string, number> = {};
    for (const row of tierCountsRaw) {
      tierCounts[row.tier] = Number(row.n || 0);
    }

    const preAgg = preAggRaw[0] || { total: 0, activeUserDays: 0 };
    const postAgg = postAggRaw[0] || { total: 0, activeUserDays: 0 };

    const mkPeriodStats = (agg: { total: number | null; activeUserDays: number | null }, days: number) => {
      const totalContributions = Number(agg.total || 0);
      const activeUserDays = Number(agg.activeUserDays || 0);
      const denom = userCount > 0 ? userCount * days : 0;
      return {
        totalContributions,
        activeUserDays,
        days,
        contributionsPerUserPerDay: denom > 0 ? totalContributions / denom : 0,
        activeDayShare: denom > 0 ? activeUserDays / denom : 0,
        contributionsPerActiveDay: activeUserDays > 0 ? totalContributions / activeUserDays : 0,
      };
    };

    const preStats = mkPeriodStats(preAgg, pre.days);
    const postStats = mkPeriodStats(postAgg, post.days);

    const toTierMap = (
      rows: Array<{ tier: string; total: number | null; activeUserDays: number | null }>,
      days: number
    ) => {
      const out: Record<
        string,
        {
          users: number;
          totalContributions: number;
          activeUserDays: number;
          contributionsPerUserPerDay: number;
          activeDayShare: number;
          contributionsPerActiveDay: number;
        }
      > = {};

      for (const row of rows) {
        const users = tierCounts[row.tier] ?? 0;
        const totalContributions = Number(row.total || 0);
        const activeUserDays = Number(row.activeUserDays || 0);
        const denom = users > 0 ? users * days : 0;
        out[row.tier] = {
          users,
          totalContributions,
          activeUserDays,
          contributionsPerUserPerDay: denom > 0 ? totalContributions / denom : 0,
          activeDayShare: denom > 0 ? activeUserDays / denom : 0,
          contributionsPerActiveDay:
            activeUserDays > 0 ? totalContributions / activeUserDays : 0,
        };
      }

      return out;
    };

    const tiersPre = toTierMap(preTierAggRaw, pre.days);
    const tiersPost = toTierMap(postTierAggRaw, post.days);

    const deltas: number[] = [];
    for (const row of perUserRaw) {
      const preAvg =
        pre.days > 0 ? Number(row.preTotal || 0) / pre.days : 0;
      const postAvg =
        post.days > 0 ? Number(row.postTotal || 0) / post.days : 0;
      deltas.push(postAvg - preAvg);
    }

    deltas.sort((a, b) => a - b);
    const mean =
      deltas.length > 0
        ? deltas.reduce((sum, v) => sum + v, 0) / deltas.length
        : 0;
    const pctPositive =
      deltas.length > 0
        ? deltas.filter((v) => v > 0).length / deltas.length
        : 0;

    const samplingParams = (() => {
      if (!lastUserJob?.samplingParams) return null;
      try {
        return JSON.parse(lastUserJob.samplingParams) as unknown;
      } catch {
        return null;
      }
    })();

    return NextResponse.json({
      cohort: {
        users: userCount,
        repos: repoCount,
        tiers: tierCounts,
        lastUserSyncAt: lastUserJob?.completedAt?.toISOString() ?? null,
        lastRepoSyncAt: lastRepoJob?.completedAt?.toISOString() ?? null,
        samplingSeed: lastUserJob?.samplingSeed ?? null,
        samplingParams,
      },
      periods: {
        pre: {
          startMonth: pre.startMonth,
          endMonth: pre.endMonth,
          ...preStats,
        },
        post: {
          startMonth: post.startMonth,
          endMonth: post.endMonth,
          ...postStats,
        },
      },
      tiers: {
        pre: tiersPre,
        post: tiersPost,
      },
      distribution: {
        deltaContributionsPerUserPerDay: {
          mean,
          p10: percentile(deltas, 0.1),
          p25: percentile(deltas, 0.25),
          median: percentile(deltas, 0.5),
          p75: percentile(deltas, 0.75),
          p90: percentile(deltas, 0.9),
          pctPositive,
          n: deltas.length,
        },
      },
      adoption: {
        usersWithAI,
        reposWithAI,
        totalSignals,
      },
    });
  } catch (error) {
    console.error("Error fetching findings:", error);
    return NextResponse.json(
      { error: "Failed to fetch findings" },
      { status: 500 }
    );
  }
}

