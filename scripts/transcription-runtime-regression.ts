import {
  TranscriptionSettings,
  buildTranscriptionEnv,
  formatTranscriptionFieldMeta,
  isMaskedSecret,
  usableSecret,
} from "../src/lib/ai-config";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type Source = "settings" | "env" | "missing";

function pickSecret(settingsValue: string, envValue: string, minLength: number) {
  const settingsSecret = usableSecret(settingsValue, minLength);
  const envSecret = usableSecret(envValue, minLength);
  const source: Source = settingsSecret ? "settings" : envSecret ? "env" : "missing";
  const value = settingsSecret || envSecret || "";
  return { value, source };
}

function keepSecret(incoming: unknown, existing: string) {
  const value = String(incoming ?? "").trim();
  if (!value || isMaskedSecret(value)) return existing;
  return value;
}

const env = {
  DASHSCOPE_API_KEY: "sk-env-real-dashscope-key-abcdef-ad49",
  OSS_ACCESS_KEY_ID: "LTAI5tAgViEdpwMqnaiaW1aa",
  OSS_ACCESS_KEY_SECRET: "env-oss-secret-long-enough-4Sa1",
  OSS_BUCKET_NAME: "douyin-transcribe",
  OSS_ENDPOINT: "oss-cn-beijing.aliyuncs.com",
  FFMPEG_PATH: "D:\\ffmpeg\\bin\\ffmpeg.exe",
};

assert(pickSecret("", env.DASHSCOPE_API_KEY, 20).source === "env", "数据库为空时必须使用 .env DashScope Key");
assert(pickSecret("short-key", env.DASHSCOPE_API_KEY, 20).source === "env", "数据库短假 Key 不能覆盖 .env 真 Key");
assert(pickSecret("sk-settings-real-dashscope-key-xyz", env.DASHSCOPE_API_KEY, 20).source === "settings", "数据库真 Key 必须优先于 .env");

const real = "sk-settings-real-dashscope-key-xyz";
assert(keepSecret("••••-xyz", real) === real, "遮罩值不能覆盖真实 DashScope Key");
assert(keepSecret("鈥⑩€⑩€⑩€?xyz", real) === real, "乱码遮罩值也不能覆盖真实 DashScope Key");

const badDashscope = "LTAI5tAgViEdpwMqnaiaW1aa";
assert(/^LTAI/.test(badDashscope), "测试样本必须像 OSS AccessKey ID");
assert(!badDashscope.startsWith("sk-"), "OSS AccessKey ID 不应被当作 DashScope Key");

const completeSettingsOss = {
  accessKeyId: "LTAI-settings-id",
  accessKeySecret: "settings-secret-long-enough",
  bucketName: "settings-bucket",
  endpoint: "oss-cn-shanghai.aliyuncs.com",
};
const incompleteSettingsOss = { ...completeSettingsOss, accessKeySecret: "" };
const pickOssSource = (oss: typeof completeSettingsOss) => (
  oss.accessKeyId && oss.accessKeySecret && oss.bucketName && oss.endpoint ? "settings" : "env"
);
assert(pickOssSource(completeSettingsOss) === "settings", "OSS 四件套完整时必须整组使用设置页");
assert(pickOssSource(incompleteSettingsOss) === "env", "OSS 四件套不完整时必须整组回退 .env，不能半混用");

const config: TranscriptionSettings = {
  cookies: "cookie-line",
  dashscopeApiKey: env.DASHSCOPE_API_KEY,
  ossAccessKeyId: env.OSS_ACCESS_KEY_ID,
  ossAccessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  ossBucketName: env.OSS_BUCKET_NAME,
  ossEndpoint: env.OSS_ENDPOINT,
  ffmpegPath: env.FFMPEG_PATH,
  enableTimestamps: true,
  enableSpeakerDiarization: true,
  speakerCount: 0,
};
const childEnv = buildTranscriptionEnv(config);
assert(childEnv.DASHSCOPE_API_KEY === env.DASHSCOPE_API_KEY, "Python 子进程必须拿统一解析后的 DashScope Key");
assert(childEnv.OSS_ACCESS_KEY_ID === env.OSS_ACCESS_KEY_ID, "Python 子进程必须拿统一解析后的 OSS AccessKey ID");
assert(childEnv.OSS_ACCESS_KEY_SECRET === env.OSS_ACCESS_KEY_SECRET, "Python 子进程必须拿统一解析后的 OSS Secret");

const metaText = formatTranscriptionFieldMeta({
  present: true,
  source: "env",
  tail: "ad49",
  length: 35,
  label: "DashScope API Key",
});
assert(metaText.includes(".env") && metaText.includes("ad49"), "诊断文案必须显示来源和尾号");

console.log("transcription runtime regression passed");
