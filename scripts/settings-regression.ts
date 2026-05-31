import { DEFAULTS, Provider, UserSettings, isMaskedSecret, looksMojibake, resolveSettings } from "../src/lib/ai-config";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function mergeSettings(existing: UserSettings, body: Partial<UserSettings>): UserSettings {
  const updated: UserSettings = {
    providers: existing.providers,
    assignments: { ...DEFAULTS.assignments, ...existing.assignments },
    prompts: { ...DEFAULTS.prompts, ...existing.prompts },
    transcription: { ...DEFAULTS.transcription, ...existing.transcription },
    spirit: { ...DEFAULTS.spirit, ...existing.spirit },
    knowledge: { ...DEFAULTS.knowledge, ...existing.knowledge },
    appearance: { ...DEFAULTS.appearance, ...existing.appearance },
  };

  if (body.providers) {
    updated.providers = body.providers.map((provider: Provider) => {
      const oldProvider = existing.providers.find((item) => item.id === provider.id);
      const value = String(provider.apiKey || "").trim();
      return {
        ...provider,
        apiKey: !value || isMaskedSecret(value) ? oldProvider?.apiKey || "" : value,
      };
    });
  }

  if (body.assignments) updated.assignments = { ...updated.assignments, ...body.assignments };
  if (body.prompts) {
    const keepPrompt = (incoming: unknown, existing: string, fallback: string) => {
      const value = String(incoming ?? "").trim();
      if (!value) return existing || fallback;
      if (looksMojibake(value)) return existing && !looksMojibake(existing) ? existing : fallback;
      return value;
    };
    updated.prompts = {
      chat: keepPrompt(body.prompts.chat, existing.prompts.chat, DEFAULTS.prompts.chat),
      analysis: keepPrompt(body.prompts.analysis, existing.prompts.analysis, DEFAULTS.prompts.analysis),
      report: keepPrompt(body.prompts.report, existing.prompts.report, DEFAULTS.prompts.report),
    };
  }
  if (body.transcription) {
    const current = existing.transcription;
    const incoming = body.transcription;
    updated.transcription = {
      cookies: incoming.cookies ?? current.cookies ?? "",
      dashscopeApiKey: !incoming.dashscopeApiKey || isMaskedSecret(incoming.dashscopeApiKey) ? current.dashscopeApiKey : incoming.dashscopeApiKey,
      ossAccessKeyId: incoming.ossAccessKeyId ?? current.ossAccessKeyId ?? "",
      ossAccessKeySecret: !incoming.ossAccessKeySecret || isMaskedSecret(incoming.ossAccessKeySecret) ? current.ossAccessKeySecret : incoming.ossAccessKeySecret,
      ossBucketName: incoming.ossBucketName ?? current.ossBucketName ?? "",
      ossEndpoint: incoming.ossEndpoint ?? current.ossEndpoint ?? "",
      ffmpegPath: incoming.ffmpegPath ?? current.ffmpegPath ?? "",
      enableTimestamps: incoming.enableTimestamps ?? current.enableTimestamps ?? DEFAULTS.transcription.enableTimestamps,
      enableSpeakerDiarization: incoming.enableSpeakerDiarization ?? current.enableSpeakerDiarization ?? DEFAULTS.transcription.enableSpeakerDiarization,
      speakerCount: Number(incoming.speakerCount ?? current.speakerCount ?? DEFAULTS.transcription.speakerCount) || 0,
    };
  }
  if (body.spirit) {
    const keepPrompt = (incoming: unknown, existing: string, fallback: string) => {
      const value = String(incoming ?? "").trim();
      if (!value) return existing || fallback;
      if (looksMojibake(value)) return existing && !looksMojibake(existing) ? existing : fallback;
      return value;
    };
    updated.spirit = {
      ...updated.spirit,
      ...body.spirit,
      personaPrompt: keepPrompt(body.spirit.personaPrompt, existing.spirit.personaPrompt, DEFAULTS.spirit.personaPrompt),
      learningPrompt: keepPrompt(body.spirit.learningPrompt, existing.spirit.learningPrompt, DEFAULTS.spirit.learningPrompt),
      prompt: keepPrompt(body.spirit.prompt, existing.spirit.prompt, DEFAULTS.spirit.prompt),
    };
  }
  if (body.knowledge) {
    updated.knowledge = {
      defaultSort: body.knowledge.defaultSort ?? existing.knowledge.defaultSort,
      autoAnalyze: body.knowledge.autoAnalyze ?? existing.knowledge.autoAnalyze,
      autoReport: body.knowledge.autoReport ?? existing.knowledge.autoReport,
      deleteMode: body.knowledge.deleteMode ?? existing.knowledge.deleteMode,
      autoImageOcr: body.knowledge.autoImageOcr ?? existing.knowledge.autoImageOcr,
    };
  }
  if (body.appearance) {
    updated.appearance = {
      fontFamily: body.appearance.fontFamily ?? existing.appearance.fontFamily,
      customFontFamily: body.appearance.customFontFamily ?? existing.appearance.customFontFamily,
    };
  }
  return updated;
}

