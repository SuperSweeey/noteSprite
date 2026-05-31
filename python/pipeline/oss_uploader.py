"""Aliyun OSS upload helper."""

import uuid
from pathlib import Path
from typing import Tuple

from pipeline.logger import Logger


class OSSUploader:
    """Small wrapper around oss2 bucket uploads used by the transcription pipeline."""

    def __init__(
        self,
        access_key_id: str,
        access_key_secret: str,
        bucket_name: str,
        endpoint: str,
    ):
        try:
            import oss2
        except ImportError as exc:
            raise RuntimeError("oss2 is not installed. Run: pip install oss2") from exc

        self.auth = oss2.Auth(access_key_id, access_key_secret)
        self.bucket = oss2.Bucket(self.auth, endpoint, bucket_name)
        self.bucket_name = bucket_name

    def upload_audio(self, local_file_path: str, expiration: int = 3600) -> Tuple[str, str]:
        """Upload an audio file to OSS and return a temporary signed URL."""
        local_file = Path(local_file_path)
        if not local_file.exists():
            raise FileNotFoundError(f"File does not exist: {local_file_path}")

        suffix = local_file.suffix.lower() or ".opus"
        object_name = f"douyin-transcribe/{uuid.uuid4()}{suffix}"
        Logger.info(f"Uploading {local_file.name} to OSS...")

        self.bucket.put_object_from_file(object_name, str(local_file))
        url = self.bucket.sign_url("GET", object_name, expiration)

        Logger.success(f"OSS upload complete. Signed URL expires in {expiration // 3600} hour(s).")
        return url, object_name

    def delete_object(self, object_name: str):
        """Delete an OSS object after preflight checks or cleanup."""
        try:
            self.bucket.delete_object(object_name)
            Logger.info(f"Deleted OSS object: {object_name}")
        except Exception:
            pass
