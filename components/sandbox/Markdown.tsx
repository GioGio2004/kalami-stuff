import type { ReactNode } from "react";

/**
 * The Markdown that task steps use: paragraphs, `code`, **bold**, *italic*,
 * links, lists, headings and fenced code blocks. Everything is rendered as
 * React text, so no HTML from a task ever reaches the page.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("`")) {
      out.push(
        <code key={k} className="rounded-md bg-panel px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<em key={k}>{token.slice(1, -1)}</em>);
    } else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-xl bg-charcoal px-4 py-3 font-mono text-[13px] leading-relaxed text-paper">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      // Real headings, sized relative to the text around them so they fit a task step and a lesson slide alike.
      const Heading = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(
        <Heading
          key={key}
          className={`font-medium leading-snug tracking-tight text-ink not-first:pt-2 ${heading[1].length <= 2 ? "text-[1.3em]" : "text-[1.1em]"}`}
        >
          {inline(heading[2], key)}
        </Heading>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `${key}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i++]);
    }
    blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
  }
  return <div className={`space-y-3 ${className}`}>{blocks}</div>;
}
