"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { DEFAULT_REPORT_PROMPT } from "@/lib/default-prompts";

type Tab = "spirit" | "model" | "knowledge" | "transcribe" | "about";

interface Provider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

interface Assignment {
  providerId: string;
  model: string;
}

interface SpiritSettings {
  name: string;
  personaId: string;
  personaPrompt: string;
  learningModeId: string;
  learningPrompt: string;
  prompt: string;
}

interface Settings {
  providers: Provider[];
  assignments: { chat: Assignment; analysis: Assignment; report: Assignment; vision: Assignment };
  prompts: { chat: string; analysis: string; report: string };
  spirit: SpiritSettings;
  transcription: {
    cookies: string;
    dashscopeApiKey: string;
    ossAccessKeyId: string;
    ossAccessKeySecret: string;
    ossBucketName: string;
    ossEndpoint: string;
    ffmpegPath: string;
    enableTimestamps: boolean;
    enableSpeakerDiarization: boolean;
    speakerCount: number;
  };
  knowledge: {
    defaultSort: "updated" | "created";
    autoAnalyze: boolean;
    autoReport: boolean;
    deleteMode: "trash" | "permanent";
    autoImageOcr: boolean;
  };
}

interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
}

const MASK = "••••";

const PERSONA_TEMPLATES = [
  {
    id: "warm",
    name: "温柔陪伴型",
    desc: "像长期一起读笔记的伙伴，清楚、温和、有陪伴感。",
    prompt: "你是一个温柔、聪明、好奇的 AI 学习伙伴。你存在于用户的真实笔记中，长期陪用户读笔记、整理想法、追问问题。你说话自然、清楚、具体，有陪伴感，但不过度卖萌。你优先依据用户笔记回答；不知道就说不知道。",
  },
  {
    id: "analyst",
    name: "冷静分析型",
    desc: "更克制、更重逻辑，适合严肃分析和复杂材料。",
    prompt: "你是一个冷静、可靠、重逻辑的 AI 分析伙伴。你会帮助用户把笔记中的概念、证据、因果关系和结构拆清楚。你表达克制、准确、具体，不迎合，不编造，不用空泛鼓励。",
  },
  {
    id: "mentor",
    name: "导师引导型",
    desc: "像导师一样追问和引导，但不压迫用户。",
    prompt: "你是一个有耐心的 AI 导师。你不会急着给结论，而是帮助用户看见问题的关键、拆出思路、自己完成理解。你语气鼓励但不敷衍，追问具体但不咄咄逼人。",
  },
  {
    id: "editor",
    name: "写作编辑型",
    desc: "适合把笔记变成观点、素材和表达。",
    prompt: "你是一个敏锐、准确的 AI 写作编辑。你会帮助用户从笔记中提炼选题、观点、结构、例子和可复用表达。你重视清楚、锋利、诚实的表达，不写空话套话。",
  },
];

