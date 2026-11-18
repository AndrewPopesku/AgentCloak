import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Storage } from "../storage/types.js";
import { createApiRoutes } from "./api.js";
import { createOAuthRoutes } from "./oauth.js";
import { exchangeCode, generateConnectAuthUrl } from "../providers/gmail/oauth.js";

vi.mock("../providers/gmail/oauth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/gmail/oauth.js")>()),
  exchangeCode: vi.fn(),
}));

const config: Config = {
  host: "127.0.0.1", port: 3000, databasePath: ":memory:",
  baseUrl: "https://agentcloak.example", sessionSecret: "test-secret-that-is-at-least-32-characters",
  sessionMaxAge: 600_000, googleClientId: "test-client", googleClientSecret: "test-secret",
  googleRedirectUri: "https://agentcloak.example/auth/callback", gmailAllowDrafts: false,
};

describe("OAuth browser and account binding", () => {
  let app: Hono;
  let storage: Storage;
  beforeEach(() => {
    vi.clearAllMocks();
    storage = {
      getSession: vi.fn(async (id: string) => id === "owner-session" ? { id, accountId: "owner" } : null),
      getAccount: vi.fn(async () => ({ id: "owner" })),
      getAccountByEmail: vi.fn(async () => ({ id: "owner", createdAt: 1 })),
      getConnection: vi.fn(async () => ({ id: "connection", accountId: "owner", provider: "gmail", email: "owner@example.net" })),
      upsertAccount: vi.fn(), createAccount: vi.fn(async () => true), createSession: vi.fn(), createConnection: vi.fn(),
      upsertFilterConfig: vi.fn(), updateConnectionTokens: vi.fn(), updateConnectionStatus: vi.fn(),
    } as unknown as Storage;
    vi.mocked(exchangeCode).mockResolvedValue({
      email: "owner@example.net", name: null, avatarUrl: null,
      tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: 1, scope: "readonly" },
    });
    app = new Hono().route("/auth", createOAuthRoutes(storage, config)).route("/api", createApiRoutes(storage, config));
  });

  async function start(path = "/auth/login") {
    const response = await app.request(path, { headers: { Cookie: "sid=owner-session" } });
    const state = new URL(response.headers.get("Location")!).searchParams.get("state")!;
    const stateCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("oauth_state="));
    return { response, state, cookie: stateCookie?.split(";")[0] ?? "" };
  }

  it("rejects callbacks that did not originate in this browser before exchanging tokens", async () => {
    const { state } = await start();
    const response = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`);
    expect(response.headers.get("Location")).toContain("invalid_state");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a different browser's state cookie", async () => {
    const first = await start();
    const second = await start();
    await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(first.state)}`, { headers: { Cookie: second.cookie } });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("sets a private, short-lived state cookie and clears it without losing the login cookie", async () => {
    const { response, state, cookie } = await start();
    expect(response.headers.get("Set-Cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("Set-Cookie")).toMatch(/Secure/i);
    expect(response.headers.get("Set-Cookie")).toMatch(/SameSite=Lax/i);
    const result = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(result.headers.get("Location")).toBe("/dashboard");
    expect(result.headers.getSetCookie().some((value) => value.startsWith("sid="))).toBe(true);
    expect(result.headers.getSetCookie().some((value) => value.startsWith("oauth_state=") && value.includes("Max-Age=0"))).toBe(true);
  });

  it.each(["/api/connections/gmail/connect", "/api/connections/connection/reauthorize"])("requires the initiating account's live session for %s", async (path) => {
    const { state, cookie } = await start(path);
    await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(storage.createConnection).not.toHaveBeenCalled();
    expect(storage.updateConnectionTokens).not.toHaveBeenCalled();
  });

  it("connects with the matching browser and account", async () => {
    const { state, cookie } = await start("/api/connections/gmail/connect");
    const response = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: `${cookie}; sid=owner-session` } });
    expect(response.headers.get("Location")).toMatch(/^\/connections\//);
    expect(storage.createConnection).toHaveBeenCalledWith(expect.objectContaining({ accountId: "owner", email: "owner@example.net" }));
  });

  it("does not replace a connection with tokens for a different mailbox", async () => {
    const { state, cookie } = await start("/api/connections/connection/reauthorize");
    vi.mocked(exchangeCode).mockResolvedValueOnce({ email: "other@example.net", name: null, avatarUrl: null, tokens: { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: 1, scope: "readonly" } });
    const response = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: `${cookie}; sid=owner-session` } });
    expect(response.headers.get("Location")).toContain("email_mismatch");
    expect(storage.updateConnectionTokens).not.toHaveBeenCalled();
  });

  it("requests read-only Gmail access unless drafts are explicitly enabled", () => {
    const readonly = new URL(generateConnectAuthUrl(config, "owner")).searchParams.get("scope")!;
    expect(readonly).toContain("gmail.readonly");
    expect(readonly).not.toContain("gmail.compose");
    const drafts = new URL(generateConnectAuthUrl({ ...config, gmailAllowDrafts: true }, "owner")).searchParams.get("scope")!;
    expect(drafts).toContain("gmail.compose");
  });

  it("does not auto-link Google login to an unverified password registration", async () => {
    vi.mocked(storage.getAccountByEmail).mockResolvedValue({ id: "attacker-account", passwordHash: "attacker-password-hash" } as never);
    const { state, cookie } = await start();
    const response = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(response.headers.get("Location")).toContain("use_password_to_sign_in");
    expect(storage.upsertAccount).not.toHaveBeenCalled();
    expect(storage.createSession).not.toHaveBeenCalled();
  });

  it("never logs into a concurrently created Google-login account by email", async () => {
    vi.mocked(storage.getAccountByEmail).mockResolvedValue(null);
    vi.mocked(storage.createAccount).mockResolvedValue(false);
    const { state, cookie } = await start();
    const response = await app.request(`/auth/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } });
    expect(response.headers.get("Location")).toContain("account_already_exists");
    expect(storage.createSession).not.toHaveBeenCalled();
    expect(storage.upsertAccount).not.toHaveBeenCalled();
  });
});
