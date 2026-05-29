import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIConfig } from "@/lib/ai-config";

// PUT - save edited spirit reading
export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { noteId, report } = await req.json();
    if (!noteId || !report) {
      return NextResponse.json({ error: "missing params" }, { status: 400 });
    }

    await prisma.aIResult.upsert({
      where: { noteId },
      create: {
        noteId,
        summary: "",
        keyPoints: "[]",
        keywords: "[]",
        suggestedTags: "[]",
        actionItems: report,
        reviewQuestions: "[]",
      },
      update: { actionItems: report },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const {
      noteId,
      model: modelOverride,
      apiKey: apiKeyOverride,
      baseUrl: baseUrlOverride,
    } = await req.json();

    if (!noteId) {
      return NextResponse.json({ error: "noteId required" }, { status: 400 });
    }

    const config = await getAIConfig(userId, "report");
    const model = (modelOverride && modelOverride.trim()) || config.model;
    const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || config.apiKey;
    const baseUrl = (baseUrlOverride && baseUrlOverride.trim()) || config.baseUrl;

    const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const existing = await prisma.aIResult.findUnique({ where: { noteId } });
    if (existing?.actionItems && existing.actionItems.includes("## ")) {
      return NextResponse.json({ report: existing.actionItems });
    }

    if (!apiKey) {
      return NextResponse.json({ report: "" });
    }

    const defaultPrompt =
      "你是笔记精灵。请温柔、清楚地阅读用户笔记，并输出一份 Markdown 整理稿。\n\n" +
      "请按以下结构输出：\n" +
      "## 今天这页在说什么\n2到3句话概括核心意思。\n\n" +
      "## 值得记住的几点\n用 3 到 5 条无序列表写出具体要点。\n\n" +
      "## 可以接着想的问题\n给出 2 到 3 个自然的问题，帮助用户继续思考。\n\n" +
      "语气要像住在笔记里的精灵，温柔、有陪伴感，但不要夸张，不要自称 AI。";
    const systemPrompt = config.prompt || defaultPrompt;

    const resp = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `笔记内容：\n${note.contentMd.slice(0, 6000)}` },
        ],
        max_tokens: 700,
        temperature: 0.5,
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ report: "" });
    }

    const json = await resp.json();
    const report = json.choices?.[0]?.message?.content || "";

    await prisma.aIResult.upsert({
      where: { noteId },
      create: {
        noteId,
        summary: existing?.summary || "",
        keyPoints: existing?.keyPoints || "[]",
        keywords: existing?.keywords || "[]",
        suggestedTags: existing?.suggestedTags || "[]",
        actionItems: report,
        reviewQuestions: existing?.reviewQuestions || "[]",
      },
      update: { actionItems: report },
    });

    return NextResponse.json({ report });
  } catch (e: any) {
    console.error("[Report] Error:", e);
    return NextResponse.json({ report: "" });
  }
}
