"use client";

import { useEffect } from "react";

/** Last stop when even the root layout fails to render. Plain HTML: nothing else is guaranteed to work. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafaf7", color: "#141414" }}>
        <main style={{ maxWidth: 520, margin: "80px auto", padding: "0 24px" }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em" }}>Kalami didn’t open</h1>
          <p style={{ color: "#64635e", lineHeight: 1.6 }}>
            Something broke before the page could load. Try again; if it keeps happening, tell your lecturer the
            time it happened{error.digest ? ` and this code: ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 16, padding: "12px 22px", borderRadius: 999, border: 0, background: "#141414", color: "#dcf35a", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
