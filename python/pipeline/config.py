"""
配置管理模块
"""

import json
from dataclasses import dataclass


@dataclass
class Config:
    """配置类"""

    # 阿里云OSS
    oss_access_key_id: str
    oss_access_key_secret: str
    oss_bucket_name: str
    oss_endpoint: str
    # 阿里云DashScope
    dashscope_api_key: str
    # Notion (optional)
    notion_token: str = ""
    notion_database_id: str = ""
    # FFmpeg路径（可选，如果在系统PATH中则不需要）
    ffmpeg_path: str = ""
    output_dir: str = "./output"
    zhipu_api_key: str = ""
    zhipu_api_url: str = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    title_model: str = "qwen3.5-flash"
    title_api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    github_token: str = ""
    github_user: str = "SuperSweeey"
    github_repo: str = "SuperSweeey.github.io"
    github_repo_dir: str = "/root/.openclaw/workspace/SuperSweeey.github.io"

    @classmethod
    def from_file(cls, filepath: str = "config.json") -> "Config":
        data: dict = {}
        # Try loading from JSON file (optional)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        # Override with environment variables: field name uppercased
        import os
        for field_name in cls.__dataclass_fields__:
            env_key = field_name.upper()
            env_val = os.environ.get(env_key)
            if env_val:
                data[field_name] = env_val
        return cls(**data)
