"use client";

import { useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Segmented } from "@/components/ui/form";
import { Lock } from "@/components/ui/icons";

type Client =
  | "claude"
  | "chatgpt"
  | "claude-code"
  | "cursor"
  | "vscode"
  | "gemini"
  | "codex"
  | "windsurf"
  | "other";

const CLIENTS: { value: Client; label: string }[] = [
  { value: "claude", label: "Claude app" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "vscode", label: "VS Code" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "codex", label: "Codex" },
  { value: "windsurf", label: "Windsurf" },
  { value: "other", label: "Other" },
];

export const TOKEN_PLACEHOLDER = "klm_YOUR_TOKEN";

type Snippet = {
  /** Numbered steps, in the words the client's own UI uses. */
  steps: string[];
  code: string;
  /** "Sign in with Kalami": no token involved, the person signs in with their own account. */
  signIn?: boolean;
  note?: string;
};

/** What to do where, per MCP client. `token` is the real one right after creation. */
export function snippetFor(client: Client, origin: string, token: string): Snippet {
  const endpoint = `${origin}/api/mcp`;
  const bearer = `Bearer ${token}`;
  switch (client) {
    case "claude":
      return {
        steps: [
          "Open claude.ai (or the Claude desktop app) → Settings → Connectors → Add custom connector.",
          "Name it Kalami, paste the address below and click Continue.",
          "Authentication: Sign in now. OAuth client: Use Claude’s published identity. Click Add.",
          "Click Connect, sign in with your Kalami staff account and press Allow. In a chat, switch Kalami on in the tools menu.",
        ],
        code: endpoint,
        signIn: true,
        note: "Added once, it works on claude.ai, Claude Desktop and the Claude phone apps.",
      };
    case "chatgpt":
      return {
        steps: [
          "Settings → Apps & Connectors → Advanced settings: turn on Developer mode.",
          "Back in Apps & Connectors, click Create. Name: Kalami. MCP server URL: the address below. Authentication: OAuth.",
          "Create it, sign in with your Kalami staff account and press Allow. In a new chat, add Kalami from the + menu.",
        ],
        code: endpoint,
        signIn: true,
        note: "Developer mode is only on some ChatGPT plans. If you don't see it, use another agent.",
      };
    case "claude-code":
      return {
        steps: ["Run this once in your terminal. Then start claude and ask away."],
        code: `claude mcp add --transport http kalami ${endpoint} --header "Authorization: ${bearer}"`,
      };
    case "cursor":
      return {
        steps: ["Paste into .cursor/mcp.json (or Cursor Settings → MCP → Add new MCP server)."],
        code: JSON.stringify({ mcpServers: { kalami: { url: endpoint, headers: { Authorization: bearer } } } }, null, 2),
      };
    case "vscode":
      return {
        steps: ["Paste into .vscode/mcp.json, then use Copilot Chat in Agent mode."],
        code: JSON.stringify(
          { servers: { kalami: { type: "http", url: endpoint, headers: { Authorization: bearer } } } },
          null,
          2,
        ),
      };
    case "gemini":
      return {
        steps: ["Add to ~/.gemini/settings.json, then restart gemini. /mcp lists Kalami's tools."],
        code: JSON.stringify({ mcpServers: { kalami: { httpUrl: endpoint, headers: { Authorization: bearer } } } }, null, 2),
      };
    case "codex":
      return {
        steps: ["Add to ~/.codex/config.toml, then restart codex."],
        code: `[mcp_servers.kalami]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "${bearer}" }`,
      };
    case "windsurf":
      return {
        steps: ["Add to ~/.codeium/windsurf/mcp_config.json (Windsurf Settings → Cascade → MCP servers)."],
        code: JSON.stringify(
          { mcpServers: { kalami: { serverUrl: endpoint, headers: { Authorization: bearer } } } },
          null,
          2,
        ),
      };
    case "other":
      return {
        steps: [
          "Any MCP client that speaks Streamable HTTP works: with OAuth sign-in if it supports it (no token needed), otherwise with the header below.",
        ],
        code: `URL:    ${endpoint}\nHeader: Authorization: ${bearer}`,
      };
  }
}

export function ConnectSnippets({ origin, token }: { origin: string; token?: string }) {
  const [client, setClient] = useState<Client>("claude");
  const snippet = snippetFor(client, origin, token ?? TOKEN_PLACEHOLDER);

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
      {snippet.signIn && (
        <p className="flex items-start gap-2 rounded-2xl bg-highlighter/30 px-4 py-3 text-xs leading-relaxed text-ink">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No token needed: you sign in with your own Kalami account and press Allow. Only staff accounts get the tools,
            and you can disconnect any time in the assistant’s settings.
          </span>
        </p>
      )}
      {!token && !snippet.signIn && (
        <p className="text-xs leading-relaxed text-graphite">
          Replace <code className="rounded bg-panel px-1.5 py-0.5 font-mono">{TOKEN_PLACEHOLDER}</code> with your
          token. Tokens are shown only once, when you create them, so if you lost yours, create a new one above.
        </p>
      )}
    </div>
  );
}