const LEARNING_MODES = [
  {
    id: "socratic",
    name: "苏格拉底追问",
    desc: "选择题、追问、填空题，帮你自己走完逻辑链。",
    prompt: [
      "## 核心任务",
      "针对用户提供的{笔记}，请遵循以下步骤进行回应：",
      "",
      "1. **归纳已知结论（承接）**",
      "- 先用 1-2 句话总结用户已理解或对话中已确认的核心观点。",
      "- 可以用“我们顺着刚才的链条/逻辑，再来拆解一步”作为过渡。",
      "",
      "2. **拆解逻辑链条（结构化）**",
      "- 将复杂过程拆解为清晰的步骤，如：第一步 → 第二步 → 当前在第几步。",
      "- 使用通俗类比或角色代入，例如“假设你是一家公司的老板……”。",
      "",
      "3. **引导式提问（互动验证）**",
      "- 给出 2-3 个选项（A/B/C），让用户选择“当前卡在哪一步”或“下一步该发生什么”。",
      "- 选项应包含常见误区，既检验理解，又引发思考。",
      "",
      "4. **反馈与深化**",
      "- 无论用户选对选错，先肯定其思考方向，如“你抓住了关键点/你的感觉很准”。",
      "- 若选错，温和纠偏并解释原因；若选对，追问一层次。",
      "",
      "5. **共同总结（填空/连线）**",
      "- 设计一个简短的填空或连线题，让用户亲手完成逻辑闭环。",
      "- 示例格式：“现在是____先热，要传到____热，最终要靠____起来。”",
      "",
      "6. **确认理解并提供延展**",
      "- 询问用户“现在对这个问题是否清晰了？”",
      "- 主动提供 2-3 个可深挖的方向，让用户选择继续探讨。",
      "",
      "## 互动原则",
      "- 每轮最多给两个选择题或一个填空题，避免信息过载。",
      "- 选项数量控制在 2-3 个，其中至少一个明显错误。",
      "- 使用短句、分段、加粗关键词，提升可读性。",
      "- 始终保持鼓励语气，降低学习压力。",
    ].join("\n"),
  },
  {
    id: "feynman",
    name: "费曼讲解",
    desc: "先讲人话，再找知识缺口，用例子和教回法检查理解。",
    prompt: [
      "## 适用场景",
      "当用户想真正理解一个概念、机制、理论或复杂材料时，使用费曼讲解法。",
      "",
      "## 回应流程",
      "1. **一句话讲人话**：先把笔记内容解释给一个聪明但没有背景知识的人听。",
      "2. **拆关键概念**：列出 3-5 个必须懂的概念，每个概念用简单语言解释，不要先堆术语。",
      "3. **类比与例子**：为每个难点配一个生活化类比、角色代入或具体例子。",
      "4. **找知识缺口**：指出用户可能还没真正理解的地方，例如概念边界、因果链、前提条件、容易混淆的词。",
      "5. **回到原文**：说明这些解释分别对应笔记里的哪些信息，避免脱离原文发挥。",
      "6. **教回检查**：最后请用户用一句话复述，或回答一个非常小的检查题。",
      "",
      "## 输出格式",
      "- 先用“如果用人话说……”开头。",
      "- 再写“关键概念”“生活化例子”“容易卡住的地方”“你来试着说说”。",
      "- 如果用户回答不完整，要温和指出缺口，并给一个更简单的解释版本。",
      "",
      "## 禁止事项",
      "- 不要只做摘要。",
      "- 不要用更多术语解释术语。",
      "- 不要跳过“用户教回/复述”环节。",
    ].join("\n"),
  },
  {
    id: "structure",
    name: "结构化拆解",
    desc: "适合文章、报告、视频转写，拆观点、证据、论证链和可复用素材。",
    prompt: [
      "## 适用场景",
      "当笔记来自文章、报告、视频转写、长段材料时，使用结构化拆解法。",
      "",
      "## 回应流程",
      "1. **核心问题**：判断这条笔记到底在回答什么问题。",
      "2. **观点分层**：区分主观点、次观点、例子、背景信息，不要混在一起。",
      "3. **论证链条**：写清楚作者如何从事实/案例/数据走到结论。",
      "4. **证据强度**：标出哪些证据强，哪些只是观点或推测。",
      "5. **隐含假设**：指出原文没有明说、但支撑结论成立的前提。",
      "6. **可复用素材**：提炼可用于写作、决策、研究、追问的材料。",
      "",
      "## 输出结构",
      "### 这条笔记在回答什么",
      "### 观点地图",
      "### 论证链条",
      "### 证据与例子",
      "### 隐含假设/可能漏洞",
      "### 可以复用的素材",
      "### 下一步可以追问",
      "",
      "## 禁止事项",
      "- 不要只写“这篇文章主要讲了……”。",
      "- 不要把观点、证据、例子混成一段。",
      "- 不要把原文没有支持的推测当成事实。",
    ].join("\n"),
  },
  {
    id: "research",
    name: "研究助理",
    desc: "适合论文、政策、行业材料，强调证据、方法、局限和可追问方向。",
    prompt: [
      "## 适用场景",
      "当笔记涉及论文、政策文件、行业研究、数据报告、学术观点时，使用研究助理模式。",
      "",
      "## 回应流程",
      "1. **研究问题/分析对象**：说明材料试图回答什么问题。",
      "2. **背景与重要性**：为什么这个问题值得关注。",
      "3. **方法或框架**：如果笔记提供了方法、样本、数据来源、分析框架，要明确列出；如果没有，要说明缺失。",
      "4. **关键发现**：提炼最重要的结论，并尽量保留数字、条件和限定词。",
      "5. **证据质量**：区分强证据、弱证据、作者判断、用户摘录。",
      "6. **局限与边界**：说明结论在哪些条件下可能不成立。",
      "7. **后续研究/查证方向**：给出 2-3 个可继续查证的问题。",
      "",
      "## 输出结构",
      "### 一句话研究摘要",
      "### 问题与背景",
      "### 方法/框架/数据",
      "### 关键发现",
      "### 证据与局限",
      "### 对用户有什么用",
      "### 下一步查什么",
      "",
      "## 禁止事项",
      "- 不要把摘要写成宣传稿。",
      "- 不要省略方法和局限。",
      "- 如果笔记没有方法信息，要明确写“笔记中没有看到”。",
    ].join("\n"),
  },
  {
    id: "writing",
    name: "写作编辑",
    desc: "把笔记转成选题、论点、金句、标题和文章结构。",
    prompt: [
      "## 适用场景",
      "当用户想把笔记变成文章、评论、视频脚本、选题素材或观点库时，使用写作编辑模式。",
      "",
      "## 回应流程",
      "1. **判断素材价值**：这条笔记适合支撑什么主题或观点。",
      "2. **提炼中心论点**：给出 1-3 个可写论点，每个论点必须具体、有判断。",
      "3. **搭建文章结构**：为最有价值的论点设计开头、主体、转折、结尾。",
      "4. **提取素材**：从笔记中提炼案例、数据、金句、反常识点、冲突点。",
      "5. **补足论证**：指出还缺什么证据、例子或反方观点。",
      "6. **给标题和开头**：提供多个标题角度，但避免夸张标题党。",
      "",
      "## 输出结构",
      "### 这条笔记适合写什么",
      "### 可发展的论点",
      "### 推荐文章结构",
      "### 可直接复用的素材",
      "### 还需要补的东西",
      "### 标题/开头方向",
      "",
      "## 禁止事项",
      "- 不要一上来替用户写完整文章。",
      "- 不要生成空泛鸡汤和套话。",
      "- 不要把原文没有的观点硬包装成结论。",
    ].join("\n"),
  },
  {
    id: "action",
    name: "行动教练",
    desc: "适合会议、计划、项目笔记，提炼目标、待办、风险和下一步。",
    prompt: [
      "## 适用场景",
      "当笔记包含会议、计划、项目、任务、想法清单、决策事项时，使用行动教练模式。",
      "",
      "## 回应流程",
      "1. **识别目标**：这件事最终要达成什么结果。",
      "2. **整理现状**：已经有什么、缺什么、卡在哪里。",
      "3. **提炼行动项**：把模糊想法改写成具体动作，每个动作尽量包含对象、动词、产出。",
      "4. **排序优先级**：区分立刻做、稍后做、可以暂时不做。",
      "5. **识别风险**：列出依赖、阻塞点、可能失败的原因。",
      "6. **下一次检查**：建议一个复盘点或检查问题。",
      "",
      "## 输出结构",
      "### 目标",
      "### 当前状态",
      "### 下一步行动",
      "### 优先级",
      "### 风险/依赖",
      "### 复盘提醒",
      "",
      "## 禁止事项",
      "- 不要替用户承诺笔记里没有的事情。",
      "- 不要把所有内容都变成待办；先判断它是不是行动信息。",
      "- 不要输出太长清单，优先给最关键的 3-5 项。",
    ].join("\n"),
  },
  {
    id: "companion",
    name: "陪伴复盘",
    desc: "适合日常记录、想法碎片和自我观察，更有温度。",
    prompt: [
      "## 适用场景",
      "当笔记是日常记录、情绪、灵感、碎片想法、阶段性复盘时，使用陪伴复盘模式。",
      "",
      "## 回应流程",
      "1. **温和承接**：先复述用户记录里最重要的事实、感受或变化。",
      "2. **识别关心**：指出这条笔记背后可能在关心什么，但不要过度心理分析。",
      "3. **保留价值**：帮用户找出值得留下的句子、想法、观察或问题。",
      "4. **连接旧线索**：如果上下文里有相关旧笔记，温和指出连接；没有就不要硬连。",
      "5. **轻轻追问**：给 1-2 个可以以后慢慢想的问题。",
      "6. **收束**：用自然、有温度的一小段话结尾。",
      "",
      "## 输出结构",
      "### 我看到你记录了什么",
      "### 这里值得留下的东西",
      "### 也许可以继续想",
      "### 和旧想法的连接",
      "### 轻轻收个尾",
      "",
      "## 禁止事项",
      "- 不要诊断用户心理。",
      "- 不要说教。",
      "- 不要把温柔写成空泛鸡汤。",
    ].join("\n"),
  },
];

