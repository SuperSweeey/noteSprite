"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { stripMarkdown } from "@/lib/tags";

type Base = {
  id: string;
  name: string;
  description: string;
  icon: string;
  notes?: Array<{
    id: string;
    title: string;
    contentMd: string;
    tags?: Array<{ tag: { id: string; fullPath: string } }>;
    aiResult?: { summary?: string | null } | null;
  }>;
  _count?: { notes?: number };
};

type NoteItem = {
  id: string;
  title: string;
  contentMd: string;
  knowledgeBaseId?: string | null;
  tags?: Array<{ tag: { id: string; fullPath: string } }>;
  aiResult?: { summary?: string | null } | null;
};

type Tag = {
  id: string;
  fullPath: string;
  noteCount: number;
};

const addModes = [
  { id: "recent", label: "最近笔记" },
  { id: "search", label: "搜索" },
  { id: "tag", label: "标签" },
  { id: "unassigned", label: "未归类" },
] as const;

export default function KnowledgePage() {
  const router = useRouter();
  const [bases, setBases] = useState<Base[]>([]);
  const [selected, setSelected] = useState<Base | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIcon, setEditIcon] = useState("📚");
  const [savingEdit, setSavingEdit] = useState(false);
  const [candidateNotes, setCandidateNotes] = useState<NoteItem[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [addMode, setAddMode] = useState<(typeof addModes)[number]["id"]>("recent");
  const [noteQuery, setNoteQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");

  const loadBases = async () => {
    setLoading(true);
    const resp = await fetch("/api/knowledge-bases");
    const data = await resp.json();
    const nextBases = data.bases || [];
    setBases(nextBases);
    setSelected((current) => {
      if (!current) return nextBases[0] || null;
      return nextBases.find((base: Base) => base.id === current.id) || nextBases[0] || null;
    });
    setLoading(false);
  };

  const loadTags = async () => {
    const resp = await fetch("/api/tags");
    const data = await resp.json();
    setTags(data.tags || []);
  };

  useEffect(() => {
    loadBases();
    loadTags();
  }, []);

  useEffect(() => {
    if (!selected?.id) {
      setNotes([]);
      return;
    }
    fetch(`/api/notes?knowledgeBaseId=${selected.id}&limit=80&viewMode=list`)
      .then((resp) => resp.json())
      .then((data) => setNotes(data.notes || []))
      .catch(() => setNotes([]));
  }, [selected?.id]);

  useEffect(() => {
    if (!adding) return;
    const params = new URLSearchParams({ limit: "80", sort: "updated", compact: "1" });
    if (addMode === "search" && noteQuery.trim()) params.set("search", noteQuery.trim());
    if (addMode === "tag" && selectedTag) params.set("tag", selectedTag);
    if (addMode === "unassigned") params.set("unassigned", "1");
    fetch(`/api/notes?${params}`)
      .then((resp) => resp.json())
      .then((data) => setCandidateNotes(data.notes || []))
      .catch(() => setCandidateNotes([]));
  }, [adding, addMode, noteQuery, selectedTag]);

  const stats = useMemo(
    () => ({
      bases: bases.length,
      notes: bases.reduce((sum, base) => sum + (base._count?.notes || 0), 0),
    }),
    [bases]
  );

  const createBase = async () => {
    if (!name.trim()) return;
    const resp = await fetch("/api/knowledge-bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim(), icon: "📚" }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setCreating(false);
      setName("");
      setDescription("");
      setSelected(data.base);
      loadBases();
    }
  };

  const startEdit = (base = selected) => {
    if (!base) return;
    setEditName(base.name || "");
    setEditDescription(base.description || "");
    setEditIcon(base.icon || "📚");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected?.id || !editName.trim() || savingEdit) return;
    setSavingEdit(true);
    const resp = await fetch(`/api/knowledge-bases/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        description: editDescription.trim(),
        icon: editIcon || "📚",
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setSelected(data.base);
      setEditing(false);
      loadBases();
    }
    setSavingEdit(false);
  };

  const deleteBase = async (base = selected) => {
    if (!base?.id) return;
    const ok = window.confirm(`删除知识库「${base.name}」？里面的笔记会保留，只是移出这个主题。`);
    if (!ok) return;
    const resp = await fetch(`/api/knowledge-bases/${base.id}`, { method: "DELETE" });
    if (resp.ok) {
      setEditing(false);
      setAdding(false);
      setNotes([]);
      setSelected(null);
      loadBases();
    }
  };

  const addNotesToBase = async () => {
    if (!selected?.id || selectedNoteIds.length === 0) return;
    const resp = await fetch(`/api/knowledge-bases/${selected.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteIds: selectedNoteIds }),
    });
    if (resp.ok) {
      setAdding(false);
      setSelectedNoteIds([]);
      setNoteQuery("");
      setSelectedTag("");
      setAddMode("recent");
      loadBases();
      const next = await fetch(`/api/notes?knowledgeBaseId=${selected.id}&limit=80&viewMode=list`).then((r) => r.json());
      setNotes(next.notes || []);
    }
  };

  const removeNote = async (noteId: string) => {
    if (!selected?.id) return;
    await fetch(`/api/knowledge-bases/${selected.id}/notes?noteId=${noteId}`, { method: "DELETE" });
    setNotes((current) => current.filter((note) => note.id !== noteId));
    loadBases();
  };

  const askBase = () => {
    if (!selected) return;
    router.push(`/ai?q=${encodeURIComponent(`@${selected.name} 帮我总结这个知识库的核心问题和下一步可研究方向。`)}`);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col bg-[#f6f6f8]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1160px] px-8 pb-16 pt-8">
            <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-[#a0a4ad]">Library</p>
                <h1 className="mt-2 text-[34px] font-semibold tracking-[-0.03em] text-[#1d1d1f]">主题书架</h1>
                <p className="mt-3 max-w-[640px] text-[15px] leading-8 text-[#69707d]">知识库不是标签墙，而是把一组笔记沉淀成一个可反复追问的主题。</p>
              </div>
              <div className="flex gap-6">
                <Metric label="主题" value={stats.bases} />
                <Metric label="笔记" value={stats.notes} />
              </div>
            </header>

            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <button
                onClick={() => setCreating(true)}
                className="min-h-[210px] rounded-[30px] border border-dashed border-[#cdd3de] bg-white/45 p-6 text-left transition-all hover:-translate-y-0.5 hover:bg-white/80 hover:shadow-[0_24px_70px_rgba(15,23,42,0.08)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1d1d1f] text-xl text-white">+</span>
                <h2 className="mt-8 text-xl font-semibold text-[#1d1d1f]">新建主题</h2>
                <p className="mt-2 text-sm leading-7 text-[#7a828f]">给一组笔记一个长期生长的地方。</p>
              </button>

              {bases.map((base, index) => (
                <button
                  key={base.id}
                  onClick={() => setSelected(base)}
                  className={`min-h-[210px] rounded-[30px] p-6 text-left shadow-[0_22px_70px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.035] transition-all hover:-translate-y-0.5 ${
                    selected?.id === base.id ? "bg-white" : "bg-white/70"
                  }`}
                >
                  <span className="text-xs text-[#a0a4ad]">Theme {String(index + 1).padStart(2, "0")}</span>
                  <h2 className="mt-8 line-clamp-2 text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">{base.name}</h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-7 text-[#69707d]">{base.description || "这个主题还在生长。"}</p>
                  <p className="mt-5 text-xs text-[#a0a4ad]">{base._count?.notes || 0} 条笔记</p>
                </button>
              ))}
            </section>

            {creating && (
              <section className="mt-6 rounded-[30px] bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.04]">
                <div className="grid gap-3 md:grid-cols-[240px_1fr_120px]">
                  <input
                    className="rounded-[18px] bg-[#f5f5f7] px-4 py-3 text-sm outline-none"
                    placeholder="主题名，例如 地方债研究"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    className="rounded-[18px] bg-[#f5f5f7] px-4 py-3 text-sm outline-none"
                    placeholder="这个知识库想收什么内容？"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <button onClick={createBase} disabled={!name.trim()} className="rounded-[18px] bg-[#1d1d1f] px-4 py-3 text-sm text-white disabled:bg-[#c9d3f7]">
                    创建
                  </button>
                </div>
              </section>
            )}

            <section className="mt-10 rounded-[34px] bg-white/82 p-7 shadow-[0_28px_90px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.04]">
              {!selected ? (
                <div className="py-20 text-center text-sm text-[#8f96a3]">{loading ? "加载中..." : "选择或创建一个主题。"}</div>
              ) : (
                <>
                  <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-[#a0a4ad]">Selected Theme</p>
                      <h2 className="mt-2 flex items-center gap-3 text-[30px] font-semibold tracking-[-0.03em] text-[#1d1d1f]">
                        <span>{selected.icon || "📚"}</span>
                        <span>{selected.name}</span>
                      </h2>
                      <p className="mt-3 max-w-[680px] text-[15px] leading-8 text-[#69707d]">{selected.description || "这个主题还没有描述。"}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button onClick={askBase} className="rounded-full bg-[#1d1d1f] px-5 py-3 text-sm text-white">
                        @这个主题提问
                      </button>
                      <button onClick={() => setAdding(true)} className="rounded-full bg-[#edf3ff] px-5 py-3 text-sm text-[#2563eb]">
                        添加笔记
                      </button>
                      <button onClick={() => startEdit()} className="rounded-full bg-[#f3f4f6] px-5 py-3 text-sm text-[#4b5563]">
                        编辑
                      </button>
                      <button onClick={() => deleteBase()} className="rounded-full bg-red-50 px-5 py-3 text-sm text-red-500">
                        删除
                      </button>
                    </div>
                  </div>

                  {editing && (
                    <div className="mt-6 rounded-[24px] bg-[#f6f6f8] p-4">
                      <div className="grid gap-3 md:grid-cols-[84px_240px_1fr_auto_auto]">
                        <input className="rounded-[16px] bg-white px-4 py-3 text-sm outline-none" placeholder="图标" value={editIcon} onChange={(e) => setEditIcon(e.target.value)} maxLength={4} />
                        <input className="rounded-[16px] bg-white px-4 py-3 text-sm outline-none" placeholder="主题名" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        <input className="rounded-[16px] bg-white px-4 py-3 text-sm outline-none" placeholder="主题描述" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                        <button onClick={saveEdit} disabled={!editName.trim() || savingEdit} className="rounded-[16px] bg-[#1d1d1f] px-4 py-3 text-sm text-white disabled:bg-[#c9d3f7]">
                          {savingEdit ? "保存中..." : "保存"}
                        </button>
                        <button onClick={() => setEditing(false)} className="rounded-[16px] bg-white px-4 py-3 text-sm text-[#8f96a3]">
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {adding && (
                    <div className="mt-6 rounded-[24px] bg-[#f6f6f8] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="flex flex-wrap gap-2">
                          {addModes.map((mode) => (
                            <button
                              key={mode.id}
                              onClick={() => {
                                setAddMode(mode.id);
                                setSelectedNoteIds([]);
                              }}
                              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                                addMode === mode.id ? "bg-[#1d1d1f] text-white" : "bg-white text-[#69707d] hover:text-[#1d1d1f]"
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                        {addMode === "search" && (
                          <input
                            className="min-h-[44px] flex-1 rounded-[16px] bg-white px-4 text-sm outline-none"
                            placeholder="搜索标题、正文、AI 整理或标签"
                            value={noteQuery}
                            onChange={(e) => setNoteQuery(e.target.value)}
                            autoFocus
                          />
                        )}
                        {addMode === "tag" && (
                          <select
                            className="min-h-[44px] flex-1 rounded-[16px] bg-white px-4 text-sm text-[#1d1d1f] outline-none"
                            value={selectedTag}
                            onChange={(e) => {
                              setSelectedTag(e.target.value);
                              setSelectedNoteIds([]);
                            }}
                          >
                            <option value="">选择一个标签</option>
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.fullPath}>
                                #{tag.fullPath} ({tag.noteCount || 0})
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-2 lg:ml-auto">
                          <button onClick={addNotesToBase} disabled={selectedNoteIds.length === 0} className="rounded-[16px] bg-[#1d1d1f] px-4 text-sm text-white disabled:bg-[#c9d3f7]">
                            加入 {selectedNoteIds.length > 0 ? selectedNoteIds.length : ""}
                          </button>
                          <button
                            onClick={() => {
                              setAdding(false);
                              setSelectedNoteIds([]);
                              setNoteQuery("");
                              setSelectedTag("");
                              setAddMode("recent");
                            }}
                            className="rounded-[16px] bg-white px-4 text-sm text-[#8f96a3]"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid max-h-[300px] gap-2 overflow-y-auto md:grid-cols-2">
                        {candidateNotes.map((note) => {
                          const checked = selectedNoteIds.includes(note.id);
                          const inCurrentBase = note.knowledgeBaseId === selected?.id;
                          const inOtherBase = Boolean(note.knowledgeBaseId && note.knowledgeBaseId !== selected?.id);
                          const title = note.title || stripMarkdown(note.contentMd || "").slice(0, 42) || "未命名笔记";
                          return (
                            <button
                              key={note.id}
                              disabled={inCurrentBase}
                              onClick={() => {
                                if (inCurrentBase) return;
                                setSelectedNoteIds((current) => (checked ? current.filter((id) => id !== note.id) : [...current, note.id]));
                              }}
                              className={`rounded-[16px] px-4 py-3 text-left text-sm transition-colors ${
                                checked
                                  ? "bg-[#1d1d1f] text-white"
                                  : inCurrentBase
                                  ? "cursor-not-allowed bg-white/55 text-[#9ca3af]"
                                  : "bg-white text-[#1d1d1f] hover:bg-[#edf3ff]"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                                {inCurrentBase && <span className="shrink-0 rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs text-[#4f46e5]">已加入</span>}
                                {inOtherBase && !checked && <span className="shrink-0 rounded-full bg-[#fff7ed] px-2 py-0.5 text-xs text-[#c2410c]">已归类</span>}
                                {checked && <span className="shrink-0 rounded-full bg-white/14 px-2 py-0.5 text-xs text-white/75">将加入</span>}
                              </span>
                              <span className={`mt-1 block truncate text-xs ${checked ? "text-white/60" : "text-[#8f96a3]"}`}>{stripMarkdown(note.contentMd || "").slice(0, 70)}</span>
                            </button>
                          );
                        })}
                        {candidateNotes.length === 0 && <div className="rounded-[16px] bg-white px-4 py-8 text-center text-sm text-[#8f96a3] md:col-span-2">没有找到可添加的笔记。</div>}
                      </div>
                    </div>
                  )}

                  {notes.length === 0 ? (
                    <div className="py-20 text-center text-sm text-[#8f96a3]">这个主题还没有笔记。先把相关笔记归进来，再慢慢长成主题。</div>
                  ) : (
                    <div className="mt-7 grid gap-3 md:grid-cols-2">
                      {notes.map((note) => (
                        <div key={note.id} className="rounded-[22px] bg-[#f7f7f9] px-5 py-5 transition-colors hover:bg-[#eef3ff]">
                          <button onClick={() => router.push(`/note/${note.id}`)} onMouseEnter={() => router.prefetch(`/note/${note.id}`)} className="w-full text-left">
                            <h3 className="line-clamp-2 text-[16px] font-semibold leading-7 text-[#1d1d1f]">{note.title || stripMarkdown(note.contentMd).slice(0, 52) || "未命名笔记"}</h3>
                            <p className="mt-2 line-clamp-3 text-sm leading-7 text-[#69707d]">{note.aiResult?.summary || stripMarkdown(note.contentMd)}</p>
                          </button>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {note.tags?.slice(0, 3).map((nt) => (
                              <span key={nt.tag.id} className="text-xs text-[#2563eb]">
                                #{nt.tag.fullPath}
                              </span>
                            ))}
                            <button onClick={() => removeNote(note.id)} className="ml-auto text-xs text-[#8f96a3] hover:text-red-500">
                              移出
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
      <SpiritPanel />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <strong className="text-[26px] font-semibold text-[#1d1d1f]">{value}</strong>
      <span className="text-xs text-[#8f96a3]">{label}</span>
    </span>
  );
}
