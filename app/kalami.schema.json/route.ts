import { z } from "zod";
import { anyKalamiFileSchema, KALAMI_SCHEMA_URL } from "@/convex/lib/kalami";

// The .kalami format as JSON Schema, for editors ("$schema" in a file gives
// autocomplete and red squiggles) and for AI assistants writing files. Built
// from the same zod schema Kalami checks imports with, so they can't disagree.
// Public: a file's "$schema" points here.

const schema = {
  ...z.toJSONSchema(anyKalamiFileSchema, { io: "input", unrepresentable: "any" }),
  $id: KALAMI_SCHEMA_URL,
  title: "Kalami file (.kalami), version 1: a course, or one presentation",
};

export function GET() {
  return Response.json(schema, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
