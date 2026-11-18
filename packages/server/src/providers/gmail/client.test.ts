import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../config.js";
import type { Storage } from "../../storage/types.js";
import { GmailProvider } from "./client.js";

const { createDraft, modify } = vi.hoisted(() => ({ modify: vi.fn(async () => ({ data: {} })), createDraft: vi.fn(async () => ({ data: { id: "draft", message: { id: "message" } } })) }));
vi.mock("googleapis", () => ({ google: { gmail: () => ({ users: { messages: { modify }, drafts: { create: createDraft } } }) } }));
vi.mock("./oauth.js", () => ({ createOAuth2Client: () => ({ setCredentials: vi.fn(), on: vi.fn() }) }));

describe("Gmail write permission", () => {
  function provider(allowDrafts: boolean, allowMarkRead = false) {
    return new GmailProvider({ gmailAllowDrafts: allowDrafts, gmailAllowMarkRead: allowMarkRead } as Config,
      { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: 1, scope: "gmail.compose" }, "connection", {} as Storage);
  }
  it("blocks draft creation by default even when an old token grants compose access", async () => {
    createDraft.mockClear();
    await expect(provider(false).createDraft({ to: ["recipient@example.net"], subject: "Synthetic", body: "Synthetic" })).rejects.toThrow(/Draft creation is disabled/);
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("preserves draft creation when the operator explicitly opts in", async () => {
    expect(await provider(true).createDraft({ to: ["recipient@example.net"], subject: "Synthetic", body: "Synthetic" })).toEqual({ draftId: "draft", messageId: "message" });
  });
  it("blocks marking read by default even if credentials have broader permissions", async () => {
    modify.mockClear();
    await expect(provider(false).markRead("message")).rejects.toThrow(/GMAIL_ALLOW_MARK_READ/);
    expect(modify).not.toHaveBeenCalled();
  });
  it("removes only UNREAD from one message and leaves drafts disabled", async () => {
    modify.mockClear();
    const gmail = provider(false, true);
    await gmail.markRead("message");
    await gmail.markRead("message");
    expect(modify.mock.calls).toEqual(Array(2).fill([{ userId: "me", id: "message", requestBody: { removeLabelIds: ["UNREAD"] } }]));
    await expect(gmail.createDraft({ to: ["recipient@example.net"], subject: "Synthetic", body: "Synthetic" })).rejects.toThrow(/disabled/);
  });
  it("reports provider failures instead of claiming a message is read", async () => {
    modify.mockRejectedValueOnce(new Error("Insufficient permission"));
    await expect(provider(false, true).markRead("message")).rejects.toThrow(/Insufficient permission/);
  });
});
