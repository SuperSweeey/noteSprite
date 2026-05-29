import { prisma } from "./prisma";

/** Ensure tag and all ancestors exist. Returns ALL tag IDs in the hierarchy. */
export async function ensureTagHierarchy(userId: string, fullPath: string): Promise<string[]> {
  const parts = fullPath.split("/");
  let parentId: string | null = null;
  const allIds: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join("/");
    const existing = await prisma.tag.findFirst({ where: { userId, fullPath: currentPath } });
    if (existing) {
      parentId = existing.id;
    } else {
      const created = await prisma.tag.create({ data: { userId, name: parts[i], fullPath: currentPath, parentId } });
      parentId = created.id;
    }
    allIds.push(parentId);
  }
  return allIds;
}
