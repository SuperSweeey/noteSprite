"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { MarkdownView } from "@/components/MarkdownView";
import { cleanAIOutput, looksLikeTruncatedAIOutput } from "@/lib/ai-output";

type Tab = "spirit" | "content" | "source" | "append";

interface NoteDetail {
  id: string;
  title?: string;
  contentMd: string;
  type: string;
  sourceUrl?: string | null;
  knowledgeBaseId?: string | null;
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
  assets?: {
    id: string;
    fileName: string;
    fileType: string;
    mimeType: string;
    fileSize: number;
    processingStatus: string;
  }[];
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
  const [saveError, setSaveError] = useState("");
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
  const [deleteMode, setDeleteMode] = useState<"trash" | "permanent">("trash");
  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);
  const [savingKb, setSavingKb] = useState(false);
  const [retryingTranscribe, setRetryingTranscribe] = useState(false);

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
      setTab(data.type === "manual" ? "content" : "spirit");
      const savedReport = cleanAIOutput(data.aiResult?.actionItems || "");
      const savedSummary = cleanAIOutput(data.aiResult?.summary || "");
      if (savedReport && !looksLikeTruncatedAIOutput(savedReport)) {
        setReport(savedReport);
      } else if (savedReport) {
        setReport("");
        setReportError("上一次 AI 解读没有完整生成，已经为你收起。请点击重新解读覆盖这份半截内容。");
      } else if (savedSummary && (savedSummary.includes("## ") || savedSummary.length > 420) && !looksLikeTruncatedAIOutput(savedSummary)) {
        setReport(savedSummary);
      } else if (savedSummary && looksLikeTruncatedAIOutput(savedSummary)) {
        setReport("");
        setReportError("上一次 AI 解读没有完整生成，已经为你收起。请点击重新解读覆盖这份半截内容。");
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

  useEffect(() => {
    fetch("/api/settings")
      .then((resp) => resp.json())
      .then((data) => setDeleteMode(data.knowledge?.deleteMode || "trash"))
      .catch(() => {});
    fetch("/api/knowledge-bases")
      .then((resp) => resp.json())
      .then((data) => setKnowledgeBases(data.bases || []))
      .catch(() => setKnowledgeBases([]));
  }, []);

  const title = note?.title || note?.aiResult?.title || note?.contentMd?.slice(0, 100) || "";
  const summary = note?.aiResult?.summary || "";
  const summaryLooksLikeReport = summary.includes("## ") || summary.length > 420;
  const displaySummary = summaryLooksLikeReport ? "" : summary;
  const keyPoints = useMemo(() => safeParse(note?.aiResult?.keyPoints), [note?.aiResult?.keyPoints]);
  const keywords = useMemo(() => safeParse(note?.aiResult?.keywords), [note?.aiResult?.keywords]);
  const suggestedTags = useMemo(() => safeParse(note?.aiResult?.suggestedTags), [note?.aiResult?.suggestedTags]);
  const spiritQuestions = useMemo(() => safeParse(note?.aiResult?.reviewQuestions), [note?.aiResult?.reviewQuestions]);
  const hasSource = Boolean(note?.sourceUrl && note?.type !== "manual");
  const isManualNote = note?.type === "manual";
  const imageAssets = useMemo(() => (note?.assets || []).filter((asset) => asset.fileType === "image"), [note?.assets]);
  const mediaAssets = useMemo(() => (note?.assets || []).filter((asset) => asset.fileType === "audio" || asset.fileType === "video"), [note?.assets]);
  const isImageNote = note?.type === "image";
  const isTranscribeFailed = Boolean(note && (note.status === "failed" || /\[失败\]|转写失败|转录失败/.test(note.contentMd || "")));

  const generateReport = async (force = false) => {
    if (!note?.id || reportLoading) return;
    if (isTranscribeFailed) {
      setReportError("这条笔记转写失败，暂不生成 AI 解读。请先重新转录，或编辑原文后再解读。");
      return;
    }
    setReportLoading(true);
    setReportError("");
    try {
      const resp = await fetch("/api/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: note.id,
          force,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.report && !data.truncated) {
        setReport(cleanAIOutput(data.report));
        await loadNote();
      } else if (data.error) {
        setReportError(data.error);
      } else {
        setReportError("AI 这次没有读出内容，检查一下 AI 设置后再试。");
      }
    } catch (e: any) {
      setReportError(readableFetchError(e, "网络请求失败，AI 解读暂时没有生成。"));
    } finally {
      setReportLoading(false);
    }
  };

  const patchNote = async (body: Record<string, unknown>) => {
    if (!note) return null;
    setSaveError("");
    try {
      const resp = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSaveError(data.error || "保存失败了，请稍后再试。");
        return null;
      }
      const updated = data as NoteDetail;
      setNote(updated);
      setEditContent(updated.contentMd || "");
      setEditTitle(updated.title || updated.aiResult?.title || "");
      return updated;
    } catch (e: any) {
      setSaveError(readableFetchError(e, "网络请求失败，保存没有完成。"));
      return null;
    }
  };

  const handleSaveContent = async () => {
    if (!editContent.trim()) {
      setSaveError("正文不能为空。");
      return;
    }
    setSaving("content");
    const updated = await patchNote({ content: editContent });
    if (updated) setEditingContent(false);
    setSaving("");
  };

  const handleSaveTitle = async () => {
    if (!editTitle.trim()) {
      setSaveError("标题不能为空。");
      return;
    }
    setSaving("title");
    const updated = await patchNote({ title: editTitle.trim() });
    if (updated) setEditingTitle(false);
    setSaving("");
  };

  const handleSaveReport = async () => {
    if (!note) return;
    setSaving("report");
    try {
      const resp = await fetch("/api/ai/report", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: note.id, report: editReport }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setReport(cleanAIOutput(editReport));
        setEditingReport(false);
        await loadNote();
      } else {
        setReportError(data.error || "AI 解读保存失败了。");
      }
    } catch (e: any) {
      setReportError(readableFetchError(e, "网络请求失败，AI 解读没有保存。"));
    } finally {
      setSaving("");
    }
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
    const sourceTitle = title || "原笔记";
    try {
      const resp = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `# ${sourceTitle}｜AI 解读\n\n> 来源笔记：[${escapeMarkdown(sourceTitle)}](/note/${note.id})\n\n${report.trim()}` }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        router.push(`/note/${data.id}`);
      } else {
        setReportError(data.error || "另存为新笔记失败了。");
      }
    } catch (e: any) {
      setReportError(readableFetchError(e, "网络请求失败，另存为新笔记没有完成。"));
    } finally {
      setSaving("");
    }
  };

  const handleCopyReport = async () => {
    if (!report.trim()) return;
    await navigator.clipboard.writeText(report);
    setReuseMsg("AI 解读已复制。");
    setTimeout(() => setReuseMsg(""), 1800);
  };

  const handleAddTag = async (tagOverride?: string) => {
    if (!note) return;
    const tagPath = (tagOverride || addTagText).trim().replace(/^#/, "");
    if (!tagPath) return;
    const updated = await patchNote({ tagPath });
    if (updated) {
      setAddTagText("");
      setShowTagInput(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!note) return;
    setSaveError("");
    try {
      const resp = await fetch(`/api/notes/${note.id}?tagId=${tagId}`, { method: "DELETE" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setSaveError(data.error || "删除标签失败。");
        return;
      }
      await loadNote();
    } catch (e: any) {
      setSaveError(readableFetchError(e, "网络请求失败，标签没有删除。"));
    }
  };

  const handleDelete = async () => {
    if (!note || !confirm(deleteMode === "permanent" ? "设置当前为直接永久删除，确定删除吗？" : "把这页放进最近删除吗？")) return;
    setSaveError("");
    try {
      const resp = await fetch(`/api/notes/${note.id}${deleteMode === "permanent" ? "?permanentNow=true" : ""}`, { method: "DELETE" });
      if (resp.ok) {
        router.push("/");
      } else {
        const data = await resp.json().catch(() => ({}));
        setSaveError(data.error || "删除失败。");
      }
    } catch (e: any) {
      setSaveError(readableFetchError(e, "网络请求失败，删除没有完成。"));
    }
  };

  const handleKnowledgeBaseChange = async (knowledgeBaseId: string) => {
    if (!note) return;
    setSavingKb(true);
    await patchNote({ knowledgeBaseId: knowledgeBaseId || null });
    setSavingKb(false);
  };

  const handleRetryTranscribe = async () => {
    if (!note?.id || retryingTranscribe) return;
    setRetryingTranscribe(true);
    setReportError("");
    try {
      const resp = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: note.id }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setReportError(data.error || "重新转录启动失败，请到设置-转录里检测管线。");
      }
      await loadNote();
    } catch (e: any) {
      setReportError(readableFetchError(e, "网络请求失败，重新转录没有启动。"));
    } finally {
      setRetryingTranscribe(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen overflow-hidden bg-[var(--paper-bg)]">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <div className="mx-auto max-w-[980px] px-7 py-5">
            <div className="mb-4 flex items-center justify-between text-sm">
              <div className="h-5 w-20 animate-pulse rounded-full bg-white" />
              <div className="h-5 w-44 animate-pulse rounded-full bg-white" />
            </div>
            <section className="rounded-[8px] border border-[var(--paper-border)] bg-white px-7 py-6 shadow-[0_20px_50px_rgba(15,23,42,0.04)]">
              <div className="h-9 w-2/3 animate-pulse rounded-full bg-[var(--paper-soft)]" />
              <div className="mt-5 flex gap-2">
                <div className="h-7 w-24 animate-pulse rounded-full bg-[var(--paper-soft)]" />
                <div className="h-7 w-28 animate-pulse rounded-full bg-[var(--paper-soft)]" />
                <div className="h-7 w-32 animate-pulse rounded-full bg-[var(--paper-soft)]" />
              </div>
            </section>
            <div className="mt-5 flex gap-7 border-b border-[var(--paper-border)] py-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-white" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-white" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-white" />
            </div>
            <section className="mt-5 rounded-[8px] border border-[var(--paper-border)] bg-white px-8 py-7">
              <div className="flex items-center gap-3 text-sm text-[var(--ink-faint)]">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
                AI 正在翻到这一页...
              </div>
              <div className="mt-8 space-y-4">
                <div className="h-4 w-full animate-pulse rounded-full bg-[var(--paper-soft)]" />
                <div className="h-4 w-11/12 animate-pulse rounded-full bg-[var(--paper-soft)]" />
                <div className="h-4 w-4/5 animate-pulse rounded-full bg-[var(--paper-soft)]" />
              </div>
            </section>
          </div>
        </main>
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
                  外部资料 · {platformLabel(note.type)}
                </span>
              )}
              {isManualNote && (
                <span className="rounded-full bg-[var(--paper-soft)] px-3 py-1 text-sm text-[var(--ink-light)]">
                  笔记输入
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
                  <button onClick={() => handleAddTag()} className="text-sm text-[var(--accent-blue)]">保存</button>
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
                  onClick={() => handleAddTag(tag)}
                  className="rounded-full bg-blue-50 px-3 py-1 text-sm text-[var(--accent-blue)]"
                >
                  + 智能标签 #{tag}
                </button>
              ))}
              <select
                className="rounded-full border border-[var(--paper-border)] bg-white px-3 py-1 text-sm text-[var(--ink-light)] outline-none"
                value={note.knowledgeBaseId || ""}
                onChange={(e) => handleKnowledgeBaseChange(e.target.value)}
                disabled={savingKb}
                title="归入知识库"
              >
                <option value="">未归入知识库</option>
                {knowledgeBases.map((base) => (
                  <option key={base.id} value={base.id}>{base.name}</option>
                ))}
              </select>
            </div>
          </section>

          <div className="sticky top-0 z-10 mb-5 flex items-center gap-7 border-b border-[var(--paper-border)] bg-[var(--paper-bg)]/95 py-2 backdrop-blur">
            {[
              { key: "spirit" as Tab, label: isManualNote ? "和 AI 讨论" : "AI 解读" },
              { key: "content" as Tab, label: isManualNote ? "我的记录" : "原文" },
              { key: "source" as Tab, label: isImageNote ? "原图" : mediaAssets.length ? "源文件" : "链接原文", hide: !hasSource && imageAssets.length === 0 && mediaAssets.length === 0 },
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
            {saveError && (
              <div className="mb-5 rounded-[8px] border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {saveError}
              </div>
            )}
            {tab === "spirit" && (
              <div className="space-y-8">
                <div className="flex items-start justify-between gap-5">
                  <div className="flex items-center gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--ink)]">AI 解读</h2>
                      <p className="mt-1 text-sm text-[var(--ink-faint)]">{isManualNote ? "自己的想法以记录和修改为主，AI 可以在侧边陪你讨论。" : "这部分应该能替代你重新读一遍原文。"}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => generateReport(true)}
                    disabled={reportLoading || isTranscribeFailed}
                    className="rounded-lg border border-[var(--paper-border)] px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)] disabled:opacity-40"
                  >
                    {isManualNote ? "整理想法" : isTranscribeFailed ? "等待重新转录" : reportLoading ? "AI 正在读" : "重新解读"}
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
                    <p>这条笔记转写失败了，AI 不会解读失败提示文本。</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleRetryTranscribe}
                        disabled={retryingTranscribe}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                      >
                        {retryingTranscribe ? "重新转录中" : "重新转录"}
                      </button>
                      <button onClick={() => setTab("content")} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-white">
                        编辑原文
                      </button>
                    </div>
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
                  {isImageNote && imageAssets.length > 0 && (
                    <div className="mb-6 overflow-hidden rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-soft)]">
                      <img
                        src={`/api/assets/${imageAssets[0].id}/file`}
                        alt={imageAssets[0].fileName}
                        className="max-h-[640px] w-full object-contain"
                      />
                    </div>
                  )}
                  <article className="prose-note max-w-none text-[17px] leading-9">
                    <MarkdownView content={note.contentMd} />
                  </article>
                  <button onClick={() => setEditingContent(true)} className="mt-5 text-sm text-[var(--ink-faint)] hover:text-[var(--accent-blue)]">
                    编辑原文
                  </button>
                </div>
              )
            )}

            {tab === "source" && (hasSource || imageAssets.length > 0 || mediaAssets.length > 0) && (
              <div>
                {imageAssets.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-[var(--ink-faint)]">原始图片</p>
                    {imageAssets.map((asset) => (
                      <figure key={asset.id} className="overflow-hidden rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-soft)]">
                        <img src={`/api/assets/${asset.id}/file`} alt={asset.fileName} className="max-h-[720px] w-full object-contain" />
                        <figcaption className="border-t border-[var(--paper-border)] px-4 py-3 text-sm text-[var(--ink-faint)]">
                          {asset.fileName} · {formatFileSize(asset.fileSize)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : mediaAssets.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--ink-faint)]">上传源文件</p>
                    {mediaAssets.map((asset) => (
                      <div key={asset.id} className="rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-soft)] p-4 text-sm leading-7 text-[var(--ink-light)]">
                        <p className="font-medium text-[var(--ink)]">{asset.fileName}</p>
                        <p>类型：{asset.fileType === "video" ? "视频" : "音频"} · {formatFileSize(asset.fileSize)}</p>
                        <p>状态：{assetStatusLabel(asset.processingStatus)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="mb-2 text-sm text-[var(--ink-faint)]">原始链接</p>
                    <a href={note.sourceUrl || ""} target="_blank" rel="noopener noreferrer" className="break-all text-[15px] text-[var(--accent-blue)] hover:underline">
                      {note.sourceUrl}
                    </a>
                  </>
                )}
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
    upload: "本地上传",
    image: "图片",
  };
  return labels[type] || type;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

function readableFetchError(error: any, fallback: string): string {
  const message = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed|err_failed/i.test(message)) return fallback;
  return message || fallback;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function assetStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "等待处理",
    uploading: "上传中",
    uploaded: "已上传",
    processing: "处理中",
    completed: "已完成",
    failed: "失败",
  };
  return labels[status] || status || "未知";
}
