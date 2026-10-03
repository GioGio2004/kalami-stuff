// @vitest-environment node
import { beforeAll, describe, expect, test, vi } from "vitest";

// The real MCP server, driven over HTTP-shaped requests without a network or a
// token: handleVerified serves a request for a caller Convex has already
// accepted. Calls that would reach Convex are not exercised here
// (convex/studio.test.ts covers those).

type Server = typeof import("./server");
let server: Server;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example-test-123.convex.cloud");
  server = await import("./server");
});

const authInfo = { token: "svc.test", clientId: "user_1", scopes: ["openid"], extra: { origin: "https://staff.test" } };

function rpc(id: number, method: string, params: Record<string, unknown> = {}): Request {
  return new Request("https://staff.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

/** Streamable HTTP may answer as JSON or as one SSE event; read either. */
async function body(response: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const raw = await response.text();
  const data = raw.trim().startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:"))?.slice(5);
  return JSON.parse(data ?? "{}");
}

describe("MCP server", () => {
  test("initialize announces Kalami with instructions about drafts", async () => {
    const response = await server.handleVerified(
      rpc(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
      authInfo,
    );
    expect(response.status).toBe(200);
    const { result } = await body(response);
    expect(result?.serverInfo).toMatchObject({ name: "kalami" });
    expect(String(result?.instructions)).toContain("only change DRAFT");
  });

  test("tools/list exposes the drafting tools and nothing that publishes", async () => {
    const response = await server.handleVerified(rpc(2, "tools/list"), authInfo);
    const { result } = await body(response);
    const names = (result?.tools as { name: string }[]).map((tool) => tool.name).sort();
    expect(names).toEqual([
      "add_questions",
      "check_code_task",
      "create_assessment",
      "create_course",
      "delete_question",
      "get_assessment",
      "get_course",
      "list_courses",
      "reorder_questions",
      "update_assessment",
      "update_question",
      "whoami",
    ]);
  });

  test("the header route refuses a request without a token", async () => {
    const response = await server.headerAuthHandler(rpc(3, "tools/list"));
    expect(response.status).toBe(401);
  });

  test("verifyToken ignores a missing token without calling Convex", async () => {
    expect(await server.verifyToken(rpc(4, "tools/list"), undefined)).toBeUndefined();
  });
});
