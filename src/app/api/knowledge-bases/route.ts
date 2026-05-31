import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const [bases, unassigned, suggestions] = await Promise.all([
      prisma.knowledgeBase.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          notes: {
            where: { deletedAt: null },
            take: 4,
            orderBy: { updatedAt: "desc" },
            include: { aiResult: true, tags: { include: { tag: true } } },
          },
          _count: { select: { notes: true } },
        },
      }),
      prisma.note.count({ where: { userId, deletedAt: null, knowledgeBaseId: null } }),
      buildSuggestions(userId),
    ]);

    return NextResponse.json({ bases, unassigned, suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });

    const base = await prisma.knowledgeBase.create({
      data: {
        userId,
        name,
        description: String(body.description || "").trim(),
        icon: String(body.icon || "◌").trim().slice(0, 4) || "◌",
      },
    });

    const noteIds = Array.isArray(body.noteIds) ? body.noteIds.filter(Boolean) : [];
    if (noteIds.length > 0) {
      await prisma.note.updateMany({
        where: { userId, id: { in: noteIds } },
        data: { knowledgeBaseId: base.id },
      });
    }

    return NextResponse.json({ base });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function buildSuggestions(userId: string) {
  const tags = await prisma.tag.findMany({
    where: { userId, noteCount: { gte: 2 } },
    orderBy: { noteCount: "desc" },
    take: 6,
    include: {
      notes: {
        where: { note: { deletedAt: null, knowledgeBaseId: null } },
        take: 8,
        include: { note: { select: { id: true, title: true, contentMd: true } } },
      },
    },
  });

  return tags
    .map((tag) => ({
      name: tag.fullPath.split("/").at(-1) || tag.name,
      description: `AI 根据 #${tag.fullPath} 发现的主题集合`,
      icon: "◌",
      noteIds: tag.notes.map((item) => item.note.id),
      noteCount: tag.notes.length,
      tag: tag.fullPath,
    }))
    .filter((item) => item.noteCount >= 2);
}
