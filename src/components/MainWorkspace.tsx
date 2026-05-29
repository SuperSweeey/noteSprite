"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { stripMarkdown } from "@/lib/tags";

interface Note {
  id: string; contentMd: string; type: string; status: string; createdAt: string;
  tags: { tag: { name: string; fullPath: string } }[];
  aiResult?: { summary: string; suggestedTags: string; keyPoints: string } | null;
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
    setNotes((await resp.json()).notes || []);
    setLoading(false);
  }, [activeTag]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const hasProcessing = notes.some((n) => n.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(fetchNotes, 3000);
    return () => clearInterval(t);
  }, [hasProcessing, fetchNotes]);

  const save = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    const resp = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) });
    if (resp.ok) { setContent(""); setJustSaved(true); setTimeout(() => setJustSaved(false), 1800); fetchNotes(); }
    setSaving(false);
  };

  const submitLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setSaving(true); setLinkMsg("正在识别链接...");
    const resp = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const data = await resp.json();
    if (resp.ok) { setLinkUrl(""); setLinkMsg(""); fetchNotes(); }
    else setLinkMsg(data.error || "出了点问题");
    setSaving(false);
  };

  const handleArchive = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    await fetch(`/api/notes/${noteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) });
    fetchNotes();
  };

  const handleDelete = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (!confirm("确定删除？")) return;
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    fetchNotes();
  };

  const handleTagClick = (tag: string) => setActiveTag(tag === activeTag ? null : tag);
  const grouped = groupByTime(notes);

  return (
    <main className="flex-1 min-h-screen flex flex-col bg-[var(--paper-bg)]">
      {/* Capture area — paper card */}
      <div className="px-6 pt-6 pb-4">
        <div className="paper-card p-5">
          {/* Mode tabs */}
          <div className="flex gap-6 mb-4">
            <button onClick={() => setMode("write")} className={`text-[15px] pb-1.5 border-b-2 transition-colors ${mode === "write" ? "text-[var(--ink)] border-[var(--gold)] font-medium" : "text-[var(--ink-faint)] border-transparent hover:text-[var(--ink-light)]"}`}>写想法</button>
            <button onClick={() => setMode("link")} className={`text-[15px] pb-1.5 border-b-2 transition-colors ${mode === "link" ? "text-[var(--ink)] border-[var(--gold)] font-medium" : "text-[var(--ink-faint)] border-transparent hover:text-[var(--ink-light)]"}`}>丢链接</button>
          </div>

          {mode === "write" ? (
            <div className={justSaved ? "opacity-50 transition-opacity duration-500" : ""}>
              <textarea
                className="w-full min-h-[80px] text-[17px] leading-relaxed outline-none resize-none bg-transparent text-[var(--ink)] font-prose"
                style={{ caretColor: "var(--gold)" }}
                placeholder={pickPlaceholder()}
                value={content} onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
                autoFocus
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[13px] text-[var(--ink-faint)]">Ctrl + Enter 收好 · #标签/子标签</span>
                <button onClick={save} disabled={!content.trim() || saving}
                  className="px-4 py-1.5 text-sm rounded-full transition-all active:scale-95 disabled:opacity-25 font-medium"
                  style={{ background: "var(--gold)", color: "#fff" }}>
                  {saving ? "..." : content.trim() ? "收好" : "保存"}
                </button>
              </div>
              {justSaved && <p className="text-[13px] text-[var(--sage)] mt-2 animate-pulse">已收好 ✨</p>}
            </div>
          ) : (
            <div>
              <div className="flex gap-2">
                <input type="url"
                  className="flex-1 px-4 py-3 rounded-xl outline-none border border-[var(--paper-border)] bg-[var(--paper-bg)] text-[15px] text-[var(--ink)] font-ui"
                  placeholder="粘贴抖音 / B站 / YouTube / 小红书链接"
                  value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitLink(); }} autoFocus />
                <button onClick={submitLink} disabled={!linkUrl.trim() || saving}
                  className="px-5 py-3 rounded-xl text-sm transition-all active:scale-95 disabled:opacity-25 font-medium whitespace-nowrap"
                  style={{ background: "var(--gold)", color: "#fff" }}>
                  {saving ? "处理中..." : "收下链接"}
                </button>
              </div>
              {linkMsg && <p className="text-[13px] text-[var(--ink-light)] mt-2 pl-1">{linkMsg}</p>}
              <p className="text-[13px] text-[var(--ink-faint)] mt-3 pl-1">自动下载 → 转文字 → AI 摘要 → 收进笔记</p>
            </div>
          )}
        </div>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto pb-12">
        <div className="flex items-center justify-between px-7 py-3">
          <span className="text-[15px] font-medium text-[var(--ink)]">笔记 {!loading && <span className="text-[var(--ink-faint)] font-normal ml-1">{notes.length}</span>}</span>
          <div className="flex items-center gap-3">
            {activeTag && (
              <button onClick={() => setActiveTag(null)} className="text-[13px] text-[var(--gold)] bg-[var(--gold-light)] px-3 py-1 rounded-full">#{activeTag} ×</button>
            )}
            <button onClick={fetchNotes} className="text-[var(--ink-faint)] hover:text-[var(--ink-light)]" title="刷新">↻</button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-4 h-4 border-2 border-[var(--paper-border)] border-t-[var(--gold)] rounded-full animate-spin" /></div>
        ) : notes.length === 0 ? (
          <div className="text-center py-16 px-8">
            <p className="text-2xl mb-2">🌱</p>
            <p className="text-[15px] text-[var(--ink-light)] font-prose">这里还是空白</p>
            <p className="text-[13px] text-[var(--ink-faint)] mt-1.5">写下第一条想法吧，不用想太多</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([group, groupNotes]) => (
              <div key={group}>
                <div className="px-7 py-2.5 text-[13px] text-[var(--ink-faint)] font-medium sticky top-0 bg-[var(--paper-bg)]/90 backdrop-blur-sm z-10">{group}</div>
                <div className="px-5 space-y-2">
                  {groupNotes.map((note) => (
                    <NoteCard key={note.id} note={note} onTagClick={handleTagClick} onArchive={(e) => handleArchive(e, note.id)} onDelete={(e) => handleDelete(e, note.id)} />
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

/* ---- Note Card ---- */

function NoteCard({ note, onTagClick, onArchive, onDelete }: {
  note: Note; onTagClick: (t: string) => void; onArchive: (e: React.MouseEvent) => void; onDelete: (e: React.MouseEvent) => void;
}) {
  const router = useRouter();
  const isProcessing = note.status === "processing";
  const [menuOpen, setMenuOpen] = useState(false);
  const cleanContent = stripMarkdown(note.contentMd);
  const title = note.aiResult?.summary || cleanContent.slice(0, 120);
  const suggestedTags: string[] = note.aiResult?.suggestedTags ? safeParse(note.aiResult.suggestedTags) : [];
  const keyPoints: string[] = note.aiResult?.keyPoints ? safeParse(note.aiResult.keyPoints) : [];
  const bodyPreview = note.aiResult?.summary ? cleanContent.slice(0, 200) : cleanContent.slice(0, 160);

  return (
    <div
      className={`paper-card px-5 py-4 ${isProcessing ? "cursor-default opacity-70" : "cursor-pointer"}`}
      onClick={() => { if (!isProcessing) router.push(`/note/${note.id}`); }}
    >
      {isProcessing ? (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-3.5 h-3.5 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--gold)] font-medium">精灵正在整理...</span>
          </div>
          <p className="text-sm text-[var(--ink-faint)]">{note.contentMd.slice(0, 80)}</p>
        </div>
      ) : (
        <>
          {/* Top row: type badge + time */}
          <div className="flex items-center gap-2 mb-2">
            {note.type !== "manual" && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                note.type === "link" ? "text-blue-600 bg-blue-50" : "text-[var(--sage)] bg-[var(--sage-light)]"
              }`}>
                {note.type === "link" ? "链接" : platformBadge(note.type)}
              </span>
            )}
            {note.aiResult?.summary && note.type !== "manual" && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">AI {note.type === "link" ? "链接" : ""}笔记</span>
            )}
            <span className="text-xs text-[var(--ink-faint)] ml-auto">{formatTime(note.createdAt)}</span>
          </div>

          {/* Title */}
          <p className="text-[16px] leading-relaxed font-medium text-[var(--ink)] line-clamp-2 font-prose mb-1.5">{title}</p>

          {/* Body preview */}
          {bodyPreview && (
            <p className="text-[14px] text-[var(--ink-light)] leading-relaxed line-clamp-2 font-prose mb-2">{bodyPreview}</p>
          )}

          {/* Key points quick view */}
          {keyPoints.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {keyPoints.slice(0, 3).map((p, i) => (
                <span key={i} className="text-xs text-[var(--sage)] bg-[var(--sage-light)]/70 px-2 py-0.5 rounded-full">• {p.slice(0, 30)}</span>
              ))}
            </div>
          )}

          {/* Tags + actions row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {note.tags?.slice(0, 3).map((nt) => (
              <span key={nt.tag.id} onClick={(e) => { e.stopPropagation(); onTagClick(nt.tag.fullPath); }}
                className="text-xs text-[var(--gold)] bg-[var(--gold-light)] px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity">#{nt.tag.fullPath}</span>
            ))}
            {note.tags?.length > 3 && (
              <span className="text-xs text-[var(--ink-faint)]">+{note.tags.length - 3}</span>
            )}
            {suggestedTags.filter((t) => !note.tags?.some((nt) => nt.tag.fullPath === t)).slice(0, 2).map((t) => (
              <span key={t} onClick={(e) => { e.stopPropagation(); onTagClick(t); }}
                className="text-xs text-[var(--ink-faint)] px-2 py-0.5 rounded-full cursor-pointer hover:bg-[var(--paper-hover)] border border-dashed border-[var(--paper-border)]">+{t}</span>
            ))}

            {/* Actions — always visible */}
            <div className="ml-auto flex items-center gap-0.5">
              <button onClick={(e) => { e.stopPropagation(); router.push(`/note/${note.id}`); }}
                className="px-2 py-1 text-xs text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--paper-hover)] rounded transition-colors">展阅</button>
              {note.status === "inbox" && (
                <button onClick={(e) => { onArchive(e as any); }}
                  className="px-2 py-1 text-xs text-[var(--ink-faint)] hover:text-[var(--sage)] hover:bg-[var(--sage-light)] rounded transition-colors">收好</button>
              )}
              <button onClick={(e) => { onDelete(e as any); }}
                className="px-2 py-1 text-xs text-[var(--ink-faint)] hover:text-red-400 hover:bg-red-50 rounded transition-colors">撕掉</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function platformBadge(t: string): string {
  const m: Record<string, string> = { douyin: "抖音", bilibili: "B站", youtube: "YouTube", xiaohongshu: "小红书", web: "网页", pdf: "PDF" };
  return m[t] || t;
}

function pickPlaceholder(): string {
  const list = ["把一闪而过的念头放在这里", "一句话，也可以成为一页", "落笔即是整理，不急", "今日何事，值得被记住？", "丢一个链接，我帮你收好"];
  return list[new Date().getHours() % list.length];
}

function formatTime(iso: string): string {
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000); const h = Math.floor(diff / 3600000); const days = Math.floor(diff / 86400000);
  if (m < 1) return "刚刚"; if (m < 60) return `${m} 分钟前`;
  if (h < 6) return `${h} 小时前`; if (h < 24) return "今天 " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (days < 2) return "昨天"; if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function groupByTime(notes: Note[]): Record<string, Note[]> {
  const groups: Record<string, Note[]> = {};
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  for (const note of notes) {
    const d = new Date(note.createdAt);
    const label = d >= today ? "今天" : d >= yesterday ? "昨天" : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    (groups[label] ??= []).push(note);
  }
  return groups;
}

function safeParse(s: string): string[] { try { return JSON.parse(s); } catch { return []; } }
