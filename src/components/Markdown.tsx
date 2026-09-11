/**
 * A very small Markdown renderer.
 *
 * Cards are short, so this covers what people actually write — headings,
 * lists, quotes, code, bold/italic, `[[wikilinks]]` and `#tags` — and renders
 * it as React nodes. Nothing is injected as HTML, so a pasted card can never
 * script the app.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function inline(
  text: string,
  keyPrefix: string,
  onLink?: (target: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass over the interesting inline constructs, in priority order.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[\[[^\]]+\]\])|((?:^|\s)#[\w/-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[[")) {
      const inner = token.slice(2, -2);
      const target = inner.split("|")[0].trim();
      const label = inner.split("|")[1]?.trim() ?? target;
      nodes.push(
        onLink ? (
          <button
            key={key}
            onClick={() => onLink(target)}
            className="font-medium text-brand underline decoration-brand/40 underline-offset-2"
          >
            {label}
          </button>
        ) : (
          <span key={key} className="font-medium text-brand">
            {label}
          </span>
        ),
      );
    } else if (token.trimStart().startsWith("#")) {
      const lead = token.startsWith("#") ? "" : token[0];
      nodes.push(
        <span key={key}>
          {lead}
          <span className="font-medium text-brand">{token.trim()}</span>
        </span>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({
  text,
  className,
  onLink,
}: {
  text: string;
  className?: string;
  /** Called when a `[[wikilink]]` is tapped. */
  onLink?: (target: string) => void;
}) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="leading-relaxed">
        {inline(paragraph.join(" "), key, onLink)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} className="ml-1 space-y-1.5">
        {list.map((item, index) => (
          <li key={index} className="flex gap-2 leading-relaxed">
            <span className="mt-[.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            <span>{inline(item, `${key}-${index}`, onLink)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trimStart().startsWith("```")) {
      if (code === null) {
        flushParagraph();
        flushList();
        code = [];
      } else {
        blocks.push(
          <pre
            key={`pre-${blocks.length}`}
            data-selectable
            className="overflow-x-auto rounded-xl bg-raised p-3 font-mono text-[13px] leading-relaxed"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(raw);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const key = `h-${blocks.length}`;
      blocks.push(
        <p
          key={key}
          className={cn(
            "font-bold leading-snug",
            level <= 2 ? "text-lg" : "text-[15px]",
          )}
        >
          {inline(heading[2], key, onLink)}
        </p>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^\s*[-*+]\s+/, ""));
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      const key = `q-${blocks.length}`;
      blocks.push(
        <blockquote
          key={key}
          className="border-l-[3px] border-brand/50 pl-3 italic text-muted"
        >
          {inline(line.replace(/^>\s?/, ""), key, onLink)}
        </blockquote>,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="border-line" />);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  if (code !== null && code.length > 0) {
    blocks.push(
      <pre key="pre-tail" data-selectable className="overflow-x-auto rounded-xl bg-raised p-3 font-mono text-[13px]">
        {code.join("\n")}
      </pre>,
    );
  }

  return (
    <div data-selectable className={cn("space-y-3 text-[15px]", className)}>
      {blocks}
    </div>
  );
}
