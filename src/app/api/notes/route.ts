import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { ensureTagHierarchy, syncTagCounts } from "@/lib/tags-db";
import { analyzeNote } from "@/lib/ai";
import { getAIConfig, resolveSettings } from "@/lib/ai-config";
import { markStaleTranscriptions } from "@/lib/transcription-jobs";

function shouldSkipAIAnalysis(content: string) {
  return /\[失败\]|转写失败|转录失败/.test(content || "");
}

// POST /api/notes — create a note
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { content } = await req.json();
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const cleanContent = content.trim();
    const tagPaths = parseTags(cleanContent);
    const plainText = stripMarkdown(cleanContent);

    // Step 1: ensure all tag hierarchies exist (returns ALL ids: ancestors + leaf)
    const allTagIds: string[] = [];
    for (const fullPath of tagPaths) {
      const ids = await ensureTagHierarchy(userId, fullPath);
      allTagIds.push(...ids);
    }
    const uniqueTagIds = Array.from(new Set(allTagIds));

    // Step 2: create the note with tag connections
    const note = await prisma.note.create({
      data: {
        userId,
        contentMd: cleanContent,
        plainText,
        status: "inbox",
        tags: {
          create: uniqueTagIds.map((tagId) => ({
            tag: { connect: { id: tagId } },
          })),
        },
      },
      include: { tags: { include: { tag: true } } },
    });

    await syncTagCounts(userId);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    const settings = resolveSettings(user?.settings);

    // Step 4: trigger AI analysis in background (don't wait)
    if (settings.knowledge.autoAnalyze && !shouldSkipAIAnalysis(cleanContent)) {
      runAIAnalysis(note.id, cleanContent);
    }

    return NextResponse.json(note, { status: 201 });
  } catch (e: any) {
    console.error("POST /api/notes error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET /api/notes — list notes (latest first, with filters)
export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    await markStaleTranscriptions(userId);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const tag = url.searchParams.get("tag") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const hasAI = url.searchParams.get("hasAI") || undefined;
    const view = url.searchParams.get("view") || "active";
    const sort = url.searchParams.get("sort") || undefined;
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;
    const knowledgeBaseId = url.searchParams.get("knowledgeBaseId") || undefined;
    const unassigned = url.searchParams.get("unassigned") === "1";
    const compact = url.searchParams.get("compact") === "1";
    const viewMode = url.searchParams.get("viewMode") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const where: any = { userId };
    if (view === "trash") {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    if (status) where.status = status;
    if (from || to) {
      const dateFilter: any = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lt = new Date(to);
      where.OR = [{ createdAt: dateFilter }, { updatedAt: dateFilter }];
    }
    if (source) {
      where.type = source === "manual" ? "manual" : source;
    }
    if (knowledgeBaseId) {
      where.knowledgeBaseId = knowledgeBaseId;
    } else if (unassigned) {
      where.knowledgeBaseId = null;
    }
    if (search) {
      const searchOr = [
        { title: { contains: search } },
        { plainText: { contains: search } },
        { contentMd: { contains: search } },
        { aiResult: { is: { summary: { contains: search } } } },
        { aiResult: { is: { actionItems: { contains: search } } } },
        { tags: { some: { tag: { fullPath: { contains: search } } } } },
      ];
      where.AND = [...(where.AND || []), { OR: searchOr }];
    }
    if (hasAI === "yes") where.aiResult = { isNot: null };
    if (hasAI === "no") where.aiResult = { is: null };
    if (tag) {
      where.tags = {
        some: {
          tag: { fullPath: { startsWith: tag } },
        },
      };
    }

    const orderBy = { [sort === "created" ? "createdAt" : "updatedAt"]: "desc" };
    const notesQuery = compact
      ? prisma.note.findMany({
          where,
          select: { id: true, title: true, contentMd: true, createdAt: true, updatedAt: true, type: true, knowledgeBaseId: true },
          orderBy,
          take: limit,
          skip: offset,
        })
      : viewMode === "timeline"
      ? prisma.note.findMany({
          where,
          select: {
            id: true,
            title: true,
            contentMd: true,
            sourceUrl: true,
            type: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            tags: { include: { tag: true }, take: 4 },
            aiResult: { select: { summary: true, keyPoints: true, suggestedTags: true } },
          },
          orderBy,
          take: limit,
          skip: offset,
        })
      : viewMode === "list"
      ? prisma.note.findMany({
          where,
          select: {
            id: true,
            title: true,
            contentMd: true,
            type: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            knowledgeBaseId: true,
            tags: { include: { tag: true }, take: 3 },
            aiResult: { select: { summary: true } },
          },
          orderBy,
          take: limit,
          skip: offset,
        })
      : prisma.note.findMany({
          where,
          include: { tags: { include: { tag: true } }, aiResult: true },
          orderBy,
          take: limit,
          skip: offset,
        });

    const [notes, total] = await Promise.all([notesQuery, prisma.note.count({ where })]);

    return NextResponse.json({ notes, total });
  } catch (e: any) {
    console.error("GET /api/notes error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function runAIAnalysis(noteId: string, content: string) {
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    const config = await getAIConfig(note!.userId, "analysis");
    if (!config.apiKey) return;

    const overrides = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    };

    const result = await analyzeNote(content, overrides);
    if (!result) return;

    await prisma.aIResult.create({
      data: {
        noteId,
        model: config.model || "deepseek-v4-flash",
        summary: result.summary,
        keyPoints: JSON.stringify(result.keyPoints),
        keywords: JSON.stringify(result.keywords),
        suggestedTags: JSON.stringify(result.suggestedTags),
      },
    });
    console.log(`[AI] Analysis saved for note ${noteId}`);
  } catch (e) {
    console.error(`[AI] Analysis failed for note ${noteId}:`, e);
  }
}
