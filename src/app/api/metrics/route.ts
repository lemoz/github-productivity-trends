import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GlobalMetrics, TrendData } from "@/types/metrics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  try {
    const dateFilter = {
      gte: startDate ? new Date(startDate) : new Date("2020-01-01"),
      lte: endDate ? new Date(endDate) : new Date(),
    };

    // Get USER contribution data (this is the main metric we care about!)
    const userContributions = await prisma.userContributionMetrics.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" },
    });

    // Get REPO commit metrics as secondary data
    const commitMetrics = await prisma.commitMetrics.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" },
    });

    // Get PR and issue metrics for flow/quality signals
    const prMetrics = await prisma.pRMetrics.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" },
    });

    const issueMetrics = await prisma.issueMetrics.findMany({
      where: { date: dateFilter },
      orderBy: { date: "asc" },
    });

    // Get user and repo counts
    const [userCount, repoCount] = await Promise.all([
      prisma.sampledUser.count(),
      prisma.sampledRepo.count(),
    ]);

    // Check if we have any data
    const hasUserData = userContributions.length > 0;
    const hasRepoData =
      commitMetrics.length > 0 || prMetrics.length > 0 || issueMetrics.length > 0;

    if (!hasUserData && !hasRepoData) {
      return NextResponse.json({
        summary: getEmptySummary(),
        trends: getEmptyTrends(),
        message: "No data collected yet. Click 'Sync GitHub Data' to populate.",
      });
    }

    // Aggregate USER contributions by month (PRIMARY metric for productivity)
    const userMonthlyData = aggregateUserContributionsByMonth(userContributions, userCount);

    // Aggregate REPO metrics by month (secondary - for lines of code)
    const repoMonthlyData = aggregateRepoMetricsByMonth(commitMetrics);

    const prMonthlyData = aggregatePRMetricsByMonth(prMetrics);
    const issueMonthlyData = aggregateIssueMetricsByMonth(issueMetrics);

    // Calculate summary from USER contribution data
    const totalUserContributions = userContributions.reduce((sum, m) => sum + m.contributionCount, 0);
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
    const avgContributionsPerUserPerDay = userMonthlyData.length > 0
      ? userMonthlyData.reduce((sum, m) => sum + m.avgContributionsPerUserPerDay, 0) / userMonthlyData.length
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
        userMonthlyData[0]?.date ||
        repoMonthlyData[0]?.date ||
        prMonthlyData[0]?.date ||
        issueMonthlyData[0]?.date ||
        "",
      periodEnd:
        userMonthlyData[userMonthlyData.length - 1]?.date ||
        repoMonthlyData[repoMonthlyData.length - 1]?.date ||
        prMonthlyData[prMonthlyData.length - 1]?.date ||
        issueMonthlyData[issueMonthlyData.length - 1]?.date ||
        "",
    };

    // Build trend data - USER contributions for commits, REPO data for lines
    const trends: TrendData = {
      // User productivity - avg contributions per user per day
      commits: userMonthlyData.map((m) => ({
        date: m.date,
        value: m.avgContributionsPerUserPerDay,
      })),
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
        userContributions: userContributions.length,
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

// Aggregate USER contribution data by month - calculate avg contributions per user per day
function aggregateUserContributionsByMonth(
  contributions: Array<{
    date: Date;
    userId: string;
    contributionCount: number;
  }>,
  totalUserCount: number
): Array<{ date: string; avgContributionsPerUserPerDay: number }> {
  // Group by month, tracking total contributions
  const monthMap = new Map<string, number>();

  for (const c of contributions) {
    const monthKey = c.date.toISOString().slice(0, 7); // YYYY-MM
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + c.contributionCount);
  }

  const result: Array<{ date: string; avgContributionsPerUserPerDay: number }> = [];
  for (const [month, totalContributions] of monthMap.entries()) {
    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const monthNum = Number(monthStr); // 1-based
    const daysInMonth = Number.isFinite(year) && Number.isFinite(monthNum)
      ? new Date(year, monthNum, 0).getDate()
      : 30;

    const avgContributionsPerUserPerDay =
      totalUserCount > 0 && daysInMonth > 0
        ? totalContributions / (totalUserCount * daysInMonth)
        : 0;

    result.push({
      date: `${month}-01`,
      avgContributionsPerUserPerDay,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
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
    linesOfCode: [],
    prMergeTime: [],
    issueResolution: [],
  };
}
