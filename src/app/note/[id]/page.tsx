"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";
import { MarkdownView } from "@/components/MarkdownView";

type Tab = "spirit" | "content" | "source" | "append";

export default function NoteDetailPage() {
  const params = useParams(); const router = useRouter();
  const [note, setNote] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("spirit");
  const [report, setReport] = useState(""); const [reportLoading, setReportLoading] = useState(false);
  const [editingReport, setEditingReport] = useState(false); const [editReport, setEditReport] = useState("");
  const [editingContent, setEditingContent] = useState(false); const [editContent, setEditContent] = useState("");
  const [editingTitle, setEditingTitle] = useState(false); const [editTitle, setEditTitle] = useState("");
  const [appendText, setAppendText] = useState(""); const [appending, setAppending] = useState(false);
  const [allTags, setAllTags] = useState<{ id: string; fullPath: string; noteCount: number }[]>([]);
  const [showTagInput, setShowTagInput] = useState(false); const [addTagText, setAddTagText] = useState("");

  const fetchNote = () => {
    fetch("/api/notes?limit=300").then((r) => r.json()).then((data) => {
      const found = data.notes?.find((n: any) => n.id === params.id);
      setNote(found || null); setEditContent(found?.contentMd || ""); setEditTitle(found?.aiResult?.summary || "");
      setLoading(false);
    });
  };
  useEffect(() => { fetchNote(); }, [params.id]);

  useEffect(() => { fetch("/api/tags").then(r=>r.json()).then(d=>setAllTags(d.tags||[])); }, []);

  const isAutoNote = note?.type && note.type !== "manual";
  const title = note?.aiResult?.summary || note?.contentMd?.slice(0, 100) || "";

  // Load cached report or generate new one
  useEffect(() => {
    if (!note?.id) return;
    // Check cache in AIResult
    if (note.aiResult?.summary && note.aiResult.summary.includes("## ")) {
      setReport(note.aiResult.summary);
      return;
    }
    if (!isAutoNote) return;
    // Generate new report
    setReportLoading(true);
    fetch("/api/ai/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: note.id, model: localStorage.getItem("nf_model") || undefined, apiKey: localStorage.getItem("nf_api_key") || undefined, baseUrl: localStorage.getItem("nf_base_url") || undefined }) })
      .then((r) => r.json()).then((d) => { if (d.report) { setReport(d.report); fetchNote(); } setReportLoading(false); })
      .catch(() => setReportLoading(false));
  }, [note?.id]);

  const handleSaveContent = async () => {
    const resp = await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editContent }) });
    if (resp.ok) { const u = await resp.json(); setNote(u); setEditingContent(false); }
  };
  const handleSaveTitle = async () => {
    // Save title to AIResult
    await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: editTitle }) });
    setEditingTitle(false); fetchNote();
  };
  const handleSaveReport = async () => {
    await fetch("/api/ai/report", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: note.id, report: editReport }) });
    setReport(editReport); setEditingReport(false);
  };
  const handleAppend = async () => {
    if (!appendText.trim()) return; setAppending(true);
    const resp = await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: note.contentMd + "\n\n---\n\n" + appendText }) });
    if (resp.ok) { const u = await resp.json(); setNote(u); setAppendText(""); setTab("content"); }
    setAppending(false);
  };
  const handleDeleteTag = async (tagId: string) => {
    await fetch(`/api/tags?id=${tagId}`, { method: "DELETE" });
    fetchNote(); fetch("/api/tags").then(r=>r.json()).then(d=>setAllTags(d.tags||[]));
  };
  const handleAddTag = async () => {
    const tagPath = addTagText.trim();
    if (!tagPath) return;
    // Append #tag to note content, which triggers re-parsing in PATCH
    const newContent = (note.contentMd || "") + `\n#${tagPath}`;
    const resp = await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: newContent }) });
    if (resp.ok) { const u = await resp.json(); setNote(u); setAddTagText(""); setShowTagInput(false); }
  };
  const handleDelete = async () => {
    if (!confirm("确定撕掉这页？")) return;
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" }); router.push("/");
  };

  const updateTime = formatRelative(note?.updatedAt || note?.createdAt);
  const wordCount = note?.contentMd?.replace(/[#*`~>\[\]()!|\-\n\s]/g, "")?.length || 0;
  const hasSource = note?.sourceUrl && note?.type !== "manual";

  if (loading) return <div className="flex h-screen bg-[var(--paper-bg)] items-center justify-center"><div className="w-5 h-5 border-2 border-[var(--paper-border)] border-t-[var(--gold)] rounded-full animate-spin" /></div>;
  if (!note) return (
    <div className="flex h-screen overflow-hidden"><Sidebar /><main className="flex-1 bg-[var(--paper-bg)] flex flex-col items-center justify-center gap-2"><p className="text-lg text-[var(--ink-light)] font-prose">这页笔记不知去向了</p><button onClick={() => router.push("/")} className="text-sm text-[var(--gold)] hover:underline">回书桌</button></main><SpiritPanel /></div>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 bg-[var(--paper-bg)] overflow-y-auto">
        <div className="max-w-[780px] mx-auto px-6 py-6">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => router.push("/")} className="text-sm text-[var(--ink-faint)] hover:text-[var(--ink-light)]">← 回书桌</button>
            <div className="text-sm text-[var(--ink-faint)]">{updateTime} · 字 {wordCount}</div>
            <div className="flex items-center gap-1">
              <button onClick={() => setTab("append")} className="px-3 py-1.5 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-hover)] rounded-lg">续写</button>
              <button onClick={handleDelete} className="px-3 py-1.5 text-sm text-[var(--ink-faint)] hover:text-red-400 rounded-lg hover:bg-red-50">撕掉</button>
            </div>
          </div>

          {/* Title */}
          <div className="paper-card p-6 mb-3">
            {editingTitle ? (
              <div className="flex gap-2"><input className="flex-1 text-xl font-bold text-[var(--ink)] font-prose outline-none border-b border-[var(--paper-border)]" value={editTitle} onChange={e=>setEditTitle(e.target.value)} autoFocus /><button onClick={handleSaveTitle} className="text-sm text-[var(--gold)]">收好</button><button onClick={()=>setEditingTitle(false)} className="text-sm text-[var(--ink-faint)]">算了</button></div>
            ) : (
              <h1 className="text-xl font-bold text-[var(--ink)] leading-snug font-prose cursor-pointer hover:text-[var(--gold)]" onClick={()=>{setEditTitle(title);setEditingTitle(true);}} title="点击修改标题">
                {title || "（无标题，点击添加）"}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-4">
              {hasSource && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">收录自{platformLabel(note.type)}</span>}
              {note.tags?.map((nt: any) => (
                <span key={nt.tag.id} className="text-xs text-[var(--gold)] bg-[var(--gold-light)] px-2 py-0.5 rounded-full group flex items-center gap-1">
                  <span className="cursor-pointer" onClick={() => router.push(`/?tag=${encodeURIComponent(nt.tag.fullPath)}`)}>#{nt.tag.fullPath}</span>
                  <button onClick={(e)=>{e.stopPropagation();handleDeleteTag(nt.tag.id);}} className="opacity-0 group-hover:opacity-100 text-[var(--ink-faint)] hover:text-red-400">×</button>
                </span>
              ))}
              {showTagInput ? (
                <span className="flex items-center gap-1">
                  <input className="text-xs px-2 py-0.5 rounded-full border border-[var(--gold)] outline-none w-28" placeholder="如 产品/AI" value={addTagText} onChange={(e) => setAddTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); if (e.key === "Escape") { setShowTagInput(false); setAddTagText(""); } }} autoFocus />
                  <button onClick={handleAddTag} className="text-xs text-[var(--gold)]">✓</button>
                  <button onClick={() => { setShowTagInput(false); setAddTagText(""); }} className="text-xs text-[var(--ink-faint)]">✕</button>
                </span>
              ) : (
                <button onClick={() => { setShowTagInput(true); setAddTagText(""); }} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] px-2 py-1 rounded-full border border-dashed border-[var(--paper-border)]">+ 标签</button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mb-0">
            {[{ key: "spirit" as Tab, label: "🧚 精灵的话" }, { key: "content" as Tab, label: "笔记正文" }, { key: "source" as Tab, label: "出处", hide: !hasSource }, { key: "append" as Tab, label: "续写" }].filter(t=>!t.hide).map(t=>(
              <button key={t.key} onClick={()=>setTab(t.key)} className={`px-5 py-2.5 text-sm transition-colors border-b-2 ${tab===t.key?"text-[var(--ink)] border-[var(--gold)] font-medium":"text-[var(--ink-faint)] border-transparent hover:text-[var(--ink-light)]"}`}>{t.label}</button>
            ))}
          </div>

          {/* Content */}
          <div className="paper-card rounded-tl-none p-6 min-h-[300px]">
            {tab === "spirit" && (
              isAutoNote ? (
                reportLoading ? <div className="flex flex-col items-center gap-3 py-16"><span className="text-3xl animate-bounce">🧚</span><p className="text-sm text-[var(--ink-faint)]">精灵正在展读...</p></div>
                : report ? (
                  editingReport ? (
                    <div><textarea className="w-full min-h-[300px] p-4 text-sm rounded-xl border border-[var(--paper-border)] outline-none resize-none font-prose" value={editReport} onChange={e=>setEditReport(e.target.value)} autoFocus /><div className="flex gap-2 mt-2"><button onClick={handleSaveReport} className="px-4 py-1.5 text-sm rounded-full text-white" style={{background:"var(--gold)"}}>收好</button><button onClick={()=>setEditingReport(false)} className="px-4 py-1.5 text-sm text-[var(--ink-light)]">算了</button></div></div>
                  ) : (
                    <div>
                      <div className="prose-note text-sm"><MarkdownView content={report} /></div>
                      <button onClick={()=>{setEditReport(report);setEditingReport(true);}} className="mt-3 text-xs text-[var(--ink-faint)] hover:text-[var(--gold)]">✎ 修改</button>
                    </div>
                  )
                ) : <div className="text-center py-12"><button onClick={()=>{setReportLoading(true);fetch("/api/ai/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({noteId:note.id,model:localStorage.getItem("nf_model")||undefined,apiKey:localStorage.getItem("nf_api_key")||undefined,baseUrl:localStorage.getItem("nf_base_url")||undefined})}).then(r=>r.json()).then(d=>{if(d.report)setReport(d.report);setReportLoading(false);});}} className="px-4 py-2 text-sm text-[var(--gold)] hover:underline">让精灵读一读</button></div>
              ) : (
                <div className="text-center py-16">
                  <span className="text-3xl mb-3 block">🧚</span>
                  <p className="text-base text-[var(--ink)] font-prose mb-2">亲手写下的文字</p>
                  <p className="text-sm text-[var(--ink-faint)] mb-5">精灵不会擅自解读。需要的话——</p>
                  <button onClick={()=>setTab("content")} className="px-5 py-2 text-sm rounded-full text-white" style={{background:"var(--gold)"}}>跟精灵聊聊这条想法</button>
                </div>
              )
            )}
            {tab === "content" && (
              editingContent ? (
                <div><textarea className="w-full min-h-[400px] p-5 text-[16px] leading-relaxed outline-none resize-none rounded-card border border-[var(--paper-border)] bg-[var(--paper-card)] text-[var(--ink)] font-prose" value={editContent} onChange={e=>setEditContent(e.target.value)} autoFocus /><div className="flex gap-2 mt-3"><button onClick={handleSaveContent} className="px-4 py-1.5 text-sm rounded-full text-white" style={{background:"var(--gold)"}}>收好</button><button onClick={()=>{setEditContent(note.contentMd);setEditingContent(false);}} className="px-4 py-1.5 text-sm text-[var(--ink-light)]">放下</button></div></div>
              ) : (
                <div>
                  <MarkdownView content={note.contentMd} />
                  <button onClick={()=>setEditingContent(true)} className="mt-4 text-xs text-[var(--ink-faint)] hover:text-[var(--gold)]">✎ 删改正文</button>
                </div>
              )
            )}
            {tab === "source" && hasSource && (
              <div>
                <p className="text-sm text-[var(--ink-faint)] mb-2">出处</p>
                <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--gold)] hover:underline break-all">{note.sourceUrl}</a>
                <div className="mt-4 p-4 rounded-xl bg-[var(--paper-bg)] border border-[var(--paper-border)]"><p className="text-sm text-[var(--ink-light)]">来自 · {platformLabel(note.type)}</p><p className="text-sm text-[var(--ink-light)] mt-1">收于 · {new Date(note.createdAt).toLocaleString("zh-CN")}</p></div>
              </div>
            )}
            {tab === "append" && (
              <div><p className="text-sm text-[var(--ink-faint)] mb-3">在这页后面接着写</p><textarea className="w-full min-h-[180px] p-4 rounded-xl outline-none border border-[var(--paper-border)] bg-[var(--paper-card)] text-[var(--ink)] font-prose text-sm leading-relaxed resize-none" placeholder="续写..." value={appendText} onChange={e=>setAppendText(e.target.value)} autoFocus /><div className="flex gap-2 mt-3"><button onClick={handleAppend} disabled={!appendText.trim()||appending} className="px-4 py-2 text-sm rounded-full text-white disabled:opacity-25" style={{background:"var(--gold)"}}>{appending?"续写中...":"接到后面"}</button><button onClick={()=>{setAppendText("");setTab("content");}} className="px-4 py-2 text-sm text-[var(--ink-light)] rounded-full hover:bg-[var(--paper-hover)]">算了</button></div></div>
            )}
          </div>
        </div>
      </main>
      <SpiritPanel noteId={note.id as string} />
    </div>
  );
}
function formatRelative(iso: string): string { if(!iso)return"";const d=new Date(iso),diff=Date.now()-d.getTime(),m=Math.floor(diff/60000),h=Math.floor(diff/3600000),days=Math.floor(diff/86400000);if(m<1)return"方才";if(m<60)return`${m}分钟前`;if(h<24)return`${h}小时前`;if(days<7)return`${days}天前`;return d.toLocaleDateString("zh-CN",{month:"short",day:"numeric"});}
function platformLabel(t: string): string { const m:Record<string,string>={douyin:"抖音",bilibili:"B站",youtube:"YouTube",xiaohongshu:"小红书",web:"网页",pdf:"PDF"};return m[t]||t; }
