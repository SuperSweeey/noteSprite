import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSpiritPrompt, getAIConfig, getSpiritConfig } from "@/lib/ai-config";

function isFailedTranscription(note: { status: string; contentMd: string }) {
  return note.status === "failed" || /\[失败\]|转写失败|转录失败/.test(note.contentMd || "");
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { noteId, report } = await req.json();
    if (!noteId || !report) {
      return NextResponse.json({ error: "missing params" }, { status: 400 });
    }

    const note = await prisma.note.findFirst({ where: { id: noteId, userId }, select: { id: true } });
    if (!note) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
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
    const { noteId, force, model: modelOverride, apiKey: apiKeyOverride, baseUrl: baseUrlOverride } = await req.json();

    if (!noteId) {
      return NextResponse.json({ error: "noteId required" }, { status: 400 });
    }

    const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (isFailedTranscription(note)) {
      return NextResponse.json({
        report: "",
        error: "这条笔记转写失败，暂不生成 AI 解读。请先重新转录，或编辑原文后再解读。",
      });
    }

    const existing = await prisma.aIResult.findUnique({ where: { noteId } });
    if (!force && existing?.actionItems && existing.actionItems.includes("## ")) {
      return NextResponse.json({ report: existing.actionItems });
    }

    const config = await getAIConfig(userId, "report");
    const spirit = await getSpiritConfig(userId);
    const model = String(modelOverride || "").trim() || config.model;
    const apiKey = String(apiKeyOverride || "").trim() || config.apiKey;
    const baseUrl = String(baseUrlOverride || "").trim() || config.baseUrl;

    if (!apiKey) {
      return NextResponse.json({
        report: "",
        error: "没有可用的模型密钥。请在设置里重新填写模型 Key，或检查 .env 里的 DEEPSEEK_API_KEY。",
      });
    }

    const systemPrompt = buildSpiritPrompt(spirit, config.prompt);

    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请完整解读这条笔记，尽量让解读稿可以替代原文阅读。\n\n笔记原文：\n${note.contentMd.slice(0, 9000)}`,
          },
        ],
        max_tokens: 1800,
        temperature: 0.45,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({
        report: "",
        error: `模型连接失败：HTTP ${resp.status}。${text.slice(0, 220)}`,
      });
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
    return NextResponse.json({ report: "", error: e.message });
  }
}
