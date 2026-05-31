import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { ensureTagHierarchy, normalizeTagPath, syncTagCounts } from "@/lib/tags-db";
import { markStaleTranscriptions } from "@/lib/transcription-jobs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    await markStaleTranscriptions(userId);
    const note = await prisma.note.findFirst({
      where: { id: params.id, userId, deletedAt: null },
      include: {
        tags: { include: { tag: true }, orderBy: { tag: { fullPath: "asc" } } },
        aiResult: true,
        assets: { orderBy: { createdAt: "desc" } },
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
    const { content, title, status, knowledgeBaseId, restore, tagPath } = await req.json();

    const note = await prisma.note.findFirst({
      where: { id: params.id, userId },
    });
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const data: any = { version: note.version + 1 };
    if (content !== undefined) {
      if (typeof content !== "string" || !content.trim()) {
        return NextResponse.json({ error: "正文不能为空" }, { status: 400 });
      }
      const cleanContent = content.trim();
      data.contentMd = cleanContent;
      data.plainText = stripMarkdown(cleanContent);

      const tagPaths = parseTags(cleanContent);
      await prisma.noteTag.deleteMany({ where: { noteId: note.id } });
      const allIds: string[] = [];
      for (const tagPath of tagPaths) {
        const ids = await ensureTagHierarchy(userId, tagPath);
        allIds.push(...ids);
      }
      for (const tagId of Array.from(new Set(allIds))) {
        await prisma.noteTag.create({ data: { noteId: note.id, tagId } });
      }
      await syncTagCounts(userId);
    }
    if (tagPath !== undefined) {
      const tagIds = await ensureTagHierarchy(userId, normalizeTagPath(String(tagPath)));
      for (const tagId of Array.from(new Set(tagIds))) {
        await prisma.noteTag.upsert({
          where: { noteId_tagId: { noteId: note.id, tagId } },
          update: {},
          create: { noteId: note.id, tagId },
        });
      }
      await syncTagCounts(userId);
    }
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
      }
      data.title = title.trim();
    }
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
        assets: { orderBy: { createdAt: "desc" } },
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

      const tag = await prisma.tag.findFirst({
        where: { id: tagId, userId },
        select: { id: true, fullPath: true },
      });
      if (!tag) {
        return NextResponse.json({ error: "Tag not found" }, { status: 404 });
      }
      const descendants = await prisma.tag.findMany({
        where: { userId, OR: [{ id: tag.id }, { fullPath: { startsWith: `${tag.fullPath}/` } }] },
        select: { id: true },
      });
      await prisma.noteTag.deleteMany({
        where: { noteId: params.id, tagId: { in: descendants.map((item) => item.id) } },
      });
      await syncTagCounts(userId);
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
