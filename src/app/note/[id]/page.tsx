"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { MarkdownView } from "@/components/MarkdownView";

type Tab = "spirit" | "content" | "source" | "append";

interface NoteDetail {
  id: string;
  title?: string;
  contentMd: string;
  type: string;
  sourceUrl?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  tags: { tag: { id: string; fullPath: string } }[];
  aiResult?: {
    title?: string | null;
    summary?: string | null;
    keyPoints?: string | null;
    keywords?: string | null;
    suggestedTags?: string | null;
    actionItems?: string | null;
    reviewQuestions?: string | null;
  } | null;
}

function safeParse(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

export default function NoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("spirit");
  const [report, setReport] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
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
  const [saving, setSaving] = useState("");
  const [suggestedQuestion, setSuggestedQuestion] = useState("");
  const [reuseMsg, setReuseMsg] = useState("");

  const noteId = params.id;

  const loadNote = async () => {
    setError("");
    try {
      const resp = await fetch(`/api/notes/${noteId}`);
      if (!resp.ok) throw new Error("这页笔记暂时不在这里。");
      const data = (await resp.json()) as NoteDetail;
      setNote(data);
      setEditContent(data.contentMd || "");
      setEditTitle(data.title || data.aiResult?.title || data.contentMd?.slice(0, 80) || "");
      if (data.aiResult?.actionItems?.includes("## ")) {
        setReport(data.aiResult.actionItems);
      } else if (data.aiResult?.summary && (data.aiResult.summary.includes("## ") || data.aiResult.summary.length > 420)) {
        setReport(data.aiResult.summary);
      } else {
        setReport("");
      }
    } catch (e: any) {
      setError(e.message || "AI 没找到这页笔记。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!noteId) return;
    setLoading(true);
    loadNote();
  }, [noteId]);

  const title = note?.title || note?.aiResult?.title || note?.contentMd?.slice(0, 100) || "";
  const summary = note?.aiResult?.summary || "";
  const summaryLooksLikeReport = summary.includes("## ") || summary.length > 420;
  const displaySummary = summaryLooksLikeReport ? "" : summary;
  const keyPoints = useMemo(() => safeParse(note?.aiResult?.keyPoints), [note?.aiResult?.keyPoints]);
  const keywords = useMemo(() => safeParse(note?.aiResult?.keywords), [note?.aiResult?.keywords]);
  const suggestedTags = useMemo(() => safeParse(note?.aiResult?.suggestedTags), [note?.aiResult?.suggestedTags]);
  const spiritQuestions = useMemo(() => safeParse(note?.aiResult?.reviewQuestions), [note?.aiResult?.reviewQuestions]);
  const hasSource = Boolean(note?.sourceUrl && note?.type !== "manual");
  const isTranscribeFailed = Boolean(note && (note.status === "failed" || /\[失败\]|转写失败|转录失败/.test(note.contentMd || "")));

  const generateReport = async (force = false) => {
    if (!note?.id || reportLoading) return;
    if (isTranscribeFailed) {
      setReportError("这条笔记转写失败，暂不生成 AI 解读。请先重新转录，或编辑原文后再解读。");
      return;
    }
    setReportLoading(true);
    setReportError("");
    const resp = await fetch("/api/ai/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noteId: note.id,
        force,
        model: localStorage.getItem("nf_model") || undefined,
        apiKey: localStorage.getItem("nf_api_key") || undefined,
        baseUrl: localStorage.getItem("nf_base_url") || undefined,
      }),
    });
    const data = await resp.json();
    if (data.report) {
      setReport(data.report);
      await loadNote();
    } else if (data.error) {
      setReportError(data.error);
    } else {
      setReportError("AI 这次没有读出内容，检查一下 AI 设置后再试。");
    }
    setReportLoading(false);
  };

  useEffect(() => {
    if (!note?.id || report || reportLoading) return;
    if (isTranscribeFailed) return;
    generateReport(false);
  }, [note?.id, isTranscribeFailed]);

  const patchNote = async (body: Record<string, unknown>) => {
    if (!note) return null;
    const resp = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      setError("保存失败了，AI 刚才没接住。");
      return null;
    }
    const updated = (await resp.json()) as NoteDetail;
    setNote(updated);
    setEditContent(updated.contentMd || "");
    setEditTitle(updated.title || updated.aiResult?.title || "");
    return updated;
  };

  const handleSaveContent = async () => {
    setSaving("content");
    const updated = await patchNote({ content: editContent });
    if (updated) setEditingContent(false);
    setSaving("");
  };

  const handleSaveTitle = async () => {
    setSaving("title");
    const updated = await patchNote({ title: editTitle.trim() });
    if (updated) setEditingTitle(false);
    setSaving("");
  };

  const handleSaveReport = async () => {
    if (!note) return;
    setSaving("report");
    const resp = await fetch("/api/ai/report", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId: note.id, report: editReport }),
    });
    if (resp.ok) {
      setReport(editReport);
      setEditingReport(false);
      await loadNote();
    } else {
      setReportError("AI 解读保存失败了。");
    }
    setSaving("");
  };

  const handleAppend = async () => {
    if (!note || !appendText.trim()) return;
    setAppending(true);
    const updated = await patchNote({ content: `${note.contentMd}\n\n---\n\n${appendText.trim()}` });
    if (updated) {
      setAppendText("");
      setTab("content");
    }
    setAppending(false);
  };

  const handleAppendReport = async () => {
    if (!note || !report.trim()) return;
    setSaving("append-report");
    const block = `## AI 解读\n\n${report.trim()}`;
    const updated = await patchNote({ content: `${note.contentMd}\n\n---\n\n${block}` });
    if (updated) {
      setReuseMsg("AI 解读已追加到原文。");
      setTab("content");
    }
    setSaving("");
  };

  const handleCreateNoteFromReport = async () => {
    if (!note || !report.trim()) return;
    setSaving("report-note");
    const resp = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `# ${title || "AI 解读"}\n\n> 来源笔记：${note.id}\n\n${report.trim()}` }),
    });
    if (resp.ok) {
      const created = await resp.json();
      router.push(`/note/${created.id}`);
    } else {
      setReportError("另存为新笔记失败了。");
    }
    setSaving("");
  };

  const handleCopyReport = async () => {
    if (!report.trim()) return;
    await navigator.clipboard.writeText(report);
    setReuseMsg("AI 解读已复制。");
    setTimeout(() => setReuseMsg(""), 1800);
  };

  const handleAddTag = async () => {
    if (!note) return;
    const tagPath = addTagText.trim().replace(/^#/, "");
    if (!tagPath) return;
    const updated = await patchNote({ content: `${note.contentMd}\n#${tagPath}` });
    if (updated) {
      setAddTagText("");
      setShowTagInput(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!note) return;
    await fetch(`/api/notes/${note.id}?tagId=${tagId}`, { method: "DELETE" });
    await loadNote();
  };

  const handleDelete = async () => {
    if (!note || !confirm("把这页放进最近删除吗？")) return;
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--paper-bg)]">
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--paper-border)] bg-white px-5 py-4">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
          <span className="text-sm text-[var(--ink-faint)]">AI 正在翻到这一页...</span>
        </div>
      </div>
    );
  }

  if (!note || error) {
    return (
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--paper-bg)]">
          <p className="text-sm text-[var(--ink-light)]">{error || "这页笔记暂时不在这里。"}</p>
          <button onClick={() => router.push("/")} className="rounded-full border border-[var(--paper-border)] px-4 py-2 text-sm text-[var(--ink)]">
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
        <div className="mx-auto max-w-[980px] px-7 py-5">
          <div className="mb-4 flex items-center justify-between text-sm">
            <button onClick={() => router.push("/")} className="text-[var(--ink-faint)] hover:text-[var(--ink)]">
              ← 回书桌
            </button>
            <span className="text-[var(--ink-faint)]">
              最近更新：{formatRelative(note.updatedAt || note.createdAt)} · {countWords(note.contentMd)} 字
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setTab("append")} className="rounded-lg border border-[var(--paper-border)] px-3 py-1.5 text-[var(--ink-light)] hover:bg-white">
                追加笔记
              </button>
              <button onClick={handleDelete} className="rounded-lg border border-[var(--paper-border)] px-3 py-1.5 text-[var(--ink-faint)] hover:border-red-200 hover:text-red-500">
                删除
              </button>
            </div>
          </div>

          <section className="mb-5 rounded-[8px] border border-[var(--paper-border)] bg-white px-7 py-6 shadow-[0_20px_50px_rgba(15,23,42,0.04)]">
            {editingTitle ? (
              <div className="flex items-center gap-3">
                <input
                  className="min-w-0 flex-1 border-b border-[var(--paper-border)] bg-transparent text-3xl font-bold leading-snug text-[var(--ink)] outline-none"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  autoFocus
                />
                <button onClick={handleSaveTitle} className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-sm text-white">
                  {saving === "title" ? "保存中" : "保存"}
                </button>
                <button onClick={() => setEditingTitle(false)} className="px-2 py-1.5 text-sm text-[var(--ink-faint)]">
                  取消
                </button>
              </div>
            ) : (
              <h1
                className="cursor-pointer text-3xl font-bold leading-snug text-[var(--ink)] hover:text-[var(--accent-blue)]"
                onClick={() => {
                  setEditTitle(title);
                  setEditingTitle(true);
                }}
                title="点击修改标题"
              >
                {title || "这页还没有标题"}
              </h1>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {hasSource && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-[var(--accent-blue)]">
                  AI 链接笔记 · {platformLabel(note.type)}
                </span>
              )}
              {note.tags.map((nt) => (
                <span key={nt.tag.id} className="group flex items-center gap-1 rounded-full border border-[var(--paper-border)] bg-[var(--paper-soft)] px-3 py-1 text-sm text-[var(--ink-light)]">
                  <button onClick={() => router.push(`/?tag=${encodeURIComponent(nt.tag.fullPath)}`)}>#{nt.tag.fullPath}</button>
                  <button onClick={() => handleDeleteTag(nt.tag.id)} className="opacity-45 hover:text-red-500 hover:opacity-100">
                    ×
                  </button>
                </span>
              ))}
              {showTagInput ? (
                <span className="flex items-center gap-1">
                  <input
                    className="w-36 rounded-full border border-[var(--accent-blue)] px-3 py-1 text-sm outline-none"
                    placeholder="主题/方向"
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
                  <button onClick={handleAddTag} className="text-sm text-[var(--accent-blue)]">保存</button>
                  <button onClick={() => setShowTagInput(false)} className="text-sm text-[var(--ink-faint)]">取消</button>
                </span>
              ) : (
                <button onClick={() => setShowTagInput(true)} className="rounded-full border border-dashed border-[var(--paper-border)] px-3 py-1 text-sm text-[var(--ink-faint)] hover:text-[var(--accent-blue)]">
                  + 添加标签
                </button>
              )}
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setAddTagText(tag);
                    setShowTagInput(true);
                  }}
                  className="rounded-full bg-blue-50 px-3 py-1 text-sm text-[var(--accent-blue)]"
                >
                  + 智能标签 #{tag}
                </button>
              ))}
            </div>
          </section>

          <div className="sticky top-0 z-10 mb-5 flex items-center gap-7 border-b border-[var(--paper-border)] bg-[var(--paper-bg)]/95 py-2 backdrop-blur">
            {[
              { key: "spirit" as Tab, label: "AI 解读" },
              { key: "content" as Tab, label: "原文" },
              { key: "source" as Tab, label: "链接原文", hide: !hasSource },
              { key: "append" as Tab, label: "追加笔记" },
            ]
              .filter((item) => !item.hide)
              .map((item) => (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  className={`border-b-2 pb-2 text-[15px] transition-colors ${
                    tab === item.key
                      ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                      : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-light)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
          </div>

          <section className="rounded-[8px] border border-[var(--paper-border)] bg-white px-8 py-7">
            {tab === "spirit" && (
              <div className="space-y-8">
                <div className="flex items-start justify-between gap-5">
                  <div className="flex items-center gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--ink)]">AI 解读</h2>
                      <p className="mt-1 text-sm text-[var(--ink-faint)]">这部分应该能替代你重新读一遍原文。</p>
                    </div>
                  </div>
                  <button
                    onClick={() => generateReport(true)}
                    disabled={reportLoading || isTranscribeFailed}
                    className="rounded-lg border border-[var(--paper-border)] px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)] disabled:opacity-40"
                  >
                    {isTranscribeFailed ? "等待重新转录" : reportLoading ? "AI 正在读" : "重新解读"}
                  </button>
                </div>

                {displaySummary && (
                  <div className="rounded-[8px] bg-[var(--paper-soft)] px-5 py-4">
                    <p className="text-xs text-[var(--ink-faint)]">一句话抓住这页</p>
                    <p className="mt-2 text-[15px] leading-7 text-[var(--ink-light)]">{displaySummary}</p>
                  </div>
                )}

                {keyPoints.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-base font-semibold text-[var(--ink)]">先记住这几件事</h3>
                    <ul className="space-y-2 text-[15px] leading-7 text-[var(--ink-light)]">
                      {keyPoints.map((point, index) => (
                        <li key={`${point}-${index}`} className="flex gap-3">
                          <span className="mt-[11px] h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)]" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isTranscribeFailed ? (
                  <div className="rounded-[8px] border border-red-100 bg-red-50 px-5 py-4 text-sm leading-6 text-red-700">
                    这条笔记转写失败了，AI 不会解读失败提示文本。请先回到列表点“重新转录”，或切到“原文”手动补充有效内容后再解读。
                  </div>
                ) : reportLoading ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
                    <p className="text-sm text-[var(--ink-faint)]">AI 正在把原文读厚一点，整理成完整解读。</p>
                  </div>
                ) : report ? (
                  <div>
                    {editingReport ? (
                      <div>
                        <textarea
                          className="min-h-[420px] w-full resize-y rounded-[8px] border border-[var(--paper-border)] p-5 text-[15px] leading-7 outline-none"
                          value={editReport}
                          onChange={(e) => setEditReport(e.target.value)}
                          autoFocus
                        />
                        <div className="mt-3 flex gap-2">
                          <button onClick={handleSaveReport} className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm text-white">
                            {saving === "report" ? "保存中" : "保存解读"}
                          </button>
                          <button onClick={() => setEditingReport(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]">
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <article className="prose-note max-w-none text-[17px] leading-9">
                          <MarkdownView content={report} />
                        </article>
                        <div className="mt-5 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              setEditReport(report);
                              setEditingReport(true);
                            }}
                            className="rounded-lg border border-[var(--paper-border)] px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]"
                          >
                            编辑解读
                          </button>
                          <button onClick={handleCopyReport} className="rounded-lg border border-[var(--paper-border)] px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]">
                            复制
                          </button>
                          <button onClick={handleAppendReport} disabled={saving === "append-report"} className="rounded-lg border border-[var(--paper-border)] px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)] disabled:opacity-40">
                            {saving === "append-report" ? "追加中" : "追加到原文"}
                          </button>
                          <button onClick={handleCreateNoteFromReport} disabled={saving === "report-note"} className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm text-white disabled:opacity-40">
                            {saving === "report-note" ? "保存中" : "另存为笔记"}
                          </button>
                          {reuseMsg && <span className="text-sm text-[var(--sage)]">{reuseMsg}</span>}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="py-14 text-center">
                    <p className="mt-3 text-sm text-[var(--ink-faint)]">{reportError || "这一页还没有完整解读。"}</p>
                    <button onClick={() => generateReport(true)} disabled={isTranscribeFailed} className="mt-4 rounded-lg bg-[var(--ink)] px-4 py-2 text-sm text-white disabled:opacity-40">
                      让 AI 完整读一遍
                    </button>
                  </div>
                )}

                {(keywords.length > 0 || spiritQuestions.length > 0) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {keywords.length > 0 && (
                      <div className="rounded-[8px] border border-[var(--paper-border)] p-4">
                        <p className="text-sm font-medium text-[var(--ink)]">关键词</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {keywords.map((keyword) => (
                            <span key={keyword} className="rounded-full bg-[var(--paper-soft)] px-3 py-1 text-sm text-[var(--ink-light)]">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {spiritQuestions.length > 0 && (
                      <div className="rounded-[8px] border border-[var(--paper-border)] p-4">
                        <p className="text-sm font-medium text-[var(--ink)]">继续问 AI</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {spiritQuestions.map((question) => (
                            <button
                              key={question}
                              onClick={() => setSuggestedQuestion(question)}
                              className="rounded-full border border-[var(--paper-border)] px-3 py-1.5 text-sm text-[var(--ink-light)] hover:bg-blue-50 hover:text-[var(--accent-blue)]"
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "content" && (
              editingContent ? (
                <div>
                  <textarea
                    className="min-h-[520px] w-full resize-y rounded-[8px] border border-[var(--paper-border)] bg-white p-5 text-[16px] leading-8 text-[var(--ink)] outline-none"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoFocus
                  />
                  <div className="mt-3 flex gap-2">
                    <button onClick={handleSaveContent} className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm text-white">
                      {saving === "content" ? "保存中" : "保存正文"}
                    </button>
                    <button
                      onClick={() => {
                        setEditContent(note.contentMd);
                        setEditingContent(false);
                      }}
                      className="rounded-lg px-4 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <article className="prose-note max-w-none text-[17px] leading-9">
                    <MarkdownView content={note.contentMd} />
                  </article>
                  <button onClick={() => setEditingContent(true)} className="mt-5 text-sm text-[var(--ink-faint)] hover:text-[var(--accent-blue)]">
                    编辑原文
                  </button>
                </div>
              )
            )}

            {tab === "source" && hasSource && (
              <div>
                <p className="mb-2 text-sm text-[var(--ink-faint)]">原始链接</p>
                <a href={note.sourceUrl || ""} target="_blank" rel="noopener noreferrer" className="break-all text-[15px] text-[var(--accent-blue)] hover:underline">
                  {note.sourceUrl}
                </a>
                <div className="mt-5 rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-soft)] p-4 text-sm leading-7 text-[var(--ink-light)]">
                  <p>来源类型：{platformLabel(note.type)}</p>
                  <p>收录时间：{new Date(note.createdAt).toLocaleString("zh-CN")}</p>
                </div>
              </div>
            )}

            {tab === "append" && (
              <div>
                <p className="mb-4 text-sm text-[var(--ink-faint)]">把新的想法接在这一页后面，AI 会保留原来的脉络。</p>
                <textarea
                  className="min-h-[220px] w-full resize-y rounded-[8px] border border-[var(--paper-border)] bg-white p-4 text-[15px] leading-7 text-[var(--ink)] outline-none"
                  placeholder="继续写..."
                  value={appendText}
                  onChange={(e) => setAppendText(e.target.value)}
                  autoFocus
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleAppend}
                    disabled={!appendText.trim() || appending}
                    className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm text-white disabled:opacity-30"
                  >
                    {appending ? "接上去..." : "接到后面"}
                  </button>
                  <button
                    onClick={() => {
                      setAppendText("");
                      setTab("content");
                    }}
                    className="rounded-lg px-4 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
      <SpiritPanel noteId={note.id} initialQuestion={suggestedQuestion} onInitialQuestionConsumed={() => setSuggestedQuestion("")} />
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
    bilibili: "B 站",
    youtube: "YouTube",
    xiaohongshu: "小红书",
    web: "网页",
    pdf: "PDF",
    link: "链接",
  };
  return labels[type] || type;
}
