"""Cloud speech transcription through Alibaba Cloud DashScope."""

import json
import urllib.request
from typing import Any, Dict, List, Optional

from pipeline.logger import Logger


class CloudTranscriber:
    """DashScope paraformer file transcription client."""

    def __init__(
        self,
        api_key: str,
        model: str = "paraformer-v2",
        enable_timestamps: bool = True,
        enable_speaker_diarization: bool = True,
        speaker_count: int = 0,
    ):
        if not api_key:
            raise RuntimeError("DashScope API Key 为空。请在转录设置里填写阿里云百炼/DashScope API Key。")

        try:
            import dashscope
            from dashscope.audio.asr import Transcription
        except ImportError as exc:
            raise RuntimeError("dashscope 库未安装，请运行: pip install dashscope") from exc

        dashscope.api_key = api_key
        self.dashscope = dashscope
        self.model = model
        self.Transcription = Transcription
        self.enable_timestamps = enable_timestamps
        self.enable_speaker_diarization = enable_speaker_diarization
        self.speaker_count = max(int(speaker_count or 0), 0)

    def validate_auth(self) -> None:
        """Fail fast before downloading large media when the DashScope key is invalid."""
        try:
            response = self.dashscope.Models.list()
        except Exception as exc:
            raise RuntimeError(f"DashScope API Key 检测失败：{exc}") from exc

        status_code = getattr(response, "status_code", None)
        if status_code and int(status_code) >= 400:
            raise RuntimeError(f"DashScope API Key 无效。{self._format_response_detail(response)}")

    def transcribe(
        self, oss_url: str, language_hints: Optional[List[str]] = None, task_id: str = ""
    ) -> str:
        """Transcribe one audio file URL and return readable Markdown text."""
        if language_hints is None:
            language_hints = ["zh", "en"]

        Logger.step(4, 5, "提交转录任务", task_id)

        options: Dict[str, Any] = {
            "model": self.model,
            "file_urls": [oss_url],
            "language_hints": language_hints,
        }
        if self.enable_timestamps:
            options["timestamp_alignment_enabled"] = True
        if self.enable_speaker_diarization:
            options["diarization_enabled"] = True
            if self.speaker_count > 0:
                options["speaker_count"] = self.speaker_count

        task_response = self.Transcription.async_call(**options)

        submitted_task_id = self._extract_submitted_task_id(task_response)
        Logger.info(f"转录任务已提交: {submitted_task_id}", task_id)

        Logger.info("等待转录完成...", task_id)
        transcription_response = self.Transcription.wait(task=submitted_task_id)

        self._ensure_success_response(transcription_response, "等待转录结果")

        results = []
        for result in transcription_response.output.get("results", []):
            if result.get("subtask_status") == "SUCCEEDED":
                transcript_url = result["transcription_url"]
                transcript_data = json.loads(
                    urllib.request.urlopen(transcript_url).read().decode("utf-8")
                )
                text = self._format_transcript_data(transcript_data)
                if text:
                    results.append(text)
            else:
                Logger.warning(
                    f"子任务失败: {result.get('message', 'Unknown error')}", task_id
                )

        if not results:
            raise RuntimeError("转录结果为空")

        full_text = "\n\n".join(results)
        Logger.success(f"转录完成，共 {len(full_text)} 字符", task_id)

        return full_text

    def _format_transcript_data(self, transcript_data: Dict[str, Any]) -> str:
        lines: List[str] = []
        for transcript in transcript_data.get("transcripts", []):
            sentence_lines = self._format_sentences(transcript)
            if sentence_lines:
                lines.extend(sentence_lines)
                continue

            text = str(transcript.get("text", "")).strip()
            if text:
                lines.append(text)
        return "\n".join(lines).strip()

    def _format_sentences(self, transcript: Dict[str, Any]) -> List[str]:
        sentences = (
            transcript.get("sentences")
            or transcript.get("sentence")
            or transcript.get("paragraphs")
            or []
        )
        if not isinstance(sentences, list):
            return []

        formatted: List[str] = []
        for sentence in sentences:
            if not isinstance(sentence, dict):
                continue
            text = str(sentence.get("text") or sentence.get("sentence") or "").strip()
            if not text:
                continue

            prefix_parts = []
            if self.enable_timestamps:
                begin = self._first_number(sentence, ["begin_time", "start_time", "start", "begin"])
                end = self._first_number(sentence, ["end_time", "end"])
                if begin is not None or end is not None:
                    prefix_parts.append(f"[{self._format_ms(begin)} - {self._format_ms(end)}]")

            if self.enable_speaker_diarization:
                speaker = sentence.get("speaker") or sentence.get("speaker_id") or sentence.get("channel_id")
                if speaker not in (None, ""):
                    prefix_parts.append(f"说话人{speaker}:")

            prefix = " ".join(prefix_parts)
            formatted.append(f"{prefix} {text}".strip())
        return formatted

    def _first_number(self, obj: Dict[str, Any], keys: List[str]) -> Optional[float]:
        for key in keys:
            value = obj.get(key)
            if value in (None, ""):
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    def _format_ms(self, value: Optional[float]) -> str:
        if value is None:
            return "--:--:--"
        seconds = value / 1000 if value > 1000 else value
        total = max(int(seconds), 0)
        hour = total // 3600
        minute = (total % 3600) // 60
        second = total % 60
        return f"{hour:02d}:{minute:02d}:{second:02d}"

    def _extract_submitted_task_id(self, response) -> str:
        self._ensure_success_response(response, "提交转录任务")
        output = getattr(response, "output", None) or {}
        submitted_task_id = self._get_value(output, "task_id")
        if not submitted_task_id:
            raise RuntimeError(
                "提交转录任务失败：云端没有返回 task_id。"
                f"{self._format_response_detail(response)}"
            )
        return submitted_task_id

    def _ensure_success_response(self, response, action: str) -> None:
        if response is None:
            raise RuntimeError(f"{action}失败：DashScope 没有返回响应，请检查网络和 API Key。")

        status_code = getattr(response, "status_code", None)
        output = getattr(response, "output", None)
        if status_code and int(status_code) >= 400:
            raise RuntimeError(f"{action}失败。{self._format_response_detail(response)}")

        if output is None:
            raise RuntimeError(f"{action}失败：DashScope 返回为空。{self._format_response_detail(response)}")

    def _format_response_detail(self, response) -> str:
        parts = []
        for name in ["code", "message", "request_id"]:
            value = getattr(response, name, None)
            if value:
                parts.append(f"{name}: {value}")

        output = getattr(response, "output", None)
        output_message = self._get_value(output, "message")
        output_code = self._get_value(output, "code")
        if output_code:
            parts.append(f"output.code: {output_code}")
        if output_message:
            parts.append(f"output.message: {output_message}")

        if not parts:
            try:
                parts.append(str(response))
            except Exception:
                pass

        detail = "；".join(parts).strip()
        return f"原因：{detail}" if detail else "没有更多错误细节。"

    def _get_value(self, obj, key: str):
        if obj is None:
            return None
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)
