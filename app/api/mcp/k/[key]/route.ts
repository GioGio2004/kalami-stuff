/**
 * The old secret-link connector (/api/mcp/k/klm_…). Retired: a link with the
 * token in it could be shared or leaked, and anyone holding it acted as the
 * lecturer. claude.ai and ChatGPT now use "Sign in with Kalami" on /api/mcp,
 * where each person signs in with their own account.
 */

export const dynamic = "force-dynamic";

function gone(): Response {
  return Response.json(
    {
      error:
        "Kalami links were replaced by “Sign in with Kalami”. Add https://staff.kalami.space/api/mcp as the connector URL and choose Sign in now.",
    },
    { status: 410 },
  );
}

export { gone as GET, gone as POST, gone as DELETE };
