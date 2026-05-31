import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const noteIds = Array.isArray(body.noteIds) ? body.noteIds.filter(Boolean) : [];
    if (noteIds.length === 0) return NextResponse.json({ error: "请选择要加入的笔记" }, { status: 400 });

    const kb = await prisma.knowledgeBase.findFirst({ where: { id: params.id, userId }, select: { id: true } });
    if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });

    await prisma.note.updateMany({
      where: { userId, id: { in: noteIds }, deletedAt: null },
      data: { knowledgeBaseId: kb.id },
    });
    await prisma.knowledgeBase.update({ where: { id: kb.id }, data: { updatedAt: new Date() } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const noteId = url.searchParams.get("noteId");
    if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

    await prisma.note.updateMany({
      where: { userId, id: noteId, knowledgeBaseId: params.id },
      data: { knowledgeBaseId: null },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
