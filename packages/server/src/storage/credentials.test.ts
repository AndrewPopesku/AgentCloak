import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "./sqlite.js";
import type { OAuthTokens, StoredEmailConnection } from "./types.js";

const secret = "credential-test-secret-at-least-32-characters";
const tokens: OAuthTokens = { accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token", expiresAt: 123, scope: "gmail.readonly" };
const connection: StoredEmailConnection = { id: "mailbox", accountId: "owner", email: "owner@example.net", provider: "gmail", displayName: null, tokens, status: "active", createdAt: 1, updatedAt: 1 };

describe("OAuth credential encryption at rest", () => {
  let directory: string;
  let path: string;
  let storage: SqliteStorage;
  let db: Database.Database;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "agentcloak-credentials-"));
    path = join(directory, "test.db");
    storage = new SqliteStorage(path, undefined, secret);
    await storage.init();
    await storage.createAccount({ id: "owner", email: "owner@example.net", name: null, avatarUrl: null, passwordHash: null, createdAt: 1, updatedAt: 1 });
    db = new Database(path);
  });
  afterEach(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
  function stored(): string { return (db.prepare("SELECT tokens_json FROM email_connections WHERE id = ?").get("mailbox") as { tokens_json: string }).tokens_json; }

  it("stores encrypted credentials, survives reopen, and encrypts refreshed tokens", async () => {
    await storage.createConnection(connection);
    expect(stored()).not.toContain(tokens.accessToken);
    expect(stored()).not.toContain(tokens.refreshToken);
    expect((await storage.getConnection("mailbox"))?.tokens).toEqual(tokens);
    const reopened = new SqliteStorage(path, undefined, secret);
    await reopened.init();
    expect((await reopened.listConnections("owner"))[0]?.tokens).toEqual(tokens);
    const refreshed = { ...tokens, accessToken: "synthetic-refreshed-access" };
    await reopened.updateConnectionTokens("mailbox", refreshed);
    expect(stored()).not.toContain(refreshed.accessToken);
    expect((await reopened.getConnection("mailbox"))?.tokens).toEqual(refreshed);
  });

  it("fails closed when encrypted credentials are tampered with or the secret is wrong", async () => {
    await storage.createConnection(connection);
    const wrongSecret = new SqliteStorage(path, undefined, "different-secret-at-least-32-characters");
    await wrongSecret.init();
    await expect(wrongSecret.getConnection("mailbox")).rejects.toThrow();
    const envelope = JSON.parse(stored());
    envelope.authTag = "00".repeat(16);
    db.prepare("UPDATE email_connections SET tokens_json = ? WHERE id = ?").run(JSON.stringify(envelope), "mailbox");
    await expect(storage.getConnection("mailbox")).rejects.toThrow();
  });

  it("migrates legacy plaintext Gmail records on startup", async () => {
    db.prepare("INSERT INTO email_connections (id, account_id, email, provider, tokens_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("mailbox", "owner", connection.email, "gmail", JSON.stringify(tokens), "active", 1, 1);
    const reopened = new SqliteStorage(path, undefined, secret);
    await reopened.init();
    expect(stored()).not.toContain(tokens.refreshToken);
    expect((await reopened.getConnection("mailbox"))?.tokens).toEqual(tokens);
  });

  it("never writes OAuth secrets without an encryption secret", async () => {
    const unconfigured = new SqliteStorage(path);
    await unconfigured.init();
    await expect(unconfigured.createConnection(connection)).rejects.toThrow(/SESSION_SECRET/);
    expect(await unconfigured.getConnection("mailbox")).toBeNull();
  });

  it("rejects a database encryption option unsupported by the SQLite driver", () => {
    expect(() => new SqliteStorage(":memory:", "unsupported-sqlcipher-key", secret)).toThrow(/DATABASE_ENCRYPTION_KEY/);
  });
});
