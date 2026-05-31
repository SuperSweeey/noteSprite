import { prisma } from "@/lib/prisma";
import { DEFAULT_REPORT_PROMPT } from "@/lib/default-prompts";

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export interface Assignment {
  providerId: string;
  model: string;
}

export interface TranscriptionSettings {
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
}

export type TranscriptionConfigSource = "settings" | "env" | "missing";

export interface TranscriptionFieldMeta {
  present: boolean;
  source: TranscriptionConfigSource;
  tail: string;
  length: number;
  label: string;
  warning?: string;
}

export interface TranscriptionRuntimeConfig extends TranscriptionSettings {
  sources: Record<keyof TranscriptionSettings, TranscriptionFieldMeta>;
  warnings: string[];
}

export interface SpiritSettings {
  name: string;
  personaId: string;
  personaPrompt: string;
  learningModeId: string;
  learningPrompt: string;
  prompt: string;
}

export interface KnowledgeSettings {
  defaultSort: "updated" | "created";
  autoAnalyze: boolean;
  autoReport: boolean;
  deleteMode: "trash" | "permanent";
  autoImageOcr: boolean;
}

export interface AppearanceSettings {
  fontFamily:
    | "source-serif"
    | "source-sans"
    | "lxgw-wenkai"
    | "lxgw-bright"
    | "misans"
    | "harmonyos"
    | "alibaba-puhuiti"
    | "system-sans"
    | "microsoft-yahei"
    | "songti"
    | "kaiti"
    | "system"
    | "custom";
  customFontFamily: string;
}

export interface LearningMode {
  id: string;
  name: string;
  desc: string;
  prompt: string;
}

export interface PersonaTemplate {
  id: string;
  name: string;
  desc: string;
  prompt: string;
}

export interface UserSettings {
  providers: Provider[];
  assignments: {
    chat: Assignment;
    analysis: Assignment;
    report: Assignment;
    vision: Assignment;
  };
  prompts: {
    chat: string;
    analysis: string;
    report: string;
  };
  transcription: TranscriptionSettings;
  spirit: SpiritSettings;
  knowledge: KnowledgeSettings;
  appearance: AppearanceSettings;
}

export const SECRET_MASK = "••••";

const DEFAULT_PROVIDER: Provider = {
  id: "default",
  name: "DeepSeek",
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
  models: ["deepseek-v4-flash", "deepseek-chat"],
};

const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
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
};

const DEFAULT_KNOWLEDGE: KnowledgeSettings = {
  defaultSort: "updated",
  autoAnalyze: true,
  autoReport: false,
  deleteMode: "trash",
  autoImageOcr: false,
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: "source-serif",
  customFontFamily: "",
};

