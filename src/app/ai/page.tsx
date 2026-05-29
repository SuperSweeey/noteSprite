"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MarkdownView } from "@/components/MarkdownView";

const suggestions = [
  { icon: "📊", text: "帮我梳理一下，最近都在关注哪些主题？" },
  { icon: "🔗", text: "我笔记里有没有相互矛盾的观点？" },
  { icon: "⏳", text: "看看我一周前在思考什么？" },
  { icon: "🪞", text: "有哪些旧笔记，值得现在重新翻开？" },
  { icon: "💡", text: "根据我的笔记，给我一个值得思考的问题" },
  { icon: "✍️", text: "帮我写一段总结，概括我最近的思考" },
];

export default function AIPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Load conversations list
  const loadConversations = () => {
    fetch("/api/ai/chat?list=1")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations || []));
  };
  useEffect(() => { loadConversations(); }, []);

  // Load messages for current conversation
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    fetch(`/api/ai/chat?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []));
  }, [conversationId]);

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async (text?: string) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput(""); setLoading(true);

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversationId: conversationId || null, stream: true }),
      });

      if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
        const data = await resp.json();
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((m) => [...m, { role: "assistant", content: data.answer || "..." }]);
        loadConversations();
        setLoading(false);
        return;
      }

      // Streaming
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decoder.decode(value, { stream: true }).split("\n").forEach((line) => {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;
            try {
              const json = JSON.parse(data);
              if (json.content) {
                content += json.content;
                setMessages((m) => { const u = [...m]; u[u.length - 1] = { role: "assistant", content }; return u; });
              }
              if (json.conversationId) { setConversationId(json.conversationId); loadConversations(); }
              if (json.error) {
                setMessages((m) => { const u = [...m]; u[u.length - 1] = { role: "assistant", content: content || json.error }; return u; });
              }
            } catch {}
          }
        });
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "网络不太顺畅..." }]);
    } finally { setLoading(false); }
  };

  const newConversation = () => { setConversationId(null); setMessages([]); setShowConvList(false); };
  const switchConversation = (id: string) => { setConversationId(id); setShowConvList(false); };
  const deleteConversation = async (id: string) => {
    await fetch(`/api/ai/chat?conversationId=${id}`, { method: "DELETE" });
    if (conversationId === id) { setConversationId(null); setMessages([]); }
    loadConversations();
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col bg-[var(--paper-bg)]">
        {/* Header with conversation controls */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--paper-border)] bg-[var(--paper-card)]">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧚</span>
            <span className="text-sm font-medium text-[var(--ink)]">笔记精灵</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowConvList(!showConvList)} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] px-2 py-1 rounded transition-colors" title="对话列表">☰ 历史</button>
            <button onClick={newConversation} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] px-2 py-1 rounded transition-colors" title="新建对话">+ 新建</button>
          </div>
        </div>

        {/* Conversation list dropdown */}
        {showConvList && (
          <div className="border-b border-[var(--paper-border)] bg-[var(--paper-card)] max-h-[240px] overflow-y-auto shadow-sm">
            <div className="px-4 py-2 text-xs text-[var(--ink-faint)] flex items-center justify-between">
              <span>对话记录</span>
              <button onClick={newConversation} className="text-[var(--gold)]">+ 新建</button>
            </div>
            {conversations.length === 0 ? (
              <p className="px-4 py-6 text-xs text-[var(--ink-faint)] text-center">还没有对话记录</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--paper-hover)] text-sm transition-colors ${c.id === conversationId ? "bg-[var(--gold-light)]" : ""}`}
                  onClick={() => switchConversation(c.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--ink)] truncate">{c.messages?.[0]?.content?.slice(0, 50) || "新对话"}</p>
                    <p className="text-xs text-[var(--ink-faint)] mt-0.5">{new Date(c.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                    className="text-xs text-red-400 hover:underline ml-3 shrink-0"
                  >删除</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Messages area */}
        <div ref={chatRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-6 py-6 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center pt-16 pb-8">
                <p className="text-4xl mb-4">🧚</p>
                <h1 className="text-xl font-medium text-[var(--ink)] font-prose">笔记精灵</h1>
                <p className="text-sm text-[var(--ink-faint)] mt-2 leading-relaxed">
                  我读过了你的笔记。<br />需要时唤我，不扰你。
                </p>
                <div className="mt-8 space-y-2.5">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => send(s.text)}
                      className="paper-card w-full text-left px-5 py-3.5 text-sm text-[var(--ink-light)] hover:border-[var(--gold)] transition-colors"
                    >{s.icon} {s.text}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fade-up`}>
                  <div className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-[var(--gold-light)] text-[var(--ink)] rounded-2xl rounded-br-sm"
                      : "paper-card rounded-2xl rounded-bl-sm"
                  }`}>
                    {m.role === "assistant" ? <MarkdownView content={m.content} /> : m.content}
                  </div>
                </div>
              ))
            )}
            {loading && !(messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content) && (
              <div className="flex justify-start animate-fade-up">
                <div className="paper-card px-5 py-3.5 flex items-center gap-2 text-sm text-[var(--ink-faint)] rounded-2xl rounded-bl-sm">
                  <span className="w-3 h-3 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />思考中...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-[var(--paper-border)] bg-[var(--paper-card)]">
          <div className="max-w-[720px] mx-auto px-6 py-4 flex items-center gap-2">
            <input
              className="flex-1 px-4 py-3 text-sm rounded-xl outline-none border border-[var(--paper-border)] bg-[var(--paper-bg)] text-[var(--ink)]"
              style={{ fontFamily: "inherit" }}
              placeholder="问笔记精灵..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 flex items-center justify-center rounded-full text-white transition-all active:scale-95 disabled:opacity-25"
              style={{ background: "var(--gold)" }}
            >↑</button>
          </div>
        </div>
      </main>
    </div>
  );
}