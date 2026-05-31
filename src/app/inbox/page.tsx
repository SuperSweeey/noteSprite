"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { stripMarkdown } from "@/lib/tags";

export default function InboxPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"list" | "card">("list");
  const [bases, setBases] = useState<any[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [targetBaseId, setTargetBaseId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const fetchNotes = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100", sort: "updated", viewMode: "list" });
    if (query.trim()) params.set("search", query.trim());
    if (source !== "all") params.set("source", source);
    if (status !== "all") params.set("status", status);
    fetch(`/api/notes?${params}`)
      .then((r) => r.json())
      .then((data) => setNotes(data.notes || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(fetchNotes, 180);
    return () => clearTimeout(timer);
  }, [query, source, status]);

  useEffect(() => {
    fetch("/api/knowledge-bases")
      .then((r) => r.json())
      .then((data) => {
        const nextBases = data.bases || [];
        setBases(nextBases);
        setTargetBaseId((current) => current || nextBases[0]?.id || "");
      })
      .catch(() => setBases([]));
  }, []);

  const counts = useMemo(() => {
    return {
      all: notes.length,
      failed: notes.filter((note) => note.status === "failed").length,
      inbox: notes.filter((note) => note.status === "inbox").length,
      ai: notes.filter((note) => note.aiResult).length,
    };
  }, [notes]);

  const toggleNote = (noteId: string) => {
    setSelectedNoteIds((current) => current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]);
  };

  const assignSelectedToBase = async () => {
    if (!targetBaseId || selectedNoteIds.length === 0 || assigning) return;
    setAssigning(true);
    const resp = await fetch(`/api/knowledge-bases/${targetBaseId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteIds: selectedNoteIds }),
    });
    if (resp.ok) {
      setSelectedNoteIds([]);
      fetchNotes();
    }
    setAssigning(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col bg-[var(--paper-bg)]">
        <header className="px-8 pb-4 pt-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ink-faint)]">Collection</p>
          <div className="mt-3 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-[34px] font-semibold leading-tight text-[var(--ink)]">收集箱</h1>
              <p className="mt-2 max-w-[620px] text-sm leading-7 text-[var(--ink-light)]">
                所有笔记的入口。这里负责搜索、筛选、处理失败项和快速打开原始内容。
              </p>
            </div>
            <div className="flex gap-5 text-sm">
              <Metric label="全部" value={counts.all} />
              <Metric label="未归档" value={counts.inbox} />
              <Metric label="AI 整理" value={counts.ai} />
              <Metric label="失败" value={counts.failed} />
            </div>
          </div>
        </header>

        <section className="mx-8 mb-4 rounded-[8px] border border-[var(--paper-border)] bg-white/85 p-3 backdrop-blur">
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_170px_170px_160px]">
            <input
              className="rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent-blue)]"
              placeholder="搜索标题、正文、AI 解读、标签"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-bg)] px-3 py-2.5 text-sm outline-none" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">全部来源</option>
              <option value="manual">手写笔记</option>
              <option value="douyin">抖音</option>
              <option value="bilibili">B站</option>
              <option value="youtube">YouTube</option>
              <option value="xiaohongshu">小红书</option>
              <option value="link">普通链接</option>
            </select>
            <select className="rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-bg)] px-3 py-2.5 text-sm outline-none" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">全部状态</option>
              <option value="inbox">收集箱</option>
              <option value="processing">处理中</option>
              <option value="failed">转录失败</option>
              <option value="archived">已归档</option>
            </select>
            <div className="flex rounded-[8px] border border-[var(--paper-border)] bg-[var(--paper-bg)] p-1">
              <button onClick={() => setView("list")} className={viewButton(view === "list")}>列表</button>
              <button onClick={() => setView("card")} className={viewButton(view === "card")}>卡片</button>
            </div>
          </div>
        </section>

        {selectedNoteIds.length > 0 && (
          <section className="mx-8 mb-4 flex flex-col gap-3 rounded-[8px] border border-blue-100 bg-blue-50/80 p-3 text-sm text-[var(--ink)] md:flex-row md:items-center md:justify-between">
            <div>
              已选择 <strong>{selectedNoteIds.length}</strong> 条笔记
              <button onClick={() => setSelectedNoteIds([])} className="ml-3 text-xs text-[var(--ink-faint)] hover:text-[var(--accent-blue)]">清空</button>
            </div>
            <div className="flex gap-2">
              <select
                value={targetBaseId}
                onChange={(e) => setTargetBaseId(e.target.value)}
                className="min-w-[220px] rounded-[8px] border border-blue-100 bg-white px-3 py-2 text-sm outline-none"
              >
                {bases.length === 0 ? (
                  <option value="">还没有知识库</option>
                ) : bases.map((base) => (
                  <option key={base.id} value={base.id}>{base.icon || "◌"} {base.name}</option>
                ))}
              </select>
              <button
                onClick={assignSelectedToBase}
                disabled={!targetBaseId || assigning}
                className="rounded-[8px] bg-[#1d1d1f] px-4 py-2 text-sm text-white disabled:bg-[#c9d3f7]"
              >
                {assigning ? "加入中" : "加入知识库"}
              </button>
            </div>
          </section>
        )}

        <div className="flex-1 overflow-y-auto px-8 pb-10">
          {loading ? (
            <div className="flex justify-center py-16"><div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--paper-border)] border-t-[var(--gold)]" /></div>
          ) : notes.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--ink-faint)]">没有找到匹配的笔记。</div>
          ) : (
            <div className={view === "card" ? "grid gap-3 xl:grid-cols-2" : "space-y-2"}>
              {notes.map((note) => {
                const selected = selectedNoteIds.includes(note.id);
                return (
                <div
                  key={note.id}
                  className={`group w-full rounded-[8px] border border-[var(--paper-border)] bg-white/85 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:shadow-[0_18px_40px_rgba(15,23,42,0.06)] ${
                    view === "card" ? "p-5" : "px-4 py-3"
                  } ${selected ? "border-[var(--accent-blue)] ring-2 ring-blue-100" : ""}`}
                >
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => toggleNote(note.id)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors ${
                        selected ? "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white" : "border-[var(--paper-border)] bg-white text-transparent"
                      }`}
                      title={selected ? "取消选择" : "选择笔记"}
                    >
                      ✓
                    </button>
                    <button onClick={() => router.push(`/note/${note.id}`)} onMouseEnter={() => router.prefetch(`/note/${note.id}`)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-[var(--ink)]">{note.title || makeTitle(note)}</h2>
                        {note.aiResult && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600">AI</span>}
                        {note.status === "failed" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-500">失败</span>}
                      </div>
                      <p className={`mt-1 text-sm leading-6 text-[var(--ink-light)] ${view === "card" ? "line-clamp-4" : "line-clamp-2"}`}>
                        {note.aiResult?.summary || stripMarkdown(note.contentMd)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]">
                        <span>{formatTime(note.updatedAt || note.createdAt)}</span>
                        <span className={note.type === "manual" ? "text-[#69707d]" : "text-[#2563eb]"}>{sourceLabel(note.type)}</span>
                        {note.tags?.slice(0, 3).map((nt: any) => <span key={nt.tag.id} className="text-[var(--gold)]">#{nt.tag.fullPath}</span>)}
                      </div>
                    </button>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>
      </main>
      <SpiritPanel />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <strong className="text-2xl font-semibold text-[var(--ink)]">{value}</strong>
      <span className="text-xs text-[var(--ink-faint)]">{label}</span>
    </span>
  );
}

function viewButton(active: boolean) {
  return `flex-1 rounded-[6px] px-3 py-1.5 text-xs transition-colors ${active ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-faint)]"}`;
}

function makeTitle(note: any) {
  return stripMarkdown(note.contentMd || "").slice(0, 42) || "未命名笔记";
}

function sourceLabel(type: string) {
  const labels: Record<string, string> = { manual: "笔记输入", douyin: "外部资料 · 抖音", bilibili: "外部资料 · B站", youtube: "外部资料 · YouTube", xiaohongshu: "外部资料 · 小红书", link: "外部资料 · 链接" };
  return labels[type] || type || "笔记输入";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
