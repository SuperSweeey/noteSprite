import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const icon = String(body.icon || "").trim().slice(0, 4);

    if (!name) {
      return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });
    }

    const existing = await prisma.knowledgeBase.findFirst({
      where: { id: params.id, userId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
    }

    const base = await prisma.knowledgeBase.update({
      where: { id: existing.id },
      data: {
        name,
        description,
        ...(icon ? { icon } : {}),
      },
      include: {
        notes: {
          where: { deletedAt: null },
          take: 4,
          orderBy: { updatedAt: "desc" },
          include: { aiResult: true, tags: { include: { tag: true } } },
        },
        _count: { select: { notes: true } },
      },
    });

    return NextResponse.json({ base });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId();
    const existing = await prisma.knowledgeBase.findFirst({
      where: { id: params.id, userId },
      select: { id: true, name: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.note.updateMany({
        where: { userId, knowledgeBaseId: existing.id },
        data: { knowledgeBaseId: null },
      }),
      prisma.knowledgeBase.delete({ where: { id: existing.id } }),
    ]);

    return NextResponse.json({ ok: true, deletedId: existing.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
