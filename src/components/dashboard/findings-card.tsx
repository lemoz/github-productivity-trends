"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FindingsResponse = {
  cohort: {
    users: number;
    repos: number;
    tiers: Record<string, number>;
    lastUserSyncAt: string | null;
    lastRepoSyncAt: string | null;
    samplingSeed: number | null;
    samplingParams: unknown;
  };
  periods: {
    pre: {
      startMonth: string;
      endMonth: string;
      days: number;
      totalContributions: number;
      activeUserDays: number;
      contributionsPerUserPerDay: number;
      activeDayShare: number;
      contributionsPerActiveDay: number;
    };
    post: {
      startMonth: string;
      endMonth: string;
      days: number;
      totalContributions: number;
      activeUserDays: number;
      contributionsPerUserPerDay: number;
      activeDayShare: number;
      contributionsPerActiveDay: number;
    };
  };
  tiers: {
    pre: Record<
      string,
      {
        users: number;
        totalContributions: number;
        activeUserDays: number;
        contributionsPerUserPerDay: number;
        activeDayShare: number;
        contributionsPerActiveDay: number;
      }
    >;
    post: Record<
      string,
      {
        users: number;
        totalContributions: number;
        activeUserDays: number;
        contributionsPerUserPerDay: number;
        activeDayShare: number;
        contributionsPerActiveDay: number;
      }
    >;
  };
  distribution: {
    deltaContributionsPerUserPerDay: {
      mean: number;
      p10: number;
      p25: number;
      median: number;
      p75: number;
      p90: number;
      pctPositive: number;
      n: number;
    };
  };
  adoption: {
    usersWithAI: number;
    reposWithAI: number;
    totalSignals: number;
  };
};

function formatPct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

export function FindingsCard() {
  const [data, setData] = useState<FindingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/findings");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to load findings");
        }
        const json = (await res.json()) as FindingsResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load findings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    const pre = data.periods.pre.contributionsPerUserPerDay;
    const post = data.periods.post.contributionsPerUserPerDay;
    const pctChange = pre > 0 ? post / pre - 1 : 0;
    return { pre, post, pctChange };
  }, [data]);

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-5 w-40 rounded bg-gray-200" />
        </CardHeader>
        <CardContent>
          <div className="h-4 w-full rounded bg-gray-100" />
          <div className="mt-2 h-4 w-5/6 rounded bg-gray-100" />
          <div className="mt-2 h-4 w-2/3 rounded bg-gray-100" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Findings (v1)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-gray-700">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!error && data && summary && (
          <>
            <div className="space-y-1">
              <p className="font-medium text-gray-900">Productivity (primary metric)</p>
              <p>
                Avg contributions/user/day:{" "}
                <span className="font-semibold">
                  {summary.pre.toFixed(2)}
                </span>{" "}
                ({data.periods.pre.startMonth}–{data.periods.pre.endMonth}) →{" "}
                <span className="font-semibold">
                  {summary.post.toFixed(2)}
                </span>{" "}
                ({data.periods.post.startMonth}–{data.periods.post.endMonth}){" "}
                <span className="ml-2 font-semibold text-green-700">
                  {summary.pctChange >= 0 ? "+" : ""}
                  {(summary.pctChange * 100).toFixed(1)}%
                </span>
              </p>
              <p className="text-xs text-gray-500">
                From GitHub contribution calendars (includes commits, PRs, issues, reviews).
              </p>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-gray-900">Activity mix</p>
              <p>
                Active-day share:{" "}
                <span className="font-semibold">
                  {formatPct(data.periods.pre.activeDayShare)}
                </span>{" "}
                →{" "}
                <span className="font-semibold">
                  {formatPct(data.periods.post.activeDayShare)}
                </span>
                <span className="mx-2 text-gray-400">•</span>
                Contribs per active day:{" "}
                <span className="font-semibold">
                  {data.periods.pre.contributionsPerActiveDay.toFixed(2)}
                </span>{" "}
                →{" "}
                <span className="font-semibold">
                  {data.periods.post.contributionsPerActiveDay.toFixed(2)}
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-gray-900">By tier</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-2 pr-4">Tier</th>
                      <th className="py-2 pr-4">Users</th>
                      <th className="py-2 pr-4">Pre</th>
                      <th className="py-2 pr-4">Post</th>
                      <th className="py-2 pr-0">Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["top", "mid", "casual"].map((tier) => {
                      const pre = data.tiers.pre[tier]?.contributionsPerUserPerDay ?? 0;
                      const post = data.tiers.post[tier]?.contributionsPerUserPerDay ?? 0;
                      const users = data.cohort.tiers[tier] ?? 0;
                      const deltaPct = pre > 0 ? post / pre - 1 : 0;
                      return (
                        <tr key={tier} className="border-b last:border-b-0">
                          <td className="py-2 pr-4 font-medium capitalize text-gray-900">
                            {tier}
                          </td>
                          <td className="py-2 pr-4">{users.toLocaleString()}</td>
                          <td className="py-2 pr-4">{pre.toFixed(2)}</td>
                          <td className="py-2 pr-4">{post.toFixed(2)}</td>
                          <td className="py-2 pr-0">
                            <span className={deltaPct >= 0 ? "text-green-700" : "text-red-700"}>
                              {deltaPct >= 0 ? "+" : ""}
                              {(deltaPct * 100).toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">
                Cohort tiers are follower-based bands, sampled with a baseline activity filter.
              </p>
            </div>

            <div className="space-y-1">
              <p className="font-medium text-gray-900">Distribution (user-level deltas)</p>
              <p>
                Median Δ:{" "}
                <span className="font-semibold">
                  {data.distribution.deltaContributionsPerUserPerDay.median.toFixed(2)}
                </span>{" "}
                contribs/day{" "}
                <span className="mx-2 text-gray-400">•</span>
                Mean Δ:{" "}
                <span className="font-semibold">
                  {data.distribution.deltaContributionsPerUserPerDay.mean.toFixed(2)}
                </span>{" "}
                <span className="mx-2 text-gray-400">•</span>
                P25/P75:{" "}
                <span className="font-semibold">
                  {data.distribution.deltaContributionsPerUserPerDay.p25.toFixed(2)}
                </span>
                /
                <span className="font-semibold">
                  {data.distribution.deltaContributionsPerUserPerDay.p75.toFixed(2)}
                </span>{" "}
                <span className="mx-2 text-gray-400">•</span>
                % positive:{" "}
                <span className="font-semibold">
                  {formatPct(data.distribution.deltaContributionsPerUserPerDay.pctPositive)}
                </span>
              </p>
            </div>

            <div className="rounded-md border bg-gray-50 p-3 text-xs text-gray-600">
              <p>
                <span className="font-medium text-gray-800">Caveat:</span> correlational only. The cohort is sampled
                (active in 2020–2021) and this dashboard does not yet attribute changes to AI tool adoption at the
                user level.
              </p>
              <p className="mt-2">
                <span className="font-medium text-gray-800">Data:</span>{" "}
                {data.cohort.users.toLocaleString()} users, {data.cohort.repos.toLocaleString()} repos. AI signals found
                in {data.adoption.usersWithAI.toLocaleString()} users / {data.adoption.reposWithAI.toLocaleString()} repos
                ({data.adoption.totalSignals.toLocaleString()} total signals).
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

