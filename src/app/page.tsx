"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendLineChart } from "@/components/charts/trend-line-chart";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { FindingsCard } from "@/components/dashboard/findings-card";
import { SyncButton } from "@/components/dashboard/sync-button";
import type { GlobalMetrics, TrendData, SyncStatus } from "@/types/metrics";

export default function Dashboard() {
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [metricsRes, syncRes] = await Promise.all([
        fetch("/api/metrics"),
        fetch("/api/sync"),
      ]);

      const metricsData = await metricsRes.json();
      const syncData = await syncRes.json();

      setMetrics(metricsData.summary);
      setTrends(metricsData.trends);
      setSyncStatus(syncData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                GitHub Productivity Trends
              </h1>
              <p className="mt-1 text-gray-600">
                Measuring the impact of AI coding tools on developer productivity
              </p>
            </div>
            <SyncButton syncStatus={syncStatus} onSyncComplete={fetchData} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Stats Overview */}
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Productivity Overview
          </h2>
          <StatsCards metrics={metrics} isLoading={isLoading} />
        </section>

        {/* Trend Charts */}
        <section>
          <Tabs defaultValue="commits" className="w-full">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Productivity Trends Over Time
              </h2>
              <TabsList>
                <TabsTrigger value="commits">Contributions</TabsTrigger>
                <TabsTrigger value="lines">Lines of Code</TabsTrigger>
                <TabsTrigger value="prs">PR Velocity</TabsTrigger>
                <TabsTrigger value="issues">Issue Resolution</TabsTrigger>
              </TabsList>
            </div>

            <Card>
              <CardContent className="pt-6">
                <TabsContent value="commits" className="mt-0">
                  {isLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <TrendLineChart
                      data={trends?.commits || []}
                      title="Average Contributions Per User Per Day"
                      yAxisLabel="Contributions/Day"
                      color="#3b82f6"
                      valueFormatter={(v) => v.toFixed(1)}
                    />
                  )}
                </TabsContent>

                <TabsContent value="lines" className="mt-0">
                  {isLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <TrendLineChart
                      data={trends?.linesOfCode || []}
                      title="Average Lines Changed per Commit"
                      yAxisLabel="Lines"
                      color="#10b981"
                      valueFormatter={(v) => v.toFixed(0)}
                    />
                  )}
                </TabsContent>

                <TabsContent value="prs" className="mt-0">
                  {isLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <TrendLineChart
                      data={trends?.prMergeTime || []}
                      title="Average PR Merge Time"
                      yAxisLabel="Hours"
                      color="#f59e0b"
                      valueFormatter={(v) => `${v.toFixed(1)}h`}
                    />
                  )}
                </TabsContent>

                <TabsContent value="issues" className="mt-0">
                  {isLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <TrendLineChart
                      data={trends?.issueResolution || []}
                      title="Average Issue Resolution Time"
                      yAxisLabel="Hours"
                      color="#ef4444"
                      valueFormatter={(v) => `${v.toFixed(1)}h`}
                    />
                  )}
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </section>

        {/* Findings */}
        <section className="mt-8">
          <FindingsCard />
        </section>

        {/* AI Milestones Timeline */}
        <section className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>AI Tool Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <MilestoneTimeline />
            </CardContent>
          </Card>
        </section>

        {/* About Section */}
        <section className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>About This Dashboard</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none text-gray-600">
              <p>
                This dashboard tracks public GitHub activity over time to explore
                whether AI coding tools are associated with changes in developer
                throughput and shipping speed. We sample active developers across
                follower tiers and popular repositories across major languages.
              </p>
              <p className="mt-2">
                <strong>Primary metric:</strong> average GitHub contributions per
                user per day (from contribution calendars, including commits, PRs,
                issues, and reviews).
              </p>
              <p className="mt-2">
                <strong>Flow metrics:</strong> lines changed per commit, PR merge
                time, and issue resolution time.
              </p>
              <p className="mt-2">
                <strong>AI milestones:</strong> Chart markers show major AI tool
                releases (Copilot, ChatGPT, Claude, etc.) as reference points —
                not direct adoption signals.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Charts default to complete months only (the current partial month is excluded).
                Results are correlational and based on public data only.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white py-6">
        <div className="container mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            Data sourced from GitHub API. Metrics are based on sampled users and
            repositories.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[400px] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
    </div>
  );
}

function MilestoneTimeline() {
  const milestones = [
    { date: "Jun 2022", event: "Copilot GA", type: "copilot" },
    { date: "Nov 2022", event: "ChatGPT", type: "openai" },
    { date: "Mar 2023", event: "GPT-4 & Claude", type: "multiple" },
    { date: "Jun 2024", event: "Claude 3.5 Sonnet", type: "anthropic" },
    { date: "Feb 2025", event: "Copilot Agent Mode", type: "copilot" },
    { date: "Nov 2025", event: "GPT-5.1 / Gemini 3 / Opus 4.5", type: "multiple" },
  ];

  const typeColors: Record<string, string> = {
    copilot: "bg-indigo-500",
    openai: "bg-emerald-500",
    anthropic: "bg-orange-500",
    google: "bg-blue-500",
    multiple: "bg-purple-500",
  };

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 h-full w-0.5 bg-gray-200" />

      {/* Milestones */}
      <div className="space-y-4">
        {milestones.map((m, i) => (
          <div key={i} className="relative flex items-center gap-4 pl-10">
            <div
              className={`absolute left-2.5 h-3 w-3 rounded-full ${typeColors[m.type]}`}
            />
            <span className="w-20 text-sm font-medium text-gray-500">
              {m.date}
            </span>
            <span className="text-sm text-gray-900">{m.event}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
