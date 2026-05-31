import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSpiritPrompt, getAIConfig, getSpiritConfig } from "@/lib/ai-config";
import { cleanAIOutput, modelWasTruncated } from "@/lib/ai-output";

const CHAT_MAX_TOKENS = 2600;

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId") || undefined;
    const listConversations = url.searchParams.get("list") === "1";

    if (listConversations) {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);
      const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
      const where = { userId };
      const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
          include: { messages: { take: 1, orderBy: { createdAt: "asc" }, select: { content: true } } },
        }),
        prisma.conversation.count({ where }),
      ]);
      return NextResponse.json({ conversations, total, hasMore: offset + conversations.length < total });
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
      "用户正在和你对话。请只依据本轮明确提供的上下文回答：如果用户点了 @ 引用，优先回答 @ 引用内容；如果没有 @ 但在笔记详情页，才围绕当前页面笔记回答。不要假装存在上一轮对话，不要说“顺着刚刚/继续刚才”，除非历史消息里真的有相关内容。输出最终回答即可，不要展示思考过程。"
    );
    const systemPrompt = [injectedPrompt, dbConfig.prompt, String(body.prompt || "").trim()].filter(Boolean).join("\n\n");

    if (!apiKey) {
      return NextResponse.json({
        answer: "我还没有拿到可用的模型密钥。请在设置里重新填写模型 Key，或检查 .env 里的 DEEPSEEK_API_KEY。",
        conversationId,
        authError: true,
        persist: false,
      });
    }

    const context = await buildNoteContext(userId, question, noteId, contextRefs);
    const history = conversationId
      ? await prisma.chatMessage.findMany({
          where: { userId, conversationId },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [];
    const historyMsgs = history.reverse().map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const messages = [
      {
        role: "system",
        content:
          systemPrompt +
          "\n上下文优先级：1. 本轮 @ 引用；2. 当前页面笔记；3. 已存在的同一对话历史。没有明确提供的内容不要补造。回答末尾只在确实使用了笔记或知识库时用「参考笔记」列出来源；如果上下文没有相关信息，要明确说暂时没在笔记里看到。",
      },
      ...historyMsgs,
      {
        role: "user",
        content: `我的笔记上下文：\n${context || "（还没有可用笔记上下文）"}\n\n我的问题：${question}`,
      },
    ];

    if (body.stream === false) {
      const result = await callModel({ baseUrl, apiKey, model, messages, maxTokens: CHAT_MAX_TOKENS });
      if (!result.ok) {
        return NextResponse.json({
          answer: formatModelConnectionError(result.status, result.text),
          conversationId,
          authError: isAuthStatus(result.status),
          persist: false,
        });
      }
      conversationId = await ensureConversation(userId, conversationId, question);
      await prisma.chatMessage.create({
        data: { userId, conversationId, noteId: noteId || null, role: "user", content: question },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      await prisma.chatMessage.create({
        data: { userId, conversationId, noteId: noteId || null, role: "assistant", content: cleanAIOutput(result.answer) },
      });
      return NextResponse.json({ answer: cleanAIOutput(result.answer), conversationId });
    }

    const aiResp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: CHAT_MAX_TOKENS, temperature: 0.65, stream: true }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      return NextResponse.json({
        answer: formatModelConnectionError(aiResp.status, text),
        conversationId,
        authError: isAuthStatus(aiResp.status),
        persist: false,
      });
    }

    conversationId = await ensureConversation(userId, conversationId, question);
    await prisma.chatMessage.create({
      data: { userId, conversationId, noteId: noteId || null, role: "user", content: question },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    const encoder = new TextEncoder();
    let fullAnswer = "";
    let truncated = false;
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
                const choice = json.choices?.[0] || {};
                if (modelWasTruncated(choice)) truncated = true;
                const delta = choice.delta?.content;
                if (delta) {
                  fullAnswer += delta;
                  const cleanFull = cleanAIOutput(fullAnswer);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: cleanFull, replace: true })}\n\n`));
                }
              } catch {}
            }
          }

          const cleanAnswer = cleanAIOutput(fullAnswer);
          if (truncated) {
            const warning = `${cleanAnswer}\n\n> 这次回答被模型长度上限截断了，没有完整结束。可以把问题拆小一点，或在设置里换用更大输出长度的模型后重试。`.trim();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: warning, replace: true, truncated: true })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          if (cleanAnswer) {
            prisma.chatMessage.create({
              data: { userId, conversationId, noteId: noteId || null, role: "assistant", content: truncated ? `${cleanAnswer}\n\n> 这次回答被模型长度上限截断了。` : cleanAnswer },
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
  const hasExplicitContext = contextRefs.length > 0 || mentions.length > 0;

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
          _count: { select: { notes: { where: { deletedAt: null } } } },
        },
      });
      if (kb) {
        chunks.push(`【引用知识库：${kb.name}】`);
        chunks.push(`知识库名称：${kb.name}\n知识库总笔记数：${kb._count.notes}\n本次注入笔记数：${kb.notes.length}\n规则：如果用户询问这个知识库有几条笔记，直接回答“${kb._count.notes} 条”。`);
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

  if (!hasExplicitContext && noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId }, include: { aiResult: true } });
    if (note) {
      chunks.push("【当前页面笔记】");
      chunks.push(note.contentMd.slice(0, 6000));
      if (note.aiResult?.actionItems) {
        chunks.push(`\n【已有 AI 解读】\n${cleanAIOutput(note.aiResult.actionItems).slice(0, 2400)}`);
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
        _count: { select: { notes: { where: { deletedAt: null } } } },
      },
    });
    if (kb) {
      chunks.push(`【@知识库：${kb.name}】`);
      chunks.push(`知识库名称：${kb.name}\n知识库总笔记数：${kb._count.notes}\n本次注入笔记数：${kb.notes.length}\n规则：如果用户询问这个知识库有几条笔记，直接回答“${kb._count.notes} 条”。`);
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

  const shouldSearchRelated = !hasExplicitContext && !noteId && wantsRelatedNotes(question);
  const keywords = shouldSearchRelated ? extractSearchTerms(question) : [];
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

  if (!hasExplicitContext && !noteId && wantsRecentNotes(question)) {
    const recentNotes = await prisma.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { title: true, contentMd: true, createdAt: true },
    });
    const recentContext = recentNotes
      .map((note) => {
        const date = new Date(note.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
        return `[${date}] ${note.title || note.contentMd.slice(0, 40)}\n${note.contentMd.slice(0, 280)}`;
      })
      .join("\n---\n")
      .slice(0, 2600);

    if (recentContext) {
      chunks.push("【最近笔记】");
      chunks.push(recentContext);
    }
  }

  return chunks.join("\n\n");
}

function wantsRecentNotes(question: string): boolean {
  return /最近|近期|这周|这一周|今天|昨天|全部笔记|所有笔记|时间线|timeline/i.test(question);
}

function wantsRelatedNotes(question: string): boolean {
  return /相关|关联|连接|呼应|找.*笔记|搜.*笔记|检索|主题|知识库|总结|分析/.test(question);
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

async function ensureConversation(userId: string, conversationId: string | null, question: string) {
  if (conversationId) {
    const existing = await prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
    if (existing) return existing.id;
  }
  const conv = await prisma.conversation.create({ data: { userId, title: question.slice(0, 40) || "新对话" } });
  return conv.id;
}

function isAuthStatus(status: number) {
  return status === 401 || status === 403;
}

function formatModelConnectionError(status: number, text: string) {
  if (isAuthStatus(status)) {
    return `模型鉴权失败（HTTP ${status}）。请到设置页重新检测模型 Key、接口地址和模型名称；这次失败不会写入历史记录。${text.slice(0, 120)}`;
  }
  return `AI 刚才没连上模型（HTTP ${status}）。这次失败不会写入历史记录。${text.slice(0, 160)}`;
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
}): Promise<{ ok: true; answer: string } | { ok: false; status: number; text: string }> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.65 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, status: resp.status, text };
  }
  const json = await resp.json();
  return { ok: true, answer: cleanAIOutput(json.choices?.[0]?.message?.content || "") };
}
