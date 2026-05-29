"use client";

import { useMemo } from "react";
import { marked } from "marked";

// Configure marked for safe rendering
marked.use({
  gfm: true,
  breaks: true,
});

export function MarkdownView({ content }: { content: string }) {
  const html = useMemo(() => {
    // Strip the YAML frontmatter-like header lines（来源、平台等元信息）
    const clean = content
      .replace(/^# .*\n/, "") // remove h1 title
      .replace(/^\*\*来源：.*\*\*\n/gm, "")
      .replace(/^\*\*平台：.*\*\*\n/gm, "")
      .replace(/^---\n*/gm, "")
      .trim();

    return marked.parse(clean) as string;
  }, [content]);

  return (
    <div
      className="prose-note"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
