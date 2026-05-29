import { execFile } from "child_process";
import { access, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";
import { buildTranscriptionEnv, getTranscriptionConfig } from "@/lib/ai-config";

const execFileAsync = promisify(execFile);

export interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

export async function runTranscriptionPreflight(userId: string): Promise<PreflightResult> {
  const config = await getTranscriptionConfig(userId);
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

  const basicOk = checks.every((check) => check.ok);
  if (basicOk) {
    checks.push(await checkDashScopeAuth(env));
    checks.push(await checkOssUpload(env));
  }

  return { ok: checks.every((check) => check.ok), checks };
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
        message: `无效或无权限。请填写阿里云百炼/DashScope API Key，不要填 OSS AccessKey。${text.slice(0, 180)}`,
      };
    }

    if (!resp.ok) {
      const text = await resp.text();
      return { name: "DashScope API Key 有效性", ok: false, message: `检测失败：HTTP ${resp.status}。${text.slice(0, 180)}` };
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
    const detail = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").slice(0, 1600);
    return { name: "OSS 上传权限", ok: false, message: detail || "OSS 上传检测失败" };
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}
