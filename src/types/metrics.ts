// Time series data point for charts
export interface TimeSeriesDataPoint {
  date: string; // ISO date string
  value: number;
  // Optional breakdown
  byLanguage?: Record<string, number>;
  byTier?: Record<string, number>;
}

// Global metrics summary
export interface GlobalMetrics {
  // Commit metrics
  totalCommits: number;
  avgCommitsPerUser: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  avgLinesPerCommit: number;

  // PR metrics
  totalPRsOpened: number;
  totalPRsMerged: number;
  avgTimeToMergeHours: number | null;

  // Issue metrics
  totalIssuesOpened: number;
  totalIssuesClosed: number;
  avgResolutionHours: number | null;

  // Counts
  activeUsers: number;
  activeRepos: number;

  // Period
  periodStart: string;
  periodEnd: string;
}

// Trend data for dashboard charts
export interface TrendData {
  commits: TimeSeriesDataPoint[];
  linesOfCode: TimeSeriesDataPoint[];
  prMergeTime: TimeSeriesDataPoint[];
  issueResolution: TimeSeriesDataPoint[];
}

// Filter options
export interface MetricsFilters {
  startDate?: string;
  endDate?: string;
  language?: string;
  userTier?: "top" | "mid" | "casual" | "all";
}

// User productivity summary
export interface UserProductivity {
  username: string;
  tier: string;
  totalCommits: number;
  avgCommitsPerDay: number;
  totalPRs: number;
  avgPRMergeTime: number | null;
  primaryLanguage: string | null;
}

// Repository stats summary
export interface RepoStats {
  fullName: string;
  language: string;
  stars: number;
  totalCommits: number;
  avgCommitsPerWeek: number;
  avgPRMergeTime: number | null;
  avgIssueResolutionTime: number | null;
}

// Sync job status
export interface SyncStatus {
  lastSyncAt: string | null;
  isRunning: boolean;
  usersTracked: number;
  reposTracked: number;
  rateLimitStatus: {
    rest: { remaining: number; limit: number; resetAt: string };
    search: { remaining: number; limit: number; resetAt: string };
    graphql: { remaining: number; limit: number; resetAt: string };
  };
}

// Languages we track
export const TRACKED_LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C++",
  "C#",
  "PHP",
  "Ruby",
] as const;

export type TrackedLanguage = (typeof TRACKED_LANGUAGES)[number];
