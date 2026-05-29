"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

type Tab = "ai" | "transcribe" | "about";

interface Provider { id: string; name: string; apiKey: string; baseUrl: string; models: string[]; }
interface Assignment { providerId: string; model: string; }

interface Settings {
  providers: Provider[];
  assignments: { chat: Assignment; analysis: Assignment; report: Assignment; };
  prompts: { chat: string; analysis: string; report: string; };
  transcription?: {
    cookies: string; dashscopeApiKey: string; ossAccessKeyId: string; ossAccessKeySecret: string;
    ossBucketName: string; ossEndpoint: string; ffmpegPath: string;
  };
}

const AI_FUNCTIONS = [
  { key: "chat" as const, label: "精灵对话", desc: "右侧面板、全屏精灵页的对话模型" },
  { key: "analysis" as const, label: "单篇分析", desc: "创建笔记 / 丢链接时自动生成标题 + 标签 + 关键词" },
  { key: "report" as const, label: "精灵展读", desc: "笔记的深度解读（摘要、要点、收获）" },
];

const DEFAULT_PROMPTS: Record<string, string> = {
  chat: "你是「笔记精灵」，温柔、有洞察力的知识伙伴。用中文回答，语气自然。可以引用笔记内容。",
  analysis: "",
  report: "你是笔记精灵，温柔地帮用户读笔记。请按以下格式输出（Markdown）：\n\n## 💭 概要\n用自然的语气，2-3句话概括这条笔记的核心。像朋友为你简述。\n\n## 🔑 要点\n- 要点一，具体不空洞\n- 要点二\n- 要点三（3~5个）\n\n## 🌟 可带走什么\n1~2句话，说说读完这条笔记的收获。\n\n语气温润，像旧友闲谈。不要标签。不要'作为AI'。",
};

