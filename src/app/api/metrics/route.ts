import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GlobalMetrics, TrendData } from "@/types/metrics";

function endOfLastFullMonthUtc(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymFromDateUtc(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function monthRange(ymStart: string, ymEnd: string) {
  const [sy, sm] = ymStart.split("-").map(Number);
  const [ey, em] = ymEnd.split("-").map(Number);
  if (![sy, sm, ey, em].every(Number.isFinite)) {
    throw new Error(`Invalid month range: ${ymStart}..${ymEnd}`);
  }

  const months: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function daysInMonthFromYm(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  try {
    const defaultEnd = endOfLastFullMonthUtc(new Date());
    const start = startDate ? new Date(startDate) : new Date("2020-01-01");
    const end = endDate ? new Date(endDate) : defaultEnd;
    const dateFilter = { gte: start, lte: end };
    const startMs = start.getTime();
    const endMs = end.getTime();

    const [
      commitMetrics,
      prMetrics,
      issueMetrics,
      userCount,
      repoCount,
      tierCountsRaw,
      userAggByMonthRaw,
      userAggByMonthTierRaw,
      userMonthTotalsRaw,
    ] = await Promise.all([
      prisma.commitMetrics.findMany({
        where: { date: dateFilter },
        orderBy: { date: "asc" },
      }),
      prisma.pRMetrics.findMany({
        where: { date: dateFilter },
        orderBy: { date: "asc" },
      }),
      prisma.issueMetrics.findMany({
        where: { date: dateFilter },
        orderBy: { date: "asc" },
      }),
      prisma.sampledUser.count(),
      prisma.sampledRepo.count(),
      prisma.$queryRaw<{ tier: string; n: number }[]>`
        SELECT tier as tier, COUNT(*) as n
        FROM SampledUser
        GROUP BY tier
      `,
      prisma.$queryRaw<
        { ym: string; total: number | null; activeUserDays: number | null }[]
      >`
        SELECT
          strftime('%Y-%m', datetime(date/1000, 'unixepoch')) as ym,
          SUM(contributionCount) as total,
          COUNT(*) as activeUserDays
        FROM UserContributionMetrics
        WHERE date >= ${startMs} AND date <= ${endMs}
        GROUP BY ym
        ORDER BY ym ASC
      `,
      prisma.$queryRaw<
        {
          ym: string;
          tier: string;
          total: number | null;
          activeUserDays: number | null;
        }[]
      >`
        SELECT
          strftime('%Y-%m', datetime(m.date/1000, 'unixepoch')) as ym,
          u.tier as tier,
          SUM(m.contributionCount) as total,
          COUNT(*) as activeUserDays
        FROM UserContributionMetrics m
        JOIN SampledUser u ON u.id = m.userId
        WHERE m.date >= ${startMs} AND m.date <= ${endMs}
        GROUP BY ym, tier
        ORDER BY ym ASC
      `,
      prisma.$queryRaw<
        { ym: string; userId: string; tier: string; total: number | null }[]
      >`
        SELECT
          strftime('%Y-%m', datetime(m.date/1000, 'unixepoch')) as ym,
          m.userId as userId,
          u.tier as tier,
          SUM(m.contributionCount) as total
        FROM UserContributionMetrics m
        JOIN SampledUser u ON u.id = m.userId
        WHERE m.date >= ${startMs} AND m.date <= ${endMs}
        GROUP BY ym, userId, tier
      `,
    ]);

    // Check if we have any data
    const hasUserData = userAggByMonthRaw.length > 0;
    const hasRepoData =
      commitMetrics.length > 0 || prMetrics.length > 0 || issueMetrics.length > 0;

    if (!hasUserData && !hasRepoData) {
      return NextResponse.json({
        summary: getEmptySummary(),
        trends: getEmptyTrends(),
        message: "No data collected yet. Click 'Sync GitHub Data' to populate.",
      });
    }

    const tierCounts: Record<string, number> = {};
    for (const row of tierCountsRaw) {
      tierCounts[row.tier] = Number(row.n || 0);
    }

    const startYm = ymFromDateUtc(start);
    const endYm = ymFromDateUtc(end);
    const months = monthRange(startYm, endYm);

    const daysByYm = new Map<string, number>();
    for (const ym of months) {
      daysByYm.set(ym, daysInMonthFromYm(ym));
    }

    const userAggByMonth = new Map<string, { total: number; activeUserDays: number }>();
    for (const row of userAggByMonthRaw) {
      userAggByMonth.set(row.ym, {
        total: Number(row.total || 0),
        activeUserDays: Number(row.activeUserDays || 0),
      });
    }

    const userAggByMonthTier = new Map<
      string,
      Map<string, { total: number; activeUserDays: number }>
    >();
    for (const row of userAggByMonthTierRaw) {
      const ym = row.ym;
      const tierMap =
        userAggByMonthTier.get(ym) ||
        (() => {
          const created = new Map<string, { total: number; activeUserDays: number }>();
          userAggByMonthTier.set(ym, created);
          return created;
        })();

      tierMap.set(row.tier, {
        total: Number(row.total || 0),
        activeUserDays: Number(row.activeUserDays || 0),
      });
    }

    const perUserValuesByMonth = new Map<string, number[]>();
    const perTierValuesByMonth = new Map<string, Map<string, number[]>>();

    for (const row of userMonthTotalsRaw) {
      const ym = row.ym;
      const days = daysByYm.get(ym) ?? 30;
      const value = days > 0 ? Number(row.total || 0) / days : 0;

      const overall = perUserValuesByMonth.get(ym) || [];
      overall.push(value);
      perUserValuesByMonth.set(ym, overall);

      const tierMap =
        perTierValuesByMonth.get(ym) ||
        (() => {
          const created = new Map<string, number[]>();
          perTierValuesByMonth.set(ym, created);
          return created;
        })();

      const tierValues = tierMap.get(row.tier) || [];
      tierValues.push(value);
      tierMap.set(row.tier, tierValues);
    }

    const computeQuantiles = (activeValues: number[], population: number) => {
      const missing = Math.max(0, population - activeValues.length);
      const sorted = activeValues.slice().sort((a, b) => a - b);
      const padded = missing > 0 ? new Array(missing).fill(0).concat(sorted) : sorted;
      return {
        p25: percentile(padded, 0.25),
        p50: percentile(padded, 0.5),
        p75: percentile(padded, 0.75),
      };
    };

    const userMonthlyContributions = months.map((ym) => {
      const days = daysByYm.get(ym) ?? 30;
      const agg = userAggByMonth.get(ym) || { total: 0, activeUserDays: 0 };
      const total = agg.total;

      const byTier: Record<string, number> = {};
      const byTierP25: Record<string, number> = {};
      const byTierP50: Record<string, number> = {};
      const byTierP75: Record<string, number> = {};

      const tierAgg = userAggByMonthTier.get(ym);
      for (const [tier, users] of Object.entries(tierCounts)) {
        const tAgg = tierAgg?.get(tier) || { total: 0, activeUserDays: 0 };
        byTier[tier] = users > 0 && days > 0 ? tAgg.total / (users * days) : 0;

        const tierActiveValues = perTierValuesByMonth.get(ym)?.get(tier) || [];
        const tierQuantiles = computeQuantiles(tierActiveValues, users);
        byTierP25[tier] = tierQuantiles.p25;
        byTierP50[tier] = tierQuantiles.p50;
        byTierP75[tier] = tierQuantiles.p75;
      }

      const activeValues = perUserValuesByMonth.get(ym) || [];
      const overallQuantiles = computeQuantiles(activeValues, userCount);

      return {
        date: `${ym}-01`,
        value: userCount > 0 && days > 0 ? total / (userCount * days) : 0,
        byTier,
        p25: overallQuantiles.p25,
        p50: overallQuantiles.p50,
        p75: overallQuantiles.p75,
        byTierP25,
        byTierP50,
        byTierP75,
      };
    });

    const userMonthlyActiveDayShare = months.map((ym) => {
      const days = daysByYm.get(ym) ?? 30;
      const agg = userAggByMonth.get(ym) || { total: 0, activeUserDays: 0 };
      const denom = userCount > 0 && days > 0 ? userCount * days : 0;

      const byTier: Record<string, number> = {};
      const tierAgg = userAggByMonthTier.get(ym);
      for (const [tier, users] of Object.entries(tierCounts)) {
        const tAgg = tierAgg?.get(tier) || { total: 0, activeUserDays: 0 };
        const tDenom = users > 0 && days > 0 ? users * days : 0;
        byTier[tier] = tDenom > 0 ? tAgg.activeUserDays / tDenom : 0;
      }

      return {
        date: `${ym}-01`,
        value: denom > 0 ? agg.activeUserDays / denom : 0,
        byTier,
      };
    });

    const userMonthlyContribsPerActiveDay = months.map((ym) => {
      const agg = userAggByMonth.get(ym) || { total: 0, activeUserDays: 0 };
      const total = agg.total;
      const byTier: Record<string, number> = {};
      const tierAgg = userAggByMonthTier.get(ym);
      for (const [tier] of Object.entries(tierCounts)) {
        const tAgg = tierAgg?.get(tier) || { total: 0, activeUserDays: 0 };
        byTier[tier] = tAgg.activeUserDays > 0 ? tAgg.total / tAgg.activeUserDays : 0;
      }

      return {
        date: `${ym}-01`,
        value: agg.activeUserDays > 0 ? total / agg.activeUserDays : 0,
        byTier,
      };
    });

    // Aggregate REPO metrics by month (secondary - for lines of code)
    const repoMonthlyData = aggregateRepoMetricsByMonth(commitMetrics);

    const prMonthlyData = aggregatePRMetricsByMonth(prMetrics);
    const issueMonthlyData = aggregateIssueMetricsByMonth(issueMetrics);

    // Calculate summary from USER contribution data
    const totalUserContributions = Array.from(userAggByMonth.values()).reduce(
      (sum, m) => sum + m.total,
      0
    );
    const totalRepoCommits = commitMetrics.reduce((sum, m) => sum + m.commitCount, 0);
    const totalLinesAdded = commitMetrics.reduce((sum, m) => sum + m.linesAdded, 0);
    const totalLinesRemoved = commitMetrics.reduce((sum, m) => sum + m.linesRemoved, 0);

    const totalPRsOpened = prMetrics.reduce((sum, m) => sum + m.prsOpened, 0);
    const totalPRsMerged = prMetrics.reduce((sum, m) => sum + m.prsMerged, 0);
    const weightedMergeHours = prMetrics.reduce(
      (sum, m) => sum + (m.avgTimeToMergeHrs || 0) * m.prsMerged,
      0
    );
    const avgTimeToMergeHours =
      totalPRsMerged > 0 ? weightedMergeHours / totalPRsMerged : null;

    const totalIssuesOpened = issueMetrics.reduce((sum, m) => sum + m.issuesOpened, 0);
    const totalIssuesClosed = issueMetrics.reduce((sum, m) => sum + m.issuesClosed, 0);
    const weightedResolutionHours = issueMetrics.reduce(
      (sum, m) => sum + (m.avgResolutionHrs || 0) * m.issuesClosed,
      0
    );
    const avgResolutionHours =
      totalIssuesClosed > 0 ? weightedResolutionHours / totalIssuesClosed : null;

    // Average contributions per user per calendar-day (includes inactive days)
    const avgContributionsPerUserPerDay =
      userMonthlyContributions.length > 0
        ? userMonthlyContributions.reduce((sum, m) => sum + m.value, 0) /
          userMonthlyContributions.length
        : 0;

    const summary: GlobalMetrics = {
      totalCommits: totalUserContributions, // User contributions is primary
      avgContributionsPerUserPerDay,
      totalLinesAdded,
      totalLinesRemoved,
      avgLinesPerCommit: totalRepoCommits > 0 ? (totalLinesAdded + totalLinesRemoved) / totalRepoCommits : 0,
      totalPRsOpened,
      totalPRsMerged,
      avgTimeToMergeHours,
      totalIssuesOpened,
      totalIssuesClosed,
      avgResolutionHours,
      activeUsers: userCount,
      activeRepos: repoCount,
      periodStart:
        userMonthlyContributions[0]?.date ||
        repoMonthlyData[0]?.date ||
        prMonthlyData[0]?.date ||
        issueMonthlyData[0]?.date ||
        "",
      periodEnd:
        userMonthlyContributions[userMonthlyContributions.length - 1]?.date ||
        repoMonthlyData[repoMonthlyData.length - 1]?.date ||
        prMonthlyData[prMonthlyData.length - 1]?.date ||
        issueMonthlyData[issueMonthlyData.length - 1]?.date ||
        "",
    };

    // Build trend data - USER contributions for commits, REPO data for lines
    const trends: TrendData = {
      // User productivity - avg contributions per user per day
      commits: userMonthlyContributions,
      activeDayShare: userMonthlyActiveDayShare,
      contributionsPerActiveDay: userMonthlyContribsPerActiveDay,
      // Lines of code from repo stats
      linesOfCode: repoMonthlyData.map((m) => ({
        date: m.date,
        value: m.avgLinesPerCommit,
      })),
      prMergeTime: prMonthlyData.map((m) => ({
        date: m.date,
        value: m.avgTimeToMergeHrs,
      })),
      issueResolution: issueMonthlyData.map((m) => ({
        date: m.date,
        value: m.avgResolutionHrs,
      })),
    };

    return NextResponse.json({
      summary,
      trends,
      dataSource: "real",
      dataCounts: {
        userContributions: userMonthTotalsRaw.length,
        repoCommits: commitMetrics.length,
        repoPRDays: prMetrics.length,
        repoIssueDays: issueMetrics.length,
      },
    });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}

// Aggregate REPO commit data by month (for lines of code metrics)
function aggregateRepoMetricsByMonth(
  metrics: Array<{
    date: Date;
    commitCount: number;
    linesAdded: number;
    linesRemoved: number;
  }>
): Array<{ date: string; avgLinesPerCommit: number }> {
  const monthMap = new Map<string, { commits: number; lines: number }>();

  for (const m of metrics) {
    const monthKey = m.date.toISOString().slice(0, 7); // YYYY-MM
    const existing = monthMap.get(monthKey) || { commits: 0, lines: 0 };
    monthMap.set(monthKey, {
      commits: existing.commits + m.commitCount,
      lines: existing.lines + m.linesAdded + m.linesRemoved,
    });
  }

  const result: Array<{ date: string; avgLinesPerCommit: number }> = [];
  for (const [month, data] of monthMap.entries()) {
    result.push({
      date: `${month}-01`,
      avgLinesPerCommit: data.commits > 0 ? data.lines / data.commits : 0,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function aggregatePRMetricsByMonth(
  metrics: Array<{
    date: Date;
    prsMerged: number;
    avgTimeToMergeHrs: number | null;
  }>
): Array<{ date: string; avgTimeToMergeHrs: number }> {
  const monthMap = new Map<string, { merged: number; mergeHours: number }>();

  for (const m of metrics) {
    const monthKey = m.date.toISOString().slice(0, 7);
    const existing = monthMap.get(monthKey) || { merged: 0, mergeHours: 0 };
    monthMap.set(monthKey, {
      merged: existing.merged + m.prsMerged,
      mergeHours: existing.mergeHours + (m.avgTimeToMergeHrs || 0) * m.prsMerged,
    });
  }

  const result: Array<{ date: string; avgTimeToMergeHrs: number }> = [];
  for (const [month, data] of monthMap.entries()) {
    result.push({
      date: `${month}-01`,
      avgTimeToMergeHrs: data.merged > 0 ? data.mergeHours / data.merged : 0,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateIssueMetricsByMonth(
  metrics: Array<{
    date: Date;
    issuesClosed: number;
    avgResolutionHrs: number | null;
  }>
): Array<{ date: string; avgResolutionHrs: number }> {
  const monthMap = new Map<string, { closed: number; resolutionHours: number }>();

  for (const m of metrics) {
    const monthKey = m.date.toISOString().slice(0, 7);
    const existing = monthMap.get(monthKey) || { closed: 0, resolutionHours: 0 };
    monthMap.set(monthKey, {
      closed: existing.closed + m.issuesClosed,
      resolutionHours:
        existing.resolutionHours + (m.avgResolutionHrs || 0) * m.issuesClosed,
    });
  }

  const result: Array<{ date: string; avgResolutionHrs: number }> = [];
  for (const [month, data] of monthMap.entries()) {
    result.push({
      date: `${month}-01`,
      avgResolutionHrs: data.closed > 0 ? data.resolutionHours / data.closed : 0,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function getEmptySummary(): GlobalMetrics {
  return {
    totalCommits: 0,
    avgContributionsPerUserPerDay: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    avgLinesPerCommit: 0,
    totalPRsOpened: 0,
    totalPRsMerged: 0,
    avgTimeToMergeHours: null,
    totalIssuesOpened: 0,
    totalIssuesClosed: 0,
    avgResolutionHours: null,
    activeUsers: 0,
    activeRepos: 0,
    periodStart: "",
    periodEnd: "",
  };
}

function getEmptyTrends(): TrendData {
  return {
    commits: [],
    activeDayShare: [],
    contributionsPerActiveDay: [],
    linesOfCode: [],
    prMergeTime: [],
    issueResolution: [],
  };
}
