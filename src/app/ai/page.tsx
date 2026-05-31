"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { MarkdownView } from "@/components/MarkdownView";
import { XiaoAoMark } from "@/components/XiaoAoMark";
import { upsertStreamingAssistant } from "@/lib/chat-messages";
import { stripMarkdown } from "@/lib/tags";

const suggestions = [
  "帮我串一下最近几页笔记，看看它们在说什么。",
  "这些笔记里有没有互相呼应的主题？",
  "从这周的笔记里，给我一个值得继续想的问题。",
  "哪些旧笔记值得今天重新翻开？",
  "根据我的笔记，帮我看清最近在往哪个方向走。",
  "帮我写一段近期总结。",
];

const CONVERSATION_PAGE_SIZE = 20;

const sessionLearningModes = [
  {
    id: "socratic",
    name: "苏格拉底追问",
    prompt: [
      "本次对话临时使用苏格拉底追问模式。",
      "不要急着直接给完整答案，而是先承接用户已经理解的部分，再把问题拆成清晰逻辑链。",
      "每轮最多给 2 个选择题或 1 个填空题，用 2-3 个选项检验理解，其中可以包含一个常见误区。",
      "用户回答后先肯定思考方向，再温和纠偏或继续追问一层。",
      "目标是让用户自己走完理解过程，而不是被动接收结论。",
    ].join("\n"),
  },
  {
    id: "feynman",
    name: "费曼学习",
    prompt: [
      "本次对话临时使用费曼学习模式。",
      "先用人话解释笔记里的概念或问题，避免堆术语。",
      "把关键概念拆成小块，每个难点配一个生活化例子或类比。",
      "指出用户可能还没理解透的概念边界、因果链或容易混淆点。",
      "最后请用户用一句话复述，或回答一个很小的检查题。",
    ].join("\n"),
  },
  {
    id: "structure",
    name: "结构化拆解",
    prompt: [
      "本次对话临时使用结构化拆解模式。",
      "优先判断笔记在回答什么问题，再区分主观点、次观点、证据、例子和背景信息。",
      "把论证链写清楚：事实/案例/数据如何走到结论。",
      "标出证据强弱、隐含假设、可能漏洞和可复用素材。",
      "输出要有层次，适合用户以后复习和引用。",
    ].join("\n"),
  },
  {
    id: "research",
    name: "研究助理",
    prompt: [
      "本次对话临时使用研究助理模式。",
      "先说明材料的研究问题、分析对象和背景意义。",
      "如果笔记里有方法、数据、样本或框架，要明确列出；没有就说笔记里没有看到。",
      "区分关键发现、证据质量、局限边界和后续查证方向。",
      "不要把摘要写成宣传稿，不要把笔记没有支持的内容当成事实。",
    ].join("\n"),
  },
  {
    id: "writing",
    name: "写作编辑",
    prompt: [
      "本次对话临时使用写作编辑模式。",
      "判断这条笔记适合发展成什么选题、观点或素材。",
      "提炼 1-3 个具体论点，并给出文章结构、可复用素材、缺失证据和标题方向。",
      "保持表达清楚、锋利、诚实，不写空话套话。",
      "不要一上来替用户写完整文章，先帮用户看清可写性。",
    ].join("\n"),
  },
  {
    id: "action",
    name: "行动教练",
    prompt: [
      "本次对话临时使用行动教练模式。",
      "从笔记里识别目标、现状、阻塞点和下一步行动。",
      "把模糊想法改写成具体动作，每个动作尽量包含对象、动词和产出。",
      "区分立刻做、稍后做、暂时不做，并指出依赖和风险。",
      "不要把所有内容都变成待办，先判断它是不是行动信息。",
    ].join("\n"),
  },
  {
    id: "companion",
    name: "陪伴复盘",
    prompt: [
      "本次对话临时使用陪伴复盘模式。",
      "先温和承接用户记录里的事实、感受或变化。",
      "帮用户看见这条笔记里值得留下的句子、观察、问题或线索。",
      "可以轻轻追问 1-2 个问题，但不要说教、不要心理诊断、不要写空泛鸡汤。",
      "语气自然、有温度，像长期一起整理笔记的伙伴。",
    ].join("\n"),
  },
] as const;

