export type ChatMessageView = { role: string; content: string };

export function upsertStreamingAssistant(messages: ChatMessageView[], content: string): ChatMessageView[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (last?.role === "assistant") {
    updated[updated.length - 1] = { ...last, content };
    return updated;
  }
  return [...updated, { role: "assistant", content }];
}