const SHORT_PROMPT_THRESHOLD = 260;

const FUNCTIONS = [
  { key: "chat" as const, label: "AI 对话", desc: "右侧面板和 AI 页的对话能力" },
  { key: "analysis" as const, label: "笔记整理", desc: "生成标题、摘要、关键词和建议标签" },
  { key: "report" as const, label: "深度解读", desc: "生成可替代原文阅读的完整解读稿" },
  { key: "vision" as const, label: "图片理解", desc: "上传图片后的 OCR、多模态理解和图片笔记整理" },
];

let idCounter = 0;
function genId() {
  return `p_${Date.now()}_${idCounter++}`;
}

function visibleSecret(value: string) {
  return value.startsWith(MASK) ? "" : value;
}

function secretTail(value: string) {
  return value ? value.slice(-4) : "";
}

function learningPromptFor(modeId: string) {
  return LEARNING_MODES.find((item) => item.id === modeId)?.prompt || LEARNING_MODES[0].prompt;
}

function normalizeLearningPrompt(spirit: SpiritSettings) {
  const current = spirit.learningPrompt || "";
  if (current.length >= SHORT_PROMPT_THRESHOLD) return current;
  return learningPromptFor(spirit.learningModeId);
}

function explainCheck(check: PreflightCheck) {
  if (check.ok) return "这一项已经可以工作。";
  const text = `${check.name} ${check.message}`;
  if (text.includes("SignatureDoesNotMatch")) return "AccessKey ID 能找到，但 Secret 不匹配。请重新创建一对 RAM AccessKey，不要混用旧 Secret。";
  if (text.includes("AccessDenied")) return "账号没有 OSS 上传权限。给 RAM 用户添加 AliyunOSSFullAccess，或至少允许当前 Bucket 的 PutObject/GetObject/DeleteObject。";
  if (text.includes("NoSuchBucket")) return "Bucket 名称或地域不对。确认 Bucket 叫 douyin-transcribe，并且 Endpoint 对应它的地域。";
  if (text.includes("InvalidAccessKeyId")) return "AccessKey ID 填错、被禁用，或不是阿里云 RAM AccessKey。";
  if (check.name.includes("ffmpeg")) return "ffmpeg 用来从视频里提取音频。请填写 ffmpeg.exe 的完整路径，或把 ffmpeg 加到 PATH。";
  if (check.name.includes("yt-dlp")) return "yt-dlp 用来下载视频。当前环境找不到它，需要安装或修复 PATH。";
  return "这一项还没通过。先按左侧教程核对配置，再重新检测。";
}

