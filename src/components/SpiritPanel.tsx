"use client";

import { useState, useEffect, useRef } from "react";
import { MarkdownView } from "@/components/MarkdownView";

const prompts = [
  "看到你的笔记在慢慢生长，真好。",
  "有些想法放久了会自己发酵。回看一周前的笔记？",
  "「写下来的东西不会消失。偶尔翻翻旧笔记，会有惊喜。」",
  "灵感像种子，写下来才算种下。",
  "你最近写的东西，好像在某个方向越走越深了。",
  "要不要停下来，跟精灵聊聊你最近的想法？",
];

function now() { return new Date(); }
let lastPrompt = now();

export function SpiritPanel({ noteId }: { noteId?: string }) {
  const [closed, setClosed] = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [proactive, setProactive] = useState("");
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
    if (!conversationId) {
      setMessages([]);
      return;
    }
    fetch(`/api/ai/chat?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []));
  }, [conversationId]);

  // Proactive prompts
  useEffect(() => {
    const check = () => {
      const elapsed = (now().getTime() - lastPrompt.getTime()) / 60000;
      if (elapsed >= 5 + Math.random() * 5) {
        setProactive(prompts[Math.floor(Math.random() * prompts.length)]);
        lastPrompt = now();
        setTimeout(() => setProactive(""), 10000);
      }
    };
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput(""); setLoading(true);

    try {
      const model = (typeof localStorage !== "undefined" && localStorage.getItem("nf_model")) || undefined;
      const apiKey = (typeof localStorage !== "undefined" && localStorage.getItem("nf_api_key")) || undefined;
      const baseUrl = (typeof localStorage !== "undefined" && localStorage.getItem("nf_base_url")) || undefined;
      const prompt = (typeof localStorage !== "undefined" && localStorage.getItem("nf_prompt")) || undefined;

      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q, noteId: noteId || null, conversationId: conversationId || null,
          model: model || undefined, apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined, prompt: prompt || undefined, stream: true,
        }),
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
      setMessages((m) => { const u = [...m]; u[u.length - 1] = { role: "assistant", content: "网络不太顺畅..." }; return u; });
    } finally { setLoading(false); }
  };

  const newConversation = () => { setConversationId(null); setMessages([]); setShowConvList(false); };
  const switchConversation = (id: string) => { setConversationId(id); setShowConvList(false); };
  const deleteConversation = async (id: string) => {
    await fetch(`/api/ai/chat?conversationId=${id}`, { method: "DELETE" });
    if (conversationId === id) { setConversationId(null); setMessages([]); }
    loadConversations();
  };

  if (closed) {
    return (
      <aside className="w-11 flex flex-col items-center pt-4 border-l border-[var(--paper-border)] bg-[var(--paper-sidebar)]/50">
        <button onClick={() => setClosed(false)} className="text-lg text-[var(--ink-faint)] hover:text-[var(--gold)] transition-colors" title="笔记精灵">🧚</button>
      </aside>
    );
  }

  return (
    <aside className="w-[320px] min-h-screen flex flex-col bg-[var(--paper-sidebar)] border-l border-[var(--paper-border)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--paper-border)]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧚</span>
          <span className="text-sm font-medium text-[var(--ink)]">笔记精灵</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowConvList(!showConvList)} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] px-1.5 py-0.5 rounded" title="对话列表">☰</button>
          <button onClick={newConversation} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] px-1.5 py-0.5 rounded" title="新建对话">+</button>
          <button onClick={() => setClosed(true)} className="text-[var(--ink-faint)] hover:text-[var(--ink)] px-1">✕</button>
        </div>
      </div>

      {/* Conversation list dropdown */}
      {showConvList && (
        <div className="border-b border-[var(--paper-border)] bg-[var(--paper-card)] max-h-[200px] overflow-y-auto">
          <div className="px-3 py-2 text-xs text-[var(--ink-faint)] flex items-center justify-between">
            <span>对话记录</span>
            <button onClick={newConversation} className="text-[var(--gold)]">+ 新建</button>
          </div>
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-xs text-[var(--ink-faint)] text-center">还没有对话记录</p>
          ) : (
            conversations.map((c) => (
              <div key={c.id} className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--paper-hover)] text-sm ${c.id === conversationId ? "bg-[var(--gold-light)]" : ""}`} onClick={() => switchConversation(c.id)}>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--ink)] truncate">{c.messages?.[0]?.content?.slice(0, 40) || "新对话"}</p>
                  <p className="text-xs text-[var(--ink-faint)]">{new Date(c.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} className="text-xs text-red-400 hover:underline ml-2 shrink-0">删除</button>
              </div>
            ))
          )}
        </div>
      )}

      {proactive && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-[var(--gold-light)] border border-[var(--gold)]/20 text-sm text-[var(--ink-light)] leading-relaxed animate-fade-up">🧚 {proactive}</div>
      )}

      <div ref={chatRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="text-center pt-8">
            <p className="text-2xl mb-2">🧚</p>
            <p className="text-sm text-[var(--ink)] font-prose">笔记精灵</p>
            <p className="text-xs text-[var(--ink-faint)] mt-1">{noteId ? "正在看这条笔记，想问什么？" : "随时可以问我关于笔记的问题"}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed ${m.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
            <div className={`max-w-[92%] px-3 py-2 rounded-xl ${
              m.role === "user"
                ? "bg-[var(--gold-light)] text-[var(--ink)] rounded-br-sm"
                : "bg-[var(--paper-card)] text-[var(--ink-light)] border border-[var(--paper-border)] rounded-bl-sm"
            }`}>
              {m.role === "assistant" ? <MarkdownView content={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {loading && !(messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content) && (
          <div className="flex items-center gap-2 text-xs text-[var(--ink-faint)] px-1"><span className="w-3 h-3 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />思考中...</div>
        )}
      </div>

      <div className="p-3 border-t border-[var(--paper-border)]">
        <div className="flex items-center gap-1.5">
          <input className="flex-1 px-3 py-2 text-sm rounded-xl outline-none border border-[var(--paper-border)] bg-[var(--paper-card)] text-[var(--ink)]" style={{ fontFamily: "inherit" }} placeholder={noteId ? "基于这条笔记提问..." : "问笔记精灵..."} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <button onClick={send} disabled={!input.trim() || loading} className="w-8 h-8 flex items-center justify-center rounded-full text-white transition-all active:scale-95 disabled:opacity-25" style={{ background: "var(--gold)" }}>↑</button>
        </div>
      </div>
    </aside>
  );
}