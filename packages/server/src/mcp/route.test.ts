import { request, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import type { Storage } from "../storage/types.js";
import { handleMcpRequest } from "./route.js";

const BODY_LIMIT = 4 * 1024 * 1024;
const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  gmailAllowDrafts: false, gmailAllowMarkRead: false,
  googleClientId: "test-client-id",
  googleClientSecret: "test-client-secret",
  googleRedirectUri: "http://localhost:3000/auth/callback",
  databasePath: ":memory:",
  baseUrl: "http://localhost:3000",
  sessionSecret: "test-session-secret-at-least-32-characters",
  sessionMaxAge: 60_000,
};

describe("MCP HTTP request body limits", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    const storage = {
      getConnection: vi.fn().mockResolvedValue({
        id: "connection",
        provider: "gmail",
        status: "active",
        tokens: { accessToken: "unused", refreshToken: "unused", expiresAt: 0, scope: "" },
      }),
      getFilterConfig: vi.fn().mockResolvedValue(null),
    } as unknown as Storage;
    server = createServer((req, res) => {
      void handleMcpRequest(req, res, "connection", storage, config).catch(() => {
        if (!res.headersSent) res.writeHead(400).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  function post(chunks: string[], contentLength?: number): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port, path: "/mcp", method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(contentLength === undefined ? {} : { "Content-Length": contentLength }),
        },
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => body += chunk);
        res.on("end", () => resolve({ status: res.statusCode!, body }));
        res.on("error", reject);
      });
      req.on("error", reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }

  it("rejects an oversized Content-Length before reading the body", async () => {
    expect((await post([], BODY_LIMIT + 1)).status).toBe(413);
  });

  it("rejects an oversized chunked body", async () => {
    const result = await post([" ".repeat(BODY_LIMIT), " "]);
    expect(result.status).toBe(413);
  });

  it("accepts an ordinary MCP request", async () => {
    const result = await post([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })]);
    expect(result.status).toBe(200);
    expect(result.body).toContain("search_emails");
  });

  it("accepts a valid body exactly at the size limit", async () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const result = await post([message.padEnd(BODY_LIMIT, " ")]);
    expect(result.status).toBe(200);
  });

  it("keeps malformed JSON rejected", async () => {
    expect((await post(["{"])).status).toBe(400);
  });
});
