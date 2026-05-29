"""
云端转录模块
阿里云Paraformer语音识别
"""

import json
import urllib.request
from typing import List

from pipeline.logger import Logger


class CloudTranscriber:
    """阿里云Paraformer语音识别"""

    def __init__(self, api_key: str, model: str = "paraformer-v2"):
        try:
            import dashscope
            from dashscope.audio.asr import Transcription
        except ImportError:
            raise RuntimeError("dashscope库未安装，请运行: pip install dashscope")

        dashscope.api_key = api_key
        self.model = model
        self.Transcription = Transcription

    def transcribe(
        self, oss_url: str, language_hints: List[str] = None, task_id: str = ""
    ) -> str:
        """转录音频文件"""
        if language_hints is None:
            language_hints = ["zh", "en"]

        Logger.step(4, 5, "提交转录任务", task_id)

        task_response = self.Transcription.async_call(
            model=self.model, file_urls=[oss_url], language_hints=language_hints
        )

        submitted_task_id = self._extract_submitted_task_id(task_response)
        Logger.info(f"转录任务已提交: {submitted_task_id}", task_id)

        Logger.info("等待转录完成...", task_id)
        transcription_response = self.Transcription.wait(
            task=submitted_task_id
        )

        self._ensure_success_response(transcription_response, "等待转录结果")

        results = []
        for result in transcription_response.output.get("results", []):
            if result.get("subtask_status") == "SUCCEEDED":
                transcript_url = result["transcription_url"]
                transcript_data = json.loads(
                    urllib.request.urlopen(transcript_url).read().decode("utf-8")
                )

                for transcript in transcript_data.get("transcripts", []):
                    text = transcript.get("text", "")
                    if text:
                        results.append(text)
            else:
                Logger.warning(
                    f"子任务失败: {result.get('message', 'Unknown error')}", task_id
                )

        if not results:
            raise RuntimeError("转录结果为空")

        full_text = "\n".join(results)
        Logger.success(f"转录完成，共 {len(full_text)} 字符", task_id)

        return full_text

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
