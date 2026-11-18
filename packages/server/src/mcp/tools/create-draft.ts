import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FilterPipeline } from "../../filters/pipeline.js";
import type { EmailProvider } from "../../providers/types.js";
import { threadParticipants } from "./format.js";

export function registerCreateDraft(
  server: McpServer,
  provider: EmailProvider,
  pipeline: FilterPipeline,
) {
  server.tool(
    "create_draft",
    "Create an email draft. The draft is saved but NOT sent. The user must manually review and send it. When replying to a thread (in_reply_to_thread_id), recipients are auto-populated from the thread participants — the 'to' field is not needed.",
    {
      to: z.array(z.string().email()).optional().describe("List of recipient email addresses. Optional when in_reply_to_thread_id is provided (recipients auto-populated from thread)."),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text (plain text)"),
      in_reply_to_thread_id: z.string().optional().describe("Thread ID if this is a reply to an existing thread. When provided, recipients are auto-populated from the thread."),
    },
    async ({ to, subject, body, in_reply_to_thread_id }) => {
      let recipients = to ?? [];

      if (in_reply_to_thread_id) {
        const { messages } = await provider.getThread(in_reply_to_thread_id);
        const { passed } = pipeline.processBatch(messages);
        if (passed.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "blocked", thread_id: in_reply_to_thread_id }) }],
            isError: true,
          };
        }
        if (recipients.length === 0) {
          recipients = threadParticipants(passed).map((p) => p.email);
        }
      }

      if (recipients.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No recipients specified. Provide 'to' addresses or 'in_reply_to_thread_id' to auto-populate recipients.",
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await provider.createDraft({
        to: recipients,
        subject,
        body,
        inReplyToThreadId: in_reply_to_thread_id,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                draftId: result.draftId,
                messageId: result.messageId,
                status: "Draft created successfully. The user must review and send it manually.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
