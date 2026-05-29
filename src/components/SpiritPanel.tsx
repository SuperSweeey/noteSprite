"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { XiaoAoMark } from "@/components/XiaoAoMark";

const prompts = [
  "我看到有些想法正在慢慢连起来。等你愿意时，我们可以把它们串成一个主题。",
  "先记下来就很好，清楚不一定要发生在第一遍。",
  "这页如果你愿意，我可以陪你继续往下问一问。",
  "最近几条笔记像是在朝同一个方向靠近。",
  "我们不用急着下结论，可以先把线索摆在桌面上。",
];

interface SpiritPanelProps {
  noteId?: string;
  initialQuestion?: string;
  onInitialQuestionConsumed?: () => void;
}

export function SpiritPanel({ noteId, initialQuestion, onInitialQuestionConsumed }: SpiritPanelProps) {
  const [closed, setClosed] = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [proactive, setProactive] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const lastPromptRef = useRef<Date>(new Date());

  const loadConversations = () => {
    fetch("/api/ai/chat?list=1")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations || []))
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
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => setMessages([]));
  }, [conversationId]);

  useEffect(() => {
    if (!initialQuestion) return;
    setInput(initialQuestion);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, onInitialQuestionConsumed]);

  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = (Date.now() - lastPromptRef.current.getTime()) / 60000;
      if (elapsed >= 5 + Math.random() * 4) {
        setProactive(prompts[Math.floor(Math.random() * prompts.length)]);
        lastPromptRef.current = new Date();
        setTimeout(() => setProactive(""), 9000);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? input).trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const model = localStorage.getItem("nf_model") || undefined;
      const apiKey = localStorage.getItem("nf_api_key") || undefined;
      const baseUrl = localStorage.getItem("nf_base_url") || undefined;
      const prompt = localStorage.getItem("nf_prompt") || undefined;

      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          noteId: noteId || null,
          conversationId: conversationId || null,
          model,
          apiKey,
          baseUrl,
          prompt,
          stream: true,
        }),
      });

      if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
        const data = await resp.json();
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((m) => [...m, { role: "assistant", content: data.answer || "我刚才走神了一下，我们再试一次。" }]);
        loadConversations();
        setLoading(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

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
              setMessages((m) => {
                const updated = [...m];
                updated[updated.length - 1] = { role: "assistant", content };
                return updated;
              });
            }
            if (json.conversationId) {
              setConversationId(json.conversationId);
              loadConversations();
            }
            if (json.error) {
              setMessages((m) => {
                const updated = [...m];
                updated[updated.length - 1] = { role: "assistant", content: content || json.error };
                return updated;
              });
            }
          } catch {}
        });
      }
    } catch {
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = { role: "assistant", content: "我这里刚才晃了一下，我们再试一次。" };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowConvList(false);
  };

  const switchConversation = (id: string) => {
    setConversationId(id);
    setShowConvList(false);
  };

  const deleteConversation = async (id: string) => {
    await fetch(`/api/ai/chat?conversationId=${id}`, { method: "DELETE" });
    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }
    loadConversations();
  };

  if (closed) {
    return (
      <aside className="flex w-12 flex-col items-center border-l border-[var(--paper-border)] bg-[var(--paper-sidebar)]/70 pt-4 backdrop-blur-md">
        <button onClick={() => setClosed(false)} className="rounded-full p-1 transition-colors hover:bg-white/50" title="AI">
          <XiaoAoMark size="sm" variant="logo" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex min-h-screen w-[340px] flex-col border-l border-[var(--paper-border)] bg-[var(--paper-sidebar)]/82 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--paper-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <XiaoAoMark size="sm" variant="logo" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--ink)]">AI</p>
            <p className="truncate text-[11px] text-[var(--ink-faint)]">
              {noteId ? "陪你把这一页慢慢读懂。" : "陪你把笔记慢慢理清楚。"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowConvList(!showConvList)} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-faint)] hover:bg-white/50 hover:text-[var(--accent-blue)]" title="对话记录">
            ☰
          </button>
          <button onClick={newConversation} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-faint)] hover:bg-white/50 hover:text-[var(--accent-blue)]" title="新对话">
            +
          </button>
          <button onClick={() => setClosed(true)} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-faint)] hover:bg-white/50 hover:text-[var(--ink)]" title="收起">
            ×
          </button>
        </div>
      </div>

      {showConvList && (
        <div className="max-h-[220px] overflow-y-auto border-b border-[var(--paper-border)] bg-white/70">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-[var(--ink-faint)]">
            <span>对话记录</span>
            <button onClick={newConversation} className="text-[var(--accent-blue)]">
              + 新建
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--ink-faint)]">还没有留下对话。</p>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-white ${
                  conversation.id === conversationId ? "bg-white" : ""
                }`}
                onClick={() => switchConversation(conversation.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[var(--ink)]">{conversation.messages?.[0]?.content?.slice(0, 40) || "新的对话"}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                    {new Date(conversation.updatedAt).toLocaleString("zh-CN", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conversation.id);
                  }}
                  className="ml-2 shrink-0 text-xs text-red-400 hover:underline"
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {proactive && (
        <div className="mx-4 mt-3 rounded-[8px] border border-white bg-white/70 p-3 text-sm leading-relaxed text-[var(--ink-light)] animate-fade-up">
          <div className="mb-1 flex items-center gap-2">
            <XiaoAoMark size="sm" variant="logo" />
            <span className="text-xs text-[var(--ink-faint)]">AI 轻轻提醒</span>
          </div>
          {proactive}
        </div>
      )}

      <div ref={chatRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="pt-8 text-center">
            <div className="mx-auto mb-3 flex w-full justify-center">
              <div className="rounded-[8px] border border-white bg-white/70 px-4 py-3 shadow-[0_14px_32px_rgba(95,143,255,0.12)]">
                <div className="flex items-center gap-3">
                  <XiaoAoMark size="md" variant="portrait" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-[var(--ink)]">AI</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
                      {noteId ? "我正在陪你看这一页。想从哪里开始聊？" : "把最近的念头丢给我，我陪你一起理。"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={`text-sm leading-relaxed ${message.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
            <div
              className={`max-w-[92%] rounded-[8px] px-3 py-2.5 ${
                message.role === "user"
                  ? "bg-blue-50 text-[var(--ink)] shadow-[0_10px_24px_rgba(95,143,255,0.10)]"
                  : "border border-white bg-white/75 text-[var(--ink-light)] shadow-[0_12px_28px_rgba(95,143,255,0.13)]"
              }`}
            >
              {message.role === "assistant" ? <MarkdownView content={message.content} /> : message.content}
            </div>
          </div>
        ))}

        {loading && !(messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content) && (
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--ink-faint)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
            AI 正在想一想...
          </div>
        )}
      </div>

      <div className="border-t border-[var(--paper-border)] p-3">
        <div className="flex items-center gap-1.5">
          <input
            className="flex-1 rounded-[8px] border border-white bg-white/78 px-3 py-2.5 text-sm text-[var(--ink)] outline-none"
            style={{ fontFamily: "inherit" }}
            placeholder={noteId ? "围绕这一页继续问问 AI..." : "问问 AI..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white transition-all active:scale-95 disabled:opacity-25"
            style={{ background: "linear-gradient(180deg, #7aa9ff 0%, #5a83f0 100%)" }}
            title="发送"
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  );
}
