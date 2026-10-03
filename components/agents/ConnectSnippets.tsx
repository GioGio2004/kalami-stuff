"use client";

import { useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Segmented } from "@/components/ui/form";
import { Lock } from "@/components/ui/icons";

type Client = "claude" | "chatgpt" | "claude-code" | "cursor" | "vscode" | "gemini" | "codex" | "other";

const CLIENTS: { value: Client; label: string }[] = [
  { value: "claude", label: "Claude app" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "vscode", label: "VS Code" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "codex", label: "Codex" },
  { value: "other", label: "Other" },
];

const SIGN_IN = "sign in with your Kalami staff account and press Allow";

type Snippet = {
  /** Numbered steps, in the words the client's own UI uses. */
  steps: string[];
  code: string;
  note?: string;
};

/**
 * What to do where, per MCP client. Every client signs in with Kalami (OAuth
 * through Clerk), so the snippets hold only the public address: nothing in
 * them is secret.
 */
export function snippetFor(client: Client, origin: string): Snippet {
  const endpoint = `${origin}/api/mcp`;
  switch (client) {
    case "claude":
      return {
        steps: [
          "Open claude.ai (or the Claude desktop app) → Settings → Connectors → Add custom connector.",
          "Name it Kalami, paste the address below and click Continue.",
          "Authentication: Sign in now. OAuth client: Use Claude’s published identity. Click Add.",
          `Click Connect, ${SIGN_IN}. In a chat, switch Kalami on in the tools menu.`,
        ],
        code: endpoint,
        note: "Added once, it works on claude.ai, Claude Desktop and the Claude phone apps.",
      };
    case "chatgpt":
      return {
        steps: [
          "Settings → Apps & Connectors → Advanced settings: turn on Developer mode.",
          "Back in Apps & Connectors, click Create. Name: Kalami. MCP server URL: the address below. Authentication: OAuth.",
          `Create it, ${SIGN_IN}. In a new chat, add Kalami from the + menu.`,
        ],
        code: endpoint,
        note: "Developer mode is only on some ChatGPT plans. If you don't see it, use another agent.",
      };
    case "claude-code":
      return {
        steps: [
          "Run this once in your terminal.",
          `Start claude, type /mcp, pick kalami and choose Authenticate. In the browser that opens, ${SIGN_IN}.`,
        ],
        code: `claude mcp add --transport http kalami ${endpoint}`,
      };
    case "cursor":
      return {
        steps: [
          "Paste into .cursor/mcp.json (or Cursor Settings → MCP → Add new MCP server).",
          `Cursor Settings → MCP shows kalami as needing a login: click it, then ${SIGN_IN}.`,
        ],
        code: JSON.stringify({ mcpServers: { kalami: { url: endpoint } } }, null, 2),
      };
    case "vscode":
      return {
        steps: [
          "Paste into .vscode/mcp.json and click Start above the kalami entry.",
          `When VS Code asks to let kalami sign in, allow it, then ${SIGN_IN}. Use Copilot Chat in Agent mode.`,
        ],
        code: JSON.stringify({ servers: { kalami: { type: "http", url: endpoint } } }, null, 2),
      };
    case "gemini":
      return {
        steps: [
          "Add to ~/.gemini/settings.json, then restart gemini.",
          `Run /mcp auth kalami and ${SIGN_IN}. /mcp lists Kalami's tools.`,
        ],
        code: JSON.stringify({ mcpServers: { kalami: { httpUrl: endpoint } } }, null, 2),
      };
    case "codex":
      return {
        steps: [
          "Add to ~/.codex/config.toml.",
          `Run codex mcp login kalami in your terminal, ${SIGN_IN}, then start codex.`,
        ],
        code: `[mcp_servers.kalami]\nurl = "${endpoint}"`,
      };
    case "other":
      return {
        steps: [
          `Any MCP client that speaks Streamable HTTP and supports OAuth sign-in works: give it the address below, and when it asks, ${SIGN_IN}.`,
        ],
        code: endpoint,
      };
  }
}

export function ConnectSnippets({ origin }: { origin: string }) {
  const [client, setClient] = useState<Client>("claude");
  const snippet = snippetFor(client, origin);

  return (
    <div className="space-y-4">
      <Segmented label="Your agent" value={client} options={CLIENTS} onChange={setClient} />
      <ol className="space-y-2">
        {snippet.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-sm leading-relaxed text-graphite">
            {snippet.steps.length > 1 && (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-panel text-xs font-semibold text-ink">
                {index + 1}
              </span>
            )}
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div className="relative">
        <pre className="no-scrollbar overflow-x-auto rounded-2xl bg-charcoal px-5 py-4 pr-28 font-mono text-[13px] leading-relaxed text-paper">
          {snippet.code}
        </pre>
        <CopyButton value={snippet.code} variant="lime" className="absolute right-3 top-3" />
      </div>
      {snippet.note && <p className="text-xs leading-relaxed text-graphite">{snippet.note}</p>}
      <p className="flex items-start gap-2 rounded-2xl bg-highlighter/30 px-4 py-3 text-xs leading-relaxed text-ink">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        <span>
          No token or key to paste: you sign in with your own Kalami account and press Allow. Only staff accounts get
          the tools, and you can disconnect any time in the assistant’s settings.
        </span>
      </p>
    </div>
  );
}
