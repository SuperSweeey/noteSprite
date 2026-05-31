import { upsertStreamingAssistant } from "../src/lib/chat-messages";

function main() {
  const first = upsertStreamingAssistant([{ role: "user", content: "55" }], "第一条回复");
  assert(first.length === 2, "第一轮必须追加 assistant");
  assert(first[1].content === "第一条回复", "第一轮 assistant 内容错误");

  const firstStreaming = upsertStreamingAssistant(first, "第一条回复更新");
  assert(firstStreaming.length === 2, "同一轮流式更新不能新增 assistant");
  assert(firstStreaming[1].content === "第一条回复更新", "同一轮必须更新最后一条 assistant");

  const secondUser = [...firstStreaming, { role: "user", content: "零食店有啥" }];
  const second = upsertStreamingAssistant(secondUser, "第二条回复");
  assert(second.length === 4, "第二轮必须新增 assistant，不能覆盖上一轮");
  assert(second[1].content === "第一条回复更新", "第二轮不能覆盖第一条 assistant");
  assert(second[3].content === "第二条回复", "第二轮 assistant 应该追加到最后");

  const thirdUser = [...second, { role: "user", content: "你在干嘛？" }];
  const third = upsertStreamingAssistant(thirdUser, "第三条回复");
  assert(third.map((item) => item.role).join("/") === "user/assistant/user/assistant/user/assistant", "消息顺序必须保持 user/assistant 交替");
  assert(third[1].content === "第一条回复更新", "第三轮不能覆盖第一条 assistant");
  assert(third[3].content === "第二条回复", "第三轮不能覆盖第二条 assistant");
  assert(third[5].content === "第三条回复", "第三轮必须追加 assistant");

  console.log("chat message regression passed");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main();
