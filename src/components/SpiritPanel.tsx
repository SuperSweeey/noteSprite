"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { XiaoAoMark } from "@/components/XiaoAoMark";
import { upsertStreamingAssistant } from "@/lib/chat-messages";
import { stripMarkdown } from "@/lib/tags";

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
  const [closed, setClosed] = useState(true);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [proactive, setProactive] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionTab, setMentionTab] = useState<"kb" | "note">("kb");
  const [mentionQuery, setMentionQuery] = useState("");
  const [bases, setBases] = useState<any[]>([]);
  const [candidateNotes, setCandidateNotes] = useState<any[]>([]);
  const [contextRefs, setContextRefs] = useState<{ type: "knowledgeBase" | "note"; id: string; label: string }[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const lastPromptRef = useRef<Date>(new Date());
  const streamingRef = useRef(false);

  const loadConversations = () => {
    fetch("/api/ai/chat?list=1")
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations || []))
      .catch(() => setConversations([]));
  };

  useEffect(() => {
    if (closed) return;
    loadConversations();
    fetch("/api/knowledge-bases")
      .then((r) => r.json())
      .then((d) => setBases(d.bases || []))
      .catch(() => setBases([]));
    fetch("/api/notes?limit=40&sort=updated&compact=1")
      .then((r) => r.json())
      .then((d) => setCandidateNotes(d.notes || []))
      .catch(() => setCandidateNotes([]));
  }, [closed]);

  useEffect(() => {
    if (closed) return;
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (streamingRef.current) return;
    fetch(`/api/ai/chat?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages || []))
      .catch(() => setMessages([]));
  }, [conversationId, closed]);

  useEffect(() => {
    if (!initialQuestion) return;
    setClosed(false);
    setInput(initialQuestion);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, onInitialQuestionConsumed]);

  useEffect(() => {
    if (closed) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - lastPromptRef.current.getTime()) / 60000;
      if (elapsed >= 5 + Math.random() * 4) {
        setProactive(prompts[Math.floor(Math.random() * prompts.length)]);
        lastPromptRef.current = new Date();
        setTimeout(() => setProactive(""), 9000);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [closed]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? input).trim();
    if (!question || loading) return;
    const refs = contextRefs;
    const refText = refs.map((ref) => `@${ref.label}`).join(" ");
    const displayQuestion = refText ? `${refText}\n${question}` : question;
    setMessages((m) => [...m, { role: "user", content: displayQuestion }]);
    setInput("");
    setContextRefs([]);
    setShowMentionPicker(false);
    setLoading(true);
    streamingRef.current = true;

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          noteId: noteId || null,
          contextRefs: refs,
          conversationId: conversationId || null,
          stream: true,
        }),
      });

      if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
        const data = await resp.json();
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((m) => upsertStreamingAssistant(m, data.answer || "我刚才走神了一下，我们再试一次。"));
        loadConversations();
        setLoading(false);
        streamingRef.current = false;
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const payload = event
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            if (json.content) {
              content = json.replace ? json.content : content + json.content;
              setMessages((m) => upsertStreamingAssistant(m, content));
            }
            if (json.conversationId) {
              setConversationId(json.conversationId);
              loadConversations();
            }
            if (json.error) {
              setMessages((m) => upsertStreamingAssistant(m, content || json.error));
            }
          } catch {}
        }
      }
    } catch {
      setMessages((m) => upsertStreamingAssistant(m, "我这里刚才晃了一下，我们再试一次。"));
    } finally {
      setLoading(false);
      streamingRef.current = false;
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

  const addContextRef = (type: "knowledgeBase" | "note", id: string, label: string) => {
    setContextRefs((current) => {
      if (current.some((item) => item.type === type && item.id === id)) return current;
      return [...current, { type, id, label }];
    });
    setShowMentionPicker(false);
    setMentionQuery("");
  };

  const filteredBases = bases.filter((base) => base.name?.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredNotes = candidateNotes.filter((note) => {
    const title = note.title || stripMarkdown(note.contentMd || "").slice(0, 60);
    return title.toLowerCase().includes(mentionQuery.toLowerCase());
  });

  if (closed) {
    return (
      <button
        onClick={() => setClosed(false)}
        className="fixed right-6 top-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/82 shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_22px_60px_rgba(15,23,42,0.16)]"
        title="打开 AI"
      >
        <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#1d1d1f] text-[12px] text-white shadow-sm">
          ↗
        </span>
        <span className="rounded-full bg-white">
          <XiaoAoMark size="sm" variant="logo" />
        </span>
      </button>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,360px)] flex-col border-l border-[var(--paper-border)] bg-[var(--paper-sidebar)]/92 shadow-[-26px_0_80px_rgba(15,23,42,0.12)] backdrop-blur-xl md:relative md:inset-auto md:h-screen md:w-[360px] md:shrink-0 md:shadow-none">
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
            {message.role === "assistant" ? (
              <div className="flex max-w-[92%] items-start gap-2">
                <div className="mt-0.5 shrink-0 rounded-full bg-white shadow-sm">
                  <XiaoAoMark size="sm" variant="logo" />
                </div>
                <div className="rounded-[8px] border border-white bg-white/75 px-3 py-2.5 text-[var(--ink-light)] shadow-[0_12px_28px_rgba(95,143,255,0.13)]">
                  <MarkdownView content={message.content} />
                </div>
              </div>
            ) : (
              <div className="max-w-[92%] rounded-[8px] bg-blue-50 px-3 py-2.5 text-[var(--ink)] shadow-[0_10px_24px_rgba(95,143,255,0.10)]">
                {message.content}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--ink-faint)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
            AI 正在想一想...
          </div>
        )}
      </div>

      <div className="border-t border-[var(--paper-border)] p-3">
        {contextRefs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextRefs.map((ref) => (
              <button
                key={`${ref.type}-${ref.id}`}
                onClick={() => setContextRefs((current) => current.filter((item) => item !== ref))}
                className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] text-[var(--accent-blue)] ring-1 ring-[var(--paper-border)]"
                title="移除引用"
              >
                @{ref.label} ×
              </button>
            ))}
          </div>
        )}
        {showMentionPicker && (
          <div className="mb-2 rounded-[12px] border border-[var(--paper-border)] bg-white/95 p-2 shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
            <div className="mb-2 flex gap-1 rounded-[8px] bg-[var(--paper-bg)] p-1">
              <button onClick={() => setMentionTab("kb")} className={mentionTabClass(mentionTab === "kb")}>知识库</button>
              <button onClick={() => setMentionTab("note")} className={mentionTabClass(mentionTab === "note")}>笔记</button>
            </div>
            <input
              className="mb-2 w-full rounded-[8px] border border-[var(--paper-border)] bg-white px-3 py-2 text-xs outline-none"
              placeholder="搜索要引用的内容"
              value={mentionQuery}
              onChange={(e) => setMentionQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-[190px] space-y-1 overflow-y-auto">
              {mentionTab === "kb" ? (
                filteredBases.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-[var(--ink-faint)]">没有找到知识库</p>
                ) : filteredBases.map((base) => (
                  <button key={base.id} onClick={() => addContextRef("knowledgeBase", base.id, base.name)} className="w-full rounded-[8px] px-2 py-2 text-left hover:bg-[#edf3ff]">
                    <span className="block truncate text-xs font-medium text-[var(--ink)]">{base.icon || "◌"} {base.name}</span>
                    <span className="block truncate text-[11px] text-[var(--ink-faint)]">{base._count?.notes || 0} 条笔记 · {base.description || "暂无描述"}</span>
                  </button>
                ))
              ) : (
                filteredNotes.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-[var(--ink-faint)]">没有找到笔记</p>
                ) : filteredNotes.map((note) => {
                  const title = note.title || stripMarkdown(note.contentMd || "").slice(0, 40) || "未命名笔记";
                  return (
                    <button key={note.id} onClick={() => addContextRef("note", note.id, title)} className="w-full rounded-[8px] px-2 py-2 text-left hover:bg-[#edf3ff]">
                      <span className="block truncate text-xs font-medium text-[var(--ink)]">{title}</span>
                      <span className="block truncate text-[11px] text-[var(--ink-faint)]">{stripMarkdown(note.contentMd || "").slice(0, 72)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowMentionPicker((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-white bg-white/78 text-sm font-medium text-[var(--accent-blue)] transition-colors hover:bg-white"
            title="引用知识库或笔记"
          >
            @
          </button>
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

function mentionTabClass(active: boolean) {
  return `flex-1 rounded-[7px] px-2 py-1.5 text-xs transition-colors ${
    active ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-faint)]"
  }`;
}
