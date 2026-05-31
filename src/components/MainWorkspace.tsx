"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { stripMarkdown } from "@/lib/tags";

interface Note {
  id: string;
  title?: string;
  contentMd: string;
  sourceUrl?: string | null;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tags: { tag: { id: string; fullPath: string } }[];
  aiResult?: {
    summary: string;
    suggestedTags: string;
    keyPoints: string;
  } | null;
}

interface RuntimeSettings {
  defaultSort: "updated" | "created";
  aiName: string;
}

export function MainWorkspace({
  onSpiritPrompt,
}: {
  onSpiritPrompt?: (question: string) => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"write" | "link">("write");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [floatingHintOpen, setFloatingHintOpen] = useState(false);
  const [settings, setSettings] = useState<RuntimeSettings>({ defaultSort: "updated", aiName: "AI" });
  const [openingNoteId, setOpeningNoteId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    const params = new URLSearchParams({ limit: "100", sort: "created", viewMode: "timeline" });
    const resp = await fetch(`/api/notes?${params}`);
    const data = await resp.json();
    setNotes(sortByTimeline(data.notes || []));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((resp) => resp.json())
      .then((data) => setSettings({ defaultSort: data.knowledge?.defaultSort || "updated", aiName: data.spirit?.name || "AI" }))
      .catch(() => {});
  }, []);

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
      fetchNotes();
    }
    setSaving(false);
  };

  const submitLink = async () => {
    const url = linkUrl.trim();
    if (!url || saving) return;
    setSaving(true);
    setLinkMsg("AI 正在识别这条链接...");
    const resp = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      setLinkUrl("");
      setLinkMsg("");
      fetchNotes();
    } else {
      setLinkMsg(data.error || "这条链接暂时没有收好。");
    }
    setSaving(false);
  };

  const retryTranscribe = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (retryingId) return;
    setRetryingId(noteId);
    const resp = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || "重新转录启动失败");
    }
    await fetchNotes();
    setRetryingId(null);
  };

  const groups = useMemo(() => groupTimeline(notes), [notes]);
  const prompt = makeTimelinePrompt(notes, settings.aiName);

  useEffect(() => {
    if (!prompt) return;
    const showDelay = 16000 + Math.random() * 12000;
    let hideTimer: number | undefined;
    const showTimer = window.setTimeout(() => {
      setFloatingHintOpen(true);
      hideTimer = window.setTimeout(() => setFloatingHintOpen(false), 11000);
    }, showDelay);
    return () => {
      window.clearTimeout(showTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [prompt?.question]);

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#f6f6f8]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 pb-20 pt-8">
          <Composer
            open={composerOpen}
            setOpen={setComposerOpen}
            mode={mode}
            setMode={setMode}
            content={content}
            setContent={setContent}
            saving={saving}
            save={save}
            linkUrl={linkUrl}
            setLinkUrl={setLinkUrl}
            submitLink={submitLink}
            linkMsg={linkMsg}
          />

          <div className="mt-12 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-[#a0a4ad]">Timeline</p>
              <h1 className="mt-2 text-[25px] font-semibold tracking-[-0.025em] text-[#1d1d1f]">最近的笔记流</h1>
              <p className="mt-2 text-sm leading-6 text-[#7a828f]">按写下或收进来的时间排列，新的在前面。</p>
            </div>
            <button onClick={fetchNotes} className="rounded-full bg-white/75 px-4 py-2 text-sm text-[#6b7280] shadow-[0_10px_35px_rgba(0,0,0,0.05)] hover:text-[#1d1d1f]">
              刷新
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-24">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d1d5db] border-t-[#1d1d1f]" />
            </div>
          ) : notes.length === 0 ? (
            <div className="py-24 text-center text-sm text-[#8f96a3]">还没有笔记。先写一句话就好。</div>
          ) : (
            <div className="mt-8 space-y-8">
              {groups.map((group) => (
                <section key={group.label} className="grid gap-3 md:grid-cols-[56px_1fr]">
                  <div className="pt-1 md:text-right">
                    <p className="text-[13px] font-medium text-[#1d1d1f]">{group.label}</p>
                    <p className="mt-1 text-[11px] text-[#a0a4ad]">{group.notes.length} 页</p>
                  </div>
                  <div className="relative space-y-3 border-l border-[#e4e6eb] pl-5">
                    {group.notes.map((note) => (
                      <TimelineEntry
                        key={note.id}
                        note={note}
                        onOpen={() => {
                          setOpeningNoteId(note.id);
                          router.push(`/note/${note.id}`);
                        }}
                        onPrefetch={() => router.prefetch(`/note/${note.id}`)}
                        onRetry={(e) => retryTranscribe(e, note.id)}
                        retrying={retryingId === note.id}
                        opening={openingNoteId === note.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      {prompt && (
        <FloatingHint
          open={floatingHintOpen}
          aiName={settings.aiName}
          question={prompt.question}
          onToggle={() => setFloatingHintOpen((value) => !value)}
          onAsk={() => {
            setFloatingHintOpen(false);
            onSpiritPrompt?.(prompt.question);
          }}
        />
      )}
    </main>
  );
}

function Composer({
  open,
  setOpen,
  mode,
  setMode,
  content,
  setContent,
  saving,
  save,
  linkUrl,
  setLinkUrl,
  submitLink,
  linkMsg,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  mode: "write" | "link";
  setMode: (mode: "write" | "link") => void;
  content: string;
  setContent: (value: string) => void;
  saving: boolean;
  save: () => void;
  linkUrl: string;
  setLinkUrl: (value: string) => void;
  submitLink: () => void;
  linkMsg: string;
}) {
  return (
    <section className={`rounded-[26px] bg-white/92 shadow-[0_18px_55px_rgba(15,23,42,0.065)] ring-1 ring-black/[0.045] backdrop-blur transition-all ${open ? "px-7 py-6" : "px-5 py-4"}`}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="flex w-full items-center justify-between text-left">
          <span className="text-[16px] text-[#8f96a3]">写一句，或收一条链接...</span>
          <span className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm text-white">打开</span>
        </button>
      ) : (
      <>
      <div className="flex gap-5">
        <button onClick={() => setMode("write")} className={composerTab(mode === "write")}>记一页</button>
        <button onClick={() => setMode("link")} className={composerTab(mode === "link")}>收链接</button>
        <button onClick={() => setOpen(false)} className="ml-auto rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs text-[#8f96a3] hover:text-[#1d1d1f]">收起</button>
      </div>
      {mode === "write" ? (
        <>
          <textarea
            className="mt-6 min-h-[120px] w-full resize-none bg-transparent text-[21px] leading-9 text-[#1d1d1f] outline-none placeholder:text-[#a0a4ad]"
            placeholder={pickPlaceholder()}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-[#8f96a3]">Ctrl + Enter 收好 · 支持 #标签/子标签</span>
            <button onClick={save} disabled={!content.trim() || saving} className="rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm text-white disabled:bg-[#c9d3f7]">
              {saving ? "保存中" : content.trim() ? "收好" : "保存"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-6 flex gap-3">
            <input
              type="url"
              className="min-h-[56px] flex-1 rounded-[18px] bg-[#f5f5f7] px-4 text-[16px] outline-none placeholder:text-[#a0a4ad]"
              placeholder="贴一条抖音 / B站 / YouTube / 小红书链接"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitLink();
              }}
            />
            <button onClick={submitLink} disabled={!linkUrl.trim() || saving} className="rounded-[18px] bg-[#1d1d1f] px-5 text-sm text-white disabled:bg-[#c9d3f7]">
              {saving ? "整理中" : "收下"}
            </button>
          </div>
          {linkMsg && <p className="mt-3 text-sm text-[#6b7280]">{linkMsg}</p>}
        </>
      )}
      </>
      )}
    </section>
  );
}

function FloatingHint({
  open,
  aiName,
  question,
  onToggle,
  onAsk,
}: {
  open: boolean;
  aiName: string;
  question: string;
  onToggle: () => void;
  onAsk: () => void;
}) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-7 right-8 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[#1d1d1f] text-[18px] text-white shadow-[0_20px_60px_rgba(0,0,0,0.22)] transition-transform hover:-translate-y-0.5"
      >
        ✨
      </button>
    );
  }

  return (
    <div className="fixed bottom-7 right-8 z-20 max-w-[360px] animate-fade-up">
      <div className="relative rounded-[24px] bg-[#1d1d1f] px-5 py-4 text-white shadow-[0_28px_85px_rgba(0,0,0,0.25)]">
        <button onClick={onToggle} className="absolute right-3 top-3 rounded-full px-2 text-xs text-white/45 hover:text-white">×</button>
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#7dd3fc]" />
          <span className="text-xs text-white/55">💭 {aiName} 刚冒出来</span>
        </div>
        <button onClick={onAsk} className="block text-left text-[15px] leading-7 text-white">
          {question}
        </button>
      </div>
      <div className="ml-auto mr-8 h-4 w-4 rotate-45 bg-[#1d1d1f]" />
    </div>
  );
}

function TimelineEntry({
  note,
  onOpen,
  onPrefetch,
  onRetry,
  retrying,
  opening,
}: {
  note: Note;
  onOpen: () => void;
  onPrefetch: () => void;
  onRetry: (e: React.MouseEvent) => void;
  retrying: boolean;
  opening: boolean;
}) {
  const preview = makeNotePreview(note);
  const isFailed = (note.status === "failed" || note.contentMd.includes("[失败]")) && Boolean(note.sourceUrl);
  const points = safeParse(note.aiResult?.keyPoints).slice(0, 2);

  return (
    <article className="group relative">
      <span className="absolute -left-[21px] top-6 h-2.5 w-2.5 rounded-full bg-[#1d1d1f] ring-4 ring-[#f6f6f8]" />
      <button onClick={onOpen} onMouseEnter={onPrefetch} className="w-full rounded-[18px] bg-white/78 px-5 py-4 text-left shadow-[0_12px_34px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.035] transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {note.aiResult && note.type !== "manual" && <span className="rounded-full bg-[#edf3ff] px-2.5 py-1 text-xs text-[#2563eb]">AI 整理</span>}
              <span className={`rounded-full px-2.5 py-1 text-xs ${note.type === "manual" ? "bg-[#f5f5f7] text-[#69707d]" : "bg-[#eef3ff] text-[#2563eb]"}`}>{sourceLabel(note.type)}</span>
              {isFailed && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-500">转录失败</span>}
              <span className="ml-auto text-xs text-[#a0a4ad]">{opening ? "打开中..." : formatTime(note.createdAt)}</span>
            </div>
            <h2 className="line-clamp-2 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-[#1d1d1f]">{note.title || preview.title || "未命名笔记"}</h2>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-[15px] leading-7 text-[#5f6673]">{note.type === "manual" ? preview.body : note.aiResult?.summary || preview.body}</p>
            {points.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {points.map((point, index) => <span key={`${point}-${index}`} className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs text-[#69707d]">{point}</span>)}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {note.tags?.slice(0, 4).map((nt) => <span key={nt.tag.id} className="text-xs text-[#2563eb]">#{nt.tag.fullPath}</span>)}
              {isFailed && (
                <span
                  onClick={onRetry}
                  className="ml-auto rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-500 hover:bg-red-100"
                >
                  {retrying ? "重试中" : "重新转录"}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </article>
  );
}

function groupTimeline(notes: Note[]) {
  const groups = new Map<string, Note[]>();
  for (const note of sortByTimeline(notes)) {
    const label = timelineDateLabel(note.createdAt);
    groups.set(label, [...(groups.get(label) || []), note]);
  }
  return Array.from(groups.entries()).map(([label, groupNotes]) => ({ label, notes: groupNotes }));
}

function sortByTimeline(notes: Note[]) {
  return [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function composerTab(active: boolean) {
  return `pb-2 text-[15px] transition-colors ${active ? "border-b-2 border-[#2563eb] font-semibold text-[#1d1d1f]" : "border-b-2 border-transparent text-[#8f96a3] hover:text-[#1d1d1f]"}`;
}

function makeTimelinePrompt(notes: Note[], aiName: string) {
  const usable = notes.filter((note) => note.status !== "processing");
  if (usable.length === 0) return null;
  const first = noteDisplayTitle(usable[0]);
  if (usable.length === 1) {
    return { question: `围绕「${first}」，${aiName} 可以帮你追问 3 个还值得继续想的问题。` };
  }
  return { question: `把最近这 ${Math.min(usable.length, 6)} 条笔记串成一条主题线索，并指出最值得复习的一页。` };
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

function makeNotePreview(note: Note) {
  const raw = note.contentMd || "";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => cleanMarkdownLine(line))
    .filter((line) => line && !/^来源[:：]|^平台[:：]|^-{3,}$/.test(line));
  const firstTitle = lines.find((line) => line.length > 0) || "";
  const body = lines.filter((line) => line !== firstTitle).join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 260);
  return {
    title: firstTitle.slice(0, 80) || stripMarkdown(raw).slice(0, 80),
    body: body || stripMarkdown(raw).slice(0, 220),
  };
}

function cleanMarkdownLine(line: string) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[#*_~]/g, "")
    .trim();
}

function noteDisplayTitle(note: Note) {
  return (note.title || makeNotePreview(note).title || "这条笔记").slice(0, 42);
}

function timelineDateLabel(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sourceLabel(type: string) {
  const labels: Record<string, string> = { manual: "笔记输入", douyin: "外部资料 · 抖音", bilibili: "外部资料 · B站", youtube: "外部资料 · YouTube", xiaohongshu: "外部资料 · 小红书", link: "外部资料 · 链接", web: "外部资料 · 网页" };
  return labels[type] || `外部资料 · ${type}`;
}

function pickPlaceholder(): string {
  const placeholders = ["一句话，也可以长成一页。", "把一闪而过的念头放在这里。", "今天有什么值得被记住？", "落笔就是整理，不用急。"];
  return placeholders[new Date().getHours() % placeholders.length];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
