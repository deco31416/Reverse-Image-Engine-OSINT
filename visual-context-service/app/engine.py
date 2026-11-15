from collections import Counter
from io import BytesIO
import base64
import logging
import numpy as np
from PIL import Image
from threading import Lock
from .config import settings


logger = logging.getLogger("visual-context")


class VisualContextEngine:
    def __init__(self) -> None:
        self.model = None
        self.ready = False
        self.warning = ""
        self._lock = Lock()

    def load(self) -> None:
        logger.info("Loading visual context engine (model=%s, device=%s, enabled=%s)", settings.model, settings.device, settings.enable_yolo)
        if not settings.enable_yolo:
            self.warning = "YOLO disabled by VISUAL_CONTEXT_ENABLE_YOLO=false"
            logger.warning(self.warning)
            return
        try:
            from ultralytics import YOLO

            self.model = YOLO(settings.model)
            self.ready = True
            logger.info("YOLO model loaded successfully: %s", settings.model)
        except Exception as exc:
            self.warning = f"YOLO unavailable: {exc}"
            self.ready = False
            logger.warning(self.warning)

    def analyze(self, payload: bytes, include_crops: bool = False, confidence: float | None = None, max_detections: int | None = None) -> dict:
        image = Image.open(BytesIO(payload), formats=["JPEG", "PNG", "WEBP"]).convert("RGB")
        width, height = image.size
        warnings: list[str] = []
        if self.warning:
            warnings.append(self.warning)
        if not self.ready or self.model is None:
            return {
                "status": "degraded",
                "model": settings.model,
                "yoloAvailable": False,
                "width": width,
                "height": height,
                "detections": [],
                "summary": {"total": 0, "labels": {}, "people": 0, "contextTags": []},
                "warnings": warnings,
            }

        conf = confidence if confidence is not None else settings.confidence
        limit = max_detections if max_detections is not None else settings.max_detections
        with self._lock:
            results = self.model.predict(
            np.array(image),
            conf=conf,
            iou=settings.iou,
            max_det=limit,
            device=settings.device,
            verbose=False,
        )

        detections: list[dict] = []
        names = getattr(self.model, "names", {}) or {}
        first = results[0] if results else None
        if first is not None and first.boxes is not None:
            for box in first.boxes:
                xyxy = box.xyxy[0].tolist()
                class_id = int(box.cls[0].item()) if box.cls is not None else None
                label = str(names.get(class_id, class_id if class_id is not None else "object"))
                score = float(box.conf[0].item()) if box.conf is not None else 0.0
                x1, y1, x2, y2 = [float(v) for v in xyxy]
                detection = {
                    "label": label,
                    "confidence": round(score, 4),
                    "classId": class_id,
                    "box": {
                        "x": round(max(x1, 0), 2),
                        "y": round(max(y1, 0), 2),
                        "width": round(max(x2 - x1, 0), 2),
                        "height": round(max(y2 - y1, 0), 2),
                    },
                    "cropBase64": None,
                }
                if include_crops:
                    detection["cropBase64"] = self.crop_to_base64(image, x1, y1, x2, y2)
                detections.append(detection)

        labels = Counter(item["label"] for item in detections)
        people = labels.get("person", 0)
        context_tags = [label for label, _ in labels.most_common(12)]
        return {
            "status": "ok",
            "model": settings.model,
            "yoloAvailable": True,
            "width": width,
            "height": height,
            "detections": detections,
            "summary": {
                "total": len(detections),
                "labels": dict(labels),
                "people": people,
                "contextTags": context_tags,
            },
            "warnings": warnings,
        }

    def crop_to_base64(self, image: Image.Image, x1: float, y1: float, x2: float, y2: float) -> str:
        width, height = image.size
        left = int(max(0, min(x1, width - 1)))
        top = int(max(0, min(y1, height - 1)))
        right = int(max(left + 1, min(x2, width)))
        bottom = int(max(top + 1, min(y2, height)))
        crop = image.crop((left, top, right, bottom))
        buffer = BytesIO()
        crop.save(buffer, format="JPEG", quality=88)
        return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


engine = VisualContextEngine()
