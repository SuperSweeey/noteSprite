"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { stripMarkdown } from "@/lib/tags";

interface Note {
  id: string;
  title?: string;
  contentMd: string;
  type: string;
  status: string;
  createdAt: string;
  tags: { tag: { id: string; fullPath: string } }[];
  aiResult?: {
    summary: string;
    suggestedTags: string;
    keyPoints: string;
  } | null;
}

function safeParse(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function MainWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(searchParams.get("tag"));
  const [mode, setMode] = useState<"write" | "link">("write");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const fetchNotes = useCallback(async () => {
    const params = new URLSearchParams({ limit: "80" });
    if (activeTag) params.set("tag", activeTag);
    const resp = await fetch(`/api/notes?${params}`);
    const data = await resp.json();
    setNotes(data.notes || []);
    setLoading(false);
  }, [activeTag]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const hasProcessing = notes.some((note) => note.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(fetchNotes, 3000);
    return () => clearInterval(timer);
  }, [fetchNotes, hasProcessing]);

  const save = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    const resp = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (resp.ok) {
      setContent("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
      fetchNotes();
    }
    setSaving(false);
  };

  const submitLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setSaving(true);
    setLinkMsg("笔记精灵正在识别这条链接...");
    const resp = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setLinkUrl("");
      setLinkMsg("");
      fetchNotes();
    } else {
      setLinkMsg(data.error || "这条链接暂时没有收好。");
    }
    setSaving(false);
  };

  const handleArchive = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    fetchNotes();
  };

  const handleDelete = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (!confirm("确定把这页放进最近删除吗？")) return;
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    fetchNotes();
  };

  const grouped = groupByTime(notes);

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[var(--paper-bg)]">
      <div className="px-6 pb-4 pt-6">
        <div className="paper-card p-5">
          <div className="mb-4 flex gap-6">
            <button
              onClick={() => setMode("write")}
              className={`border-b-2 pb-1.5 text-[15px] transition-colors ${
                mode === "write"
                  ? "border-[var(--gold)] font-medium text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-light)]"
              }`}
            >
              记一页
            </button>
            <button
              onClick={() => setMode("link")}
              className={`border-b-2 pb-1.5 text-[15px] transition-colors ${
                mode === "link"
                  ? "border-[var(--gold)] font-medium text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-light)]"
              }`}
            >
              收链接
            </button>
          </div>

          {mode === "write" ? (
            <div className={justSaved ? "opacity-50 transition-opacity duration-500" : ""}>
              <textarea
                className="min-h-[80px] w-full resize-none bg-transparent text-[17px] leading-relaxed text-[var(--ink)] outline-none"
                style={{ caretColor: "var(--gold)" }}
                placeholder={pickPlaceholder()}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    save();
                  }
                }}
                autoFocus
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[13px] text-[var(--ink-faint)]">Ctrl + Enter 收好 · 支持 #标签/子标签</span>
                <button
                  onClick={save}
                  disabled={!content.trim() || saving}
                  className="rounded-full px-4 py-1.5 text-sm font-medium text-white transition-all active:scale-95 disabled:opacity-25"
                  style={{ background: "var(--gold)" }}
                >
                  {saving ? "..." : content.trim() ? "收好" : "保存"}
                </button>
              </div>
              {justSaved && <p className="mt-2 text-[13px] text-[var(--sage)]">这一页已经被 NoteSprite 收进来了。</p>}
            </div>
          ) : (
            <div>
              <div className="flex gap-2">
                <input
                  type="url"
                  className="flex-1 rounded-xl border border-[var(--paper-border)] bg-[var(--paper-bg)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none"
                  placeholder="贴一条抖音 / B站 / YouTube / 小红书链接"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitLink();
                  }}
                  autoFocus
                />
                <button
                  onClick={submitLink}
                  disabled={!linkUrl.trim() || saving}
                  className="whitespace-nowrap rounded-xl px-5 py-3 text-sm font-medium text-white transition-all active:scale-95 disabled:opacity-25"
                  style={{ background: "var(--gold)" }}
                >
                  {saving ? "整理中..." : "收下链接"}
                </button>
              </div>
              {linkMsg && <p className="mt-2 pl-1 text-[13px] text-[var(--ink-light)]">{linkMsg}</p>}
              <p className="mt-3 pl-1 text-[13px] text-[var(--ink-faint)]">
                自动下载 → 转成文字 → 交给笔记精灵整理 → 存进 NoteSprite
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-12">
        <div className="flex items-center justify-between px-7 py-3">
          <span className="text-[15px] font-medium text-[var(--ink)]">
            笔记
            {!loading && <span className="ml-1 font-normal text-[var(--ink-faint)]">{notes.length}</span>}
          </span>
          <div className="flex items-center gap-3">
            {activeTag && (
              <button
                onClick={() => setActiveTag(null)}
                className="rounded-full bg-[var(--gold-light)] px-3 py-1 text-[13px] text-[var(--gold)]"
              >
                #{activeTag} ×
              </button>
            )}
            <button onClick={fetchNotes} className="text-[var(--ink-faint)] hover:text-[var(--ink-light)]" title="刷新">
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--paper-border)] border-t-[var(--gold)]" />
          </div>
        ) : notes.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <p className="mb-2 text-2xl">✦</p>
            <p className="font-prose text-[15px] text-[var(--ink-light)]">这里还很安静。</p>
            <p className="mt-1.5 text-[13px] text-[var(--ink-faint)]">写下第一条想法，NoteSprite 会陪你把它慢慢整理好。</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([group, groupNotes]) => (
              <div key={group}>
                <div className="sticky top-0 z-10 bg-[var(--paper-bg)]/90 px-7 py-2.5 text-[13px] font-medium text-[var(--ink-faint)] backdrop-blur-sm">
                  {group}
                </div>
                <div className="space-y-2 px-5">
                  {groupNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onTagClick={(tag) => setActiveTag(tag === activeTag ? null : tag)}
                      onArchive={(e) => handleArchive(e, note.id)}
                      onDelete={(e) => handleDelete(e, note.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function NoteCard({
  note,
  onTagClick,
  onArchive,
  onDelete,
}: {
  note: Note;
  onTagClick: (tag: string) => void;
  onArchive: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const router = useRouter();
  const isProcessing = note.status === "processing";
  const cleanContent = stripMarkdown(note.contentMd);
  const title = note.title || cleanContent.slice(0, 120);
  const summary = note.aiResult?.summary || "";
  const suggestedTags = safeParse(note.aiResult?.suggestedTags);
  const keyPoints = safeParse(note.aiResult?.keyPoints);
  const bodyPreview = summary || cleanContent.slice(0, 160);

  return (
    <div
      className={`paper-card px-5 py-4 ${isProcessing ? "cursor-default opacity-70" : "cursor-pointer"}`}
      onClick={() => {
        if (!isProcessing) router.push(`/note/${note.id}`);
      }}
    >
      {isProcessing ? (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--gold)] border-t-transparent" />
            <span className="text-sm font-medium text-[var(--gold)]">笔记精灵正在整理这页...</span>
          </div>
          <p className="text-sm text-[var(--ink-faint)]">{note.contentMd.slice(0, 80)}</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            {note.type !== "manual" && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  note.type === "link" ? "bg-blue-50 text-blue-600" : "bg-[var(--sage-light)] text-[var(--sage)]"
                }`}
              >
                {note.type === "link" ? "链接" : platformBadge(note.type)}
              </span>
            )}
            {summary && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">AI 整理</span>}
            <span className="ml-auto text-xs text-[var(--ink-faint)]">{formatTime(note.createdAt)}</span>
          </div>

          <p className="mb-1.5 line-clamp-2 text-[16px] font-medium leading-relaxed text-[var(--ink)]">{title}</p>

          {bodyPreview && <p className="mb-2 line-clamp-2 text-[14px] leading-relaxed text-[var(--ink-light)]">{bodyPreview}</p>}

          {keyPoints.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {keyPoints.slice(0, 3).map((point, index) => (
                <span key={`${point}-${index}`} className="rounded-full bg-[var(--sage-light)]/70 px-2 py-0.5 text-xs text-[var(--sage)]">
                  · {point.slice(0, 30)}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {note.tags?.slice(0, 3).map((nt) => (
              <span
                key={nt.tag.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick(nt.tag.fullPath);
                }}
                className="cursor-pointer rounded-full bg-[var(--gold-light)] px-2 py-0.5 text-xs text-[var(--gold)] transition-opacity hover:opacity-80"
              >
                #{nt.tag.fullPath}
              </span>
            ))}

            {note.tags?.length > 3 && <span className="text-xs text-[var(--ink-faint)]">+{note.tags.length - 3}</span>}

            {suggestedTags
              .filter((tag) => !note.tags?.some((nt) => nt.tag.fullPath === tag))
              .slice(0, 2)
              .map((tag) => (
                <span
                  key={tag}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(tag);
                  }}
                  className="cursor-pointer rounded-full border border-dashed border-[var(--paper-border)] px-2 py-0.5 text-xs text-[var(--ink-faint)] hover:bg-[var(--paper-hover)]"
                >
                  +{tag}
                </span>
              ))}

            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/note/${note.id}`);
                }}
                className="rounded px-2 py-1 text-xs text-[var(--ink-faint)] transition-colors hover:bg-[var(--paper-hover)] hover:text-[var(--ink)]"
              >
                打开
              </button>
              {note.status === "inbox" && (
                <button
                  onClick={(e) => onArchive(e as any)}
                  className="rounded px-2 py-1 text-xs text-[var(--ink-faint)] transition-colors hover:bg-[var(--sage-light)] hover:text-[var(--sage)]"
                >
                  归档
                </button>
              )}
              <button
                onClick={(e) => onDelete(e as any)}
                className="rounded px-2 py-1 text-xs text-[var(--ink-faint)] transition-colors hover:bg-red-50 hover:text-red-400"
              >
                删除
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function platformBadge(type: string): string {
  const labels: Record<string, string> = {
    douyin: "抖音",
    bilibili: "B站",
    youtube: "YouTube",
    xiaohongshu: "小红书",
    web: "网页",
    pdf: "PDF",
  };
  return labels[type] || type;
}

function pickPlaceholder(): string {
  const placeholders = [
    "把一闪而过的念头放在这里。",
    "一句话，也可以长成一页。",
    "落笔就是整理，不用急。",
    "今天有什么值得被记住？",
    "贴一条链接，笔记精灵会帮你收好。",
  ];
  return placeholders[new Date().getHours() % placeholders.length];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 6) return `${hours} 小时前`;
  if (hours < 24) {
    return `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (days < 2) return "昨天";
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function groupByTime(notes: Note[]): Record<string, Note[]> {
  const groups: Record<string, Note[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  for (const note of notes) {
    const date = new Date(note.createdAt);
    const label =
      date >= today
        ? "今天"
        : date >= yesterday
          ? "昨天"
          : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    (groups[label] ??= []).push(note);
  }
  return groups;
}
