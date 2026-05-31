import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/lib/prisma";

const PORT = 43187;
const baseUrl = `http://127.0.0.1:${PORT}/v1`;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function startMockModel() {
  const requests: any[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const body = await readBody(req);
    requests.push(body);
    const userContent = body.messages?.findLast?.((m: any) => m.role === "user")?.content || "";

    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "<think>private</think>" } }] })}\n\n`);
      const content = userContent.includes("知识库总笔记数：2") ? "这个知识库有 2 条笔记。" : userContent.includes("引用笔记") ? "只回答引用笔记" : "最终回答";
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      if (userContent.includes("流式截断")) {
        res.write(`data: ${JSON.stringify({ choices: [{ finish_reason: "length", delta: {} }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (userContent.includes("截断测试")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "半截解读 **" } }] }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    const content = userContent.includes("知识库总笔记数：2") ? "这个知识库有 2 条笔记。" : "<think>secret</think>完整解读";
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }));
  });
  return new Promise<{ close: () => Promise<void>; requests: any[] }>((resolve) => {
    server.listen(PORT, "127.0.0.1", () => {
      resolve({
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function main() {
  const mock = await startMockModel();
  const user = await prisma.user.upsert({
    where: { email: "dev@noteflow.local" },
    update: {},
    create: { email: "dev@noteflow.local", name: "Dev User" },
  });
  const settings = {
    providers: [{ id: "mock", name: "Mock", apiKey: "sk-mock-model-key-123456", baseUrl, models: ["mock-model"] }],
    assignments: {
      chat: { providerId: "mock", model: "mock-model" },
      analysis: { providerId: "mock", model: "mock-model" },
      report: { providerId: "mock", model: "mock-model" },
      vision: { providerId: "mock", model: "mock-model" },
    },
    prompts: { chat: "", analysis: "", report: "" },
  };
  const oldSettings = user.settings;
  await prisma.user.update({ where: { id: user.id }, data: { settings: JSON.stringify(settings) } });

  const current = await prisma.note.create({
    data: { userId: user.id, title: "当前页面笔记", contentMd: "当前页面内容，不应该压过引用。", plainText: "当前页面内容" },
  });
  const ref = await prisma.note.create({
    data: { userId: user.id, title: "引用笔记", contentMd: "引用笔记内容，应该优先回答。", plainText: "引用笔记内容" },
  });
  const reportNote = await prisma.note.create({
    data: { userId: user.id, title: "截断测试", contentMd: "截断测试 ".repeat(80), plainText: "截断测试" },
  });
  const kb = await prisma.knowledgeBase.create({
    data: { userId: user.id, name: "数量测试知识库", description: "kb count regression" },
  });
  const kbNoteA = await prisma.note.create({
    data: { userId: user.id, knowledgeBaseId: kb.id, title: "知识库笔记 A", contentMd: "A", plainText: "A" },
  });
  const kbNoteB = await prisma.note.create({
    data: { userId: user.id, knowledgeBaseId: kb.id, title: "知识库笔记 B", contentMd: "B", plainText: "B" },
  });

  try {
    const chatResp = await fetch("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "请回答我引用的内容",
        noteId: current.id,
        contextRefs: [{ type: "note", id: ref.id, label: ref.title }],
        stream: false,
      }),
    });
    const chatData = await chatResp.json();
    assert(!String(chatData.answer).includes("private"), "聊天回答不能泄露 think 内容");
    const chatRequest = mock.requests.find((item) => item.stream === undefined);
    const userMessage = chatRequest.messages.findLast((m: any) => m.role === "user").content;
    assert(userMessage.indexOf("【引用笔记") >= 0, "@ 引用必须进入上下文");
    assert(!userMessage.includes("【当前页面笔记】"), "有 @ 引用时不能默认注入当前页面笔记");

    const kbResp = await fetch("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "这个知识库里有几条笔记",
        contextRefs: [{ type: "knowledgeBase", id: kb.id, label: kb.name }],
        stream: false,
      }),
    });
    const kbData = await kbResp.json();
    assert(String(kbData.answer).includes("2 条"), "@ 知识库询问数量必须能回答总笔记数");
    const kbRequest = mock.requests.find((item) => JSON.stringify(item).includes("数量测试知识库"));
    const kbUserMessage = kbRequest.messages.findLast((m: any) => m.role === "user").content;
    assert(kbUserMessage.includes("知识库总笔记数：2"), "@ 知识库上下文必须包含总笔记数");
    assert(kbUserMessage.includes("本次注入笔记数：2"), "@ 知识库上下文必须包含本次注入数");

    const reportResp = await fetch("http://localhost:3000/api/ai/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId: reportNote.id, force: true }),
    });
    const reportData = await reportResp.json();
    assert(reportData.truncated === true, "finish_reason=length 必须标记为截断");
    const saved = await prisma.aIResult.findUnique({ where: { noteId: reportNote.id } });
    assert(!saved?.actionItems?.includes("半截解读"), "截断解读不能保存为完成内容");

    const streamResp = await fetch("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "流式截断", stream: true }),
    });
    const streamText = await streamResp.text();
    assert(streamText.includes("长度上限截断"), "流式聊天截断必须提示用户");
    assert(!streamText.includes("private"), "流式聊天不能泄露 think 内容");

    const listBeforeDelete = await fetch("http://localhost:3000/api/ai/chat?list=1&limit=10");
    const listData = await listBeforeDelete.json();
    const deletable = listData.conversations?.find((item: any) => item.title?.includes("这个知识库里有几条笔记"));
    assert(deletable?.id, "必须能找到要删除的历史对话");
    const deleteResp = await fetch(`http://localhost:3000/api/ai/chat?conversationId=${deletable.id}`, { method: "DELETE" });
    assert(deleteResp.ok, "删除历史对话接口必须成功");
    const deletedMessages = await prisma.chatMessage.count({ where: { conversationId: deletable.id } });
    assert(deletedMessages === 0, "删除历史对话必须清掉消息");

    console.log("ai context regression passed");
  } finally {
    const noteIds = [current.id, ref.id, reportNote.id, kbNoteA.id, kbNoteB.id];
    await prisma.aIResult.deleteMany({ where: { noteId: { in: noteIds } } });
    await prisma.chatMessage.deleteMany({ where: { userId: user.id, noteId: { in: noteIds } } });
    await prisma.conversation.deleteMany({ where: { userId: user.id, OR: [{ title: { contains: "请回答我引用的内容" } }, { title: { contains: "流式截断" } }, { title: { contains: "这个知识库里有几条笔记" } }] } });
    await prisma.note.deleteMany({ where: { id: { in: noteIds } } });
    await prisma.knowledgeBase.deleteMany({ where: { id: kb.id } });
    await prisma.user.update({ where: { id: user.id }, data: { settings: oldSettings } });
    await mock.close();
    await prisma.$disconnect();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
