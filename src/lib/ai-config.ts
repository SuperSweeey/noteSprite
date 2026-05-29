import { prisma } from "@/lib/prisma";

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
}

export interface UserSettings {
  providers: Provider[];
  assignments: {
    chat: Assignment;
    analysis: Assignment;
    report: Assignment;
  };
  prompts: {
    chat: string;
    analysis: string;
    report: string;
  };
  transcription: TranscriptionSettings;
}

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
};

export const DEFAULTS: UserSettings = {
  providers: [DEFAULT_PROVIDER],
  assignments: {
    chat: { providerId: "default", model: "deepseek-v4-flash" },
    analysis: { providerId: "default", model: "deepseek-v4-flash" },
    report: { providerId: "default", model: "deepseek-v4-flash" },
  },
  prompts: {
    chat: "",
    analysis: "",
    report: "",
  },
  transcription: { ...DEFAULT_TRANSCRIPTION },
};

function resolve(settings: UserSettings): UserSettings {
  if (!settings?.providers?.length) return DEFAULTS;
  return {
    providers: settings.providers,
    assignments: {
      chat: settings.assignments?.chat || DEFAULTS.assignments.chat,
      analysis: settings.assignments?.analysis || DEFAULTS.assignments.analysis,
      report: settings.assignments?.report || DEFAULTS.assignments.report,
    },
    prompts: {
      chat: settings.prompts?.chat || "",
      analysis: settings.prompts?.analysis || "",
      report: settings.prompts?.report || "",
    },
    transcription: {
      cookies: settings.transcription?.cookies || "",
      dashscopeApiKey: settings.transcription?.dashscopeApiKey || "",
      ossAccessKeyId: settings.transcription?.ossAccessKeyId || "",
      ossAccessKeySecret: settings.transcription?.ossAccessKeySecret || "",
      ossBucketName: settings.transcription?.ossBucketName || "",
      ossEndpoint: settings.transcription?.ossEndpoint || "",
      ffmpegPath: settings.transcription?.ffmpegPath || "",
    },
  };
}

/** Server-side: resolve AI config for a specific function */
export async function getAIConfig(
  userId: string,
  fn: "chat" | "analysis" | "report"
): Promise<{ apiKey: string; baseUrl: string; model: string; prompt: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  let settings: UserSettings;
  try { settings = JSON.parse(user?.settings || "{}"); } catch { settings = DEFAULTS; }
  const resolved = resolve(settings);
  const assignment = resolved.assignments[fn];
  const provider = resolved.providers.find((p) => p.id === assignment?.providerId) || DEFAULT_PROVIDER;

  return {
    apiKey: provider.apiKey || process.env.DEEPSEEK_API_KEY || "",
    baseUrl: provider.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: assignment?.model || "deepseek-v4-flash",
    prompt: resolved.prompts?.[fn] || "",
  };
}

/** Server-side: resolve transcription pipeline config */
export async function getTranscriptionConfig(userId: string): Promise<TranscriptionSettings> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  let settings: UserSettings;
  try { settings = JSON.parse(user?.settings || "{}"); } catch { settings = DEFAULTS; }
  const resolved = resolve(settings);
  return resolved.transcription;
}

/** Build env overrides for Python transcription pipeline from user settings */
export function buildTranscriptionEnv(config: TranscriptionSettings): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.cookies) env.COOKIES = config.cookies;
  if (config.dashscopeApiKey) env.DASHSCOPE_API_KEY = config.dashscopeApiKey;
  if (config.ossAccessKeyId) env.OSS_ACCESS_KEY_ID = config.ossAccessKeyId;
  if (config.ossAccessKeySecret) env.OSS_ACCESS_KEY_SECRET = config.ossAccessKeySecret;
  if (config.ossBucketName) env.OSS_BUCKET_NAME = config.ossBucketName;
  if (config.ossEndpoint) env.OSS_ENDPOINT = config.ossEndpoint;
  if (config.ffmpegPath) env.FFMPEG_PATH = config.ffmpegPath;
  return env;
}