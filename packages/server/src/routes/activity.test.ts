import { describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { SqliteStorage } from "../storage/sqlite.js";
import type { ActivityEntry } from "../storage/types.js";
import { createApiRoutes } from "./api.js";

const config = { baseUrl: "http://localhost:3000", sessionSecret: "test-session-secret-at-least-32-characters" } as Config;

describe("activity API ownership", () => {
  it("returns 404 for another account's activity and excludes it from the list", async () => {
    const storage = new SqliteStorage(":memory:", undefined, "test-session-secret-at-least-32-characters");
    await storage.init();
    for (const id of ["owner", "other"]) {
      await storage.createAccount({ id, email: `${id}@example.com`, name: null, avatarUrl: null, passwordHash: null, createdAt: 1, updatedAt: 1 });
      await storage.createConnection({ id, accountId: id, email: `${id}@example.com`, provider: "gmail", displayName: null, tokens: { accessToken: "a", refreshToken: "b", expiresAt: 0, scope: "" }, status: "active", createdAt: 1, updatedAt: 1 });
    }
    await storage.createSession({ id: "owner-session", accountId: "owner", createdAt: 1, expiresAt: Date.now() + 10000 });
    const entry: ActivityEntry = { id: "other-entry", createdAt: Date.now(), accountId: "other", connectionId: "other", apiKeyId: null, apiKeyName: null, apiKeyPrefix: null, toolName: "read_email", argumentsJson: "{}", status: "ok", durationMs: 1, providerCalls: 1, returnedCount: 1, redactedCount: 0, blockedCount: 0, filterTraceJson: "[]", responseText: "private", responseTruncated: false, errorMessage: null };
    await storage.createActivity(entry);
    const api = createApiRoutes(storage, config);
    const headers = { Cookie: "sid=owner-session" };
    expect((await api.request("/activity/other-entry", { headers })).status).toBe(404);
    expect(await (await api.request("/activity", { headers })).json()).toMatchObject({ total: 0, entries: [] });
  });
});
