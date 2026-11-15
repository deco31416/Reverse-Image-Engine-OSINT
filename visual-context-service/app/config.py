from dataclasses import dataclass
import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    service_name: str = "osint-deco-visual-context"
    service_version: str = "0.1.0"
    environment: str = os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")).lower()
    internal_api_key: str = os.getenv("VISUAL_CONTEXT_API_KEY", "")
    model: str = os.getenv("VISUAL_CONTEXT_MODEL", "yolov8n.pt")
    max_image_mb: int = max(1, min(int(os.getenv("VISUAL_CONTEXT_MAX_IMAGE_MB", "15")), 30))
    confidence: float = float(os.getenv("VISUAL_CONTEXT_CONFIDENCE", "0.25"))
    iou: float = float(os.getenv("VISUAL_CONTEXT_IOU", "0.45"))
    max_detections: int = max(1, min(int(os.getenv("VISUAL_CONTEXT_MAX_DETECTIONS", "80")), 300))
    device: str = os.getenv("VISUAL_CONTEXT_DEVICE", "cpu")
    enable_yolo: bool = os.getenv("VISUAL_CONTEXT_ENABLE_YOLO", "true").lower() == "true"

    @property
    def docs_enabled(self) -> bool:
        return self.environment in {"dev", "development", "local", "test"}

    @property
    def public_base_url(self) -> str:
        port = os.getenv("PORT", "7130")
        return os.getenv("VISUAL_CONTEXT_PUBLIC_BASE_URL", f"http://localhost:{port}")


settings = Settings()
