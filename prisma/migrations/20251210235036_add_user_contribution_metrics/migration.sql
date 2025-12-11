-- CreateTable
CREATE TABLE "UserContributionMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "contributionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserContributionMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SampledUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserContributionMetrics_date_idx" ON "UserContributionMetrics"("date");

-- CreateIndex
CREATE INDEX "UserContributionMetrics_userId_idx" ON "UserContributionMetrics"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserContributionMetrics_date_userId_key" ON "UserContributionMetrics"("date", "userId");
