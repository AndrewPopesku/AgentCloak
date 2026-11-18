import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FilterPipeline } from "../filters/pipeline.js";
import type { Config } from "../config.js";
import type { Storage, StoredApiKey, StoredEmailConnection } from "../storage/types.js";
import { instrumentProvider, instrumentTools, truncateResponse } from "./activity.js";
import type { EmailProvider } from "../providers/types.js";

const key = { id: "key", name: "Hermes", prefix: "ac_123" } as StoredApiKey;
const connection = { id: "connection", accountId: "owner" } as StoredEmailConnection;
const config = { activityLogEnabled: true } as Config;

function setup(logger = vi.fn()) {
  let callback: (args: unknown) => Promise<unknown>;
  const server = { tool: (_name: string, _description: string, _schema: unknown, fn: typeof callback) => { callback = fn; } } as unknown as McpServer;
  const storage = { createActivity: logger } as unknown as Storage;
  const pipeline = new FilterPipeline();
  const wrapped = instrumentTools(server, pipeline, storage, connection, key, config);
  return { register: (fn: (args: unknown) => Promise<unknown>) => { wrapped.tool("read_email", "test", {}, fn as never); }, call: (args: unknown) => callback(args), logger };
}

describe("activity recording", () => {
  it("records success, blocked, and thrown errors", async () => {
    const harness = setup();
    harness.register(async () => ({ content: [{ type: "text", text: "hello" }] }));
    expect(await harness.call({ message_id: "1" })).toEqual({ content: [{ type: "text", text: "hello" }] });
    expect(harness.logger.mock.calls[0][0]).toMatchObject({ status: "ok", responseText: "hello", apiKeyName: "Hermes" });
    harness.register(async () => ({ isError: true, content: [{ type: "text", text: '{"error":"blocked"}' }] }));
    await harness.call({ message_id: "1" });
    expect(harness.logger.mock.calls[1][0].status).toBe("blocked");
    harness.register(async () => { throw new Error("secret credential"); });
    await expect(harness.call({})).rejects.toThrow("secret credential");
    expect(harness.logger.mock.calls[2][0]).toMatchObject({ status: "error", errorMessage: "Tool execution failed" });
  });

  it("does not change a tool result when logging throws", async () => {
    const harness = setup(vi.fn().mockRejectedValue(new Error("db failed")));
    harness.register(async () => ({ content: [{ type: "text", text: "unchanged" }] }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await harness.call({})).toEqual({ content: [{ type: "text", text: "unchanged" }] });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("truncates response text on a UTF-8 boundary", () => {
    const result = truncateResponse("é".repeat(200000));
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text)).toBe(256 * 1024);
  });

  it("counts provider operations and keeps page tokens while removing secret fields", async () => {
    const harness = setup();
    const provider = instrumentProvider({ search: async () => ({ messages: [], resultSizeEstimate: 0 }) } as unknown as EmailProvider);
    harness.register(async () => { await provider.search({ query: "hello" }); return { content: [{ type: "text", text: "ok" }] }; });
    await harness.call({ page_token: "next-page", password: "private" });
    const recorded = harness.logger.mock.calls[0][0];
    expect(recorded.providerCalls).toBe(1);
    expect(JSON.parse(recorded.argumentsJson)).toEqual({ page_token: "next-page", password: "[REDACTED]" });
  });
});
