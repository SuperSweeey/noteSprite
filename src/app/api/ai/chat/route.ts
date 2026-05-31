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
    const contextRefs = Array.isArray(body.contextRefs) ? body.contextRefs : [];
    const temporaryLearningMode = body.temporaryLearningMode || null;

    if (!question) {
      return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
    }

    let conversationId = body.conversationId || null;
    if (!conversationId) {
      const conv = await prisma.conversation.create({ data: { userId, title: question.slice(0, 40) } });
      conversationId = conv.id;
    }

    const dbConfig = await getAIConfig(userId, "chat");
    const baseSpirit = await getSpiritConfig(userId);
    const spirit =
      temporaryLearningMode?.prompt
        ? {
            ...baseSpirit,
            learningModeId: String(temporaryLearningMode.id || baseSpirit.learningModeId),
            learningPrompt: String(temporaryLearningMode.prompt),
          }
        : baseSpirit;
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

    const context = await buildNoteContext(userId, question, noteId, contextRefs);
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
      {
        role: "system",
        content:
          systemPrompt +
          (noteId ? "\n用户正在查看某条笔记，请优先围绕当前笔记回答。" : "") +
          "\n如果本轮回答使用了笔记或知识库上下文，请在回答末尾用「参考笔记」列出本次实际参考的笔记标题或知识库名称；如果笔记里没有相关信息，要明确说暂时没在笔记里看到。",
      },
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

async function buildNoteContext(userId: string, question: string, noteId?: string, contextRefs: any[] = []): Promise<string> {
  const chunks: string[] = [];
  const mentions = extractMentions(question);
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

  for (const ref of contextRefs) {
    if (ref?.type === "knowledgeBase" && ref.id) {
      const kb = await prisma.knowledgeBase.findFirst({
        where: { userId, id: ref.id },
        include: {
          notes: {
            where: { deletedAt: null },
            orderBy: { updatedAt: "desc" },
            take: 20,
            include: { aiResult: true, tags: { include: { tag: true } } },
          },
        },
      });
      if (kb) {
        chunks.push(`【引用知识库：${kb.name}】`);
        chunks.push(formatKnowledgeBaseNotes(kb.notes));
      }
    }
    if (ref?.type === "note" && ref.id) {
      const note = await prisma.note.findFirst({
        where: { userId, id: ref.id, deletedAt: null },
        include: { aiResult: true, tags: { include: { tag: true } } },
      });
      if (note) {
        const tags = note.tags.map((nt) => `#${nt.tag.fullPath}`).join(" ");
        chunks.push(`【引用笔记：${note.title || ref.label || note.contentMd.slice(0, 40)}】`);
        chunks.push(`标签：${tags || "无"}\n正文：${note.contentMd.slice(0, 5200)}${note.aiResult?.summary ? `\n\nAI 摘要：${note.aiResult.summary.slice(0, 1200)}` : ""}`);
      }
    }
  }

  for (const mention of mentions) {
    const kb = await prisma.knowledgeBase.findFirst({
      where: { userId, name: { contains: mention } },
      include: {
        notes: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 16,
          include: { aiResult: true, tags: { include: { tag: true } } },
        },
      },
    });
    if (kb) {
      chunks.push(`【@知识库：${kb.name}】`);
      chunks.push(formatKnowledgeBaseNotes(kb.notes));
      continue;
    }

    const note = await prisma.note.findFirst({
      where: {
        userId,
        deletedAt: null,
        OR: [{ title: { contains: mention } }, { contentMd: { contains: mention } }, { plainText: { contains: mention } }],
      },
      include: { aiResult: true, tags: { include: { tag: true } } },
    });
    if (note) {
      const tags = note.tags.map((nt) => `#${nt.tag.fullPath}`).join(" ");
      chunks.push(`【@笔记：${note.title || mention}】`);
      chunks.push(`标签：${tags || "无"}\n正文：${note.contentMd.slice(0, 5000)}${note.aiResult?.summary ? `\n\nAI 摘要：${note.aiResult.summary.slice(0, 1200)}` : ""}`);
    }
  }

  const keywords = extractSearchTerms(question);
  if (keywords.length > 0) {
    const relatedNotes = await prisma.note.findMany({
      where: {
        userId,
        deletedAt: null,
        id: noteId ? { not: noteId } : undefined,
        OR: keywords.flatMap((term) => [
          { title: { contains: term } },
          { plainText: { contains: term } },
          { contentMd: { contains: term } },
          { aiResult: { is: { summary: { contains: term } } } },
          { aiResult: { is: { actionItems: { contains: term } } } },
          { tags: { some: { tag: { fullPath: { contains: term } } } } },
        ]),
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { aiResult: true, tags: { include: { tag: true } } },
    });

    if (relatedNotes.length > 0) {
      chunks.push("【按问题检索到的相关笔记】");
      chunks.push(
        relatedNotes
          .map((note) => {
            const tags = note.tags.map((nt) => `#${nt.tag.fullPath}`).join(" ");
            const report = note.aiResult?.actionItems ? `\nAI 解读摘录：${note.aiResult.actionItems.slice(0, 420)}` : "";
            return `标题：${note.title || note.contentMd.slice(0, 40)}\n标签：${tags || "无"}\n正文摘录：${note.contentMd.slice(0, 520)}${report}`;
          })
          .join("\n---\n")
          .slice(0, 4200)
      );
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

function formatKnowledgeBaseNotes(notes: any[]) {
  return notes
    .map((note) => {
      const tags = note.tags.map((nt: any) => `#${nt.tag.fullPath}`).join(" ");
      const summary = note.aiResult?.summary ? `\nAI 摘要：${note.aiResult.summary.slice(0, 360)}` : "";
      return `标题：${note.title || note.contentMd.slice(0, 40)}\n标签：${tags || "无"}\n正文摘录：${note.contentMd.slice(0, 520)}${summary}`;
    })
    .join("\n---\n")
    .slice(0, 9200);
}

function extractMentions(question: string): string[] {
  const matches = question.match(/@([^\s，。！？；：,.!?;:]+)/g) || [];
  return Array.from(new Set(matches.map((item) => item.slice(1).trim()).filter(Boolean))).slice(0, 4);
}

function extractSearchTerms(question: string): string[] {
  const cleaned = question
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const terms = new Set<string>();
  for (const item of cleaned) {
    if (item.length >= 2 && !/^(什么|怎么|如何|为什么|一下|这个|那个|请问|帮我|分析|总结)$/.test(item)) {
      terms.add(item.slice(0, 20));
    }
  }
  if (terms.size === 0 && question.trim().length >= 2) terms.add(question.trim().slice(0, 12));
  return Array.from(terms).slice(0, 5);
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
