import { beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../config.js";
import { SqliteStorage } from "../storage/sqlite.js";
import type { StoredAccount } from "../storage/types.js";
import { createAuthRoutes } from "./auth.js";

const config: Config = {
  host: "127.0.0.1",
  port: 3000,
  gmailAllowDrafts: false,
  databasePath: ":memory:",
  baseUrl: "http://localhost:3000",
  sessionSecret: "test-session-secret-at-least-32-characters",
  sessionMaxAge: 60_000,
};

describe("account registration", () => {
  let storage: SqliteStorage;
  let app: ReturnType<typeof createAuthRoutes>;

  beforeEach(async () => {
    storage = new SqliteStorage(":memory:");
    await storage.init();
    app = createAuthRoutes(storage, config);
  });

  function register(password = "safe-password", name = "New account") {
    return app.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password, name }),
    });
  }

  function login(password: string) {
    return app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password }),
    });
  }

  it("rejects registration for an OAuth-only account without granting a session or adding a password", async () => {
    const oauthAccount: StoredAccount = {
      id: "google-user",
      email: "person@example.com",
      name: "Google account",
      avatarUrl: null,
      passwordHash: null,
      createdAt: 1,
      updatedAt: 1,
    };
    await storage.upsertAccount(oauthAccount);

    const response = await register("attacker-password");

    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await storage.getAccount(oauthAccount.id)).toEqual(oauthAccount);
    expect((await login("attacker-password")).status).toBe(401);
  });

  it("creates a new account and session that can log in, while rejecting later duplicate registration", async () => {
    const response = await register();
    expect(response.status).toBe(201);
    const account = await response.json() as { id: string };
    const sid = response.headers.get("set-cookie")?.match(/^sid=([^;]+)/)?.[1];
    expect(sid).toBeTruthy();
    expect((await storage.getSession(sid!))?.accountId).toBe(account.id);
    expect((await login("safe-password")).status).toBe(200);

    const duplicate = await register("different-password");
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers.get("set-cookie")).toBeNull();
    expect((await login("different-password")).status).toBe(401);
    expect((await login("safe-password")).status).toBe(200);
  });

  it("allows only one concurrent registration and never logs the loser into the winner's account", async () => {
    const passwords = ["first-password", "second-password"];
    const responses = await Promise.all(passwords.map((password) => register(password, password)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const loserIndex = 1 - winnerIndex;
    expect(responses[loserIndex]!.headers.get("set-cookie")).toBeNull();
    expect((await storage.getAccountByEmail("person@example.com"))?.name).toBe(passwords[winnerIndex]);
    expect((await login(passwords[winnerIndex]!)).status).toBe(200);
    expect((await login(passwords[loserIndex]!)).status).toBe(401);
  });

  it("preserves a password during a profile-only account upsert", async () => {
    const response = await register();
    const { id } = await response.json() as { id: string };
    const account = (await storage.getAccount(id))!;
    await storage.upsertAccount({ ...account, name: "Updated Google name", passwordHash: null });

    expect((await storage.getAccount(account.id))?.name).toBe("Updated Google name");
    expect((await login("safe-password")).status).toBe(200);
  });
});
