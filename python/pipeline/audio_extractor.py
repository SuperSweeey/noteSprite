"""
Audio extraction with ffmpeg.
"""

import subprocess
from pathlib import Path
from typing import Optional

from downloaders.common import describe_ffmpeg_search, find_ffmpeg
from pipeline.logger import Logger


class AudioExtractor:
    """Extract audio from video or normalize downloaded audio."""

    def __init__(self, output_dir: str = "./audio", ffmpeg_path: str = ""):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg_path = find_ffmpeg(ffmpeg_path)

        if not self.ffmpeg_path:
            searched = describe_ffmpeg_search(ffmpeg_path)
            raise RuntimeError(
                "ffmpeg 未找到或不可执行。"
                "请在设置页填写 ffmpeg.exe 的完整路径，或把 ffmpeg 加入 PATH。"
                f"已尝试: {searched}"
            )

        Logger.info(f"使用 ffmpeg: {self.ffmpeg_path}")

    def extract(self, video_path: str, output_filename: Optional[str] = None) -> str:
        video_file = Path(video_path)
        if not video_file.exists():
            raise FileNotFoundError(f"源文件不存在: {video_path}")

        if output_filename:
            output_file = self.output_dir / f"{output_filename}.opus"
        else:
            output_file = self.output_dir / f"{video_file.stem}.opus"

        Logger.info(f"提取音频: {video_file.name} -> {output_file.name}")

        cmd = [
            self.ffmpeg_path,
            "-i",
            str(video_file),
            "-vn",
            "-acodec",
            "libopus",
            "-ar",
            "16000",
            "-b:a",
            "16k",
            "-y",
            str(output_file),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise RuntimeError(f"ffmpeg 提取音频失败: {stderr[-1200:]}")

        if not output_file.exists() or output_file.stat().st_size == 0:
            raise RuntimeError("ffmpeg 没有生成有效音频文件。")

        file_size = output_file.stat().st_size / (1024 * 1024)
        Logger.success(f"音频提取完成: {output_file.name} ({file_size:.2f} MB)")

        return str(output_file)