let idCounter = 0;
function genId() { return "p_" + Date.now() + "_" + (idCounter++); }

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("ai");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>({ id: "", name: "", apiKey: "", baseUrl: "https://api.deepseek.com/v1", models: [] });
  const [newModel, setNewModel] = useState("");
  const [testStatuses, setTestStatuses] = useState<Record<string, string>>({});
  const [editingModel, setEditingModel] = useState<{ providerId: string; oldName: string; value: string } | null>(null);
  // Provider inline editing
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderValues, setEditProviderValues] = useState<{ name: string; apiKey: string; baseUrl: string }>({ name: "", apiKey: "", baseUrl: "" });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      if (d.providers) {
        if (!d.prompts) d.prompts = { chat: "", analysis: "", report: "" };
        if (!d.transcription) d.transcription = { cookies: "", dashscopeApiKey: "", ossAccessKeyId: "", ossAccessKeySecret: "", ossBucketName: "", ossEndpoint: "", ffmpegPath: "" };
        setSettings(d);
      }
    });
  }, []);

  if (!settings) return (
    <div className="flex h-screen overflow-hidden"><Sidebar /><main className="flex-1 bg-[var(--paper-bg)] flex items-center justify-center"><div className="w-4 h-4 border-2 border-[var(--paper-border)] border-t-[var(--gold)] rounded-full animate-spin" /></main></div>
  );

  const persist = async (s: Settings) => {
    try {
      const resp = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      if (!resp.ok) throw new Error("save failed");
      setSaved(true); setTimeout(() => setSaved(false), 1200);
    } catch { alert("保存失败"); }
  };

  const save = async () => { setSaving(true); await persist(settings); setSaving(false); };

  const updateAndSave = (updater: (s: Settings) => Settings) => {
    setSettings((prev) => {
      const next = updater(prev!);
      persist(next);
      return next;
    });
  };

  // --- Provider mutations ---
  const addProvider = () => {
    if (!newProvider.name.trim() || newProvider.models.length === 0) return;
    updateAndSave((s) => ({ ...s, providers: [...s.providers, { ...newProvider, id: genId() }] }));
    setNewProvider({ id: "", name: "", apiKey: "", baseUrl: "https://api.deepseek.com/v1", models: [] });
    setNewModel(""); setShowAddProvider(false);
  };

  const deleteProvider = (id: string) => {
    updateAndSave((s) => ({
      ...s,
      providers: s.providers.filter((p) => p.id !== id),
      assignments: Object.fromEntries(
        Object.entries(s.assignments).map(([k, v]) => [k, v.providerId === id ? { providerId: s.providers[0]?.id || "default", model: s.providers[0]?.models[0] || "deepseek-v4-flash" } : v])
      ) as any,
    }));
  };

  const startEditProvider = (p: Provider) => {
    setEditingProviderId(p.id);
    // apiKey in state is masked; keep as placeholder, clear for new input
    setEditProviderValues({ name: p.name, apiKey: "", baseUrl: p.baseUrl });
  };

  const confirmEditProvider = () => {
    if (!editingProviderId) return;
    updateAndSave((s) => ({
      ...s,
      providers: s.providers.map((p) => p.id === editingProviderId ? {
        ...p,
        name: editProviderValues.name.trim() || p.name,
        // Only send new key if user actually typed one; otherwise keep existing (masked → DB lookup)
                apiKey: editProviderValues.apiKey.trim() || p.apiKey,
        baseUrl: editProviderValues.baseUrl.trim() || p.baseUrl,
      } : p),
    }));
    setEditingProviderId(null);
  };

  // --- Model mutations ---
  const addModel = (providerId: string) => {
    if (!newModel.trim()) return;
    if (providerId === "new") {
      if (newProvider.models.includes(newModel.trim())) { setNewModel(""); return; }
      setNewProvider((p) => ({ ...p, models: [...p.models, newModel.trim()] }));
    } else {
      updateAndSave((s) => ({
        ...s,
        providers: s.providers.map((p) => p.id === providerId ? { ...p, models: [...p.models, newModel.trim()] } : p),
      }));
    }
    setNewModel("");
  };

  const removeModel = (providerId: string, model: string) => {
    if (providerId === "new") { setNewProvider((p) => ({ ...p, models: p.models.filter((m) => m !== model) })); return; }
    updateAndSave((s) => ({
      ...s,
      providers: s.providers.map((p) => p.id === providerId ? { ...p, models: p.models.filter((m) => m !== model) } : p),
      assignments: Object.fromEntries(
        Object.entries(s.assignments).map(([k, v]) => [k, (v as Assignment).providerId === providerId && (v as Assignment).model === model ? { ...v, model: "" } : v])
      ) as any,
    }));
  };

  const startEditModel = (providerId: string, oldName: string) => { setEditingModel({ providerId, oldName, value: oldName }); };

  const confirmEditModel = () => {
    if (!editingModel || !editingModel.value.trim() || editingModel.value === editingModel.oldName) { setEditingModel(null); return; }
    const { providerId, oldName, value } = editingModel;
    updateAndSave((s) => ({
      ...s,
      providers: s.providers.map((p) => p.id === providerId ? { ...p, models: p.models.map((m) => m === oldName ? value.trim() : m) } : p),
      assignments: Object.fromEntries(
        Object.entries(s.assignments).map(([k, v]) => [k, (v as Assignment).providerId === providerId && (v as Assignment).model === oldName ? { ...v, model: value.trim() } : v])
      ) as any,
    }));
    setEditingModel(null);
  };

  // --- Assignments ---
  const setAssignment = (fn: string, field: "providerId" | "model", value: string) => {
    updateAndSave((s) => {
      const a = { ...(s.assignments as Record<string, Assignment>)[fn] };
      a[field] = value;
      if (field === "providerId") {
        const p = s.providers.find((p) => p.id === value);
        a.model = p?.models[0] || "";
      }
      return { ...s, assignments: { ...s.assignments, [fn]: a } };
    });
  };

  // --- Test connection ---
  const testProvider = async (provider: Provider) => {
    const model = provider.models[0] || "deepseek-v4-flash";
    setTestStatuses((t) => ({ ...t, [provider.id]: "测试中..." }));
    try {
      // Send providerId so the backend can look up the real key from DB
      const resp = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, providerId: provider.id, baseUrl: provider.baseUrl }) });
      const d = await resp.json();
      setTestStatuses((t) => ({ ...t, [provider.id]: d.ok ? "✓ 连接顺畅" : "✗ " + (d.error || "连不上") }));
    } catch { setTestStatuses((t) => ({ ...t, [provider.id]: "✗ 网络不通" })); }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 bg-[var(--paper-bg)] overflow-y-auto">
        <div className="max-w-[680px] mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-[var(--ink)] font-prose">偏好设置</h1>
              <p className="text-sm text-[var(--ink-faint)] mt-1">管理 AI 模型、供应商、转录管线和提示词</p>
            </div>
            <button onClick={() => router.push("/")} className="text-sm text-[var(--ink-faint)] hover:text-[var(--ink-light)]">← 回书桌</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mb-6 border-b border-[var(--paper-border)]">
            {[
              { key: "ai" as Tab, label: "AI 配置" },
              { key: "transcribe" as Tab, label: "转录管线" },
              { key: "about" as Tab, label: "关于" },
            ].map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`px-5 py-2.5 text-sm transition-colors border-b-2 ${tab === t.key ? "text-[var(--ink)] border-[var(--gold)] font-medium" : "text-[var(--ink-faint)] border-transparent hover:text-[var(--ink-light)]"}`}>{t.label}</button>
            ))}
          </div>

          {/* Tab: AI */}
          {tab === "ai" && (
            <div className="space-y-6">
              {/* Providers */}
              <div className="paper-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[15px] font-medium text-[var(--ink)]">模型供应商</h2>
                  <button onClick={() => setShowAddProvider(true)} className="text-sm text-[var(--gold)] hover:underline">+ 添加</button>
                </div>

                {showAddProvider && (
                  <div className="mb-4 p-4 rounded-xl bg-[var(--paper-bg)] border border-[var(--paper-border)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--ink-faint)]">新供应商</span>
                      <button onClick={() => setShowAddProvider(false)} className="text-xs text-[var(--ink-faint)] hover:text-[var(--ink)]">收起</button>
                    </div>
                    <input className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="供应商名称（如 DeepSeek, OpenAI）" value={newProvider.name} onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))} />
                    <input className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="接口地址" value={newProvider.baseUrl} onChange={(e) => setNewProvider((p) => ({ ...p, baseUrl: e.target.value }))} />
                    <input className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="API Key" value={newProvider.apiKey} onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))} />
                    <div className="flex gap-2">
                      <input className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="添加模型名（如 deepseek-v4-flash）" value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addModel("new"); }} />
                      <button onClick={() => addModel("new")} className="px-3 py-2 text-sm text-[var(--gold)] border border-[var(--paper-border)] rounded-lg whitespace-nowrap">添加模型</button>
                    </div>
                    {newProvider.models.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {newProvider.models.map((m) => (
                          <span key={m} className="text-xs bg-[var(--gold-light)] text-[var(--gold)] px-2 py-0.5 rounded-full">{m} <button onClick={() => removeModel("new", m)} className="ml-1 hover:text-red-400">×</button></span>
                        ))}
                      </div>
                    )}
                    <button onClick={addProvider} disabled={!newProvider.name.trim() || newProvider.models.length === 0} className="px-4 py-1.5 text-sm rounded-full text-white disabled:opacity-25" style={{ background: "var(--gold)" }}>收好供应商</button>
                  </div>
                )}

                {settings.providers.map((p) => {
                  const testStatus = testStatuses[p.id];
                  const isEditing = editingProviderId === p.id;
                  return (
                    <div key={p.id} className="mb-3 p-4 rounded-xl bg-[var(--paper-bg)] border border-[var(--paper-border)]">
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input className="flex-1 px-2 py-1 text-sm rounded border border-[var(--gold)] outline-none" placeholder="名称" value={editProviderValues.name} onChange={(e) => setEditProviderValues((v) => ({ ...v, name: e.target.value }))} autoFocus />
                            <button onClick={confirmEditProvider} className="text-xs text-[var(--gold)]">✓</button>
                            <button onClick={() => setEditingProviderId(null)} className="text-xs text-[var(--ink-faint)]">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--ink)] cursor-pointer hover:text-[var(--gold)]" onClick={() => startEditProvider(p)} title="点击编辑">{p.name}</span>
                            <button onClick={() => testProvider(p)} className="text-xs text-[var(--ink-faint)] hover:text-[var(--gold)] border border-[var(--paper-border)] rounded px-1.5 py-0.5 transition-colors">测试连接</button>
                            {testStatus && <span className={`text-xs ${testStatus.startsWith("✓") ? "text-[var(--sage)]" : "text-red-400"}`}>{testStatus}</span>}
                          </div>
                        )}
                        <button onClick={() => deleteProvider(p.id)} className="text-xs text-red-400 hover:underline shrink-0 ml-2">删除</button>
                      </div>

                      {/* URL + API Key row */}
                      {isEditing ? (
                        <div className="space-y-2 mb-2">
                          <input className="w-full px-2 py-1 text-xs rounded border border-[var(--paper-border)] outline-none" placeholder="接口地址" value={editProviderValues.baseUrl} onChange={(e) => setEditProviderValues((v) => ({ ...v, baseUrl: e.target.value }))} />
                          <input className="w-full px-2 py-1 text-xs rounded border border-[var(--paper-border)] outline-none" placeholder={p.apiKey ? `已有密钥 (${p.apiKey.slice(0,4)}****)，留空不变` : "填入 API Key"} value={editProviderValues.apiKey} onChange={(e) => setEditProviderValues((v) => ({ ...v, apiKey: e.target.value }))} />
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--ink-faint)] mb-2 cursor-pointer" onClick={() => startEditProvider(p)} title="点击编辑">
                          {p.baseUrl} · {p.apiKey ? "密钥已填" : "密钥未填"}
                          <span className="ml-1 text-[var(--ink-faint)]/50">✎</span>
                        </div>
                      )}

                      {/* Models */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {p.models.map((m) =>
                          editingModel && editingModel.providerId === p.id && editingModel.oldName === m ? (
                            <input key={m} className="text-xs px-2 py-0.5 rounded-full border border-[var(--gold)] outline-none bg-white w-40"
                              value={editingModel.value} onChange={(e) => setEditingModel({ ...editingModel, value: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") confirmEditModel(); if (e.key === "Escape") setEditingModel(null); }}
                              onBlur={confirmEditModel} autoFocus />
                          ) : (
                            <span key={m} className="text-xs bg-[var(--gold-light)] text-[var(--gold)] px-2 py-0.5 rounded-full cursor-pointer hover:ring-1 hover:ring-[var(--gold)]" onClick={() => startEditModel(p.id, m)} title="点击编辑模型名">
                              {m} <button onClick={(e) => { e.stopPropagation(); removeModel(p.id, m); }} className="ml-1 hover:text-red-400">×</button>
                            </span>
                          )
                        )}
                      </div>

                      {/* Add model row */}
                      <div className="flex gap-2">
                        <input className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-[var(--paper-border)] outline-none" placeholder="添加模型..." value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addModel(p.id); }} />
                        <button onClick={() => addModel(p.id)} className="px-2 py-1.5 text-xs text-[var(--gold)] border border-[var(--paper-border)] rounded-lg whitespace-nowrap">添加模型</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Function assignments */}
              <div className="paper-card p-5">
                <h2 className="text-[15px] font-medium text-[var(--ink)] mb-4">功能分配</h2>
                {AI_FUNCTIONS.map((fn) => {
                  const a = settings.assignments[fn.key];
                  const currentProvider = settings.providers.find((p) => p.id === a.providerId);
                  const models = currentProvider?.models || [];
                  // Ensure current model value is valid; if not, show empty
                  const modelValue = models.includes(a.model) ? a.model : "";
                  return (
                    <div key={fn.key} className="mb-4 pb-4 border-b border-[var(--paper-border)] last:border-0 last:pb-0 last:mb-0">
                      <h3 className="text-sm font-medium text-[var(--ink)] mb-1">{fn.label}</h3>
                      <p className="text-xs text-[var(--ink-faint)] mb-2">{fn.desc}</p>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="text-xs text-[var(--ink-faint)] mb-0.5 block">供应商</label>
                          <select className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none bg-[var(--paper-bg)] text-[var(--ink)]" value={a.providerId} onChange={(e) => setAssignment(fn.key, "providerId", e.target.value)}>
                            {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--ink-faint)] mb-0.5 block">模型</label>
                          <select className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none bg-[var(--paper-bg)] text-[var(--ink)]" value={modelValue} onChange={(e) => setAssignment(fn.key, "model", e.target.value)}>
                            {models.length === 0 && <option value="">-- 没有模型 --</option>}
                            {models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--ink-faint)] mb-0.5 block">System Prompt（可选，覆盖默认）</label>
                        <textarea
                          className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--paper-border)] outline-none bg-[var(--paper-bg)] text-[var(--ink)] resize-none"
                          rows={3}
                          placeholder={DEFAULT_PROMPTS[fn.key] ? `默认：${DEFAULT_PROMPTS[fn.key].slice(0, 60)}...` : "留空则使用系统默认提示词"}
                          value={settings.prompts?.[fn.key] || ""}
                          onChange={(e) => setSettings((s) => ({ ...s!, prompts: { ...s!.prompts, [fn.key]: e.target.value } }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab: Transcription Pipeline */}
          {tab === "transcribe" && (
            <div className="space-y-6">
              <div className="paper-card p-5">
                <h2 className="text-[15px] font-medium text-[var(--ink)] mb-1">Cookies（抖音专用）</h2>
                <p className="text-xs text-[var(--ink-faint)] mb-3">从浏览器导出 Netscape 格式 cookies，粘贴到下面。抖音下载视频需要此信息。</p>
                <textarea
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--paper-border)] outline-none bg-[var(--paper-bg)] text-[var(--ink)] resize-none font-mono"
                  rows={6}
                  placeholder="# Netscape HTTP Cookie File&#10;# 从浏览器扩展（如 EditThisCookie）导出，粘贴到这里"
                  value={settings.transcription?.cookies || ""}
                  onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, cookies: e.target.value } }))}
                />
              </div>

              <div className="paper-card p-5">
                <h2 className="text-[15px] font-medium text-[var(--ink)] mb-1">阿里云 DashScope</h2>
                <p className="text-xs text-[var(--ink-faint)] mb-3">语音识别 API。在 <a href="https://dashscope.aliyun.com" target="_blank" className="text-[var(--gold)]">dashscope.aliyun.com</a> 获取。</p>
                <input className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none mb-2"
                  placeholder={settings.transcription?.dashscopeApiKey && settings.transcription.dashscopeApiKey.startsWith("••••") ? "已有密钥 (••••****)，留空不变" : "DashScope API Key"}
                  value={settings.transcription?.dashscopeApiKey || ""}
                  onFocus={(e) => { if (e.target.value.startsWith("••••")) { setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, dashscopeApiKey: "" } })); } }}
                  onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, dashscopeApiKey: e.target.value } }))} />
              </div>

              <div className="paper-card p-5">
                <h2 className="text-[15px] font-medium text-[var(--ink)] mb-1">阿里云 OSS</h2>
                <p className="text-xs text-[var(--ink-faint)] mb-3">音频文件上传至 OSS 后，DashScope 进行语音识别。</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input className="px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="AccessKey ID" value={settings.transcription?.ossAccessKeyId || ""} onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ossAccessKeyId: e.target.value } }))} />
                  <input className="px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none"
                    placeholder={settings.transcription?.ossAccessKeySecret && settings.transcription.ossAccessKeySecret.startsWith("••••") ? "已有密钥 (••••****)，留空不变" : "AccessKey Secret"}
                    value={settings.transcription?.ossAccessKeySecret || ""}
                    onFocus={(e) => { if (e.target.value.startsWith("••••")) { setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ossAccessKeySecret: "" } })); } }}
                    onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ossAccessKeySecret: e.target.value } }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="Bucket 名称" value={settings.transcription?.ossBucketName || ""} onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ossBucketName: e.target.value } }))} />
                  <input className="px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="Endpoint（如 oss-cn-shanghai.aliyuncs.com）" value={settings.transcription?.ossEndpoint || ""} onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ossEndpoint: e.target.value } }))} />
                </div>
              </div>

              <div className="paper-card p-5">
                <h2 className="text-[15px] font-medium text-[var(--ink)] mb-1">FFmpeg 路径</h2>
                <p className="text-xs text-[var(--ink-faint)] mb-3">可选。如果 ffmpeg 不在系统 PATH 中，填写完整路径。</p>
                <input className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--paper-border)] outline-none" placeholder="留空则使用系统默认 ffmpeg" value={settings.transcription?.ffmpegPath || ""} onChange={(e) => setSettings((s) => ({ ...s!, transcription: { ...s!.transcription!, ffmpegPath: e.target.value } }))} />
              </div>
            </div>
          )}

          {/* Tab: About */}
          {tab === "about" && (
            <div className="paper-card p-6 space-y-5">
              <div>
                <h3 className="text-[15px] font-medium text-[var(--ink)] mb-2">Noteflow</h3>
                <p className="text-sm text-[var(--ink-light)] leading-relaxed">开源 AI 笔记与个人知识管理系统。捕捉想法、收集信息、转化 Markdown、AI 整理、每日复习。</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-[var(--ink-faint)]">版本</span><p className="text-[var(--ink)]">v0.1.0 MVP</p></div>
                <div><span className="text-[var(--ink-faint)]">协议</span><p className="text-[var(--ink)]">MIT 开源</p></div>
                <div><span className="text-[var(--ink-faint)]">技术栈</span><p className="text-[var(--ink)]">Next.js 14 · Prisma · SQLite</p></div>
                <div><span className="text-[var(--ink-faint)]">AI</span><p className="text-[var(--ink)]">多厂商支持</p></div>
              </div>
              <div className="pt-3 border-t border-[var(--paper-border)]">
                <p className="text-xs text-[var(--ink-faint)]">&copy; 2026 OpenNote AI. 你的数据你做主 — 全部 Markdown 可导出，可自托管，不绑定任何商业平台。</p>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="px-5 py-2 text-sm rounded-full text-white transition-all active:scale-95 disabled:opacity-50 font-medium" style={{ background: "var(--gold)" }}>{saving ? "保存中..." : "收好设置"}</button>
            {saved && <span className="text-sm text-[var(--sage)] animate-pulse">已保存</span>}
          </div>
        </div>
      </main>
    </div>
  );
}