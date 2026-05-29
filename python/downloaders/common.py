import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def _is_executable_ffmpeg(path: str | Path | None) -> bool:
    if not path:
        return False
    try:
        result = subprocess.run(
            [str(path), "-version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


def _ffmpeg_candidates(configured_path: str = "") -> list[str]:
    candidates: list[str] = []

    def add(value: str | Path | None) -> None:
        if not value:
            return
        path = Path(value)
        if path.is_dir():
          path = path / "ffmpeg.exe"
        text = str(path)
        if text not in candidates:
            candidates.append(text)

    add(configured_path)
    add(os.environ.get("FFMPEG_PATH"))
    add(shutil.which("ffmpeg"))

    config_path = Path(__file__).parent.parent / "config" / "config.json"
    try:
        with open(config_path, encoding="utf-8") as f:
            cfg = json.load(f)
        add(cfg.get("ffmpeg_path", ""))
    except Exception:
        pass

    add(r"D:\MyProjects\ffmpeg-n8.1-latest-win64-gpl-shared-8.1\bin\ffmpeg.exe")
    add(r"D:\ffmpeg\bin\ffmpeg.exe")
    add(r"D:\ffmpeg\ffmpeg.exe")
    add(r"C:\ffmpeg\bin\ffmpeg.exe")

    return candidates


def find_ffmpeg(configured_path: str = "") -> str | None:
    """Return the first working ffmpeg executable.

    A stale configured path must not block a valid PATH or bundled install.
    """
    for candidate in _ffmpeg_candidates(configured_path):
        if _is_executable_ffmpeg(candidate):
            return candidate
    return None


def describe_ffmpeg_search(configured_path: str = "") -> str:
    candidates = _ffmpeg_candidates(configured_path)
    if not candidates:
        return "没有可检查的候选路径"
    return "；".join(candidates)


def _get_ffmpeg_dir():
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        return str(Path(ffmpeg).parent)
    return None


def classify_yt_dlp_error(stderr: str) -> tuple[str, str]:
    text = (stderr or "").strip()
    lower = text.lower()

    if "too many requests" in lower or "http error 429" in lower:
        return "RATE_LIMITED", "平台限流，建议稍后重试或补充 cookies。"
    if "no supported javascript runtime" in lower:
        return "JS_RUNTIME_MISSING", "缺少可用的 JavaScript runtime，建议安装 node 或 deno。"
    if "sign in" in lower or "cookies" in lower or "login" in lower:
        return "AUTH_REQUIRED", "平台要求登录态，建议提供有效 cookies。"
    if "private" in lower or "unavailable" in lower or "not available" in lower:
        return "UNAVAILABLE", "视频不可访问，可能已删除、私密或地区受限。"
    if "timed out" in lower or "timeout" in lower or "connection" in lower or "network" in lower:
        return "NETWORK", "网络波动导致下载失败，可稍后重试。"
    return "UNKNOWN", "下载器返回了未分类错误，请查看原始 stderr。"


def run_yt_dlp_download(platform: str, url: str, output_path: Path, cookies_path=None, max_retries: int = 3, audio_only: bool = True) -> str:
    cmd = ["yt-dlp", "-o", str(output_path)]
    if audio_only:
        cmd += ["-f", "bestaudio"]
    else:
        cmd += ["--merge-output-format", "mp4"]
    cmd += ["-N", "8", "--no-embed-metadata"]
    if shutil.which("node"):
        cmd += ["--js-runtimes", "node"]
    if cookies_path:
        cmd += ["--cookies", str(cookies_path)]
    cmd.append(url)

    last_error = ""
    for attempt in range(1, max_retries + 1):
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        existing = list(output_path.parent.glob(f"{output_path.stem}*"))
        if existing:
            data_files = [f for f in existing if f.suffix != ".meta"]
            if data_files:
                return str(max(data_files, key=lambda f: f.stat().st_size))
            return str(existing[0])

        if result.returncode == 0:
            raise RuntimeError(f"{platform} 下载完成但找不到输出文件: {output_path.parent}")

        last_error = result.stderr.strip() or result.stdout.strip()
        code, hint = classify_yt_dlp_error(last_error)
        retryable = code in {"RATE_LIMITED", "NETWORK"}
        if retryable and attempt < max_retries:
            time.sleep(3 * attempt)
            continue
        raise RuntimeError(f"{platform} 下载失败[{code}]: {hint}\n原始错误: {last_error}")

    raise RuntimeError(f"{platform} 下载失败: {last_error}")


def run_yt_dlp_get_title(url: str, cookies_path=None) -> str | None:
    cmd = ["yt-dlp", "--get-title", url]
    if cookies_path:
        cmd += ["--cookies", str(cookies_path)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode == 0:
        return result.stdout.strip()
    return None
