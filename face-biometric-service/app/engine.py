from pathlib import Path
from threading import Lock
import logging
import cv2
import numpy as np
from fastapi import HTTPException
from .config import settings


logger = logging.getLogger("face-biometric")


class FaceEngine:
    model_name = "opencv-sface"
    model_version = "2021dec"

    def __init__(self) -> None:
        self._lock = Lock()
        self._detector = None
        self._recognizer = None
        self.warning = ""

    @property
    def ready(self) -> bool:
        return self._detector is not None and self._recognizer is not None

    def load(self) -> None:
        detector_path = Path(settings.detector_model)
        recognizer_path = Path(settings.recognizer_model)
        logger.info("Loading face biometric engine (detector=%s, recognizer=%s)", detector_path, recognizer_path)
        if not detector_path.is_file() or not recognizer_path.is_file():
            self.warning = "Face model files are missing"
            logger.warning("%s: detector exists=%s recognizer exists=%s", self.warning, detector_path.is_file(), recognizer_path.is_file())
            return
        self._detector = cv2.FaceDetectorYN.create(
            str(detector_path), "", (320, 320), settings.detection_score_threshold,
            settings.nms_threshold, settings.top_k,
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
        self.warning = ""
        logger.info("Face biometric models loaded successfully: %s", self.model_name)

    def extract(self, payload: bytes, max_faces: int, include_embedding: bool) -> dict:
        if not self.ready:
            raise HTTPException(status_code=503, detail="Face models are not loaded")
        encoded = np.frombuffer(payload, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=400, detail="Image could not be decoded")
        height, width = image.shape[:2]
        with self._lock:
            self._detector.setInputSize((width, height))
            _, detected = self._detector.detect(image)
            if detected is None:
                return {"facesDetected": 0, "imageWidth": width, "imageHeight": height, "faces": []}
            ordered = sorted(detected, key=lambda face: float(face[-1]), reverse=True)[:max_faces]
            faces = []
            for index, face in enumerate(ordered):
                aligned = self._recognizer.alignCrop(image, face)
                feature = self._recognizer.feature(aligned).flatten().astype(np.float32)
                norm = float(np.linalg.norm(feature))
                if norm > 0:
                    feature = feature / norm
                x, y, box_width, box_height = [int(max(0, round(v))) for v in face[:4]]
                area_ratio = min(1.0, (box_width * box_height) / max(1.0, width * height * 0.20))
                detection_score = float(face[-1])
                quality = round(max(0.0, min(1.0, detection_score * 0.7 + area_ratio * 0.3)), 4)
                faces.append({
                    "index": index,
                    "boundingBox": {"x": x, "y": y, "width": box_width, "height": box_height},
                    "detectionScore": round(detection_score, 6),
                    "qualityScore": quality,
                    "embedding": feature.tolist() if include_embedding else None,
                    "embeddingDimensions": int(feature.size) if include_embedding else None,
                    "model": self.model_name,
                    "modelVersion": self.model_version,
                })
        return {"facesDetected": len(faces), "imageWidth": width, "imageHeight": height, "faces": faces}

    def compare(self, first: list[float], second: list[float]) -> dict:
        if len(first) != len(second):
            raise HTTPException(status_code=400, detail="Embedding dimensions do not match")
        left = np.asarray(first, dtype=np.float32)
        right = np.asarray(second, dtype=np.float32)
        left_norm = float(np.linalg.norm(left))
        right_norm = float(np.linalg.norm(right))
        if left_norm == 0 or right_norm == 0:
            raise HTTPException(status_code=400, detail="Embedding norm cannot be zero")
        cosine = float(np.dot(left / left_norm, right / right_norm))
        classification = "unlikely"
        if cosine >= settings.cosine_probable_threshold:
            classification = "probable"
        elif cosine >= settings.cosine_candidate_threshold:
            classification = "candidate"
        return {
            "cosineSimilarity": round(cosine, 6),
            "classification": classification,
            "thresholdCandidate": settings.cosine_candidate_threshold,
            "thresholdProbable": settings.cosine_probable_threshold,
            "model": self.model_name,
        }


engine = FaceEngine()
