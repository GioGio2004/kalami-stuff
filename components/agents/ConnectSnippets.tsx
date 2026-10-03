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

/** The secret link for web assistants that can't send headers. The token is part of the path. */
export function secretLink(origin: string, token: string): string {
  return `${origin}/api/mcp/k/${token}`;
}

type Snippet = {
  /** Numbered steps, in the words the client's own UI uses. */
  steps: string[];
  code: string;
  /** True when `code` is the secret link, which deserves a password warning. */
  usesLink?: boolean;
  note?: string;
};

/** What to do where, per MCP client. `token` is the real one right after creation. */
export function snippetFor(client: Client, origin: string, token: string): Snippet {
  const endpoint = `${origin}/api/mcp`;
  const link = secretLink(origin, token);
  const bearer = `Bearer ${token}`;
  switch (client) {
    case "claude":
      return {
        steps: [
          "Open claude.ai (or the Claude desktop app) → Settings → Connectors.",
          "Click “Add custom connector”, name it Kalami and paste the link below. Leave the OAuth fields empty.",
          "In a chat, open the tools menu and switch Kalami on.",
        ],
        code: link,
        usesLink: true,
        note: "Added once, it works on claude.ai, Claude Desktop and the Claude phone apps.",
      };
    case "chatgpt":
      return {
        steps: [
          "Settings → Apps & Connectors → Advanced settings: turn on Developer mode.",
          "Back in Apps & Connectors, click Create. Name: Kalami. MCP server URL: the link below. Authentication: No authentication.",
          "Tick “I trust this application” and create it. In a new chat, add Kalami from the + menu.",
        ],
        code: link,
        usesLink: true,
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
          "Any MCP client that speaks Streamable HTTP works. Use the header if it can send one, otherwise the link.",
        ],
        code: `URL:    ${endpoint}\nHeader: Authorization: ${bearer}\n\nNo headers? Use this link instead:\n${link}`,
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
      {snippet.usesLink && (
        <p className="flex items-start gap-2 rounded-2xl bg-highlighter/30 px-4 py-3 text-xs leading-relaxed text-ink">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This link has your token inside, so treat it like a password: anyone who has it can draft in your courses.
            Revoke the token above and the link stops working.
          </span>
        </p>
      )}
      {!token && (
        <p className="text-xs leading-relaxed text-graphite">
          Replace <code className="rounded bg-panel px-1.5 py-0.5 font-mono">{TOKEN_PLACEHOLDER}</code> with your
          token. Tokens are shown only once, when you create them, so if you lost yours, create a new one above.
        </p>
      )}
    </div>
  );
}
