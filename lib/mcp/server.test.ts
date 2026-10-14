// @vitest-environment node
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
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
      "add_lesson_blocks",
      "add_questions",
      "add_week_links",
      "check_code_task",
      "check_kalami_file",
      "create_assessment",
      "create_course",
      "create_lesson",
      "create_presentation",
      "create_reading_document",
      "create_week",
      "delete_assessment",
      "delete_lesson",
      "delete_lesson_block",
      "delete_presentation",
      "delete_question",
      "delete_week",
      "export_course_file",
      "export_presentation_file",
      "get_assessment",
      "get_course",
      "get_course_outline",
      "get_kalami_format",
      "get_lesson",
      "get_presentation",
      "import_image",
      "import_kalami_file",
      "import_presentation_file",
      "list_courses",
      "list_reading_documents",
      "move_lesson",
      "move_presentation",
      "place_assessment",
      "prepare_week_drive",
      "remove_week_link",
      "reorder_lessons",
      "reorder_presentations",
      "reorder_questions",
      "reorder_week_links",
      "reorder_weeks",
      "replace_lesson_blocks",
      "update_assessment",
      "update_course",
      "update_lesson",
      "update_lesson_block",
      "update_presentation",
      "update_question",
      "update_week",
      "update_week_link",
      "whoami",
    ]);
    // Publishing stays a person's click in the dashboard.
    expect(names.some((name) => /publish/.test(name))).toBe(false);
    // Agents never delete whole courses.
    expect(names).not.toContain("delete_course");
  });

  test("create_presentation takes typed slides in a theme, documents them, and refuses a broken deck before Convex", async () => {
    const listed = await body(await server.handleVerified(rpc(5, "tools/list"), authInfo));
    const tool = (listed.result?.tools as { name: string; description: string; inputSchema: Record<string, unknown> }[]).find(
      (t) => t.name === "create_presentation",
    );
    expect(tool?.description).toContain("one idea per slide");
    const schema = JSON.stringify(tool?.inputSchema);
    for (const word of ["statement", "diagram", "compare", "closing", "aurora", "chalk", "build", "notes"]) expect(schema).toContain(word);

    // A hub needs at least three nodes: the deck rules stop it in the tool, before any Convex call.
    const response = await server.handleVerified(
      rpc(6, "tools/call", {
        name: "create_presentation",
        arguments: {
          requestId: "r1",
          weekId: "w1",
          title: "How the web works",
          theme: "aurora",
          slides: [
            { type: "title", title: "How the **web** works" },
            { type: "diagram", layout: "hub", nodes: [{ label: "Page" }, { label: "CSS" }] },
          ],
        },
      }),
      authInfo,
    );
    const { result } = await body(response);
    expect(result?.isError).toBe(true);
    const text = (result?.content as { text: string }[]).map((part) => part.text).join(" ");
    expect(text).toContain("slides[1].nodes: 3 to 8 nodes for a hub.");
  });

  test("create_presentation copies image slides' pictures into Kalami first, and saves nothing if one fails", async () => {
    const KALAMI = "https://ik.imagekit.io/kalami/dev/courses/c1/cat_1.webp";
    const imported: string[] = [];
    const saved: { slides?: { url?: string }[] }[] = [];
    const action = vi.spyOn(ConvexHttpClient.prototype, "action").mockImplementation((async (_ref: unknown, args: { url: string }) => {
      imported.push(args.url);
      if (args.url.includes("missing")) {
        throw new ConvexError({ code: "INVALID_INPUT", message: "example.org answered 404: the picture isn't there." });
      }
      return { url: KALAMI, width: 1600, height: 900, bytes: 150_000, originalBytes: 2_000_000, reused: false };
    }) as never);
    const mutation = vi.spyOn(ConvexHttpClient.prototype, "mutation").mockImplementation((async (_ref: unknown, args: (typeof saved)[number]) => {
      saved.push(args);
      return "p1";
    }) as never);
    const query = vi.spyOn(ConvexHttpClient.prototype, "query").mockResolvedValue({ courseId: "c1", slides: [{ id: "a" }, { id: "b" }] } as never);
    const call = (id: number, url: string) =>
      server
        .handleVerified(
          rpc(id, "tools/call", {
            name: "create_presentation",
            arguments: {
              weekId: "w1",
              title: "Cats",
              slides: [
                { type: "title", title: "Cats" },
                { type: "image", url, alt: "A cat", credit: "Photo: Jane Doe / Unsplash" },
              ],
            },
          }),
          authInfo,
        )
        .then(body);
    try {
      const ok = await call(7, "https://example.org/cat.jpg");
      expect(ok.result?.isError).toBeFalsy();
      expect(imported).toEqual(["https://example.org/cat.jpg"]);
      expect(saved[0].slides?.[1]).toMatchObject({ url: KALAMI, credit: "Photo: Jane Doe / Unsplash" });
      const text = (ok.result?.content as { text: string }[])[0].text;
      expect(JSON.parse(text)).toMatchObject({ presentationId: "p1", picturesCopiedIn: [{ slide: 1, sizeKB: 146, originalKB: 1953 }] });

      const failed = await call(8, "https://example.org/missing.jpg");
      expect(failed.result?.isError).toBe(true);
      expect((failed.result?.content as { text: string }[])[0].text).toContain(
        "Nothing was saved: these pictures couldn't be copied into Kalami. slides[1] (https://example.org/missing.jpg): example.org answered 404",
      );
      expect(saved).toHaveLength(1);
    } finally {
      action.mockRestore();
      mutation.mockRestore();
      query.mockRestore();
    }
  });

  test("the header route refuses a request without a token", async () => {
    const response = await server.headerAuthHandler(rpc(3, "tools/list"));
    expect(response.status).toBe(401);
  });

  test("verifyToken ignores a missing token without calling Convex", async () => {
    expect(await server.verifyToken(rpc(4, "tools/list"), undefined)).toBeUndefined();
  });
});