export default function AIPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--paper-bg)]" />}>
      <AIPageContent />
    </Suspense>
  );
}

function AIPageContent() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [showConvList, setShowConvList] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionTab, setMentionTab] = useState<"notes" | "bases">("bases");
  const [notes, setNotes] = useState<any[]>([]);
  const [bases, setBases] = useState<any[]>([]);
  const [contextRefs, setContextRefs] = useState<{ type: "note" | "knowledgeBase"; id: string; label: string }[]>([]);
  const [aiName, setAiName] = useState("AI");
  const [sessionModeId, setSessionModeId] = useState<string>("default");
  const [chatNotice, setChatNotice] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  const initialQuestionSent = useRef(false);
  const streamingRef = useRef(false);

  const loadConversations = (offset = 0) => {
    setConversationLoading(true);
    setConversationError("");
    fetch(`/api/ai/chat?list=1&limit=${CONVERSATION_PAGE_SIZE}&offset=${offset}`)
      .then((resp) => resp.json())
      .then((data) => {
        const next = data.conversations || [];
        setConversations((current) => offset > 0 ? [...current, ...next] : next);
        setConversationTotal(data.total || next.length);
      })
      .catch(() => {
        if (offset === 0) setConversations([]);
        setConversationError("历史记录暂时加载失败。");
      })
      .finally(() => setConversationLoading(false));
  };

  useEffect(() => {
    loadConversations();
    fetch("/api/settings")
      .then((resp) => resp.json())
      .then((data) => setAiName(data.spirit?.name || "AI"))
      .catch(() => {});
    fetch("/api/knowledge-bases")
      .then((resp) => resp.json())
      .then((data) => setBases(data.bases || []))
      .catch(() => setBases([]));
    fetch("/api/notes?limit=30&sort=updated&compact=1")
      .then((resp) => resp.json())
      .then((data) => setNotes(data.notes || []))
      .catch(() => setNotes([]));
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (streamingRef.current) return;
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
    const displayQuestion = contextRefs.length > 0 ? `${contextRefs.map((ref) => `@${ref.label}`).join(" ")} ${question}` : question;
    setMessages((current) => [...current, { role: "user", content: displayQuestion }]);
    setInput("");
    setChatNotice("");
    const refs = contextRefs;
    const sessionMode = sessionLearningModes.find((mode) => mode.id === sessionModeId);
    setContextRefs([]);
    setLoading(true);
    streamingRef.current = true;

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          contextRefs: refs,
          conversationId: conversationId || null,
          stream: true,
          temporaryLearningMode: sessionMode ? { id: sessionMode.id, name: sessionMode.name, prompt: sessionMode.prompt } : null,
        }),
      });

      if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
        const data = await resp.json();
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((current) => upsertStreamingAssistant(current, data.answer || "精灵刚才停了一下，我们再试一次。"));
        if (data.persist === false || data.authError) {
          setChatNotice("这次失败没有写入历史记录。可以先去设置页检测模型 Key。");
        } else {
          loadConversations();
        }
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
              setMessages((current) => upsertStreamingAssistant(current, content));
            }
            if (json.conversationId) {
              setConversationId(json.conversationId);
              loadConversations();
            }
            if (json.error) {
              setMessages((current) => upsertStreamingAssistant(current, json.error));
            }
          } catch {}
        }
      }
    } catch {
      setMessages((current) => upsertStreamingAssistant(current, "连接不太稳，我们再试一次。"));
    } finally {
      setLoading(false);
      streamingRef.current = false;
    }
  };

  useEffect(() => {
    const question = searchParams.get("q");
    if (!question || initialQuestionSent.current) return;
    initialQuestionSent.current = true;
    send(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
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

  const addContextRef = (ref: { type: "note" | "knowledgeBase"; id: string; label: string }) => {
    setContextRefs((current) => current.some((item) => item.type === ref.type && item.id === ref.id) ? current : [...current, ref]);
    setShowMentionPicker(false);
    setMentionQuery("");
  };

  const filteredBases = bases.filter((base) => base.name?.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredNotes = notes.filter((note) => {
    const text = `${note.title || ""} ${note.contentMd || ""}`.toLowerCase();
    return text.includes(mentionQuery.toLowerCase());
  });

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col bg-[var(--paper-bg)]">
        <header className="border-b border-[var(--paper-border)] bg-white/70 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[900px] items-center justify-between">
            <div className="flex items-center gap-3">
              <XiaoAoMark size="md" variant="logo" />
              <div>
                <h1 className="text-lg font-semibold text-[var(--ink)]">{aiName}</h1>
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
              {conversationLoading && conversations.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--ink-faint)]">正在加载历史...</p>
              ) : conversationError ? (
                <p className="py-6 text-center text-sm text-red-500">{conversationError}</p>
              ) : conversations.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--ink-faint)]">还没有对话。</p>
              ) : (
                <>
                  {conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className="mb-2 flex w-full items-center gap-3 rounded-[10px] border border-[var(--paper-border)] bg-white px-4 py-3 text-left text-sm hover:bg-[var(--paper-soft)]"
                    >
                      <button
                        onClick={() => {
                          setConversationId(conversation.id);
                          setShowConvList(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-[var(--ink)]">{conversation.messages?.[0]?.content?.slice(0, 70) || conversation.title || "新的对话"}</p>
                        <p className="mt-1 text-xs text-[var(--ink-faint)]">{new Date(conversation.updatedAt).toLocaleString("zh-CN")}</p>
                      </button>
                      <button
                        onClick={() => deleteConversation(conversation.id)}
                        className="shrink-0 rounded-full px-2 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  {conversations.length < conversationTotal && (
                    <button
                      onClick={() => loadConversations(conversations.length)}
                      disabled={conversationLoading}
                      className="mx-auto mt-1 block rounded-full border border-[var(--paper-border)] px-4 py-2 text-sm text-[var(--ink-light)] hover:bg-white disabled:opacity-50"
                    >
                      {conversationLoading ? "加载中" : "加载更多历史"}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <div ref={chatRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] px-6 py-8">
            {chatNotice && (
              <div className="mb-4 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {chatNotice}
              </div>
            )}
            {messages.length === 0 ? (
              <section className="paper-card p-7">
                <h2 className="text-2xl font-semibold text-[var(--ink)]">你想和笔记聊什么？</h2>
                <p className="mt-2 max-w-[560px] text-sm leading-7 text-[var(--ink-faint)]">
                  {aiName} 会优先从你的笔记里找线索。它可以帮你串主题、找关联、生成问题，也可以陪你把一个模糊想法理清楚。
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
                    {message.role === "assistant" ? (
                      <div className="flex max-w-[86%] items-start gap-3">
                        <div className="mt-1 shrink-0 rounded-full bg-white shadow-sm">
                          <XiaoAoMark size="sm" variant="logo" />
                        </div>
                        <div className="rounded-[12px] border border-[var(--paper-border)] bg-white px-4 py-3 text-sm leading-7 text-[var(--ink)]">
                          <MarkdownView content={message.content} />
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-[82%] rounded-[12px] bg-[var(--ink)] px-4 py-3 text-sm leading-7 text-white">
                        {message.content}
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 px-1 text-sm text-[var(--ink-faint)]">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
                      AI 正在思考...
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-[var(--paper-border)] bg-white/70 backdrop-blur-xl">
          <div className="relative mx-auto max-w-[900px] px-6 py-4">
            {contextRefs.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {contextRefs.map((ref) => (
                  <button
                    key={`${ref.type}-${ref.id}`}
                    onClick={() => setContextRefs((current) => current.filter((item) => item !== ref))}
                    className="rounded-full bg-[#edf3ff] px-3 py-1.5 text-xs text-[#2563eb]"
                  >
                    @{ref.label} ×
                  </button>
                ))}
              </div>
            )}
            {showMentionPicker && (
              <MentionPicker
                query={mentionQuery}
                setQuery={setMentionQuery}
                tab={mentionTab}
                setTab={setMentionTab}
                bases={filteredBases}
                notes={filteredNotes}
                onPick={addContextRef}
              />
            )}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setSessionModeId("default")}
                className={modeChipClass(sessionModeId === "default")}
                title="使用设置页里保存的默认领学方式"
              >
                跟随设置
              </button>
              {sessionLearningModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setSessionModeId(mode.id)}
                  className={modeChipClass(sessionModeId === mode.id)}
                  title="只影响当前 AI 页面，不会保存到设置"
                >
                  {mode.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMentionPicker((value) => !value)}
              className="rounded-[12px] border border-[var(--paper-border)] bg-white px-4 py-3 text-sm text-[var(--ink)] hover:bg-[var(--paper-soft)]"
              title="引用笔记或知识库"
            >
              @
            </button>
            <input
              className="flex-1 rounded-[12px] border border-[var(--paper-border)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent-blue)]"
              placeholder="问问你的 AI，或点 @ 引用笔记/知识库..."
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
          </div>
        </footer>
      </main>
    </div>
  );
}

function MentionPicker({
  query,
  setQuery,
  tab,
  setTab,
  bases,
  notes,
  onPick,
}: {
  query: string;
  setQuery: (value: string) => void;
  tab: "notes" | "bases";
  setTab: (tab: "notes" | "bases") => void;
  bases: any[];
  notes: any[];
  onPick: (ref: { type: "note" | "knowledgeBase"; id: string; label: string }) => void;
}) {
  return (
    <div className="absolute bottom-[86px] left-3 right-3 z-20 rounded-[8px] bg-white p-3 shadow-[0_28px_90px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.06] md:left-6 md:right-auto md:w-[520px] md:max-w-[calc(100vw-360px)]">
      <div className="flex items-center gap-2 border-b border-[var(--paper-border)] pb-3">
        <button onClick={() => setTab("bases")} className={mentionTabClass(tab === "bases")}>知识库</button>
        <button onClick={() => setTab("notes")} className={mentionTabClass(tab === "notes")}>笔记</button>
        <input
          className="ml-auto min-w-0 flex-1 rounded-full bg-[#f5f5f7] px-3 py-2 text-sm outline-none md:w-[220px] md:flex-none"
          placeholder="搜索引用..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="mt-3 max-h-[320px] overflow-y-auto">
        {tab === "bases" ? (
          bases.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-[var(--ink-faint)]">还没有可引用的知识库。</p>
          ) : (
            bases.map((base) => (
              <button
                key={base.id}
                onClick={() => onPick({ type: "knowledgeBase", id: base.id, label: base.name })}
                className="block w-full rounded-[14px] px-3 py-3 text-left hover:bg-[#f5f5f7]"
              >
                <span className="block text-sm font-semibold text-[var(--ink)]">@{base.name}</span>
                <span className="mt-1 block text-xs text-[var(--ink-faint)]">{base._count?.notes || 0} 条笔记 · 引用整个主题</span>
              </button>
            ))
          )
        ) : notes.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-[var(--ink-faint)]">没有找到笔记。</p>
        ) : (
          notes.map((note) => {
            const title = note.title || stripMarkdown(note.contentMd || "").slice(0, 36) || "未命名笔记";
            return (
              <button
                key={note.id}
                onClick={() => onPick({ type: "note", id: note.id, label: title })}
                className="block w-full rounded-[14px] px-3 py-3 text-left hover:bg-[#f5f5f7]"
              >
                <span className="block truncate text-sm font-semibold text-[var(--ink)]">@{title}</span>
                <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">{stripMarkdown(note.contentMd || "").slice(0, 84)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function mentionTabClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-xs ${active ? "bg-[#1d1d1f] text-white" : "text-[var(--ink-faint)] hover:bg-[#f5f5f7]"}`;
}

function modeChipClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? "bg-[var(--ink)] text-white" : "border border-[var(--paper-border)] bg-white text-[var(--ink-faint)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)]"
  }`;
}
