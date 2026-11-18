import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("server configuration", () => {
  beforeEach(() => {
    vi.stubEnv("BASE_URL", "http://localhost:3000");
    vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters");
    vi.stubEnv("HOST", undefined);
    vi.stubEnv("GMAIL_ALLOW_DRAFTS", undefined);
    vi.stubEnv("GMAIL_ALLOW_MARK_READ", undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("binds only to loopback and keeps Gmail read-only by default", () => {
    expect(loadConfig()).toMatchObject({ host: "127.0.0.1", gmailAllowDrafts: false, gmailAllowMarkRead: false });
  });

  it("allows an explicit container bind and Gmail draft opt-in", () => {
    vi.stubEnv("HOST", "0.0.0.0");
    vi.stubEnv("GMAIL_ALLOW_DRAFTS", "true");
    expect(loadConfig()).toMatchObject({ host: "0.0.0.0", gmailAllowDrafts: true });
  });

  it("treats false as false and rejects invalid draft opt-ins", () => {
    vi.stubEnv("GMAIL_ALLOW_DRAFTS", "false");
    expect(loadConfig()).toMatchObject({ gmailAllowDrafts: false });
    vi.stubEnv("GMAIL_ALLOW_DRAFTS", "yes");
    expect(() => loadConfig()).toThrow();
  });

  it("requires a strict explicit mark-read opt-in", () => {
    vi.stubEnv("GMAIL_ALLOW_MARK_READ", "true");
    expect(loadConfig().gmailAllowMarkRead).toBe(true);
    vi.stubEnv("GMAIL_ALLOW_MARK_READ", "false");
    expect(loadConfig().gmailAllowMarkRead).toBe(false);
    vi.stubEnv("GMAIL_ALLOW_MARK_READ", "yes");
    expect(() => loadConfig()).toThrow();
  });

  it("rejects the public example secret", () => {
    vi.stubEnv("SESSION_SECRET", "change-me-to-a-random-string-at-least-32-chars");
    expect(() => loadConfig()).toThrow(/unique SESSION_SECRET/);
  });
});
