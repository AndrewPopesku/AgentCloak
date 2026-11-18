import { describe, expect, it } from "vitest";
import { FilterPipeline } from "../pipeline.js";
import type { EmailMessage } from "../../providers/types.js";

function email(subject: string): EmailMessage {
  return {
    id: "1", threadId: "1", subject,
    from: { name: "Support", email: "support@example.org" }, to: [], cc: [],
    date: "2026-11-18", body: "654321", snippet: "654321", labels: ["INBOX"],
    attachments: [], isUnread: false,
  };
}

describe("FilterPipeline", () => {
  it("normalizes hidden characters before matching sensitive subjects", () => {
    const pipeline = new FilterPipeline();
    expect(pipeline.process(email("Your verification code")).action).toBe("block");
    expect(pipeline.process(email("Your verifi\u200bcation code")).action).toBe("block");
  });
});
