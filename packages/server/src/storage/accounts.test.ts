import { describe, expect, it } from "vitest";
import { SqliteStorage } from "./sqlite.js";
import type { StoredAccount } from "./types.js";

describe("insert-only account creation", () => {
  it("leaves the existing account and password unchanged when an email already exists", async () => {
    const storage = new SqliteStorage(":memory:");
    await storage.init();
    const original: StoredAccount = {
      id: "original-account",
      email: "person@example.com",
      name: "Original name",
      avatarUrl: null,
      passwordHash: "original-password-hash",
      createdAt: 1,
      updatedAt: 1,
    };

    expect(await storage.createAccount(original)).toBe(true);
    expect(await storage.createAccount({
      ...original,
      id: "competing-account",
      name: "Attacker name",
      passwordHash: "attacker-password-hash",
    })).toBe(false);

    expect(await storage.getAccountByEmail(original.email)).toEqual(original);
    expect(await storage.getAccount("competing-account")).toBeNull();
  });
});
