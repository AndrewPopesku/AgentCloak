import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";
import type { Storage } from "../../storage/types.js";
import { GmailProvider } from "./client.js";

const { createDraft } = vi.hoisted(() => ({ createDraft: vi.fn(async () => ({ data: { id: "draft", message: { id: "message" } } })) }));
vi.mock("googleapis", () => ({ google: { gmail: () => ({ users: { drafts: { create: createDraft } } }) } }));
vi.mock("./oauth.js", () => ({ createOAuth2Client: () => ({ setCredentials: vi.fn(), on: vi.fn() }) }));

describe("Gmail write permission", () => {
  function provider(allowDrafts: boolean) {
    return new GmailProvider({ gmailAllowDrafts: allowDrafts } as Config,
      { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: 1, scope: "gmail.compose" }, "connection", {} as Storage);
  }
  it("blocks draft creation by default even when an old token grants compose access", async () => {
    createDraft.mockClear();
    await expect(provider(false).createDraft({ to: ["recipient@example.net"], subject: "Synthetic", body: "Synthetic" })).rejects.toThrow(/read-only/);
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("preserves draft creation when the operator explicitly opts in", async () => {
    expect(await provider(true).createDraft({ to: ["recipient@example.net"], subject: "Synthetic", body: "Synthetic" })).toEqual({ draftId: "draft", messageId: "message" });
  });
});
