import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    if (!key) {
      continue;
    }

    const value = rest.join("=").replace(/^"(.*)"$/, "$1");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getSqlitePath() {
  loadEnvFile(path.join(repoRoot, ".env"));
  const url = process.env.DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:")) {
    throw new Error("This local init script expects DATABASE_URL to use a SQLite file URL.");
  }

  const relative = url.slice("file:".length);
  return path.resolve(repoRoot, "prisma", relative);
}

const sqlitePath = getSqlitePath();
fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

function runSql(sql) {
  execFileSync("sqlite3", [sqlitePath], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"]
  });
}

function queryJson(sql) {
  const output = execFileSync("sqlite3", ["-json", sqlitePath, sql], {
    encoding: "utf8"
  });

  if (!output.trim()) {
    return [];
  }

  return JSON.parse(output);
}

function getTableColumns(tableName) {
  const rows = queryJson(`PRAGMA table_info("${tableName}");`);
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(tableName, columnName, columnSql) {
  const columns = getTableColumns(tableName);
  if (columns.has(columnName)) {
    return false;
  }

  runSql(`ALTER TABLE "${tableName}" ADD COLUMN ${columnSql};`);
  return true;
}

const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "GenerationRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestId" TEXT NOT NULL,
  "rawInput" TEXT NOT NULL,
  "styleOptions" TEXT NOT NULL,
  "detectedIntent" TEXT NOT NULL,
  "detectedTone" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "providerName" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "OpeningCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generationRequestId" TEXT NOT NULL,
  "rankOrder" INTEGER NOT NULL,
  "strategyType" TEXT NOT NULL DEFAULT 'scene',
  "openingStrategy" TEXT NOT NULL,
  "styleLabel" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "qualityScore" INTEGER NOT NULL,
  "evaluationTotalScore" INTEGER,
  "evaluationJson" TEXT,
  "evaluationModelName" TEXT,
  "evaluatedAt" DATETIME,
  "isCopied" INTEGER NOT NULL DEFAULT 0,
  "isSelected" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "copiedAt" DATETIME,
  CONSTRAINT "OpeningCandidate_generationRequestId_fkey"
    FOREIGN KEY ("generationRequestId") REFERENCES "GenerationRequest" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OpeningCandidate_generationRequestId_rankOrder_idx"
  ON "OpeningCandidate" ("generationRequestId", "rankOrder");

CREATE TABLE IF NOT EXISTS "CopyEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "candidateId" TEXT NOT NULL,
  "generationRequestId" TEXT,
  "selectedCandidateId" TEXT,
  "guestId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopyEvent_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "OpeningCandidate" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PreferenceProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileKey" TEXT NOT NULL UNIQUE,
  "hookStrengthWeight" REAL NOT NULL DEFAULT 0,
  "clarityWeight" REAL NOT NULL DEFAULT 0,
  "noveltyWeight" REAL NOT NULL DEFAULT 0,
  "emotionalResonanceWeight" REAL NOT NULL DEFAULT 0,
  "visualImageryWeight" REAL NOT NULL DEFAULT 0,
  "thematicFitWeight" REAL NOT NULL DEFAULT 0,
  "learningCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "PreferenceLearningEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "profileKey" TEXT NOT NULL,
  "generationRequestId" TEXT NOT NULL,
  "selectedCandidateId" TEXT NOT NULL,
  "deltaJson" TEXT NOT NULL,
  "comparisonJson" TEXT NOT NULL,
  "selectedEvaluationJson" TEXT,
  "explanation" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreferenceLearningEvent_profileKey_fkey"
    FOREIGN KEY ("profileKey") REFERENCES "PreferenceProfile" ("profileKey")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreferenceLearningEvent_generationRequestId_fkey"
    FOREIGN KEY ("generationRequestId") REFERENCES "GenerationRequest" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreferenceLearningEvent_selectedCandidateId_fkey"
    FOREIGN KEY ("selectedCandidateId") REFERENCES "OpeningCandidate" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PreferenceLearningEvent_profileKey_createdAt_idx"
  ON "PreferenceLearningEvent" ("profileKey", "createdAt");

CREATE INDEX IF NOT EXISTS "PreferenceLearningEvent_generationRequestId_createdAt_idx"
  ON "PreferenceLearningEvent" ("generationRequestId", "createdAt");

CREATE TABLE IF NOT EXISTS "FeedbackEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generationRequestId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "reasonTag" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackEvent_generationRequestId_fkey"
    FOREIGN KEY ("generationRequestId") REFERENCES "GenerationRequest" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeedbackEvent_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "OpeningCandidate" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FeedbackEvent_generationRequestId_createdAt_idx"
  ON "FeedbackEvent" ("generationRequestId", "createdAt");

CREATE INDEX IF NOT EXISTS "FeedbackEvent_candidateId_createdAt_idx"
  ON "FeedbackEvent" ("candidateId", "createdAt");

CREATE INDEX IF NOT EXISTS "FeedbackEvent_type_createdAt_idx"
  ON "FeedbackEvent" ("type", "createdAt");

CREATE TABLE IF NOT EXISTS "UsageRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestId" TEXT,
  "actionType" TEXT NOT NULL,
  "usageDate" TEXT NOT NULL,
  "creditsUsed" INTEGER NOT NULL DEFAULT 1,
  "generationRequestId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_generationRequestId_fkey"
    FOREIGN KEY ("generationRequestId") REFERENCES "GenerationRequest" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UsageRecord_guestId_usageDate_idx"
  ON "UsageRecord" ("guestId", "usageDate");

CREATE INDEX IF NOT EXISTS "UsageRecord_actionType_usageDate_idx"
  ON "UsageRecord" ("actionType", "usageDate");
`;

execFileSync("sqlite3", [sqlitePath], {
  input: schemaSql,
  stdio: ["pipe", "inherit", "inherit"]
});

ensureColumn("OpeningCandidate", "strategyType", '"strategyType" TEXT NOT NULL DEFAULT \'scene\'');
ensureColumn("OpeningCandidate", "evaluationTotalScore", '"evaluationTotalScore" INTEGER');
ensureColumn("OpeningCandidate", "evaluationJson", '"evaluationJson" TEXT');
ensureColumn("OpeningCandidate", "evaluationModelName", '"evaluationModelName" TEXT');
ensureColumn("OpeningCandidate", "evaluatedAt", '"evaluatedAt" DATETIME');
ensureColumn("CopyEvent", "generationRequestId", '"generationRequestId" TEXT');
ensureColumn("CopyEvent", "selectedCandidateId", '"selectedCandidateId" TEXT');
ensureColumn("PreferenceProfile", "hookStrengthWeight", '"hookStrengthWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "clarityWeight", '"clarityWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "noveltyWeight", '"noveltyWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "emotionalResonanceWeight", '"emotionalResonanceWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "visualImageryWeight", '"visualImageryWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "thematicFitWeight", '"thematicFitWeight" REAL NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "learningCount", '"learningCount" INTEGER NOT NULL DEFAULT 0');
ensureColumn("PreferenceProfile", "updatedAt", '"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
ensureColumn("PreferenceLearningEvent", "generationRequestId", '"generationRequestId" TEXT NOT NULL');
ensureColumn("PreferenceLearningEvent", "selectedCandidateId", '"selectedCandidateId" TEXT NOT NULL');
ensureColumn("PreferenceLearningEvent", "deltaJson", '"deltaJson" TEXT NOT NULL');
ensureColumn("PreferenceLearningEvent", "comparisonJson", '"comparisonJson" TEXT NOT NULL');
ensureColumn("PreferenceLearningEvent", "selectedEvaluationJson", '"selectedEvaluationJson" TEXT');
ensureColumn("PreferenceLearningEvent", "explanation", '"explanation" TEXT NOT NULL');

runSql(`
UPDATE "OpeningCandidate"
SET "strategyType" = CASE
  WHEN "openingStrategy" = '画面切入型' THEN 'scene'
  WHEN "openingStrategy" = '情绪切入型' THEN 'emotion'
  WHEN "openingStrategy" = '提问切入型' THEN 'question'
  WHEN "openingStrategy" = '观点切入型' THEN 'statement'
  WHEN "openingStrategy" = '反差切入型' THEN 'contrast'
  ELSE COALESCE(NULLIF("strategyType", ''), 'scene')
END
WHERE "strategyType" IS NULL OR "strategyType" = '';
`);

console.log(`SQLite schema initialized at ${sqlitePath}`);
