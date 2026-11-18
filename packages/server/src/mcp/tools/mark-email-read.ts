import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FilterPipeline } from "../../filters/pipeline.js";
import type { EmailProvider } from "../../providers/types.js";

export function registerMarkEmailRead(
  server: McpServer,
  provider: EmailProvider,
  pipeline: FilterPipeline,
) {
  if (!provider.markRead) return;

  server.tool(
    "mark_email_read",
    "Mark one permitted email as read by removing its UNREAD flag. Existing content and folder filters apply. Does not mark a whole thread read.",
    { message_id: z.string().min(1).describe("The message ID to mark read") },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ message_id }) => {
      const message = await provider.getMessage(message_id);
      const result = pipeline.process(message);
      if (result.action === "block") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "blocked", reason: result.reason, message_id }) }],
          isError: true,
        };
      }
      await provider.markRead!(message.id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ message_id: message.id, isUnread: false }) }],
      };
    },
  );
}
