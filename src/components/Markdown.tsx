/**
 * A very small Markdown renderer.
 *
 * Cards are short, so this covers what people actually write — headings,
 * lists, quotes, code, bold/italic, `[[wikilinks]]` and `#tags` — and renders
 * it as React nodes. Nothing is injected as HTML, so a pasted card can never
 * script the app.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";

import { attachmentUrl, isImage } from "@/lib/attachments";
import { cn } from "@/lib/utils";

function inline(
  text: string,
  keyPrefix: string,
  onLink?: (target: string) => void,
  attachmentsDir?: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass over the interesting inline constructs, in priority order.
  const pattern =
    /(`[^`]+`)|(!\[\[[^\]]+\]\])|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[\[[^\]]+\]\])|((?:^|\s)#[\w/-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("![[")) {
      // Obsidian's embed syntax. Images are shown; anything else is named.
      const name = token.slice(3, -2).split("|")[0].trim();
      nodes.push(
        isImage(name) ? (
          <Embedded key={key} name={name} dir={attachmentsDir} />
        ) : (
          <span key={key} className="font-medium text-brand">
            {name}
          </span>
        ),
      );
    } else if (token.startsWith("`")) {
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
  attachmentsDir,
}: {
  text: string;
  className?: string;
  /** Called when a `[[wikilink]]` is tapped. */
  onLink?: (target: string) => void;
  /** Absolute path of the attachments folder, for `![[photo.jpg]]` embeds. */
  attachmentsDir?: string;
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
        {inline(paragraph.join(" "), key, onLink, attachmentsDir)}
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
            <span>{inline(item, `${key}-${index}`, onLink, attachmentsDir)}</span>
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
          {inline(heading[2], key, onLink, attachmentsDir)}
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
          {inline(line.replace(/^>\s?/, ""), key, onLink, attachmentsDir)}
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

/**
 * One embedded image.
 *
 * The webview cannot load a plain filesystem path, so the URL is resolved
 * asynchronously through Tauri's asset protocol. Outside the app — a browser
 * preview, or a card whose photo did not travel with it — a labelled
 * placeholder is shown rather than a broken image.
 */
function Embedded({ name, dir }: { name: string; dir?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!dir) {
      setUrl("");
      return;
    }
    attachmentUrl(dir, name)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => setUrl(""));
    return () => {
      cancelled = true;
    };
  }, [dir, name]);

  if (url === null) {
    return <span className="block h-32 animate-pulse rounded-xl bg-raised" />;
  }

  if (!url || failed) {
    return (
      <span className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2.5 text-sm text-muted">
        <ImageOff className="h-4 w-4 shrink-0" />
        {name}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-1 block max-h-80 w-full rounded-xl border border-line object-contain"
    />
  );
}