function pickOssConfig(config: UserSettings["transcription"], env: Record<string, string>) {
  const settingsOss = {
    accessKeyId: config.ossAccessKeyId || "",
    accessKeySecret: config.ossAccessKeySecret || "",
    bucketName: config.ossBucketName || "",
    endpoint: config.ossEndpoint || "",
  };
  const envOss = {
    accessKeyId: env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET || "",
    bucketName: env.OSS_BUCKET_NAME || "",
    endpoint: env.OSS_ENDPOINT || "",
  };
  return settingsOss.accessKeyId && settingsOss.accessKeySecret && settingsOss.bucketName && settingsOss.endpoint
    ? settingsOss
    : envOss;
}

const raw = JSON.stringify({
  ...DEFAULTS,
  providers: [{ id: "default", name: "DeepSeek", apiKey: "real-secret-key", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat"] }],
  prompts: { chat: "", analysis: "", report: "短解读" },
  transcription: { ...DEFAULTS.transcription, dashscopeApiKey: "dashscope-real-secret", ossAccessKeySecret: "oss-real-secret" },
  spirit: { ...DEFAULTS.spirit, name: "小傲", learningPrompt: "短 Prompt", prompt: "短原则" },
  knowledge: { defaultSort: "created", autoAnalyze: true, autoReport: true, deleteMode: "trash", autoImageOcr: true },
  appearance: { fontFamily: "songti", customFontFamily: "LXGW WenKai" },
});

const resolved = resolveSettings(raw);
assert(resolved.spirit.name === "小傲", "AI 名称小傲不能被改回 AI");
assert(resolved.spirit.learningPrompt === "短 Prompt", "短 learningPrompt 不能被默认 Prompt 覆盖");
assert(resolved.prompts.report === "短解读", "短 report Prompt 不能被默认 Prompt 覆盖");
assert(resolved.appearance.fontFamily === "songti", "字体设置不能被默认值覆盖");
assert(resolved.appearance.customFontFamily === "LXGW WenKai", "自定义字体名称不能丢失");

const polluted = resolveSettings(JSON.stringify({
  ...DEFAULTS,
  prompts: { ...DEFAULTS.prompts, report: "ä½ çä»»å¡ï¿½ï¿½" },
  spirit: {
    ...DEFAULTS.spirit,
    personaPrompt: "ä½ æ¯ä¸ä¸ªæ¸©æç AI",
    learningPrompt: "## æ ¸å¿ä»»å¡",
    prompt: "ä½ æ¯ NoteSprite éçç¬è®°ç²¾çµ",
  },
}));
assert(polluted.spirit.personaPrompt === DEFAULTS.spirit.personaPrompt, "污染的 personaPrompt 必须回退默认");
assert(polluted.spirit.learningPrompt === DEFAULTS.spirit.learningPrompt, "污染的 learningPrompt 必须回退默认");
assert(polluted.spirit.prompt === DEFAULTS.spirit.prompt, "污染的基础原则必须回退默认");
assert(polluted.prompts.report === DEFAULTS.prompts.report, "污染的 report Prompt 必须回退默认");

const mergedKnowledge = mergeSettings(resolved, { knowledge: { defaultSort: "updated" } as any });
assert(mergedKnowledge.knowledge.autoAnalyze === true, "局部更新 knowledge 不能把 autoAnalyze 变 false");
assert(mergedKnowledge.knowledge.autoReport === true, "局部更新 knowledge 不能把 autoReport 变 false");
assert(mergedKnowledge.knowledge.autoImageOcr === true, "局部更新 knowledge 不能把 autoImageOcr 变 false");

const mergedAppearance = mergeSettings(resolved, { appearance: { fontFamily: "custom", customFontFamily: "MiSans" } as any });
assert(mergedAppearance.appearance.fontFamily === "custom", "字体设置必须能保存自定义模式");
assert(mergedAppearance.appearance.customFontFamily === "MiSans", "自定义字体名称必须能保存新值");

const masked = mergeSettings(resolved, {
  providers: [{ ...resolved.providers[0], apiKey: "••••-key" }],
  transcription: { ...resolved.transcription, dashscopeApiKey: "••••cret", ossAccessKeySecret: "••••cret" },
});
assert(masked.providers[0].apiKey === "real-secret-key", "模型密钥遮罩保存不能覆盖真实 key");
assert(masked.transcription.dashscopeApiKey === "dashscope-real-secret", "DashScope 遮罩保存不能覆盖真实 key");
assert(masked.transcription.ossAccessKeySecret === "oss-real-secret", "OSS Secret 遮罩保存不能覆盖真实 key");

const blockedMojibake = mergeSettings(resolved, {
  prompts: { ...resolved.prompts, report: "ä½ çä»»å¡ï¿½ï¿½" },
  spirit: { ...resolved.spirit, personaPrompt: "ä½ æ¯ä¸ä¸ª", learningPrompt: "## æ ¸å¿", prompt: "ä½ æ¯ NoteSprite" },
});
assert(blockedMojibake.prompts.report === resolved.prompts.report, "PUT 不能让污染 report Prompt 覆盖干净设置");
assert(blockedMojibake.spirit.personaPrompt === resolved.spirit.personaPrompt, "PUT 不能让污染 personaPrompt 覆盖干净设置");
assert(blockedMojibake.spirit.learningPrompt === resolved.spirit.learningPrompt, "PUT 不能让污染 learningPrompt 覆盖干净设置");
assert(blockedMojibake.spirit.prompt === resolved.spirit.prompt, "PUT 不能让污染基础原则覆盖干净设置");

const ossFromSettings = pickOssConfig(
  {
    ...DEFAULTS.transcription,
    ossAccessKeyId: "settings-id",
    ossAccessKeySecret: "settings-secret",
    ossBucketName: "my-audio-bucket",
    ossEndpoint: "oss-cn-shanghai.aliyuncs.com",
  },
  {
    OSS_ACCESS_KEY_ID: "env-id",
    OSS_ACCESS_KEY_SECRET: "env-secret",
    OSS_BUCKET_NAME: "douyin-transcribe",
    OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
  },
);
assert(ossFromSettings.accessKeyId === "settings-id", "完整 OSS 设置必须整体优先于 .env，不能混用 env ID");
assert(ossFromSettings.bucketName === "my-audio-bucket", "Bucket 即使叫 my-audio-bucket 也不能被强制回退 .env");
assert(ossFromSettings.endpoint === "oss-cn-shanghai.aliyuncs.com", "Endpoint 必须跟随设置页，不得混用 .env");

const ossFromEnv = pickOssConfig(
  {
    ...DEFAULTS.transcription,
    ossAccessKeyId: "settings-id",
    ossAccessKeySecret: "",
    ossBucketName: "my-audio-bucket",
    ossEndpoint: "oss-cn-shanghai.aliyuncs.com",
  },
  {
    OSS_ACCESS_KEY_ID: "env-id",
    OSS_ACCESS_KEY_SECRET: "env-secret",
    OSS_BUCKET_NAME: "douyin-transcribe",
    OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
  },
);
assert(ossFromEnv.accessKeyId === "env-id", "OSS 设置不完整时才允许整组回退 .env");
assert(ossFromEnv.bucketName === "douyin-transcribe", "回退 .env 时必须整组回退，不能半设置半 env");

console.log("settings regression passed");
