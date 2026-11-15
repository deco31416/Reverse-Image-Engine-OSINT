from dataclasses import dataclass
import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    service_name: str = "osint-deco-face-biometric"
    service_version: str = "0.1.0"
    environment: str = os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")).lower()
    internal_api_key: str = os.getenv("FACE_BIOMETRIC_API_KEY", "")
    detector_model: str = os.getenv("FACE_DETECTOR_MODEL", str(ROOT_DIR / "models" / "face_detection_yunet_2023mar.onnx"))
    recognizer_model: str = os.getenv("FACE_RECOGNIZER_MODEL", str(ROOT_DIR / "models" / "face_recognition_sface_2021dec.onnx"))
    max_image_mb: int = max(1, min(int(os.getenv("FACE_MAX_IMAGE_MB", "10")), 25))
    detection_score_threshold: float = float(os.getenv("FACE_DETECTION_SCORE_THRESHOLD", "0.70"))
    nms_threshold: float = float(os.getenv("FACE_NMS_THRESHOLD", "0.3"))
    top_k: int = max(1, min(int(os.getenv("FACE_TOP_K", "20")), 100))
    cosine_candidate_threshold: float = float(os.getenv("FACE_COSINE_CANDIDATE_THRESHOLD", "0.30"))
    cosine_probable_threshold: float = float(os.getenv("FACE_COSINE_PROBABLE_THRESHOLD", "0.40"))

    @property
    def docs_enabled(self) -> bool:
        return self.environment in {"dev", "development", "local", "test"}

    @property
    def public_base_url(self) -> str:
        port = os.getenv("PORT", "7120")
        return os.getenv("FACE_BIOMETRIC_PUBLIC_BASE_URL", f"http://localhost:{port}")


settings = Settings()
