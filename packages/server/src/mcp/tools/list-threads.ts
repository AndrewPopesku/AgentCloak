import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FilterPipeline } from "../../filters/pipeline.js";
import type { EmailProvider } from "../../providers/types.js";
import { formatThread } from "./format.js";

export function registerListThreads(
  server: McpServer,
  provider: EmailProvider,
  pipeline: FilterPipeline,
) {
  server.tool(
    "list_threads",
    "List email threads matching a query. Returns thread summaries with participant lists. For broad queries, use a high max_results (100-200) and paginate with nextPageToken for complete results.",
    {
      query: z.string().default("").describe("Gmail search query to filter threads"),
      max_results: z.number().min(1).max(200).default(20).describe("Maximum number of threads to return. Use higher values (100-200) for broad searches."),
      page_token: z.string().optional().describe("Pagination token from previous request. Use this to retrieve additional pages of results."),
    },
    async ({ query, max_results, page_token }) => {
      const result = await provider.listThreads({
        query,
        maxResults: max_results,
        pageToken: page_token,
      });

      let blockedCount = 0;
      const summaries = [];
      for (const thread of result.threads) {
        const messages = thread.messages ?? (await provider.getThread(thread.id)).messages;
        const { passed } = pipeline.processBatch(messages);
        if (passed.length === 0) {
          blockedCount++;
          continue;
        }
        summaries.push(formatThread(thread.id, passed, pipeline));
      }

      const response: Record<string, unknown> = {
        threads: summaries,
        totalResults: result.resultSizeEstimate,
        nextPageToken: result.nextPageToken,
      };
      if (pipeline.showFilteredCount && blockedCount > 0) {
        response.filteredCount = blockedCount;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );
}
