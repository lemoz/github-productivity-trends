-- CreateTable
CREATE TABLE "AISignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "examples" TEXT,
    "userId" TEXT,
    "repoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AISignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SampledUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AISignal_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "SampledRepo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SampledRepo" (
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
    "aiAdoptionFirstSeenAt" DATETIME,
    "aiAdoptionScore" REAL NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SampledRepo" ("createdAt", "description", "forks", "fullName", "githubId", "id", "lastSyncedAt", "name", "openIssues", "owner", "primaryLanguage", "stars", "updatedAt") SELECT "createdAt", "description", "forks", "fullName", "githubId", "id", "lastSyncedAt", "name", "openIssues", "owner", "primaryLanguage", "stars", "updatedAt" FROM "SampledRepo";
DROP TABLE "SampledRepo";
ALTER TABLE "new_SampledRepo" RENAME TO "SampledRepo";
CREATE UNIQUE INDEX "SampledRepo_githubId_key" ON "SampledRepo"("githubId");
CREATE UNIQUE INDEX "SampledRepo_fullName_key" ON "SampledRepo"("fullName");
CREATE TABLE "new_SampledUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "profileUrl" TEXT,
    "publicRepos" INTEGER NOT NULL DEFAULT 0,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "totalContributions" INTEGER NOT NULL DEFAULT 0,
    "baselineContributions" INTEGER NOT NULL DEFAULT 0,
    "aiAdoptionFirstSeenAt" DATETIME,
    "aiAdoptionScore" REAL NOT NULL DEFAULT 0,
    "primaryLanguage" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SampledUser" ("avatarUrl", "baselineContributions", "createdAt", "followers", "githubId", "id", "lastSyncedAt", "primaryLanguage", "profileUrl", "publicRepos", "tier", "totalContributions", "updatedAt", "username") SELECT "avatarUrl", "baselineContributions", "createdAt", "followers", "githubId", "id", "lastSyncedAt", "primaryLanguage", "profileUrl", "publicRepos", "tier", "totalContributions", "updatedAt", "username" FROM "SampledUser";
DROP TABLE "SampledUser";
ALTER TABLE "new_SampledUser" RENAME TO "SampledUser";
CREATE UNIQUE INDEX "SampledUser_githubId_key" ON "SampledUser"("githubId");
CREATE UNIQUE INDEX "SampledUser_username_key" ON "SampledUser"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AISignal_signalType_idx" ON "AISignal"("signalType");

-- CreateIndex
CREATE INDEX "AISignal_userId_idx" ON "AISignal"("userId");

-- CreateIndex
CREATE INDEX "AISignal_repoId_idx" ON "AISignal"("repoId");