export const LEARNING_MODES: LearningMode[] = [
  {
    id: "socratic",
    name: "苏格拉底追问",
    desc: "少给答案，多用问题带用户自己走完逻辑链。",
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

export const PERSONA_TEMPLATES: PersonaTemplate[] = [
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

export const DEFAULT_SPIRIT_PROMPT = [
  "你是 NoteSprite 里的笔记精灵。",
  "你住在用户的真实笔记里，帮助用户读懂、整理、追问和连接笔记。",
  "优先依据用户笔记回答。笔记里没有的信息，要明确说暂时没在笔记里看到。",
].join("\n");

const DEFAULT_SPIRIT: SpiritSettings = {
  name: "AI",
  personaId: "warm",
  personaPrompt: PERSONA_TEMPLATES[0].prompt,
  learningModeId: "socratic",
  learningPrompt: LEARNING_MODES[0].prompt,
  prompt: DEFAULT_SPIRIT_PROMPT,
};

export const DEFAULTS: UserSettings = {
  providers: [DEFAULT_PROVIDER],
  assignments: {
    chat: { providerId: "default", model: "deepseek-v4-flash" },
    analysis: { providerId: "default", model: "deepseek-v4-flash" },
    report: { providerId: "default", model: "deepseek-v4-flash" },
    vision: { providerId: "default", model: "qwen-vl-plus" },
  },
  prompts: { chat: "", analysis: "", report: DEFAULT_REPORT_PROMPT },
  transcription: { ...DEFAULT_TRANSCRIPTION },
  spirit: { ...DEFAULT_SPIRIT },
  knowledge: { ...DEFAULT_KNOWLEDGE },
  appearance: { ...DEFAULT_APPEARANCE },
};

export function isMaskedSecret(value?: string | null): boolean {
  const text = String(value || "").trim();
  return text.startsWith(SECRET_MASK) || text.includes("鈥") || text.includes("...");
}

export function isPlaceholderSecret(value?: string | null): boolean {
  const text = String(value || "").trim();
  if (!text || isMaskedSecret(text)) return true;
  if (/test|example|demo|your_|your-|placeholder/i.test(text)) return true;
  if (text === "my-audio-bucket") return true;
  return false;
}

export function usableSecret(value?: string | null, minLength = 8): string {
  const text = String(value || "").trim();
  if (isPlaceholderSecret(text)) return "";
  return text.length >= minLength ? text : "";
}

function secretLooksLikeOssAccessKeyId(value?: string | null): boolean {
  return /^LTAI[A-Za-z0-9]{8,}$/.test(String(value || "").trim());
}

function secretLooksLikeDashScopeApiKey(value?: string | null): boolean {
  const text = String(value || "").trim();
  return /^sk-[A-Za-z0-9_-]{16,}$/.test(text) || /^dashscope-[A-Za-z0-9_-]{12,}$/i.test(text);
}

function pickSecret(
  label: string,
  settingsValue: string | undefined,
  envValue: string | undefined,
  minLength: number,
  validate?: (value: string) => string | undefined
): { value: string; meta: TranscriptionFieldMeta; warning?: string } {
  const settingsSecret = usableSecret(settingsValue, minLength);
  const envSecret = usableSecret(envValue, minLength);
  const source: TranscriptionConfigSource = settingsSecret ? "settings" : envSecret ? "env" : "missing";
  const value = settingsSecret || envSecret || "";
  const warning = value && validate ? validate(value) : undefined;
  return {
    value,
    warning,
    meta: {
      present: Boolean(value),
      source,
      tail: value ? value.slice(-4) : "",
      length: value.length,
      label,
      warning,
    },
  };
}

function pickText(
  label: string,
  settingsValue: string | undefined,
  envValue: string | undefined
): { value: string; meta: TranscriptionFieldMeta } {
  const settingsText = usableText(settingsValue);
  const envText = usableText(envValue);
  const source: TranscriptionConfigSource = settingsText ? "settings" : envText ? "env" : "missing";
  const value = settingsText || envText || "";
  return {
    value,
    meta: {
      present: Boolean(value),
      source,
      tail: value ? value.slice(-4) : "",
      length: value.length,
      label,
    },
  };
}

function sourceText(source: TranscriptionConfigSource): string {
  if (source === "settings") return "设置页";
  if (source === "env") return ".env";
  return "未配置";
}

export function formatTranscriptionFieldMeta(meta: TranscriptionFieldMeta): string {
  if (!meta.present) return `${meta.label}：未配置`;
  const tail = meta.tail ? `，尾号 ${meta.tail}` : "";
  const warning = meta.warning ? `，警告：${meta.warning}` : "";
  return `${meta.label}：来自 ${sourceText(meta.source)}${tail}${warning}`;
}

function usableText(value?: string | null): string {
  const text = String(value || "").trim();
  if (!text || isMaskedSecret(text) || /example|placeholder/i.test(text)) return "";
  return text;
}

export function looksMojibake(value?: string | null): boolean {
  const text = String(value || "");
  if (!text) return false;
  if (text.includes("\uFFFD") || text.includes("ï¿½")) return true;
  if (/[åæçèéä]/.test(text) || /浣|灏|绮|杞|妯|璁|鍥|澶|娴/.test(text)) return true;
  const latinNoise = (text.match(/[ÃÂâï¼ã]/g) || []).length;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latinNoise >= 4 && chineseChars < 8;
}

function parseSettings(raw?: string | null): Partial<UserSettings> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function cleanText(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  return text && !looksMojibake(text) ? text : fallback;
}

function cleanSpiritName(value: unknown): string {
  return cleanText(value, DEFAULT_SPIRIT.name);
}

function userText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function promptText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text && !looksMojibake(text) ? text : fallback;
}

function defaultIfMissing<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

export function resolveSettings(raw?: string | null): UserSettings {
  const settings = parseSettings(raw);
  const providers = settings.providers?.length ? settings.providers : DEFAULTS.providers;
  const rawSpirit = settings.spirit || ({} as Partial<SpiritSettings>);
  const legacySpirit = rawSpirit as Partial<SpiritSettings> & Record<string, string | undefined>;
  const mode = LEARNING_MODES.find((item) => item.id === rawSpirit.learningModeId) || LEARNING_MODES[0];
  const legacyPersona = [
    legacySpirit.identity ? `身份：${legacySpirit.identity}` : "",
    legacySpirit.relationship ? `关系：${legacySpirit.relationship}` : "",
    legacySpirit.personality ? `气质：${legacySpirit.personality}` : "",
    legacySpirit.style ? `风格：${legacySpirit.style}` : "",
    legacySpirit.boundaries ? `边界：${legacySpirit.boundaries}` : "",
  ].filter(Boolean).join("\n");
  const learningPrompt = promptText(rawSpirit.learningPrompt, mode.prompt);

  return {
    providers,
    assignments: { ...DEFAULTS.assignments, ...settings.assignments },
    prompts: {
      ...DEFAULTS.prompts,
      ...settings.prompts,
      chat: promptText(settings.prompts?.chat, DEFAULTS.prompts.chat),
      analysis: promptText(settings.prompts?.analysis, DEFAULTS.prompts.analysis),
      report: promptText(settings.prompts?.report, DEFAULT_REPORT_PROMPT),
    },
    transcription: { ...DEFAULTS.transcription, ...settings.transcription },
    knowledge: { ...DEFAULTS.knowledge, ...settings.knowledge },
    appearance: { ...DEFAULTS.appearance, ...settings.appearance },
    spirit: {
      name: cleanSpiritName(rawSpirit.name),
      personaId: defaultIfMissing(rawSpirit.personaId, DEFAULT_SPIRIT.personaId),
      personaPrompt: promptText(rawSpirit.personaPrompt, legacyPersona || DEFAULT_SPIRIT.personaPrompt),
      learningModeId: defaultIfMissing(rawSpirit.learningModeId, mode.id),
      learningPrompt,
      prompt: promptText(rawSpirit.prompt, DEFAULT_SPIRIT.prompt),
    },
  };
}

export async function getAIConfig(
  userId: string,
  fn: "chat" | "analysis" | "report" | "vision"
): Promise<{ apiKey: string; baseUrl: string; model: string; prompt: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const resolved = resolveSettings(user?.settings);
  const assignment = resolved.assignments[fn] || DEFAULTS.assignments[fn];
  const provider = resolved.providers.find((p) => p.id === assignment.providerId) || DEFAULT_PROVIDER;

  const envModel = process.env.DEEPSEEK_MODEL || DEFAULTS.assignments[fn].model;
  const envKey = usableSecret(process.env.DEEPSEEK_API_KEY, 12);
  const providerKey = usableSecret(provider.apiKey, 12);

  return {
    apiKey: providerKey || envKey,
    baseUrl: usableText(provider.baseUrl) || process.env.DEEPSEEK_BASE_URL || DEFAULT_PROVIDER.baseUrl,
    model: assignment.model || envModel,
    prompt: fn === "vision" ? "" : resolved.prompts?.[fn] || "",
  };
}

export async function getSpiritConfig(userId: string): Promise<SpiritSettings> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return resolveSettings(user?.settings).spirit;
}

export function buildSpiritPrompt(spirit: SpiritSettings, extra = ""): string {
  return [
    "## 产品身份",
    "你是 NoteSprite 里的 AI 笔记精灵，存在于用户的真实笔记中。",
    "",
    "## AI 角色画像",
    `AI 名称：${spirit.name || DEFAULT_SPIRIT.name}`,
    spirit.personaPrompt || DEFAULT_SPIRIT.personaPrompt,
    "",
    "## 基础原则",
    spirit.prompt || DEFAULT_SPIRIT_PROMPT,
    "",
    "## AI 学习方式",
    spirit.learningPrompt || DEFAULT_SPIRIT.learningPrompt,
    extra ? `\n## 当前任务补充\n${extra}` : "",
  ].filter(Boolean).join("\n");
}

export async function resolveTranscriptionRuntimeConfig(
  userId: string,
  override?: Partial<TranscriptionSettings>
): Promise<TranscriptionRuntimeConfig> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const stored = resolveSettings(user?.settings).transcription;
  const config = { ...stored, ...(override || {}) };
  const warnings: string[] = [];

  const dashscope = pickSecret(
    "DashScope API Key",
    config.dashscopeApiKey,
    process.env.DASHSCOPE_API_KEY,
    20,
    (value) => {
      if (secretLooksLikeOssAccessKeyId(value)) return "看起来像 OSS AccessKey ID，不是 DashScope API Key";
      if (!secretLooksLikeDashScopeApiKey(value)) return "格式不像常见 DashScope API Key，请用检测确认";
      return undefined;
    }
  );
  if (dashscope.warning) warnings.push(`DashScope API Key：${dashscope.warning}`);

  const cookies = pickText("Cookies", config.cookies, process.env.COOKIES);
  const ffmpegPath = pickText("ffmpeg 路径", config.ffmpegPath, process.env.FFMPEG_PATH);

  const settingsOss = {
    accessKeyId: usableSecret(config.ossAccessKeyId, 12),
    accessKeySecret: usableSecret(config.ossAccessKeySecret, 20),
    bucketName: usableText(config.ossBucketName),
    endpoint: usableText(config.ossEndpoint),
  };
  const envOss = {
    accessKeyId: usableSecret(process.env.OSS_ACCESS_KEY_ID, 12),
    accessKeySecret: usableSecret(process.env.OSS_ACCESS_KEY_SECRET, 20),
    bucketName: usableText(process.env.OSS_BUCKET_NAME),
    endpoint: usableText(process.env.OSS_ENDPOINT),
  };
  const settingsOssComplete = Boolean(
    settingsOss.accessKeyId &&
    settingsOss.accessKeySecret &&
    settingsOss.bucketName &&
    settingsOss.endpoint
  );
  const oss = settingsOssComplete ? settingsOss : envOss;
  const ossSource: TranscriptionConfigSource = settingsOssComplete ? "settings" : (
    oss.accessKeyId || oss.accessKeySecret || oss.bucketName || oss.endpoint ? "env" : "missing"
  );

  if (config.ossAccessKeyId || config.ossAccessKeySecret || config.ossBucketName || config.ossEndpoint) {
    const missing = [
      ["OSS AccessKey ID", settingsOss.accessKeyId],
      ["OSS AccessKey Secret", settingsOss.accessKeySecret],
      ["OSS Bucket", settingsOss.bucketName],
      ["OSS Endpoint", settingsOss.endpoint],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      warnings.push(`设置页里的 OSS 配置不完整，当前整组回退到 .env。缺少：${missing.join("、")}`);
    }
  }

  if (oss.accessKeyId && secretLooksLikeDashScopeApiKey(oss.accessKeyId)) {
    warnings.push("OSS AccessKey ID 看起来像 DashScope API Key，请检查是否填反。");
  }
  const ossSecretWarning = oss.accessKeySecret && secretLooksLikeOssAccessKeyId(oss.accessKeySecret)
    ? "看起来像 OSS AccessKey ID，不是 Secret"
    : undefined;
  if (ossSecretWarning) warnings.push(`OSS AccessKey Secret：${ossSecretWarning}`);

  const sources: TranscriptionRuntimeConfig["sources"] = {
    cookies: cookies.meta,
    dashscopeApiKey: dashscope.meta,
    ossAccessKeyId: {
      present: Boolean(oss.accessKeyId),
      source: ossSource,
      tail: oss.accessKeyId ? oss.accessKeyId.slice(-4) : "",
      length: oss.accessKeyId.length,
      label: "OSS AccessKey ID",
    },
    ossAccessKeySecret: {
      present: Boolean(oss.accessKeySecret),
      source: ossSource,
      tail: oss.accessKeySecret ? oss.accessKeySecret.slice(-4) : "",
      length: oss.accessKeySecret.length,
      label: "OSS AccessKey Secret",
      warning: ossSecretWarning,
    },
    ossBucketName: {
      present: Boolean(oss.bucketName),
      source: ossSource,
      tail: "",
      length: oss.bucketName.length,
      label: "OSS Bucket",
    },
    ossEndpoint: {
      present: Boolean(oss.endpoint),
      source: ossSource,
      tail: "",
      length: oss.endpoint.length,
      label: "OSS Endpoint",
    },
    ffmpegPath: ffmpegPath.meta,
    enableTimestamps: {
      present: true,
      source: "settings",
      tail: "",
      length: String(config.enableTimestamps ?? DEFAULT_TRANSCRIPTION.enableTimestamps).length,
      label: "时间戳",
    },
    enableSpeakerDiarization: {
      present: true,
      source: "settings",
      tail: "",
      length: String(config.enableSpeakerDiarization ?? DEFAULT_TRANSCRIPTION.enableSpeakerDiarization).length,
      label: "说话人分离",
    },
    speakerCount: {
      present: true,
      source: "settings",
      tail: "",
      length: String(config.speakerCount ?? DEFAULT_TRANSCRIPTION.speakerCount).length,
      label: "说话人数参考值",
    },
  };

  return {
    cookies: cookies.value,
    dashscopeApiKey: dashscope.value,
    ossAccessKeyId: oss.accessKeyId,
    ossAccessKeySecret: oss.accessKeySecret,
    ossBucketName: oss.bucketName,
    ossEndpoint: oss.endpoint,
    ffmpegPath: ffmpegPath.value,
    enableTimestamps: config.enableTimestamps ?? DEFAULT_TRANSCRIPTION.enableTimestamps,
    enableSpeakerDiarization: config.enableSpeakerDiarization ?? DEFAULT_TRANSCRIPTION.enableSpeakerDiarization,
    speakerCount: Number(config.speakerCount || 0),
    sources,
    warnings,
  };
}

