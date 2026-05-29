import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIConfig } from "@/lib/ai-config";

// PUT - save edited report
export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { noteId, report } = await req.json();
    if (!noteId || !report) return NextResponse.json({ error: "missing params" }, { status: 400 });
    await prisma.aIResult.upsert({
      where: { noteId },
      create: { noteId, summary: report, keyPoints: "[]", keywords: "[]", suggestedTags: "[]", actionItems: "[]", reviewQuestions: "[]" },
      update: { summary: report },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { noteId, model: modelOverride, apiKey: apiKeyOverride, baseUrl: baseUrlOverride } = await req.json();
    if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

    const config = await getAIConfig(userId, "report");

    const model = (modelOverride && modelOverride.trim()) || config.model;
    const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || config.apiKey;
    const baseUrl = (baseUrlOverride && baseUrlOverride.trim()) || config.baseUrl;

    const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });

    const existing = await prisma.aIResult.findUnique({ where: { noteId } });
    if (existing?.summary && existing.summary.includes("## ")) {
      return NextResponse.json({ report: existing.summary });
    }

    if (!apiKey) return NextResponse.json({ report: "未配置 API Key。" });

    const defaultPrompt =
      "你是笔记精灵，温柔地帮用户读笔记。请按以下格式输出（Markdown）：\n\n" +
      "## 💭 概要\n用自然的语气，2-3句话概括这条笔记的核心。像朋友为你简述。\n\n" +
      "## 🔑 要点\n- 要点一，具体不空洞\n- 要点二\n- 要点三（3~5个）\n\n" +
      "## 🌟 可带走什么\n1~2句话，说说读完这条笔记的收获。\n\n" +
      "语气温润，像旧友闲谈。不要标签。不要'作为AI'。";
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

    if (!resp.ok) return NextResponse.json({ report: "" });

    const json = await resp.json();
    const report = json.choices?.[0]?.message?.content || "";

    await prisma.aIResult.upsert({
      where: { noteId },
      create: { noteId, summary: report, keyPoints: "[]", keywords: "[]", suggestedTags: "[]", actionItems: "[]", reviewQuestions: "[]" },
      update: { summary: report },
    });

    return NextResponse.json({ report });
  } catch (e: any) {
    console.error("[Report] Error:", e);
    return NextResponse.json({ report: "" });
  }
}