"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";

export default function InboxPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInbox = () => {
    fetch("/api/notes?status=inbox&limit=50")
      .then((r) => r.json()).then((data) => { setNotes(data.notes || []); setLoading(false); });
  };
  useEffect(() => { fetchInbox(); }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 bg-[var(--paper-bg)] flex flex-col">
        <div className="px-6 pt-6 pb-4">
          <div className="paper-card p-5">
            <h1 className="text-lg font-medium text-[var(--ink)] font-prose">收集箱</h1>
            <p className="text-sm text-[var(--ink-faint)] mt-1.5">{notes.length === 0 ? "空空的很整洁 ✨" : `这里还放着 ${notes.length} 条没整理的想法`}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-8">
          {loading ? (
            <div className="flex justify-center py-16"><div className="w-4 h-4 border-2 border-[var(--paper-border)] border-t-[var(--gold)] rounded-full animate-spin" /></div>
          ) : notes.length === 0 ? (
            <div className="text-center py-16"><p className="text-2xl mb-2">🧹</p><p className="text-sm text-[var(--ink-light)] font-prose">全都整理好了</p></div>
          ) : (
            <div className="px-5 space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="paper-card px-5 py-4 cursor-pointer group" onClick={() => router.push(`/note/${note.id}`)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--ink)] leading-relaxed font-prose">{note.aiResult?.summary || note.contentMd.slice(0, 100)}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-[var(--ink-faint)]">{formatTime(note.createdAt)}</span>
                        {note.tags?.length > 0 && <span className="text-xs text-[var(--gold)]">{note.tags.map((nt: any) => `#${nt.tag.fullPath}`).join(" ")}</span>}
                      </div>
                    </div>
                    <button onClick={async (e) => { e.stopPropagation(); await fetch(`/api/notes/${note.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) }); fetchInbox(); }}
                      className="text-xs text-[var(--ink-faint)] hover:text-[var(--sage)] px-2 py-1 rounded hover:bg-[var(--sage-light)] opacity-0 group-hover:opacity-100 transition-all shrink-0">归档</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <SpiritPanel />
    </div>
  );
}
function formatTime(iso: string): string { const d = new Date(iso); return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
