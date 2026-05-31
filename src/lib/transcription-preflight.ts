import { execFile } from "child_process";
import { access, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import {
  TranscriptionFieldMeta,
  TranscriptionSettings,
  buildTranscriptionEnv,
  formatTranscriptionFieldMeta,
  resolveTranscriptionRuntimeConfig,
} from "@/lib/ai-config";
import { explainTranscriptionError, redactSecrets } from "@/lib/transcription-errors";

const execFileAsync = promisify(execFile);

export interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  diagnostics?: TranscriptionDiagnostics;
}

export interface TranscriptionDiagnostics {
  effective: Record<string, string>;
  sources: Record<string, TranscriptionFieldMeta>;
  warnings: string[];
}

export async function runTranscriptionPreflight(
  userId: string,
  overrideConfig?: Partial<TranscriptionSettings>
): Promise<PreflightResult> {
  const runtime = await resolveTranscriptionRuntimeConfig(userId, overrideConfig);
  const { sources, warnings, ...config } = runtime;
  const env = buildTranscriptionEnv(config);
  const checks: PreflightCheck[] = [];

  checks.push(await checkFfmpeg(config.ffmpegPath));
  checks.push(await checkCommand("yt-dlp", ["--version"], "yt-dlp"));

  const required = [
    ["DashScope API Key", env.DASHSCOPE_API_KEY],
    ["OSS AccessKey ID", env.OSS_ACCESS_KEY_ID],
    ["OSS AccessKey Secret", env.OSS_ACCESS_KEY_SECRET],
    ["OSS Bucket", env.OSS_BUCKET_NAME],
    ["OSS Endpoint", env.OSS_ENDPOINT],
  ] as const;

  for (const [name, value] of required) {
    checks.push({
      name,
      ok: Boolean(value),
      message: value ? "已配置" : "缺少配置，设置页或 .env 中需要填写",
    });
  }

  for (const warning of warnings) {
    checks.push({ name: "配置来源提醒", ok: false, message: warning });
  }

  const basicOk = checks.every((check) => check.ok);
  if (basicOk) {
    checks.push(await checkDashScopeAuth(env));
    checks.push(await checkOssUpload(env));
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    diagnostics: buildDiagnostics(runtime),
  };
}

function maskTail(value?: string, visible = 4) {
  const text = String(value || "").trim();
  if (!text) return "未配置";
  return `已配置，尾号 ${text.slice(-visible)}`;
}

function buildDiagnostics(runtime: Awaited<ReturnType<typeof resolveTranscriptionRuntimeConfig>>): TranscriptionDiagnostics {
  return {
    effective: {
      dashscopeApiKey: maskTail(runtime.dashscopeApiKey),
      ossAccessKeyId: maskTail(runtime.ossAccessKeyId, 6),
      ossAccessKeySecret: maskTail(runtime.ossAccessKeySecret),
      ossBucketName: runtime.ossBucketName || "未配置",
      ossEndpoint: runtime.ossEndpoint || "未配置",
      ffmpegPath: runtime.ffmpegPath || "使用 PATH 中的 ffmpeg",
    },
    sources: Object.fromEntries(
      Object.entries(runtime.sources).map(([key, meta]) => [
        key,
        { ...meta, label: formatTranscriptionFieldMeta(meta) },
      ])
    ) as Record<string, TranscriptionFieldMeta>,
    warnings: runtime.warnings,
  };
}

async function checkFfmpeg(ffmpegPath?: string): Promise<PreflightCheck> {
  if (ffmpegPath) {
    try {
      await access(ffmpegPath);
      await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
      return { name: "ffmpeg", ok: true, message: ffmpegPath };
    } catch (e: any) {
      return { name: "ffmpeg", ok: false, message: `不可用：${e.message}` };
    }
  }
  return checkCommand("ffmpeg", ["-version"], "ffmpeg");
}

async function checkCommand(command: string, args: string[], name: string): Promise<PreflightCheck> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
    return { name, ok: true, message: String(stdout || "").split(/\r?\n/)[0] || "可用" };
  } catch (e: any) {
    return { name, ok: false, message: `不可用：${e.message}` };
  }
}

async function checkDashScopeAuth(env: Record<string, string>): Promise<PreflightCheck> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/models", {
      headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.status === 401 || resp.status === 403) {
      const text = await resp.text();
      return {
        name: "DashScope API Key 有效性",
        ok: false,
        message: `无效或无权限。这里要填阿里云百炼/DashScope API Key，不是 DeepSeek Key，也不是 OSS AccessKey。${redactSecrets(text).slice(0, 180)}`,
      };
    }

    if (!resp.ok) {
      const text = await resp.text();
      return {
        name: "DashScope API Key 有效性",
        ok: false,
        message: `检测失败：HTTP ${resp.status}。${redactSecrets(text).slice(0, 180)}`,
      };
    }

    return { name: "DashScope API Key 有效性", ok: true, message: "认证检测通过" };
  } catch (e: any) {
    return {
      name: "DashScope API Key 有效性",
      ok: false,
      message: `检测请求失败：${e.message || e}。请确认网络可访问 dashscope.aliyuncs.com。`,
    };
  }
}

async function checkOssUpload(env: Record<string, string>): Promise<PreflightCheck> {
  const tempFile = join(tmpdir(), `notesprite-oss-check-${Date.now()}.txt`);
  await writeFile(tempFile, "notesprite oss preflight", "utf-8");

  const script = [
    "import os, sys",
    `sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "python"))})`,
    "from pipeline.oss_uploader import OSSUploader",
    "uploader = OSSUploader(",
    "  access_key_id=os.environ['OSS_ACCESS_KEY_ID'],",
    "  access_key_secret=os.environ['OSS_ACCESS_KEY_SECRET'],",
    "  bucket_name=os.environ['OSS_BUCKET_NAME'],",
    "  endpoint=os.environ['OSS_ENDPOINT'],",
    ")",
    "url, object_name = uploader.upload_audio(os.environ['NOTESPRITE_PREFLIGHT_FILE'], 60)",
    "uploader.delete_object(object_name)",
    "print('ok')",
  ].join("\n");

  try {
    await execFileAsync("python", ["-c", script], {
      timeout: 30000,
      env: { ...process.env, ...env, NOTESPRITE_PREFLIGHT_FILE: tempFile },
      maxBuffer: 1024 * 1024,
    });
    return { name: "OSS 上传权限", ok: true, message: "PutObject/GetObject/DeleteObject 检测通过" };
  } catch (e: any) {
    const detail = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    const explained = explainTranscriptionError(detail, "上传 OSS");
    return {
      name: "OSS 上传权限",
      ok: false,
      message: `${explained.summary}\n${explained.detail}\n解决：${explained.action}`,
    };
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}