function hasVisionConfig(settings: Settings) {
  const assignment = settings.assignments.vision;
  const provider = settings.providers.find((item) => item.id === assignment?.providerId);
  return Boolean(provider?.apiKey && provider.baseUrl && assignment?.model);
}

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("spirit");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newProvider, setNewProvider] = useState<Provider>({ id: "", name: "", apiKey: "", baseUrl: "https://api.deepseek.com/v1", models: [] });
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [testStatuses, setTestStatuses] = useState<Record<string, string>>({});
  const [preflightStatus, setPreflightStatus] = useState("");
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);

  useEffect(() => {
    reloadSettings().catch(() => {});
  }, []);

  const reloadSettings = async () => {
    const resp = await fetch("/api/settings");
    const data = await resp.json();
    if (data.providers) {
      data.spirit.learningPrompt = normalizeLearningPrompt(data.spirit);
      data.prompts = { chat: "", analysis: "", report: DEFAULT_REPORT_PROMPT, ...(data.prompts || {}) };
      if (!data.prompts.report || data.prompts.report.length < 120) data.prompts.report = DEFAULT_REPORT_PROMPT;
      const fallbackProviderId = data.providers[0]?.id || "default";
      data.assignments = {
        chat: { providerId: fallbackProviderId, model: data.providers[0]?.models?.[0] || "" },
        analysis: { providerId: fallbackProviderId, model: data.providers[0]?.models?.[0] || "" },
        report: { providerId: fallbackProviderId, model: data.providers[0]?.models?.[0] || "" },
        vision: { providerId: fallbackProviderId, model: "qwen-vl-plus" },
        ...(data.assignments || {}),
      };
      data.transcription = {
        cookies: "",
        dashscopeApiKey: "",
        ossAccessKeyId: "",
        ossAccessKeySecret: "",
        ossBucketName: "",
        ossEndpoint: "",
        ffmpegPath: "",
        enableTimestamps: true,
        enableSpeakerDiarization: true,
        speakerCount: 0,
        ...(data.transcription || {}),
      };
      data.knowledge = {
        defaultSort: "updated",
        autoAnalyze: true,
        autoReport: false,
        deleteMode: "trash",
        autoImageOcr: false,
        ...(data.knowledge || {}),
      };
      setSettings(data);
    }
  };

  const persist = async (next: Settings) => {
    const resp = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!resp.ok) throw new Error("save failed");
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const updateAndSave = (updater: (current: Settings) => Settings) => {
    setSettings((current) => {
      const next = updater(current!);
      persist(next).then(reloadSettings).catch(() => alert("保存失败"));
      return next;
    });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await persist(settings);
      await reloadSettings();
    } catch {
      alert("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const setSpirit = (patch: Partial<SpiritSettings>) => {
    setSettings((current) => ({ ...current!, spirit: { ...current!.spirit, ...patch } }));
  };

  const setPrompt = (key: keyof Settings["prompts"], value: string) => {
    setSettings((current) => ({ ...current!, prompts: { ...current!.prompts, [key]: value } }));
  };

  const selectLearningMode = (modeId: string) => {
    const mode = LEARNING_MODES.find((item) => item.id === modeId);
    if (!mode) return;
    setSpirit({ learningModeId: mode.id, learningPrompt: mode.prompt });
  };

  const addProvider = () => {
    if (!newProvider.name.trim() || newProvider.models.length === 0) return;
    updateAndSave((current) => ({ ...current, providers: [...current.providers, { ...newProvider, id: genId() }] }));
    setNewProvider({ id: "", name: "", apiKey: "", baseUrl: "https://api.deepseek.com/v1", models: [] });
    setNewModel("");
    setShowAddProvider(false);
  };

  const removeProvider = (id: string) => {
    updateAndSave((current) => {
      const providers = current.providers.filter((provider) => provider.id !== id);
      const fallback = providers[0];
      return {
        ...current,
        providers,
        assignments: Object.fromEntries(
          Object.entries(current.assignments).map(([key, value]) => [
            key,
            value.providerId === id ? { providerId: fallback?.id || "default", model: fallback?.models[0] || "" } : value,
          ])
        ) as Settings["assignments"],
      };
    });
  };

  const addModel = (providerId: string) => {
    const model = newModel.trim();
    if (!model) return;
    if (providerId === "new") {
      setNewProvider((provider) => ({ ...provider, models: provider.models.includes(model) ? provider.models : [...provider.models, model] }));
    } else {
      updateAndSave((current) => ({
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === providerId && !provider.models.includes(model) ? { ...provider, models: [...provider.models, model] } : provider
        ),
      }));
    }
    setNewModel("");
  };

  const removeModel = (providerId: string, model: string) => {
    if (providerId === "new") {
      setNewProvider((provider) => ({ ...provider, models: provider.models.filter((item) => item !== model) }));
      return;
    }
    updateAndSave((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === providerId ? { ...provider, models: provider.models.filter((item) => item !== model) } : provider
      ),
    }));
  };

  const setAssignment = (fn: keyof Settings["assignments"], field: keyof Assignment, value: string) => {
    updateAndSave((current) => {
      const next = { ...current.assignments[fn], [field]: value };
      if (field === "providerId") {
        const provider = current.providers.find((item) => item.id === value);
        next.model = provider?.models[0] || "";
      }
      return { ...current, assignments: { ...current.assignments, [fn]: next } };
    });
  };

  const testProvider = async (provider: Provider) => {
    if (!settings) return;
    setTestStatuses((current) => ({ ...current, [provider.id]: "测试中..." }));
    try {
      const typedApiKey = visibleSecret(provider.apiKey).trim();
      const resp = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, apiKey: typedApiKey || undefined, baseUrl: provider.baseUrl, model: provider.models[0] }),
      });
      const data = await resp.json();
      const keyHint = data.keyTail ? `测试：${data.keySource}，后四位 ${data.keyTail}` : "";
      if (!data.ok) {
        setTestStatuses((current) => ({ ...current, [provider.id]: `${data.error || "连接失败"}${keyHint ? `（${keyHint}）` : ""}` }));
        return;
      }
      if (typedApiKey) {
        const nextSettings = { ...settings, providers: settings.providers.map((item) => (item.id === provider.id ? { ...item, apiKey: typedApiKey } : item)) };
        await persist(nextSettings);
        await reloadSettings();
        setTestStatuses((current) => ({ ...current, [provider.id]: `连接正常，已保存（${keyHint}）` }));
      } else {
        setTestStatuses((current) => ({ ...current, [provider.id]: `连接正常（${keyHint || "使用已保存配置"}）` }));
      }
    } catch {
      setTestStatuses((current) => ({ ...current, [provider.id]: "网络不通" }));
    }
  };

  const checkTranscription = async () => {
    if (settings) await persist(settings);
    setPreflightStatus("检测中...");
    setPreflightChecks([]);
    try {
      const resp = await fetch("/api/transcribe/check", { method: "POST" });
      const data = await resp.json();
      setPreflightChecks(data.checks || []);
      setPreflightStatus(data.ok ? "转录管线可用" : data.error || "转录管线还有问题");
    } catch {
      setPreflightStatus("检测请求失败");
    }
  };

  if (!settings) {
    return (
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center bg-[var(--paper-bg)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--paper-border)] border-t-[var(--accent-blue)]" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-[var(--paper-bg)]">
        <div className="mx-auto max-w-[920px] px-8 py-9">
          <header className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-[28px] font-semibold tracking-normal text-[var(--ink)]">设置</h1>
              <p className="mt-2 text-sm text-[var(--ink-faint)]">配置你的 AI、模型和转录管线。</p>
            </div>
            <button onClick={() => router.push("/")} className="rounded-[8px] border border-[var(--paper-border)] bg-white px-3 py-2 text-sm text-[var(--ink-light)] hover:bg-[var(--paper-soft)]">回书桌</button>
          </header>

          <nav className="mb-7 flex gap-1 rounded-[10px] bg-black/[0.045] p-1">
            {[
              { key: "spirit" as Tab, label: "你的 AI" },
              { key: "model" as Tab, label: "模型" },
              { key: "knowledge" as Tab, label: "知识库" },
              { key: "transcribe" as Tab, label: "转录" },
              { key: "about" as Tab, label: "关于" },
            ].map((item) => (
              <button key={item.key} onClick={() => setTab(item.key)} className={`flex-1 rounded-[8px] px-4 py-2 text-sm transition-colors ${tab === item.key ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-faint)] hover:text-[var(--ink)]"}`}>
                {item.label}
              </button>
            ))}
          </nav>

          {tab === "spirit" && (
            <section className="space-y-5">
              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">AI 角色画像</h2>
                <p className="mt-1 text-sm text-[var(--ink-faint)]">决定你的 AI 是一个怎样的学习伙伴。默认名称可以直接用 AI，也可以自定义。</p>
                <div className="mt-6 max-w-md">
                  <TextInput label="AI 名称" value={settings.spirit.name} onChange={(value) => setSpirit({ name: value })} />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {PERSONA_TEMPLATES.map((preset) => (
                    <button key={preset.id} onClick={() => setSpirit({ personaId: preset.id, personaPrompt: preset.prompt })} className={`rounded-[10px] border p-4 text-left transition-colors ${settings.spirit.personaId === preset.id ? "border-[var(--accent-blue)] bg-blue-50" : "border-[var(--paper-border)] bg-white hover:bg-[var(--paper-soft)]"}`}>
                      <div className="text-sm font-medium text-[var(--ink)]">{preset.name}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{preset.desc}</div>
                    </button>
                  ))}
                </div>
                <label className="mt-5 block">
                  <span className="mb-1.5 block text-sm text-[var(--ink-light)]">AI 画像 Prompt</span>
                  <textarea className="min-h-[140px] w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-3 text-sm leading-6 outline-none" value={settings.spirit.personaPrompt} onChange={(e) => setSpirit({ personaPrompt: e.target.value })} />
                </label>
              </div>

              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">AI 领学方式</h2>
                <p className="mt-1 text-sm text-[var(--ink-faint)]">决定你的 AI 如何带你理解笔记。选择后会写入下方 Prompt，保存后刷新不丢。</p>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {LEARNING_MODES.map((mode) => (
                    <button key={mode.id} onClick={() => selectLearningMode(mode.id)} className={`rounded-[10px] border p-4 text-left transition-colors ${settings.spirit.learningModeId === mode.id ? "border-[var(--accent-blue)] bg-blue-50" : "border-[var(--paper-border)] bg-white hover:bg-[var(--paper-soft)]"}`}>
                      <div className="text-sm font-medium text-[var(--ink)]">{mode.name}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{mode.desc}</div>
                    </button>
                  ))}
                </div>
                <label className="mt-5 block">
                  <span className="mb-1.5 block text-sm text-[var(--ink-light)]">当前领学 Prompt</span>
                  <textarea className="min-h-[420px] w-full resize-y rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-3 font-mono text-xs leading-5 outline-none" value={normalizeLearningPrompt(settings.spirit)} onChange={(e) => setSpirit({ learningPrompt: e.target.value })} />
                </label>
              </div>

              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">基础原则</h2>
                <p className="mt-1 text-sm text-[var(--ink-faint)]">这一段会和角色画像、学习方式一起注入。一般不需要频繁改。</p>
                <textarea className="mt-5 min-h-[140px] w-full resize-y rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-3 text-sm leading-6 outline-none" value={settings.spirit.prompt} onChange={(e) => setSpirit({ prompt: e.target.value })} />
              </div>

              <div className="paper-card p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--ink)]">AI 解读 Prompt</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-faint)]">控制笔记详情页“AI 解读”的输出结构。会和上面的角色画像、基础原则、领学方式一起注入。</p>
                  </div>
                  <button onClick={() => setPrompt("report", DEFAULT_REPORT_PROMPT)} className="rounded-[8px] border border-[var(--paper-border)] px-3 py-1.5 text-xs text-[var(--ink-light)] hover:bg-[var(--paper-soft)]">恢复默认</button>
                </div>
                <textarea className="mt-5 min-h-[300px] w-full resize-y rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-3 font-mono text-xs leading-5 outline-none" value={settings.prompts.report || DEFAULT_REPORT_PROMPT} onChange={(e) => setPrompt("report", e.target.value)} />
              </div>
            </section>
          )}

          {tab === "model" && (
            <section className="space-y-5">
              <div className="paper-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--ink)]">模型供应商</h2>
                    <p className="mt-1 text-sm text-[var(--ink-faint)]">测试成功会自动保存当前输入框里的新密钥。</p>
                  </div>
                  <button onClick={() => setShowAddProvider(true)} className="rounded-[8px] bg-[var(--ink)] px-3 py-2 text-sm text-white">添加</button>
                </div>
                {showAddProvider && (
                  <div className="mb-4 rounded-[10px] border border-[var(--paper-border)] bg-[var(--paper-soft)] p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input className="rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm outline-none" placeholder="供应商名称" value={newProvider.name} onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))} />
                      <input className="rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm outline-none" placeholder="Base URL" value={newProvider.baseUrl} onChange={(e) => setNewProvider((p) => ({ ...p, baseUrl: e.target.value }))} />
                      <input className="rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm outline-none md:col-span-2" placeholder="API Key" value={newProvider.apiKey} onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))} />
                    </div>
                    <ModelEditor newModel={newModel} setNewModel={setNewModel} onAdd={() => addModel("new")} />
                    <ModelChips models={newProvider.models} onRemove={(model) => removeModel("new", model)} />
                    <div className="mt-4 flex gap-2">
                      <button onClick={addProvider} className="rounded-[8px] bg-[var(--ink)] px-4 py-2 text-sm text-white">保存供应商</button>
                      <button onClick={() => setShowAddProvider(false)} className="rounded-[8px] px-4 py-2 text-sm text-[var(--ink-faint)]">取消</button>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {settings.providers.map((provider) => (
                    <div key={provider.id} className="rounded-[10px] border border-[var(--paper-border)] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <input className="min-w-0 bg-transparent text-sm font-medium text-[var(--ink)] outline-none" value={provider.name} onChange={(e) => setSettings((current) => ({ ...current!, providers: current!.providers.map((p) => (p.id === provider.id ? { ...p, name: e.target.value } : p)) }))} />
                            <span className="text-xs text-[var(--ink-faint)]">{provider.apiKey ? `已保存密钥 · ${secretTail(provider.apiKey)}` : "未配置密钥"}</span>
                          </div>
                          <input className="mt-2 w-full bg-transparent text-xs text-[var(--ink-faint)] outline-none" value={provider.baseUrl} onChange={(e) => setSettings((current) => ({ ...current!, providers: current!.providers.map((p) => (p.id === provider.id ? { ...p, baseUrl: e.target.value } : p)) }))} />
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button onClick={() => testProvider(provider)} className="rounded-[8px] border border-[var(--paper-border)] px-3 py-1.5 text-xs text-[var(--ink-light)]">测试并保存</button>
                          <button onClick={() => removeProvider(provider.id)} className="rounded-[8px] px-3 py-1.5 text-xs text-red-500">删除</button>
                        </div>
                      </div>
                      {testStatuses[provider.id] && <p className="mt-2 break-words text-xs text-[var(--ink-faint)]">{testStatuses[provider.id]}</p>}
                      <input className="mt-3 w-full rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm outline-none" placeholder={provider.apiKey ? "输入新密钥；测试通过后会自动保存" : "API Key"} value={visibleSecret(provider.apiKey)} onChange={(e) => setSettings((current) => ({ ...current!, providers: current!.providers.map((p) => (p.id === provider.id ? { ...p, apiKey: e.target.value } : p)) }))} />
                      <ModelEditor newModel={newModel} setNewModel={setNewModel} onAdd={() => addModel(provider.id)} />
                      <ModelChips models={provider.models} onRemove={(model) => removeModel(provider.id, model)} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">功能分配</h2>
                <div className="mt-4 space-y-4">
                  {FUNCTIONS.map((fn) => {
                    const assignment = settings.assignments[fn.key];
                    const provider = settings.providers.find((item) => item.id === assignment.providerId);
                    const models = provider?.models || [];
                    return (
                      <div key={fn.key} className="rounded-[10px] border border-[var(--paper-border)] bg-white p-4">
                        <h3 className="text-sm font-medium text-[var(--ink)]">{fn.label}</h3>
                        <p className="mt-1 text-xs text-[var(--ink-faint)]">{fn.desc}</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <select className="rounded-[8px] border border-[var(--paper-border)] bg-white px-3 py-2 text-sm outline-none" value={assignment.providerId} onChange={(e) => setAssignment(fn.key, "providerId", e.target.value)}>
                            {settings.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                          <select className="rounded-[8px] border border-[var(--paper-border)] bg-white px-3 py-2 text-sm outline-none" value={assignment.model} onChange={(e) => setAssignment(fn.key, "model", e.target.value)}>
                            {models.map((model) => <option key={model} value={model}>{model}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {tab === "knowledge" && (
            <section className="space-y-5">
              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">知识库默认行为</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-faint)]">这些设置会影响首页知识库、删除策略和后续图片/OCR 工作流。</p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-[var(--ink-light)]">默认排序</span>
                    <select className="w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2 text-sm outline-none" value={settings.knowledge.defaultSort} onChange={(e) => setSettings((current) => ({ ...current!, knowledge: { ...current!.knowledge, defaultSort: e.target.value as any } }))}>
                      <option value="updated">最近更新优先</option>
                      <option value="created">最近创建优先</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm text-[var(--ink-light)]">删除策略</span>
                    <select className="w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2 text-sm outline-none" value={settings.knowledge.deleteMode} onChange={(e) => setSettings((current) => ({ ...current!, knowledge: { ...current!.knowledge, deleteMode: e.target.value as any } }))}>
                      <option value="trash">先进入最近删除</option>
                      <option value="permanent">直接永久删除</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="paper-card p-6">
                <h2 className="text-lg font-semibold text-[var(--ink)]">自动整理</h2>
                <div className="mt-4 space-y-3">
                  <ToggleRow title="保存笔记后自动生成标题/摘要/关键词" desc="关闭后，笔记会先保持原样，后续再手动整理。" checked={settings.knowledge.autoAnalyze} onChange={(checked) => setSettings((current) => ({ ...current!, knowledge: { ...current!.knowledge, autoAnalyze: checked } }))} />
                  <ToggleRow title="转录成功后自动生成 AI 解读" desc="打开后会更像 Get 笔记，但会增加模型调用次数。" checked={settings.knowledge.autoReport} onChange={(checked) => setSettings((current) => ({ ...current!, knowledge: { ...current!.knowledge, autoReport: checked } }))} />
                  <ToggleRow title="图片上传后自动 OCR/多模态理解" desc={hasVisionConfig(settings) ? "会使用模型页分配的图片理解模型。" : "先在模型页配置图片理解模型后才能开启。"} checked={settings.knowledge.autoImageOcr && hasVisionConfig(settings)} disabled={!hasVisionConfig(settings)} onChange={(checked) => setSettings((current) => ({ ...current!, knowledge: { ...current!.knowledge, autoImageOcr: checked } }))} />
                </div>
              </div>
            </section>
          )}

          {tab === "transcribe" && (
            <section className="space-y-5">
              <div className="paper-card p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--ink)]">转录管线</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-faint)]">这条管线会先下载视频，再用 ffmpeg 提取音频，上传到 OSS，最后调用 DashScope 转成文字笔记。</p>
                  </div>
                  <button onClick={checkTranscription} className="rounded-[8px] bg-[var(--ink)] px-3 py-2 text-sm text-white">保存并检测</button>
                </div>
                <div className="mt-5 rounded-[10px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">第一次配置建议顺序：先确认 ffmpeg 路径，再填 DashScope API Key，然后创建 OSS Bucket 和 RAM AccessKey。Cookies 可以先不填，只有抖音等平台下载失败时再补。</div>
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  <section className="paper-card p-6">
                    <StepHeader number="1" title="ffmpeg：提取音频" desc="你已经下载过 ffmpeg，通常只需要填 ffmpeg.exe 的完整路径。" />
                    <input className="mt-4 w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2.5 text-sm outline-none" placeholder="D:\\MyProjects\\ffmpeg-n8.1-latest-win64-gpl-shared-8.1\\bin\\ffmpeg.exe" value={settings.transcription.ffmpegPath} onChange={(e) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, ffmpegPath: e.target.value } }))} />
                    <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">如果这里留空，程序会尝试使用系统 PATH 里的 ffmpeg。</p>
                  </section>
                  <section className="paper-card p-6">
                    <StepHeader number="2" title="DashScope：语音转文字模型" desc="这是阿里云百炼的 API Key，不是 DeepSeek Key，也不是 OSS Key。" />
                    <input className="mt-4 w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2.5 text-sm outline-none" placeholder="sk-..." value={visibleSecret(settings.transcription.dashscopeApiKey)} onChange={(e) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, dashscopeApiKey: e.target.value } }))} />
                    <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">去阿里云百炼 / DashScope 控制台创建 API Key。这里填的是给语音转写模型用的密钥。</p>
                  </section>
                  <section className="paper-card p-6">
                    <StepHeader number="3" title="转录文本：时间戳与说话人" desc="DashScope 录音文件识别支持时间戳校准和说话人分离，开启后转录文本会更适合回看。" />
                    <div className="mt-4 space-y-3">
                      <ToggleRow title="显示时间戳" desc="在句子前显示类似 [00:00:03 - 00:00:12] 的时间范围。" checked={settings.transcription.enableTimestamps} onChange={(checked) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, enableTimestamps: checked } }))} />
                      <ToggleRow title="尝试区分说话人" desc="模型会自动判断不同说话人，并在文本中标注说话人编号。" checked={settings.transcription.enableSpeakerDiarization} onChange={(checked) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, enableSpeakerDiarization: checked } }))} />
                    </div>
                    <label className="mt-4 block">
                      <span className="mb-1.5 block text-xs font-medium text-[var(--ink-light)]">说话人数参考值</span>
                      <input type="number" min="0" max="100" className="w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2.5 text-sm outline-none" value={settings.transcription.speakerCount || 0} onChange={(e) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, speakerCount: Math.max(0, Number(e.target.value) || 0) } }))} />
                      <span className="mt-1 block text-xs leading-5 text-[var(--ink-faint)]">填 0 表示自动判断；如果你知道音频里有几个人，可以填 2 到 100。</span>
                    </label>
                  </section>
                  <section className="paper-card p-6">
                    <StepHeader number="4" title="OSS：临时存放音频" desc="DashScope 需要能读取音频文件，所以程序会先把音频上传到 OSS，再生成临时签名链接。" />
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Field label="Bucket 名称" placeholder="douyin-transcribe" value={settings.transcription.ossBucketName} onChange={(value) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, ossBucketName: value } }))} />
                      <Field label="Endpoint" placeholder="oss-cn-beijing.aliyuncs.com" value={settings.transcription.ossEndpoint} onChange={(value) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, ossEndpoint: value } }))} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">如果 Bucket 地域是华北 2（北京），Endpoint 就填 oss-cn-beijing.aliyuncs.com。地域不同，Endpoint 也必须跟着变。</p>
                  </section>
                  <section className="paper-card p-6">
                    <StepHeader number="5" title="RAM AccessKey：给程序上传权限" desc="AccessKey ID 和 Secret 必须是同一次创建出来的一对，Secret 忘了只能重新创建。" />
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Field label="OSS AccessKey ID" placeholder="LTAI..." value={settings.transcription.ossAccessKeyId} onChange={(value) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, ossAccessKeyId: value } }))} />
                      <Field label="OSS AccessKey Secret" placeholder="输入 Secret；保存后会隐藏" value={visibleSecret(settings.transcription.ossAccessKeySecret)} onChange={(value) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, ossAccessKeySecret: value } }))} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">个人使用可先给这个 RAM 用户 AliyunOSSFullAccess。之后想收紧权限，再限制到当前 Bucket 的 PutObject / GetObject / DeleteObject。</p>
                  </section>
                  <section className="paper-card p-6">
                    <StepHeader number="6" title="Cookies：可选" desc="部分平台需要登录态才能下载。可以先不填；如果抖音下载失败，再导出 Netscape cookies 粘贴到这里。" />
                    <textarea className="mt-4 min-h-[130px] w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-3 font-mono text-xs outline-none" placeholder="Netscape cookies，可先留空" value={settings.transcription.cookies} onChange={(e) => setSettings((current) => ({ ...current!, transcription: { ...current!.transcription, cookies: e.target.value } }))} />
                  </section>
                </div>
                <aside className="space-y-5">
                  <section className="paper-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--ink)]">第一次配置照着做</h3>
                    <ol className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-light)]">
                      <li>1. OSS 新建 Bucket：douyin-transcribe。</li>
                      <li>2. 地域建议选：华北 2（北京）。</li>
                      <li>3. Endpoint 填：oss-cn-beijing.aliyuncs.com。</li>
                      <li>4. RAM 新建用户：notesprite-transcriber。</li>
                      <li>5. 开启 OpenAPI 调用访问，保存 AccessKey ID 和 Secret。</li>
                      <li>6. 给 RAM 用户添加 AliyunOSSFullAccess。</li>
                      <li>7. 回到这里填写，点“保存并检测”。</li>
                    </ol>
                  </section>
                  <section className="paper-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">检测结果</h3>
                      <button onClick={checkTranscription} className="rounded-[8px] border border-[var(--paper-border)] px-3 py-1.5 text-xs text-[var(--ink-light)]">重新检测</button>
                    </div>
                    {preflightStatus && <p className="mt-3 text-sm text-[var(--ink-light)]">{preflightStatus}</p>}
                    {preflightChecks.length === 0 ? (
                      <p className="mt-3 text-sm leading-6 text-[var(--ink-faint)]">填完左侧配置后点“保存并检测”，这里会告诉你哪一步没通。</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {preflightChecks.map((check) => (
                          <div key={check.name} className={`rounded-[8px] border px-3 py-2 text-sm ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                            <div className="font-medium">{check.ok ? "通过" : "失败"}：{check.name}</div>
                            <div className="mt-1 break-words text-xs opacity-90">{explainCheck(check)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </section>
          )}

          {tab === "about" && (
            <section className="paper-card p-6">
              <h2 className="text-lg font-semibold text-[var(--ink)]">NoteSprite</h2>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-light)]">有精灵的真实笔记。它不是一个冷冰冰的工具箱，而是一个安静、清晰、能陪你整理想法的个人笔记本。</p>
            </section>
          )}

          <footer className="mt-7 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="rounded-[10px] bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "保存中..." : "保存设置"}</button>
            {saved && <span className="text-sm text-[var(--ink-faint)]">已保存</span>}
          </footer>
        </div>
      </main>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-[var(--ink-light)]">{label}</span>
      <input className="w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--accent-blue)]" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function StepHeader({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white">{number}</span>
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--ink-faint)]">{desc}</p>
      </div>
    </div>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--ink-light)]">{label}</span>
      <input className="w-full rounded-[10px] border border-[var(--paper-border)] bg-white px-3 py-2.5 text-sm outline-none" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ToggleRow({ title, desc, checked, disabled = false, onChange }: { title: string; desc: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-[10px] border border-[var(--paper-border)] bg-white px-4 py-3 ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-medium text-[var(--ink)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--ink-faint)]">{desc}</span>
      </span>
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent-blue)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function ModelEditor({ newModel, setNewModel, onAdd }: { newModel: string; setNewModel: (value: string) => void; onAdd: () => void }) {
  return (
    <div className="mt-3 flex gap-2">
      <input className="flex-1 rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm outline-none" placeholder="添加模型，例如 deepseek-chat" value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} />
      <button onClick={onAdd} className="rounded-[8px] border border-[var(--paper-border)] px-3 py-2 text-sm">添加</button>
    </div>
  );
}

function ModelChips({ models, onRemove }: { models: string[]; onRemove: (model: string) => void }) {
  if (!models.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {models.map((model) => (
        <span key={model} className="rounded-full bg-[var(--paper-soft)] px-3 py-1 text-xs text-[var(--ink-light)]">
          {model}
          <button onClick={() => onRemove(model)} className="ml-2 text-[var(--ink-faint)] hover:text-red-500">x</button>
        </span>
      ))}
    </div>
  );
}
