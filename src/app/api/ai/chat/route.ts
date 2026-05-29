import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSpiritPrompt, getAIConfig, getSpiritConfig } from "@/lib/ai-config";

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId") || undefined;
    const listConversations = url.searchParams.get("list") === "1";

    if (listConversations) {
      const conversations = await prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: { messages: { take: 1, orderBy: { createdAt: "desc" }, select: { content: true } } },
      });
      return NextResponse.json({ conversations });
    }

    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const messages = await prisma.chatMessage.findMany({
      where: { userId, conversationId: conversationId || null },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ messages: [], conversations: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const question = String(body.question || "").trim();
    const noteId = body.noteId || undefined;

    if (!question) {
      return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
    }

    let conversationId = body.conversationId || null;
    if (!conversationId) {
      const conv = await prisma.conversation.create({ data: { userId, title: question.slice(0, 40) } });
      conversationId = conv.id;
    }

    const dbConfig = await getAIConfig(userId, "chat");
    const spirit = await getSpiritConfig(userId);
    const apiKey = String(body.apiKey || "").trim() || dbConfig.apiKey;
    const baseUrl = String(body.baseUrl || "").trim() || dbConfig.baseUrl;
    const model = String(body.model || "").trim() || dbConfig.model;
    const injectedPrompt = buildSpiritPrompt(
      spirit,
      "用户正在和你对话。你要优先结合当前笔记和最近笔记回答；如果用户是在学习一个问题，要按照已选择的领学模式互动。"
    );
    const systemPrompt = [injectedPrompt, dbConfig.prompt, String(body.prompt || "").trim()].filter(Boolean).join("\n\n");

    if (!apiKey) {
      return NextResponse.json({
        answer: "我还没有拿到可用的模型密钥。请在设置里重新填写模型 Key，或检查 .env 里的 DEEPSEEK_API_KEY。",
        conversationId,
      });
    }

    await prisma.chatMessage.create({
      data: { userId, conversationId, noteId: noteId || null, role: "user", content: question },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    const context = await buildNoteContext(userId, noteId);
    const history = await prisma.chatMessage.findMany({
      where: { userId, conversationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const historyMsgs = history.reverse().map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const messages = [
      { role: "system", content: systemPrompt + (noteId ? "\n用户正在查看某条笔记，请优先围绕当前笔记回答。" : "") },
      ...historyMsgs,
      {
        role: "user",
        content: `我的笔记上下文：\n${context || "（还没有可用笔记上下文）"}\n\n我的问题：${question}`,
      },
    ];

    if (body.stream === false) {
      const answer = await callModel({ baseUrl, apiKey, model, messages, maxTokens: 1000 });
      await prisma.chatMessage.create({
        data: { userId, conversationId, noteId: noteId || null, role: "assistant", content: answer },
      });
      return NextResponse.json({ answer, conversationId });
    }

    const aiResp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 1000, temperature: 0.65, stream: true }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      const answer = `AI 刚才没连上模型（HTTP ${aiResp.status}）。${text.slice(0, 160)}`;
      await prisma.chatMessage.create({
        data: { userId, conversationId, noteId: noteId || null, role: "assistant", content: answer },
      });
      return NextResponse.json({ answer, conversationId });
    }

    const encoder = new TextEncoder();
    let fullAnswer = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = aiResp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  fullAnswer += delta;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                }
              } catch {}
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          if (fullAnswer) {
            prisma.chatMessage.create({
              data: { userId, conversationId, noteId: noteId || null, role: "assistant", content: fullAnswer },
            }).catch((e) => console.error("[Chat] DB save failed:", e));
          }
        } catch (e: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AI 回复中断：${e.message}` })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e: any) {
    console.error("[Chat] error:", e);
    return NextResponse.json({ answer: `AI 对话失败：${e.message}` });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  const noteId = url.searchParams.get("noteId") || undefined;

  if (conversationId) {
    await prisma.chatMessage.deleteMany({ where: { userId, conversationId } });
    await prisma.conversation.deleteMany({ where: { userId, id: conversationId } });
    return NextResponse.json({ ok: true });
  }

  await prisma.chatMessage.deleteMany({ where: { userId, noteId: noteId || null } });
  return NextResponse.json({ ok: true });
}

async function buildNoteContext(userId: string, noteId?: string): Promise<string> {
  const chunks: string[] = [];
  if (noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId }, include: { aiResult: true } });
    if (note) {
      chunks.push("【当前笔记】");
      chunks.push(note.contentMd.slice(0, 5000));
      if (note.aiResult?.actionItems) {
        chunks.push(`\n【已有 AI 解读】\n${note.aiResult.actionItems.slice(0, 3000)}`);
      }
    }
  }

  const recentNotes = await prisma.note.findMany({
    where: { userId, deletedAt: null, id: noteId ? { not: noteId } : undefined },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { title: true, contentMd: true, createdAt: true },
  });
  const recentContext = recentNotes
    .map((note) => {
      const date = new Date(note.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
      return `[${date}] ${note.title || note.contentMd.slice(0, 40)}\n${note.contentMd.slice(0, 280)}`;
    })
    .join("\n---\n")
    .slice(0, 3000);

  if (recentContext) {
    chunks.push("【最近笔记】");
    chunks.push(recentContext);
  }

  return chunks.join("\n\n");
}

async function callModel({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  maxTokens: number;
}): Promise<string> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.65 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return `AI 刚才没连上模型（HTTP ${resp.status}）。${text.slice(0, 160)}`;
  }
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || "";
}
