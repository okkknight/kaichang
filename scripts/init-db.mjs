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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "OpeningCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generationRequestId" TEXT NOT NULL,
  "rankOrder" INTEGER NOT NULL,
  "openingStrategy" TEXT NOT NULL,
  "styleLabel" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "qualityScore" INTEGER NOT NULL,
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
  "guestId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopyEvent_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "OpeningCandidate" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

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

console.log(`SQLite schema initialized at ${sqlitePath}`);
