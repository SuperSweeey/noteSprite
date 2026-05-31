import { prisma } from "./prisma";

export function normalizeTagPath(input: string): string {
  const parts = input
    .replace(/^#+/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("标签不能为空");
  }
  if (parts.some((part) => part.length > 40)) {
    throw new Error("单级标签不能超过 40 个字符");
  }
  return parts.join("/");
}

/** Ensure tag and all ancestors exist. Returns ALL tag IDs in the hierarchy. */
export async function ensureTagHierarchy(userId: string, fullPath: string): Promise<string[]> {
  const normalizedPath = normalizeTagPath(fullPath);
  const parts = normalizedPath.split("/");
  let parentId: string | null = null;
  const allIds: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join("/");
    const existing = await prisma.tag.findFirst({ where: { userId, fullPath: currentPath } });
    if (existing) {
      parentId = existing.id;
    } else {
      const created: { id: string } = await prisma.tag.create({
        data: { userId, name: parts[i], fullPath: currentPath, parentId },
        select: { id: true },
      });
      parentId = created.id;
    }
    allIds.push(parentId);
  }
  return allIds;
}

export async function syncTagCounts(userId: string) {
  const tags = await prisma.tag.findMany({ where: { userId }, select: { id: true } });
  for (const tag of tags) {
    const noteCount = await prisma.noteTag.count({
      where: {
        tagId: tag.id,
        note: { userId, deletedAt: null },
      },
    });
    await prisma.tag.update({ where: { id: tag.id }, data: { noteCount } });
  }
}
