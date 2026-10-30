-- CreateTable
CREATE TABLE "Season" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "sourceId" TEXT
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "scheduledStart" DATETIME,
    "scheduleUpdatedAt" DATETIME,
    "sourceId" TEXT,
    "isSprint" BOOLEAN NOT NULL DEFAULT false,
    "circuitId" TEXT,
    CONSTRAINT "Round_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Round_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Circuit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT,
    "name" TEXT NOT NULL,
    "locality" TEXT,
    "country" TEXT,
    "latitude" REAL,
    "longitude" REAL
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT,
    "givenName" TEXT,
    "familyName" TEXT,
    "displayName" TEXT NOT NULL,
    "nationality" TEXT,
    "birthDate" DATETIME,
    "biography" TEXT,
    "imageUrl" TEXT,
    "imageCredit" TEXT
);

-- CreateTable
CREATE TABLE "Constructor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT,
    "name" TEXT NOT NULL,
    "nationality" TEXT,
    "logoUrl" TEXT,
    "logoCredit" TEXT
);

-- CreateTable
CREATE TABLE "DriverSeasonEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "driverId" TEXT NOT NULL,
    "constructorId" TEXT NOT NULL,
    "racingNumber" INTEGER,
    "validFromRound" INTEGER,
    "validToRound" INTEGER,
    CONSTRAINT "DriverSeasonEntry_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DriverSeasonEntry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DriverSeasonEntry_constructorId_fkey" FOREIGN KEY ("constructorId") REFERENCES "Constructor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "constructorId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "gridPosition" INTEGER,
    "finishPosition" INTEGER,
    "classified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "timeMillis" INTEGER,
    "gapMillis" INTEGER,
    "laps" INTEGER,
    "points" REAL NOT NULL DEFAULT 0,
    "fastestLap" INTEGER,
    "sourceId" TEXT,
    "sourcePayload" JSONB,
    CONSTRAINT "Result_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_constructorId_fkey" FOREIGN KEY ("constructorId") REFERENCES "Constructor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QualifyingResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "position" INTEGER,
    "q1Millis" INTEGER,
    "q2Millis" INTEGER,
    "q3Millis" INTEGER,
    "sourcePayload" JSONB,
    CONSTRAINT "QualifyingResult_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QualifyingResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PitStop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "lap" INTEGER NOT NULL,
    "stopNumber" INTEGER,
    "durationMillis" INTEGER,
    "sourcePayload" JSONB,
    CONSTRAINT "PitStop_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PitStop_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DriverStanding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "throughRound" INTEGER NOT NULL,
    "driverId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" REAL NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "podiums" INTEGER NOT NULL DEFAULT 0,
    "poles" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverStanding_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DriverStanding_seasonYear_throughRound_fkey" FOREIGN KEY ("seasonYear", "throughRound") REFERENCES "Round" ("seasonYear", "number") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DriverStanding_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConstructorStanding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "throughRound" INTEGER NOT NULL,
    "constructorId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" REAL NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConstructorStanding_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConstructorStanding_seasonYear_throughRound_fkey" FOREIGN KEY ("seasonYear", "throughRound") REFERENCES "Round" ("seasonYear", "number") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConstructorStanding_constructorId_fkey" FOREIGN KEY ("constructorId") REFERENCES "Constructor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoringRuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceArticle" TEXT,
    "racePoints" JSONB NOT NULL,
    "sprintPoints" JSONB NOT NULL,
    "fastestLapRule" JSONB NOT NULL,
    "reducedRaceRules" JSONB NOT NULL,
    "sprintDistanceRule" JSONB NOT NULL,
    "tieBreakRules" JSONB NOT NULL,
    CONSTRAINT "ScoringRuleSet_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecapEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceLabel" TEXT,
    "authorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecapEntry_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "learnMoreUrl" TEXT,
    "seasonFrom" INTEGER,
    "seasonTo" INTEGER
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "seasonFrom" INTEGER,
    "seasonTo" INTEGER
);

-- CreateTable
CREATE TABLE "PredictionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "validation" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PredictionRun_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonYear" INTEGER NOT NULL,
    "throughRound" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastError" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL,
    CONSTRAINT "DataStatus_seasonYear_fkey" FOREIGN KEY ("seasonYear") REFERENCES "Season" ("year") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" JSONB,
    "overrideValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Round_seasonYear_number_key" ON "Round"("seasonYear", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Circuit_sourceId_key" ON "Circuit"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_sourceId_key" ON "Driver"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Constructor_sourceId_key" ON "Constructor"("sourceId");

-- CreateIndex
CREATE INDEX "DriverSeasonEntry_seasonYear_driverId_idx" ON "DriverSeasonEntry"("seasonYear", "driverId");

-- CreateIndex
CREATE INDEX "DriverSeasonEntry_seasonYear_constructorId_idx" ON "DriverSeasonEntry"("seasonYear", "constructorId");

-- CreateIndex
CREATE INDEX "Result_roundId_sessionType_finishPosition_idx" ON "Result"("roundId", "sessionType", "finishPosition");

-- CreateIndex
CREATE UNIQUE INDEX "Result_roundId_driverId_sessionType_key" ON "Result"("roundId", "driverId", "sessionType");

-- CreateIndex
CREATE UNIQUE INDEX "QualifyingResult_roundId_driverId_key" ON "QualifyingResult"("roundId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "PitStop_roundId_driverId_lap_key" ON "PitStop"("roundId", "driverId", "lap");

-- CreateIndex
CREATE INDEX "DriverStanding_seasonYear_throughRound_position_idx" ON "DriverStanding"("seasonYear", "throughRound", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DriverStanding_seasonYear_throughRound_driverId_key" ON "DriverStanding"("seasonYear", "throughRound", "driverId");

-- CreateIndex
CREATE INDEX "ConstructorStanding_seasonYear_throughRound_position_idx" ON "ConstructorStanding"("seasonYear", "throughRound", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructorStanding_seasonYear_throughRound_constructorId_key" ON "ConstructorStanding"("seasonYear", "throughRound", "constructorId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringRuleSet_seasonYear_version_key" ON "ScoringRuleSet"("seasonYear", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DataStatus_seasonYear_key" ON "DataStatus"("seasonYear");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

