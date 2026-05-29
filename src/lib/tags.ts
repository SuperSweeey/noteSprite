/**
 * Parse #a/b/c style tags from text.
 * Returns deduplicated, sorted list of tag paths.
 */
export function parseTags(text: string): string[] {
  const regex = /#[\w一-鿿-]+(\/[\w一-鿿-]+)*/g;
  const matches = text.match(regex);
  if (!matches) return [];

  // Remove the # prefix and deduplicate
  const paths = matches.map((t) => t.slice(1));
  return Array.from(new Set(paths)).sort();
}

/**
 * Given a full tag path like "产品/AI笔记/功能设计",
 * return all ancestor paths: ["产品", "产品/AI笔记", "产品/AI笔记/功能设计"]
 */
export function expandTagHierarchy(fullPath: string): string[] {
  const parts = fullPath.split("/");
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts.slice(0, i + 1).join("/"));
  }
  return result;
}

/**
 * Extract clean plain text from markdown.
 * Removes formatting syntax but preserves the actual text content.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")           // headings # ## ###
    .replace(/\*\*(.+?)\*\*/g, "$1")        // **bold**
    .replace(/__(.+?)__/g, "$1")            // __bold__
    .replace(/\*(.+?)\*/g, "$1")            // *italic*
    .replace(/_(.+?)_/g, "$1")              // _italic_
    .replace(/`{1,3}[^`]*`{1,3}/g, "")     // `code` ```blocks```
    .replace(/~~(.+?)~~/g, "$1")            // ~~strikethrough~~
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")    // [link](url)
    .replace(/!\[.*?\]\(.+?\)/g, "")        // ![image](url)
    .replace(/^>\s?/gm, "")                 // > blockquote
    .replace(/^[-*+]\s/gm, "")              // - * + list markers
    .replace(/^\d+\.\s/gm, "")              // 1. ordered list
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")    // --- horizontal rules
    .replace(/\n{2,}/g, "\n")              // collapse multiple newlines
    .replace(/\|/g, " ")                    // table pipes
    .trim();
}
