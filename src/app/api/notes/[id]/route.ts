import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { ensureTagHierarchy } from "@/lib/tags-db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    const note = await prisma.note.findFirst({
      where: { id: params.id, userId, deletedAt: null },
      include: {
        tags: { include: { tag: true }, orderBy: { tag: { fullPath: "asc" } } },
        aiResult: true,
      },
    });

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json(note);
  } catch (e: any) {
    console.error("GET /api/notes/[id] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    const { content, title, status, knowledgeBaseId, restore } = await req.json();

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
    if (restore) {
      data.status = "inbox";
      data.deletedAt = null;
    }
    if (knowledgeBaseId !== undefined) data.knowledgeBaseId = knowledgeBaseId;

    const updated = await prisma.note.update({
      where: { id: params.id },
      data,
      include: {
        tags: { include: { tag: true }, orderBy: { tag: { fullPath: "asc" } } },
        aiResult: true,
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    console.error("PATCH /api/notes/[id] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const tagId = url.searchParams.get("tagId");
    const permanent = url.searchParams.get("permanent") === "true";
    const permanentNow = url.searchParams.get("permanentNow") === "true";

    if (tagId) {
      const note = await prisma.note.findFirst({
        where: { id: params.id, userId },
        select: { id: true },
      });
      if (!note) {
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }

      await prisma.noteTag.deleteMany({ where: { noteId: params.id, tagId } });
      return NextResponse.json({ ok: true });
    }

    if (permanent || permanentNow) {
      const note = await prisma.note.findFirst({
        where: permanent ? { id: params.id, userId, deletedAt: { not: null } } : { id: params.id, userId },
        select: { id: true },
      });
      if (!note) {
        return NextResponse.json({ error: "Note not found in trash" }, { status: 404 });
      }
      await prisma.note.delete({ where: { id: params.id } });
      return NextResponse.json({ ok: true });
    }

    await prisma.note.updateMany({
      where: { id: params.id, userId },
      data: { status: "deleted", deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
