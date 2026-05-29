import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIConfig } from "@/lib/ai-config";

// GET — list messages for a conversation, or list all conversations
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

    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const messages = await prisma.chatMessage.findMany({
      where: { userId, conversationId: conversationId || null },
      orderBy: { createdAt: "asc" }, take: limit,
    });
    return NextResponse.json({ messages });
  } catch { return NextResponse.json({ messages: [], conversations: [] }); }
}

// POST — send a message (streaming by default)
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await req.json();
    const { question, noteId, conversationId } = body;

    if (!question?.trim()) return NextResponse.json({ error: "问题不能为空" }, { status: 400 });

    // Resolve AI config from settings (with client overrides as highest priority)
    let convId = conversationId || null;
    if (!convId) {
      // Auto-create a conversation if none provided
      const conv = await prisma.conversation.create({ data: { userId } });
      convId = conv.id;
    }

    // Get AI config: client overrides > DB settings > env vars
    const clientOverrides = {
      apiKey: (body.apiKey && body.apiKey.trim()) || undefined,
      baseUrl: (body.baseUrl && body.baseUrl.trim()) || undefined,
      model: (body.model && body.model.trim()) || undefined,
    };
    const dbConfig = await getAIConfig(userId, "chat");

    const apiKey = clientOverrides.apiKey || dbConfig.apiKey || process.env.DEEPSEEK_API_KEY;
    const baseUrl = clientOverrides.baseUrl || dbConfig.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    const model = clientOverrides.model || dbConfig.model || "deepseek-v4-flash";
    const defaultPrompt = "你是「笔记精灵」，温柔、有洞察力的知识伙伴。用中文回答，语气自然。可以引用笔记内容。";
    const systemPrompt = (body.prompt && body.prompt.trim()) || dbConfig.prompt || defaultPrompt;

    if (!apiKey) return NextResponse.json({ answer: "未配置 API Key，请在设置中填入。" });

    // Save user message
    await prisma.chatMessage.create({ data: { userId, conversationId: convId, noteId: noteId || null, role: "user", content: question } });
    // Touch conversation updatedAt
    await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

    // Build context: recent notes for global awareness
    let context = "";
    if (noteId) {
      const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
      if (note) context = `【当前笔记】\n${note.contentMd.slice(0, 4000)}\n\n`;
    }
    const notes = await prisma.note.findMany({
      where: { userId, deletedAt: null, id: noteId ? { not: noteId } : undefined },
      orderBy: { createdAt: "desc" }, take: 15,
      select: { contentMd: true, createdAt: true },
    });
    context += notes.map((n) => {
      const d = new Date(n.createdAt);
      return `[${d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}] ${n.contentMd.slice(0, 300)}`;
    }).join("\n---\n").slice(0, 3000);

    // History
    const history = await prisma.chatMessage.findMany({
      where: { userId, conversationId: convId },
      orderBy: { createdAt: "desc" }, take: 10,
    });
    const historyMsgs = history.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const useStream = body.stream !== false;

    if (!useStream) {
      const resp = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt + (noteId ? "用户正在看某条笔记，请优先围绕它来回答。" : "") },
            ...historyMsgs,
            { role: "user", content: `我的笔记：\n${context || "（还没有笔记）"}\n\n问题：${question}` },
          ],
          max_tokens: 800, temperature: 0.7,
        }),
      });
      if (!resp.ok) {
        const answer = `精灵打了个盹（${resp.status}）。稍后再试？`;
        await prisma.chatMessage.create({ data: { userId, conversationId: convId, noteId: noteId || null, role: "assistant", content: answer } });
        return NextResponse.json({ answer, conversationId: convId });
      }
      const json = await resp.json();
      const answer = json.choices?.[0]?.message?.content || "";
      await prisma.chatMessage.create({ data: { userId, conversationId: convId, noteId: noteId || null, role: "assistant", content: answer } });
      return NextResponse.json({ answer, conversationId: convId });
    }

    // Streaming path
    const aiResp = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt + (noteId ? "用户正在看某条笔记，请优先围绕它来回答。" : "") },
          ...historyMsgs,
          { role: "user", content: `我的笔记：\n${context || "（还没有笔记）"}\n\n问题：${question}` },
        ],
        max_tokens: 800, temperature: 0.7, stream: true,
      }),
    });

    if (!aiResp.ok) {
      const answer = `精灵打了个盹（${aiResp.status}）。稍后再试？`;
      await prisma.chatMessage.create({ data: { userId, conversationId: convId, noteId: noteId || null, role: "assistant", content: answer } });
      return NextResponse.json({ answer, conversationId: convId });
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
              if (line.startsWith("data: ")) {
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
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId: convId })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          if (fullAnswer) {
            prisma.chatMessage.create({
              data: { userId, conversationId: convId, noteId: noteId || null, role: "assistant", content: fullAnswer },
            }).catch((e) => console.error("[Chat] DB save fail:", e));
          }
        } catch (e: any) {
          console.error("[Chat] stream err:", e.message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "流中断了" })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e: any) {
    console.error("[Chat] err:", e.message);
    return NextResponse.json({ answer: "网络似乎不太顺畅，再试一次？" });
  }
}

// DELETE — clear conversation messages or delete whole conversation
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
  // Legacy: clear by noteId only
  await prisma.chatMessage.deleteMany({ where: { userId, noteId: noteId || null } });
  return NextResponse.json({ ok: true });
}