import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { ensureTagHierarchy } from "@/lib/tags-db";

// PATCH /api/notes/[id] — update note
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    const { content, title, status, knowledgeBaseId } = await req.json();

    const note = await prisma.note.findFirst({
      where: { id: params.id, userId },
    });
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const data: any = { version: note.version + 1 };
    if (content !== undefined) {
      data.contentMd = content;
      data.plainText = stripMarkdown(content);

      // Re-parse tags with full hierarchy
      const tagPaths = parseTags(content);
      await prisma.noteTag.deleteMany({ where: { noteId: note.id } });
      const allIds: string[] = [];
      for (const tagPath of tagPaths) {
        const ids = await ensureTagHierarchy(userId, tagPath);
        allIds.push(...ids);
      }
      for (const tagId of Array.from(new Set(allIds))) {
        await prisma.noteTag.create({ data: { noteId: note.id, tagId } });
      }
    }
    if (title !== undefined) data.title = title;
    if (status !== undefined) data.status = status;
    if (knowledgeBaseId !== undefined) data.knowledgeBaseId = knowledgeBaseId;

    const updated = await prisma.note.update({
      where: { id: params.id },
      data,
      include: { tags: { include: { tag: true } }, aiResult: true },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    console.error("PATCH /api/notes error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/notes/[id] — soft delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    await prisma.note.updateMany({
      where: { id: params.id, userId },
      data: { status: "deleted", deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
