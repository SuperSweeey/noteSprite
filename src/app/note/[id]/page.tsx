"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { MarkdownView } from "@/components/MarkdownView";

type Tab = "spirit" | "content" | "source" | "append";

function safeParse(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [note, setNote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("spirit");
  const [report, setReport] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [editingReport, setEditingReport] = useState(false);
  const [editReport, setEditReport] = useState("");
  const [editingContent, setEditingContent] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [appendText, setAppendText] = useState("");
  const [appending, setAppending] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [addTagText, setAddTagText] = useState("");

  const fetchNote = () => {
    fetch("/api/notes?limit=300")
      .then((r) => r.json())
      .then((data) => {
        const found = data.notes?.find((n: any) => n.id === params.id);
        setNote(found || null);
        setEditContent(found?.contentMd || "");
        setEditTitle(found?.title || found?.aiResult?.title || found?.contentMd?.slice(0, 80) || "");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchNote();
  }, [params.id]);

  const title = note?.title || note?.aiResult?.title || note?.contentMd?.slice(0, 100) || "";
  const summary = note?.aiResult?.summary || "";
  const keyPoints = useMemo(() => safeParse(note?.aiResult?.keyPoints), [note?.aiResult?.keyPoints]);
  const keywords = useMemo(() => safeParse(note?.aiResult?.keywords), [note?.aiResult?.keywords]);
  const suggestedTags = useMemo(() => safeParse(note?.aiResult?.suggestedTags), [note?.aiResult?.suggestedTags]);
  const spiritQuestions = useMemo(() => safeParse(note?.aiResult?.reviewQuestions), [note?.aiResult?.reviewQuestions]);
  const hasSource = Boolean(note?.sourceUrl && note?.type !== "manual");

  useEffect(() => {
    if (!note?.id) return;
    if (note.aiResult?.actionItems && note.aiResult.actionItems.includes("## ")) {
      setReport(note.aiResult.actionItems);
      return;
    }

    setReportLoading(true);
    fetch("/api/ai/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noteId: note.id,
        model: localStorage.getItem("nf_model") || undefined,
        apiKey: localStorage.getItem("nf_api_key") || undefined,
        baseUrl: localStorage.getItem("nf_base_url") || undefined,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.report) {
          setReport(d.report);
          fetchNote();
        }
        setReportLoading(false);
      })
      .catch(() => setReportLoading(false));
  }, [note?.id]);

  const handleSaveContent = async () => {
    const resp = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    if (resp.ok) {
      const updated = await resp.json();
      setNote(updated);
      setEditingContent(false);
    }
  };

  const handleSaveTitle = async () => {
    const resp = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle }),
    });
    if (resp.ok) {
      fetchNote();
      setEditingTitle(false);
    }
  };

  const handleSaveReport = async () => {
    await fetch("/api/ai/report", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId: note.id, report: editReport }),
    });
    setReport(editReport);
    setEditingReport(false);
    fetchNote();
  };

  const handleAppend = async () => {
    if (!appendText.trim()) return;
    setAppending(true);
    const resp = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${note.contentMd}\n\n---\n\n${appendText}` }),
    });
    if (resp.ok) {
      const updated = await resp.json();
      setNote(updated);
      setAppendText("");
      setTab("content");
    }
    setAppending(false);
  };

  const handleAddTag = async () => {
    const tagPath = addTagText.trim();
    if (!tagPath) return;
    const resp = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${note.contentMd}\n#${tagPath}` }),
    });
    if (resp.ok) {
      setAddTagText("");
      setShowTagInput(false);
      fetchNote();
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    await fetch(`/api/tags?id=${tagId}`, { method: "DELETE" });
    fetchNote();
  };

  const handleDelete = async () => {
    if (!confirm("确定把这页放进最近删除吗？")) return;
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--paper-bg)]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--paper-border)] border-t-[var(--gold)]" />
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-[var(--paper-bg)]">
          <p className="font-prose text-lg text-[var(--ink-light)]">这页笔记暂时不在这里了。</p>
          <button onClick={() => router.push("/")} className="text-sm text-[var(--gold)] hover:underline">
            回书桌
          </button>
        </main>
        <SpiritPanel />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-[var(--paper-bg)]">
        <div className="mx-auto max-w-[820px] px-6 py-6">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => router.push("/")} className="text-sm text-[var(--ink-faint)] hover:text-[var(--ink-light)]">
              回书桌
            </button>
            <div className="text-sm text-[var(--ink-faint)]">
              {formatRelative(note.updatedAt || note.createdAt)} · {countWords(note.contentMd)} 字
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setTab("append")} className="rounded-lg px-3 py-1.5 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-hover)]">
                续写
              </button>
              <button onClick={handleDelete} className="rounded-lg px-3 py-1.5 text-sm text-[var(--ink-faint)] hover:bg-red-50 hover:text-red-400">
                删除
              </button>
            </div>
          </div>

          <div className="paper-card mb-3 p-6">
            {editingTitle ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 border-b border-[var(--paper-border)] text-xl font-bold leading-snug text-[var(--ink)] outline-none"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                />
                <button onClick={handleSaveTitle} className="text-sm text-[var(--gold)]">
                  保存
                </button>
                <button onClick={() => setEditingTitle(false)} className="text-sm text-[var(--ink-faint)]">
                  取消
                </button>
              </div>
            ) : (
              <h1
                className="cursor-pointer text-xl font-bold leading-snug text-[var(--ink)] hover:text-[var(--gold)]"
                onClick={() => {
                  setEditTitle(title);
                  setEditingTitle(true);
                }}
                title="点击修改标题"
              >
                {title || "（这页还没有标题）"}
              </h1>
            )}

            {summary && <p className="mt-3 text-sm leading-7 text-[var(--ink-light)]">{summary}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {hasSource && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  来自 {platformLabel(note.type)}
                </span>
              )}
              {note.tags?.map((nt: any) => (
                <span
                  key={nt.tag.id}
                  className="group flex items-center gap-1 rounded-full bg-[var(--gold-light)] px-2 py-0.5 text-xs text-[var(--gold)]"
                >
                  <span className="cursor-pointer" onClick={() => router.push(`/?tag=${encodeURIComponent(nt.tag.fullPath)}`)}>
                    #{nt.tag.fullPath}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTag(nt.tag.id);
                    }}
                    className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
              {showTagInput ? (
                <span className="flex items-center gap-1">
                  <input
                    className="w-28 rounded-full border border-[var(--gold)] px-2 py-0.5 text-xs outline-none"
                    placeholder="如 产品/AI"
                    value={addTagText}
                    onChange={(e) => setAddTagText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTag();
                      if (e.key === "Escape") {
                        setShowTagInput(false);
                        setAddTagText("");
                      }
                    }}
                    autoFocus
                  />
                  <button onClick={handleAddTag} className="text-xs text-[var(--gold)]">
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setShowTagInput(false);
                      setAddTagText("");
                    }}
                    className="text-xs text-[var(--ink-faint)]"
                  >
                    取消
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setShowTagInput(true);
                    setAddTagText("");
                  }}
                  className="rounded-full border border-dashed border-[var(--paper-border)] px-2 py-1 text-xs text-[var(--ink-faint)] hover:text-[var(--gold)]"
                >
                  + 标签
                </button>
              )}
            </div>
          </div>

          <div className="mb-0 flex gap-0">
            {[
              { key: "spirit" as Tab, label: "笔记精灵" },
              { key: "content" as Tab, label: "笔记正文" },
              { key: "source" as Tab, label: "出处", hide: !hasSource },
              { key: "append" as Tab, label: "续写" },
            ]
              .filter((item) => !item.hide)
              .map((item) => (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  className={`border-b-2 px-5 py-2.5 text-sm transition-colors ${
                    tab === item.key
                      ? "border-[var(--gold)] font-medium text-[var(--ink)]"
                      : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-light)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
          </div>

          <div className="paper-card min-h-[320px] rounded-tl-none p-6">
            {tab === "spirit" && (
              <div className="space-y-6">
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-base">✦</span>
                    <h2 className="text-sm font-medium text-[var(--ink)]">精灵整理</h2>
                  </div>

                  {!summary && keyPoints.length === 0 && keywords.length === 0 && (
                    <p className="text-sm text-[var(--ink-faint)]">这页还没整理完，精灵正在慢慢读。</p>
                  )}

                  {summary && (
                    <div className="mb-4 rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-4">
                      <p className="text-xs text-[var(--ink-faint)]">一句话理解</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--ink-light)]">{summary}</p>
                    </div>
                  )}

                  {keyPoints.length > 0 && (
                    <div className="mb-4 rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-4">
                      <p className="text-xs text-[var(--ink-faint)]">值得记住的几点</p>
                      <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--ink-light)]">
                        {keyPoints.map((point, index) => (
                          <li key={`${point}-${index}`} className="flex gap-2">
                            <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(keywords.length > 0 || suggestedTags.length > 0) && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-4">
                        <p className="text-xs text-[var(--ink-faint)]">关键词</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {keywords.map((keyword) => (
                            <span key={keyword} className="rounded-full bg-[var(--sage-light)] px-2 py-1 text-xs text-[var(--sage)]">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-4">
                        <p className="text-xs text-[var(--ink-faint)]">精灵建议的标签</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {suggestedTags.map((tag) => (
                            <span key={tag} className="rounded-full border border-dashed border-[var(--paper-border)] px-2 py-1 text-xs text-[var(--ink-light)]">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-base">✦</span>
                    <h2 className="text-sm font-medium text-[var(--ink)]">精灵读后感</h2>
                  </div>

                  {reportLoading ? (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <span className="text-3xl">✦</span>
                      <p className="text-sm text-[var(--ink-faint)]">精灵正在把这页慢慢读成一段话。</p>
                    </div>
                  ) : report ? (
                    editingReport ? (
                      <div>
                        <textarea
                          className="min-h-[280px] w-full resize-none rounded-xl border border-[var(--paper-border)] p-4 text-sm outline-none"
                          value={editReport}
                          onChange={(e) => setEditReport(e.target.value)}
                          autoFocus
                        />
                        <div className="mt-2 flex gap-2">
                          <button onClick={handleSaveReport} className="rounded-full px-4 py-1.5 text-sm text-white" style={{ background: "var(--gold)" }}>
                            保存
                          </button>
                          <button onClick={() => setEditingReport(false)} className="px-4 py-1.5 text-sm text-[var(--ink-light)]">
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="prose-note text-sm">
                          <MarkdownView content={report} />
                        </div>
                        <button
                          onClick={() => {
                            setEditReport(report);
                            setEditingReport(true);
                          }}
                          className="mt-3 text-xs text-[var(--ink-faint)] hover:text-[var(--gold)]"
                        >
                          编辑这段阅读稿
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="text-center py-10">
                      <button
                        onClick={() => {
                          setReportLoading(true);
                          fetch("/api/ai/report", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              noteId: note.id,
                              model: localStorage.getItem("nf_model") || undefined,
                              apiKey: localStorage.getItem("nf_api_key") || undefined,
                              baseUrl: localStorage.getItem("nf_base_url") || undefined,
                            }),
                          })
                            .then((r) => r.json())
                            .then((d) => {
                              if (d.report) setReport(d.report);
                              setReportLoading(false);
                            });
                        }}
                        className="px-4 py-2 text-sm text-[var(--gold)] hover:underline"
                      >
                        让精灵读一遍
                      </button>
                    </div>
                  )}
                </section>

                {spiritQuestions.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-base">✦</span>
                      <h2 className="text-sm font-medium text-[var(--ink)]">继续聊下去</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {spiritQuestions.map((question) => (
                        <button
                          key={question}
                          onClick={() => {
                            navigator.clipboard.writeText(question).catch(() => {});
                          }}
                          className="rounded-full border border-[var(--paper-border)] px-3 py-1.5 text-xs text-[var(--ink-light)] hover:bg-[var(--paper-hover)]"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {tab === "content" && (
              editingContent ? (
                <div>
                  <textarea
                    className="min-h-[400px] w-full resize-none rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-5 text-[16px] leading-relaxed text-[var(--ink)] outline-none"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoFocus
                  />
                  <div className="mt-3 flex gap-2">
                    <button onClick={handleSaveContent} className="rounded-full px-4 py-1.5 text-sm text-white" style={{ background: "var(--gold)" }}>
                      保存
                    </button>
                    <button
                      onClick={() => {
                        setEditContent(note.contentMd);
                        setEditingContent(false);
                      }}
                      className="px-4 py-1.5 text-sm text-[var(--ink-light)]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <MarkdownView content={note.contentMd} />
                  <button onClick={() => setEditingContent(true)} className="mt-4 text-xs text-[var(--ink-faint)] hover:text-[var(--gold)]">
                    编辑正文
                  </button>
                </div>
              )
            )}

            {tab === "source" && hasSource && (
              <div>
                <p className="mb-2 text-sm text-[var(--ink-faint)]">出处</p>
                <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-[var(--gold)] hover:underline">
                  {note.sourceUrl}
                </a>
                <div className="mt-4 rounded-xl border border-[var(--paper-border)] bg-[var(--paper-bg)] p-4">
                  <p className="text-sm text-[var(--ink-light)]">来自 · {platformLabel(note.type)}</p>
                  <p className="mt-1 text-sm text-[var(--ink-light)]">
                    收录于 · {new Date(note.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
              </div>
            )}

            {tab === "append" && (
              <div>
                <p className="mb-3 text-sm text-[var(--ink-faint)]">在这页后面接着写。</p>
                <textarea
                  className="min-h-[180px] w-full resize-none rounded-xl border border-[var(--paper-border)] bg-[var(--paper-card)] p-4 text-sm leading-relaxed text-[var(--ink)] outline-none"
                  placeholder="继续写..."
                  value={appendText}
                  onChange={(e) => setAppendText(e.target.value)}
                  autoFocus
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleAppend}
                    disabled={!appendText.trim() || appending}
                    className="rounded-full px-4 py-2 text-sm text-white disabled:opacity-25"
                    style={{ background: "var(--gold)" }}
                  >
                    {appending ? "续写中..." : "接到后面"}
                  </button>
                  <button
                    onClick={() => {
                      setAppendText("");
                      setTab("content");
                    }}
                    className="rounded-full px-4 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-hover)]"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <SpiritPanel noteId={note.id as string} />
    </div>
  );
}

function countWords(content: string): number {
  return content?.replace(/[#*`~>\[\]()!|\-\n\s]/g, "")?.length || 0;
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function platformLabel(type: string): string {
  const labels: Record<string, string> = {
    douyin: "抖音",
    bilibili: "B站",
    youtube: "YouTube",
    xiaohongshu: "小红书",
    web: "网页",
    pdf: "PDF",
    link: "链接",
  };
  return labels[type] || type;
}
