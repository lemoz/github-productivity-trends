-- CreateTable
CREATE TABLE "SampledUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "profileUrl" TEXT,
    "publicRepos" INTEGER NOT NULL DEFAULT 0,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "totalContributions" INTEGER NOT NULL DEFAULT 0,
    "primaryLanguage" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SampledRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT,
    "primaryLanguage" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommitMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "userId" TEXT,
    "repoId" TEXT,
    "language" TEXT,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    "linesAdded" INTEGER NOT NULL DEFAULT 0,
    "linesRemoved" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommitMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SampledUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommitMetrics_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "SampledRepo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PRMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "userId" TEXT,
    "repoId" TEXT,
    "language" TEXT,
    "prsOpened" INTEGER NOT NULL DEFAULT 0,
    "prsMerged" INTEGER NOT NULL DEFAULT 0,
    "prsClosed" INTEGER NOT NULL DEFAULT 0,
    "avgTimeToMergeHrs" REAL,
    "avgReviewCycles" REAL,
    "avgLinesPerPR" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PRMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SampledUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PRMetrics_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "SampledRepo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IssueMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "repoId" TEXT,
    "language" TEXT,
    "issuesOpened" INTEGER NOT NULL DEFAULT 0,
    "issuesClosed" INTEGER NOT NULL DEFAULT 0,
    "avgResolutionHrs" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueMetrics_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "SampledRepo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GlobalDailyMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "totalCommits" INTEGER NOT NULL DEFAULT 0,
    "avgCommitsPerUser" REAL NOT NULL DEFAULT 0,
    "totalLinesAdded" INTEGER NOT NULL DEFAULT 0,
    "totalLinesRemoved" INTEGER NOT NULL DEFAULT 0,
    "avgLinesPerCommit" REAL NOT NULL DEFAULT 0,
    "totalPRsOpened" INTEGER NOT NULL DEFAULT 0,
    "totalPRsMerged" INTEGER NOT NULL DEFAULT 0,
    "avgTimeToMergeHrs" REAL,
    "totalIssuesOpened" INTEGER NOT NULL DEFAULT 0,
    "totalIssuesClosed" INTEGER NOT NULL DEFAULT 0,
    "avgResolutionHrs" REAL,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "activeRepos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "APICache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "responseData" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rateLimitRemaining" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SampledUser_githubId_key" ON "SampledUser"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "SampledUser_username_key" ON "SampledUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "SampledRepo_githubId_key" ON "SampledRepo"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "SampledRepo_fullName_key" ON "SampledRepo"("fullName");

-- CreateIndex
CREATE INDEX "CommitMetrics_date_idx" ON "CommitMetrics"("date");

-- CreateIndex
CREATE INDEX "CommitMetrics_userId_idx" ON "CommitMetrics"("userId");

-- CreateIndex
CREATE INDEX "CommitMetrics_repoId_idx" ON "CommitMetrics"("repoId");

-- CreateIndex
CREATE INDEX "CommitMetrics_language_idx" ON "CommitMetrics"("language");

-- CreateIndex
CREATE UNIQUE INDEX "CommitMetrics_date_userId_repoId_language_key" ON "CommitMetrics"("date", "userId", "repoId", "language");

-- CreateIndex
CREATE INDEX "PRMetrics_date_idx" ON "PRMetrics"("date");

-- CreateIndex
CREATE INDEX "PRMetrics_userId_idx" ON "PRMetrics"("userId");

-- CreateIndex
CREATE INDEX "PRMetrics_repoId_idx" ON "PRMetrics"("repoId");

-- CreateIndex
CREATE INDEX "PRMetrics_language_idx" ON "PRMetrics"("language");

-- CreateIndex
CREATE UNIQUE INDEX "PRMetrics_date_userId_repoId_language_key" ON "PRMetrics"("date", "userId", "repoId", "language");

-- CreateIndex
CREATE INDEX "IssueMetrics_date_idx" ON "IssueMetrics"("date");

-- CreateIndex
CREATE INDEX "IssueMetrics_repoId_idx" ON "IssueMetrics"("repoId");

-- CreateIndex
CREATE INDEX "IssueMetrics_language_idx" ON "IssueMetrics"("language");

-- CreateIndex
CREATE UNIQUE INDEX "IssueMetrics_date_repoId_language_key" ON "IssueMetrics"("date", "repoId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalDailyMetrics_date_key" ON "GlobalDailyMetrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "APICache_cacheKey_key" ON "APICache"("cacheKey");

-- CreateIndex
CREATE INDEX "APICache_cacheKey_idx" ON "APICache"("cacheKey");

-- CreateIndex
CREATE INDEX "APICache_expiresAt_idx" ON "APICache"("expiresAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- CreateIndex
CREATE INDEX "SyncJob_jobType_idx" ON "SyncJob"("jobType");