export async function getTranscriptionConfig(userId: string): Promise<TranscriptionSettings> {
  const runtime = await resolveTranscriptionRuntimeConfig(userId);
  const { sources, warnings, ...config } = runtime;
  return config;
}

export function buildTranscriptionEnv(config: TranscriptionSettings): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.cookies) env.COOKIES = config.cookies;
  if (config.dashscopeApiKey) env.DASHSCOPE_API_KEY = config.dashscopeApiKey;
  if (config.ossAccessKeyId) env.OSS_ACCESS_KEY_ID = config.ossAccessKeyId;
  if (config.ossAccessKeySecret) env.OSS_ACCESS_KEY_SECRET = config.ossAccessKeySecret;
  if (config.ossBucketName) env.OSS_BUCKET_NAME = config.ossBucketName;
  if (config.ossEndpoint) env.OSS_ENDPOINT = config.ossEndpoint;
  if (config.ffmpegPath) env.FFMPEG_PATH = config.ffmpegPath;
  env.TRANSCRIBE_ENABLE_TIMESTAMPS = config.enableTimestamps ? "1" : "0";
  env.TRANSCRIBE_ENABLE_SPEAKER_DIARIZATION = config.enableSpeakerDiarization ? "1" : "0";
  env.TRANSCRIBE_SPEAKER_COUNT = String(config.speakerCount || 0);
  return env;
}
