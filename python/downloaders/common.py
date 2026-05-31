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
    """Return the first working ffmpeg executable."""
    for candidate in _ffmpeg_candidates(configured_path):
        if _is_executable_ffmpeg(candidate):
            return candidate
    return None


def describe_ffmpeg_search(configured_path: str = "") -> str:
    candidates = _ffmpeg_candidates(configured_path)
    if not candidates:
        return "没有可检测的候选路径"
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


def _candidate_outputs(output_path: Path) -> list[Path]:
    files: list[Path] = []
    for file in output_path.parent.glob(f"{output_path.stem}*"):
        if not file.is_file():
            continue
        name = file.name.lower()
        if name.endswith(".part") or file.suffix == ".meta":
            continue
        try:
            if file.stat().st_size <= 0:
                continue
        except OSError:
            continue
        files.append(file)
    return files


def _pick_download_output(output_path: Path, audio_only: bool) -> Path | None:
    files = _candidate_outputs(output_path)
    if not files:
        return None
    if audio_only:
        for suffix in (".opus", ".m4a", ".webm", ".mp3", ".wav"):
            matches = [f for f in files if f.suffix.lower() == suffix]
            if matches:
                return max(matches, key=lambda f: f.stat().st_mtime)
    return max(files, key=lambda f: f.stat().st_mtime)


def _cleanup_download_siblings(output_path: Path, keep: Path | None = None) -> None:
    for file in output_path.parent.glob(f"{output_path.stem}*"):
        if not file.is_file():
            continue
        if keep and file.resolve() == keep.resolve():
            continue
        try:
            file.unlink()
        except OSError:
            pass


def run_yt_dlp_download(
    platform: str,
    url: str,
    output_path: Path,
    cookies_path=None,
    max_retries: int = 3,
    audio_only: bool = True,
) -> str:
    cmd = ["yt-dlp", "-o", str(output_path)]
    if audio_only:
        cmd += [
            "-f",
            "worstaudio[ext=m4a]/worstaudio[ext=webm]/worstaudio/bestaudio/best",
            "-x",
            "--audio-format",
            "opus",
            "--audio-quality",
            "9",
            "--postprocessor-args",
            "ffmpeg:-hide_banner -loglevel error -ac 1 -ar 16000 -b:a 16k",
        ]
    else:
        cmd += ["--merge-output-format", "mp4"]

    cmd += [
        "-N",
        "8",
        "--no-playlist",
        "--no-write-comments",
        "--no-write-thumbnail",
        "--no-embed-metadata",
        "--no-mtime",
        "--socket-timeout",
        "20",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
    ]
    if shutil.which("node"):
        cmd += ["--js-runtimes", "node"]
    if cookies_path:
        cmd += ["--cookies", str(cookies_path)]
    cmd.append(url)

    last_error = ""
    for attempt in range(1, max_retries + 1):
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode == 0:
            final_file = _pick_download_output(output_path, audio_only=audio_only)
            if final_file:
                _cleanup_download_siblings(output_path, keep=final_file)
                return str(final_file)
            raise RuntimeError(f"{platform} 下载完成但找不到输出文件: {output_path.parent}")

        last_error = result.stderr.strip() or result.stdout.strip()
        _cleanup_download_siblings(output_path)
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
