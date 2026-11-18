import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import type { MessageTrace, FilterPipeline } from "../filters/pipeline.js";
import type { EmailProvider } from "../providers/types.js";
import type { Storage, StoredApiKey, StoredEmailConnection, ActivityEntry } from "../storage/types.js";

interface CallContext { traces: MessageTrace[]; providerCalls: number }
const calls = new AsyncLocalStorage<CallContext>();
const RESPONSE_LIMIT = 256 * 1024;

export function truncateResponse(value: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= RESPONSE_LIMIT) return { text: value, truncated: false };
  let bytes = 0;
  let text = "";
  const chars: string[] = [];
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > RESPONSE_LIMIT) break;
    chars.push(char);
    bytes += size;
  }
  text = chars.join("");
  return { text, truncated: true };
}

export function instrumentProvider(provider: EmailProvider): EmailProvider {
  const counter = provider as EmailProvider & { setRequestCounter?: (counter: () => void) => void };
  counter.setRequestCounter?.(() => { const context = calls.getStore(); if (context) context.providerCalls++; });
  return new Proxy(provider, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const context = calls.getStore();
        if (context && !counter.setRequestCounter && key !== "getProviderInfo") context.providerCalls++;
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function safeArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeArguments);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, /authorization|api.?key|(?<!page_)token|password|cookie|secret|session/i.test(key) ? "[REDACTED]" : safeArguments(item)]));
  }
  return value;
}

export function instrumentTools(
  server: McpServer, pipeline: FilterPipeline, storage: Storage,
  connection: StoredEmailConnection, key: StoredApiKey | undefined, config: Config,
): McpServer {
  pipeline.onTrace = (trace) => calls.getStore()?.traces.push(trace);
  if (!config.activityLogEnabled || !key) return server;
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "tool") return Reflect.get(target, property, receiver);
      return (...registration: unknown[]) => {
        const toolName = registration[0] as string;
        const callback = registration[registration.length - 1] as (...args: unknown[]) => Promise<unknown>;
        registration[registration.length - 1] = (...args: unknown[]) => calls.run({ traces: [], providerCalls: 0 }, async () => {
          const context = calls.getStore()!;
          const createdAt = Date.now();
          const started = performance.now();
          let result: unknown;
          let thrown: unknown;
          try { result = await callback(...args); } catch (error) { thrown = error; }
          const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content ?? [];
          const response = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
          const { text, truncated } = truncateResponse(response);
          const counts = { returned: 0, redacted: 0, blocked: 0 };
          for (const trace of context.traces) counts[trace.decision === "passed" ? "returned" : trace.decision]++;
          // Redacted messages are returned too.
          counts.returned += counts.redacted;
          const isError = (result as { isError?: boolean } | undefined)?.isError;
          const blocked = isError && (context.traces.some((trace) => trace.decision === "blocked") || response.includes('"error":"blocked"'));
          const entry: ActivityEntry = {
            id: randomUUID(), createdAt, accountId: connection.accountId, connectionId: connection.id,
            apiKeyId: key.id, apiKeyName: key.name, apiKeyPrefix: key.prefix, toolName,
            argumentsJson: JSON.stringify(safeArguments(args[0] ?? {})),
            status: blocked ? "blocked" : isError || thrown ? "error" : "ok",
            durationMs: Math.round(performance.now() - started), providerCalls: context.providerCalls,
            returnedCount: counts.returned, redactedCount: counts.redacted, blockedCount: counts.blocked,
            filterTraceJson: JSON.stringify(context.traces.map((trace) => trace.decision === "blocked"
              ? { messageId: trace.messageId, decision: trace.decision, sender: trace.sender, blockReason: trace.blockReason }
              : trace)), responseText: text,
            responseTruncated: truncated, errorMessage: thrown ? "Tool execution failed" : isError ? text : null,
          };
          try { await storage.createActivity(entry); } catch (error) { console.error("Activity logging failed:", error); }
          if (thrown) throw thrown;
          return result;
        });
        return Reflect.apply(target.tool, target, registration);
      };
    },
  });
}
