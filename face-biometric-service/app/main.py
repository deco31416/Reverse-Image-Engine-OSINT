from contextlib import asynccontextmanager
import logging
from fastapi import Depends, FastAPI, Header, HTTPException
from .config import settings
from .engine import engine
from .schemas import CompareRequest, CompareResponse, ExtractRequest, ExtractResponse
from .security import RequestSizeLimit, decode_image_base64, validate_magic, validate_image_dimensions


logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger("face-biometric")


def startup_audit() -> None:
    logger.info("============================================================")
    logger.info("[FACE BIOMETRIC] Environment: %s", settings.environment)
    logger.info("[FACE BIOMETRIC] Version: %s", settings.service_version)
    logger.info("[FACE BIOMETRIC] Base URL: %s", settings.public_base_url)
    logger.info("[FACE BIOMETRIC] Health: %s/health", settings.public_base_url)
    logger.info("[FACE BIOMETRIC] Docs: %s", "enabled at /docs" if settings.docs_enabled else "disabled outside development")
    logger.info("[FACE BIOMETRIC] API key: %s", "configured" if settings.internal_api_key else "missing")
    logger.info("[FACE BIOMETRIC] Detector model: %s", settings.detector_model)
    logger.info("[FACE BIOMETRIC] Recognizer model: %s", settings.recognizer_model)
    logger.info("[FACE BIOMETRIC] Max image MB: %s", settings.max_image_mb)
    logger.info("[FACE BIOMETRIC] Detection threshold: %s", settings.detection_score_threshold)
    logger.info("[FACE BIOMETRIC] Candidate/probable thresholds: %s/%s", settings.cosine_candidate_threshold, settings.cosine_probable_threshold)
    logger.info("[FACE BIOMETRIC] Models: %s%s", "ready" if engine.ready else "degraded", f" ({engine.warning})" if engine.warning else "")
    logger.info("[FACE BIOMETRIC] Startup audit completed")
    logger.info("============================================================")


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine.load()
    startup_audit()
    yield


app = FastAPI(
    title=settings.service_name,
    version=settings.service_version,
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)
app.add_middleware(RequestSizeLimit)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not settings.internal_api_key:
        raise HTTPException(status_code=503, detail="FACE_BIOMETRIC_API_KEY is not configured")
    if x_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict:
    return {
        "status": "UP" if engine.ready else "DEGRADED",
        "service": settings.service_name,
        "version": settings.service_version,
        "modelsLoaded": engine.ready,
        "model": engine.model_name,
        "warning": engine.warning,
    }


@app.post("/v1/faces/extract", response_model=ExtractResponse, dependencies=[Depends(require_api_key)])
def extract_faces(request: ExtractRequest) -> dict:
    payload = decode_image_base64(request.imageBase64)
    validate_magic(payload)
    validate_image_dimensions(payload)
    return engine.extract(payload, request.maxFaces, request.includeEmbedding)


@app.post("/v1/faces/compare", response_model=CompareResponse, dependencies=[Depends(require_api_key)])
def compare_faces(request: CompareRequest) -> dict:
    return engine.compare(request.firstEmbedding, request.secondEmbedding)
