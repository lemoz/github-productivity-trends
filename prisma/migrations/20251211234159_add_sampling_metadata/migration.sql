-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN "samplingParams" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN "samplingSeed" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "primaryLanguage" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SampledUser" ("avatarUrl", "createdAt", "followers", "githubId", "id", "lastSyncedAt", "primaryLanguage", "profileUrl", "publicRepos", "tier", "totalContributions", "updatedAt", "username") SELECT "avatarUrl", "createdAt", "followers", "githubId", "id", "lastSyncedAt", "primaryLanguage", "profileUrl", "publicRepos", "tier", "totalContributions", "updatedAt", "username" FROM "SampledUser";
DROP TABLE "SampledUser";
ALTER TABLE "new_SampledUser" RENAME TO "SampledUser";
CREATE UNIQUE INDEX "SampledUser_githubId_key" ON "SampledUser"("githubId");
CREATE UNIQUE INDEX "SampledUser_username_key" ON "SampledUser"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
