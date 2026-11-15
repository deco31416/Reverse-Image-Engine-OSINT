from pydantic import BaseModel, Field
from typing import Any
from .config import settings


class AnalyzeRequest(BaseModel):
    imageBase64: str = Field(min_length=16, max_length=4 * ((settings.max_image_mb * 1024 * 1024 + 2) // 3) + 128)
    includeCrops: bool = False
    confidence: float | None = Field(default=None, ge=0, le=1)
    maxDetections: int | None = Field(default=None, ge=1, le=300)


class Box(BaseModel):
    x: float
    y: float
    width: float
    height: float


class Detection(BaseModel):
    label: str
    confidence: float
    box: Box
    classId: int | None = None
    cropBase64: str | None = None


class AnalyzeResponse(BaseModel):
    status: str
    model: str
    yoloAvailable: bool
    width: int
    height: int
    detections: list[Detection]
    summary: dict[str, Any]
    warnings: list[str] = []
