"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GlobalMetrics } from "@/types/metrics";

interface StatsCardsProps {
  metrics: GlobalMetrics | null;
  isLoading?: boolean;
}

export function StatsCards({ metrics, isLoading }: StatsCardsProps) {
  const stats = [
    {
      title: "Avg Commits/Day",
      value: metrics?.avgCommitsPerUser
        ? metrics.avgCommitsPerUser.toFixed(1)
        : "—",
      description: "Average commits per day per user",
      trend: "",
      trendUp: true,
    },
    {
      title: "Avg Lines/Commit",
      value: metrics?.avgLinesPerCommit?.toFixed(0) || "—",
      description: "Lines added + removed per commit",
      trend: "",
      trendUp: true,
    },
    {
      title: "PR Merge Time",
      value: metrics?.avgTimeToMergeHours
        ? `${metrics.avgTimeToMergeHours.toFixed(1)}h`
        : "—",
      description: "Average time to merge PRs",
      trend: "-15%",
      trendUp: true, // Lower is better for merge time
    },
    {
      title: "Issue Resolution",
      value: metrics?.avgResolutionHours
        ? `${metrics.avgResolutionHours.toFixed(1)}h`
        : "—",
      description: "Average time to close issues",
      trend: "-22%",
      trendUp: true, // Lower is better
    },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 w-24 rounded bg-gray-200" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-32 rounded bg-gray-100" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              {stat.title}
            </CardTitle>
            <span
              className={`text-xs font-medium ${
                stat.trendUp ? "text-green-600" : "text-red-600"
              }`}
            >
              {stat.trend}
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
            <p className="text-xs text-gray-500">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
