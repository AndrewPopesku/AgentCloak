import { describe, expect, it } from "vitest";
import { SqliteStorage } from "./sqlite.js";
import type { ActivityEntry, StoredAccount, StoredEmailConnection } from "./types.js";

const account = (id: string): StoredAccount => ({ id, email: `${id}@example.com`, name: null, avatarUrl: null, passwordHash: null, createdAt: 1, updatedAt: 1 });
const connection = (id: string, accountId: string): StoredEmailConnection => ({ id, accountId, email: `${id}@example.com`, provider: "gmail", displayName: null, tokens: { accessToken: "a", refreshToken: "b", expiresAt: 0, scope: "" }, status: "active", createdAt: 1, updatedAt: 1 });
export const entry = (id: string, accountId: string, connectionId: string, createdAt: number): ActivityEntry => ({
  id, accountId, connectionId, createdAt, apiKeyId: null, apiKeyName: null, apiKeyPrefix: null,
  toolName: "read_email", argumentsJson: "{}", status: "ok", durationMs: 1, providerCalls: 1,
  returnedCount: 1, redactedCount: 0, blockedCount: 0, filterTraceJson: "[]", responseText: "hello",
  responseTruncated: false, errorMessage: null,
});

describe("activity storage", () => {
  it("prunes expired rows and scopes reads to the account", async () => {
    const storage = new SqliteStorage(":memory:", undefined, "test-session-secret-at-least-32-characters");
    await storage.init();
    for (const id of ["a", "b"]) { await storage.createAccount(account(id)); await storage.createConnection(connection(id, id)); }
    await storage.createActivity(entry("old", "a", "a", 1));
    await storage.createActivity(entry("new", "b", "b", 100));
    expect(await storage.pruneActivity(50)).toBe(1);
    expect(await storage.getActivity("old", "a")).toBeNull();
    expect(await storage.getActivity("new", "a")).toBeNull();
    expect((await storage.listActivity("a", { limit: 50, offset: 0 })).total).toBe(0);
    expect(await storage.getActivity("new", "b")).toMatchObject({ id: "new" });
  });
});

describe("schema v6 migration", () => {
  it("adds the activity table to an existing v5 database", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "agentcloak-activity-"));
    try {
      const path = join(dir, "test.db");
      const initial = new SqliteStorage(path);
      await initial.init();
      const db = new Database(path);
      db.exec("DROP TABLE activity_log; DELETE FROM schema_version WHERE version = 6");
      db.close();
      const upgraded = new SqliteStorage(path);
      await upgraded.init();
      expect(await upgraded.pruneActivity(Date.now())).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
