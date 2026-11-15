from pydantic import BaseModel, Field, FiniteFloat
from .config import settings


class ExtractRequest(BaseModel):
    imageBase64: str = Field(min_length=16, max_length=4 * ((settings.max_image_mb * 1024 * 1024 + 2) // 3) + 128)
    includeEmbedding: bool = True
    maxFaces: int = Field(default=10, ge=1, le=50)


class FaceResult(BaseModel):
    index: int
    boundingBox: dict[str, int]
    detectionScore: float
    qualityScore: float
    embedding: list[float] | None = None
    embeddingDimensions: int | None = None
    model: str
    modelVersion: str


class ExtractResponse(BaseModel):
    facesDetected: int
    imageWidth: int
    imageHeight: int
    faces: list[FaceResult]


class CompareRequest(BaseModel):
    firstEmbedding: list[FiniteFloat] = Field(min_length=128, max_length=128)
    secondEmbedding: list[FiniteFloat] = Field(min_length=128, max_length=128)


class CompareResponse(BaseModel):
    cosineSimilarity: float
    classification: str
    thresholdCandidate: float
    thresholdProbable: float
    model: str

