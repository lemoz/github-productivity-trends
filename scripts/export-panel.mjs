#!/usr/bin/env node

/**
 * Export a user-month panel dataset for causal analysis.
 *
 * Usage:
 *   node scripts/export-panel.mjs --out analysis/user_month_panel.csv \
 *     --start 2020-01-01 --end 2025-12-31
 *
 * Options:
 *   --out   Output CSV path (default: analysis/user_month_panel.csv)
 *   --start Start date (YYYY-MM-DD, default: 2020-01-01)
 *   --end   End date (YYYY-MM-DD, default: today)
 *   --db    DATABASE_URL override (e.g. file:./dev_v1.db)
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value =
      argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[key.slice(2)] = value;
  }
  return args;
}

function daysInMonth(isoMonth) {
  const [yearStr, monthStr] = isoMonth.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return 30;
  return new Date(year, monthNum, 0).getDate();
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toCsv(rows, headers) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/\"/g, "\"\"")}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const outPath = args.out || path.join("analysis", "user_month_panel.csv");
  const start = args.start || "2020-01-01";
  const end = args.end || new Date().toISOString().slice(0, 10);

  if (args.db) {
    process.env.DATABASE_URL = args.db;
  }

  const prisma = new PrismaClient();

  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T23:59:59.999Z`).getTime();

  const users = await prisma.sampledUser.findMany({
    select: {
      id: true,
      username: true,
      tier: true,
      followers: true,
      baselineContributions: true,
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const userMonthly = await prisma.$queryRaw`
    SELECT
      userId as userId,
      strftime('%Y-%m-01', date/1000, 'unixepoch') as month,
      SUM(contributionCount) as totalContributions,
      COUNT(*) as activeDays
    FROM UserContributionMetrics
    WHERE date >= ${startMs} AND date <= ${endMs}
    GROUP BY userId, month
    ORDER BY month ASC
  `;

  const prMonthly = await prisma.$queryRaw`
    SELECT
      strftime('%Y-%m-01', date/1000, 'unixepoch') as month,
      SUM(prsOpened) as prsOpened,
      SUM(prsMerged) as prsMerged,
      CASE WHEN SUM(prsMerged) > 0
        THEN SUM(COALESCE(avgTimeToMergeHrs, 0) * prsMerged) / SUM(prsMerged)
        ELSE NULL END as avgTimeToMergeHrs
    FROM PRMetrics
    WHERE date >= ${startMs} AND date <= ${endMs}
    GROUP BY month
  `;
  const prByMonth = new Map(prMonthly.map((m) => [m.month, m]));

  const issueMonthly = await prisma.$queryRaw`
    SELECT
      strftime('%Y-%m-01', date/1000, 'unixepoch') as month,
      SUM(issuesOpened) as issuesOpened,
      SUM(issuesClosed) as issuesClosed,
      CASE WHEN SUM(issuesClosed) > 0
        THEN SUM(COALESCE(avgResolutionHrs, 0) * issuesClosed) / SUM(issuesClosed)
        ELSE NULL END as avgResolutionHrs
    FROM IssueMetrics
    WHERE date >= ${startMs} AND date <= ${endMs}
    GROUP BY month
  `;
  const issueByMonth = new Map(issueMonthly.map((m) => [m.month, m]));

  const panelRows = [];
  for (const row of userMonthly) {
    const u = userById.get(row.userId);
    if (!u) continue;

    const month = row.month;
    const dim = daysInMonth(month.slice(0, 7));
    const total = Number(row.totalContributions || 0);
    const activeDays = Number(row.activeDays || 0);

    const pr = prByMonth.get(month) || {};
    const issues = issueByMonth.get(month) || {};

    panelRows.push({
      userId: u.id,
      username: u.username,
      tier: u.tier,
      followers: u.followers,
      baselineContributions: u.baselineContributions,
      month,
      daysInMonth: dim,
      totalContributions: total,
      activeDays,
      contributionsPerUserPerDay: dim > 0 ? total / dim : 0,
      prsOpened: pr.prsOpened ? Number(pr.prsOpened) : 0,
      prsMerged: pr.prsMerged ? Number(pr.prsMerged) : 0,
      avgTimeToMergeHrs:
        pr.avgTimeToMergeHrs != null ? Number(pr.avgTimeToMergeHrs) : "",
      issuesOpened: issues.issuesOpened ? Number(issues.issuesOpened) : 0,
      issuesClosed: issues.issuesClosed ? Number(issues.issuesClosed) : 0,
      avgResolutionHrs:
        issues.avgResolutionHrs != null ? Number(issues.avgResolutionHrs) : "",
    });
  }

  const headers = [
    "userId",
    "username",
    "tier",
    "followers",
    "baselineContributions",
    "month",
    "daysInMonth",
    "totalContributions",
    "activeDays",
    "contributionsPerUserPerDay",
    "prsOpened",
    "prsMerged",
    "avgTimeToMergeHrs",
    "issuesOpened",
    "issuesClosed",
    "avgResolutionHrs",
  ];

  ensureDir(outPath);
  fs.writeFileSync(outPath, toCsv(panelRows, headers));

  console.log(
    `Wrote ${panelRows.length} rows for ${users.length} users to ${outPath}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

