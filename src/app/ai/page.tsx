"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MarkdownView } from "@/components/MarkdownView";
import { XiaoAoMark } from "@/components/XiaoAoMark";

const suggestions = [
  "帮我串一下最近几页笔记，看看它们在说什么。",
  "这些笔记里有没有互相呼应的主题？",
  "从这周的笔记里，给我一个值得继续想的问题。",
  "哪些旧笔记值得今天重新翻开？",
  "根据我的笔记，帮我看清最近在往哪个方向走。",
  "帮我写一段近期总结。",
];

export default function AIPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const loadConversations = () => {
    fetch("/api/ai/chat?list=1")
      .then((resp) => resp.json())
      .then((data) => setConversations(data.conversations || []))
      .catch(() => setConversations([]));
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    fetch(`/api/ai/chat?conversationId=${conversationId}`)
      .then((resp) => resp.json())
      .then((data) => setMessages(data.messages || []));
  }, [conversationId]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;
    setMessages((current) => [...current, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId: conversationId || null, stream: true }),
      });

      if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
        const data = await resp.json();
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((current) => [...current, { role: "assistant", content: data.answer || "精灵刚才停了一下，我们再试一次。" }]);
        loadConversations();
        setLoading(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      setMessages((current) => [...current, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decoder.decode(value, { stream: true }).split("\n").forEach((line) => {
          if (!line.startsWith("data: ")) return;
          const payload = line.slice(6);
          if (payload === "[DONE]") return;
          try {
            const json = JSON.parse(payload);
            if (json.content) {
              content += json.content;
              setMessages((current) => {
                const updated = [...current];
                updated[updated.length - 1] = { role: "assistant", content };
                return updated;
              });
            }
            if (json.conversationId) {
              setConversationId(json.conversationId);
              loadConversations();
            }
          } catch {}
        });
      }
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "连接不太稳，我们再试一次。" }]);
    } finally {
      setLoading(false);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowConvList(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col bg-[var(--paper-bg)]">
        <header className="border-b border-[var(--paper-border)] bg-white/70 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[900px] items-center justify-between">
            <div className="flex items-center gap-3">
              <XiaoAoMark size="md" variant="logo" />
              <div>
                <h1 className="text-lg font-semibold text-[var(--ink)]">精灵助手</h1>
                <p className="text-xs text-[var(--ink-faint)]">围绕你的真实笔记，整理、追问、连接。</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowConvList(!showConvList)} className="rounded-[8px] border border-[var(--paper-border)] bg-white px-3 py-1.5 text-sm text-[var(--ink-light)]">
                历史
              </button>
              <button onClick={newConversation} className="rounded-[8px] bg-[var(--ink)] px-3 py-1.5 text-sm text-white">
                新对话
              </button>
            </div>
          </div>
        </header>

        {showConvList && (
          <section className="border-b border-[var(--paper-border)] bg-white/60">
            <div className="mx-auto max-h-[230px] max-w-[900px] overflow-y-auto px-6 py-3">
              {conversations.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--ink-faint)]">还没有对话。</p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => {
                      setConversationId(conversation.id);
                      setShowConvList(false);
                    }}
                    className="mb-2 block w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-4 py-3 text-left text-sm hover:bg-[var(--paper-soft)]"
                  >
                    <p className="truncate text-[var(--ink)]">{conversation.messages?.[0]?.content?.slice(0, 70) || "新的对话"}</p>
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">{new Date(conversation.updatedAt).toLocaleString("zh-CN")}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        <div ref={chatRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] px-6 py-8">
            {messages.length === 0 ? (
              <section className="paper-card p-7">
                <h2 className="text-2xl font-semibold text-[var(--ink)]">你想和笔记聊什么？</h2>
                <p className="mt-2 max-w-[560px] text-sm leading-7 text-[var(--ink-faint)]">
                  精灵会优先从你的笔记里找线索。它可以帮你串主题、找关联、生成问题，也可以陪你把一个模糊想法理清楚。
                </p>
                <div className="mt-7 grid gap-2 md:grid-cols-2">
                  {suggestions.map((item) => (
                    <button
                      key={item}
                      onClick={() => send(item)}
                      className="rounded-[10px] border border-[var(--paper-border)] bg-white px-4 py-3 text-left text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)]"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] rounded-[12px] px-4 py-3 text-sm leading-7 ${
                      message.role === "user" ? "bg-[var(--ink)] text-white" : "border border-[var(--paper-border)] bg-white text-[var(--ink)]"
                    }`}>
                      {message.role === "assistant" ? <MarkdownView content={message.content} /> : message.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-[12px] border border-[var(--paper-border)] bg-white px-4 py-3 text-sm text-[var(--ink-faint)]">
                      AI 正在思考...
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-[var(--paper-border)] bg-white/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[900px] items-center gap-2 px-6 py-4">
            <input
              className="flex-1 rounded-[12px] border border-[var(--paper-border)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent-blue)]"
              placeholder="问问你的 AI..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button onClick={() => send()} disabled={!input.trim() || loading} className="rounded-[12px] bg-[var(--ink)] px-4 py-3 text-sm text-white disabled:opacity-35">
              发送
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
