import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTags, stripMarkdown } from "@/lib/tags";
import { ensureTagHierarchy } from "@/lib/tags-db";
import { analyzeNote } from "@/lib/ai";
import { getAIConfig, resolveSettings } from "@/lib/ai-config";

function shouldSkipAIAnalysis(content: string) {
  return /\[失败\]|转写失败|转录失败/.test(content || "");
}

// POST /api/notes — create a note
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { content } = await req.json();
    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const tagPaths = parseTags(content);
    const plainText = stripMarkdown(content);

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
        contentMd: content,
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

    // Step 3: increment note counts for all tags in hierarchy
    for (const tagId of uniqueTagIds) {
      await prisma.tag.update({
        where: { id: tagId },
        data: { noteCount: { increment: 1 } },
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    const settings = resolveSettings(user?.settings);

    // Step 4: trigger AI analysis in background (don't wait)
    if (settings.knowledge.autoAnalyze && !shouldSkipAIAnalysis(content)) {
      runAIAnalysis(note.id, content);
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
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const tag = url.searchParams.get("tag") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const hasAI = url.searchParams.get("hasAI") || undefined;
    const view = url.searchParams.get("view") || "active";
    const sort = url.searchParams.get("sort") || undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const where: any = { userId };
    if (view === "trash") {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    if (status) where.status = status;
    if (source) {
      where.type = source === "manual" ? "manual" : source;
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { plainText: { contains: search } },
        { contentMd: { contains: search } },
        { aiResult: { is: { summary: { contains: search } } } },
        { aiResult: { is: { actionItems: { contains: search } } } },
        { tags: { some: { tag: { fullPath: { contains: search } } } } },
      ];
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

    const [notes, total] = await Promise.all([
      prisma.note.findMany({
        where,
        include: { tags: { include: { tag: true } }, aiResult: true },
        orderBy: { [sort === "created" ? "createdAt" : "updatedAt"]: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.note.count({ where }),
    ]);

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
