import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FilterPipeline } from "../../filters/pipeline.js";
import type { EmailProvider } from "../../providers/types.js";
import { formatAddresses } from "./format.js";

export function registerListDrafts(
  server: McpServer,
  provider: EmailProvider,
  pipeline: FilterPipeline,
) {
  server.tool(
    "list_drafts",
    "List email drafts. Returns draft metadata including recipients and subjects.",
    {
      max_results: z.number().min(1).max(200).default(20).describe("Maximum number of drafts to return."),
    },
    async ({ max_results }) => {
      const result = await provider.listDrafts(max_results);

      const drafts = [];
      for (const draft of result.drafts) {
        const message = await provider.getMessage(draft.messageId);
        const filtered = pipeline.process(message);
        if (filtered.action === "block") continue;
        const sanitized = filtered.message;
        drafts.push({
          id: draft.id,
          messageId: sanitized.id,
          to: formatAddresses(sanitized.to, pipeline),
          subject: sanitized.subject,
          snippet: sanitized.snippet,
          updatedAt: sanitized.date,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ drafts }, null, 2),
          },
        ],
      };
    },
  );
}
