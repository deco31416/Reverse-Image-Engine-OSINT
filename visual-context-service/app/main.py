from contextlib import asynccontextmanager
import logging
from fastapi import Depends, FastAPI, Header, HTTPException
from .config import settings
from .engine import engine
from .schemas import AnalyzeRequest, AnalyzeResponse
from .security import RequestSizeLimit, decode_image_base64, validate_magic, validate_image_dimensions


logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger("visual-context")


def startup_audit() -> None:
    logger.info("============================================================")
    logger.info("[VISUAL CONTEXT] Environment: %s", settings.environment)
    logger.info("[VISUAL CONTEXT] Version: %s", settings.service_version)
    logger.info("[VISUAL CONTEXT] Base URL: %s", settings.public_base_url)
    logger.info("[VISUAL CONTEXT] Health: %s/health", settings.public_base_url)
    logger.info("[VISUAL CONTEXT] Docs: %s", "enabled at /docs" if settings.docs_enabled else "disabled outside development")
    logger.info("[VISUAL CONTEXT] API key: %s", "configured" if settings.internal_api_key else "missing")
    logger.info("[VISUAL CONTEXT] Model: %s", settings.model)
    logger.info("[VISUAL CONTEXT] Device: %s", settings.device)
    logger.info("[VISUAL CONTEXT] Max image MB: %s", settings.max_image_mb)
    logger.info("[VISUAL CONTEXT] Max detections: %s", settings.max_detections)
    logger.info("[VISUAL CONTEXT] YOLO: %s%s", "ready" if engine.ready else "degraded", f" ({engine.warning})" if engine.warning else "")
    logger.info("[VISUAL CONTEXT] Startup audit completed")
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
        raise HTTPException(status_code=503, detail="VISUAL_CONTEXT_API_KEY is not configured")
    if x_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict:
    return {
        "status": "UP" if engine.ready else "DEGRADED",
        "service": settings.service_name,
        "version": settings.service_version,
        "model": settings.model,
        "yoloAvailable": engine.ready,
        "warning": engine.warning,
    }


@app.post("/v1/visual/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_api_key)])
def analyze_visual_context(request: AnalyzeRequest) -> dict:
    payload = decode_image_base64(request.imageBase64)
    validate_magic(payload)
    validate_image_dimensions(payload)
    return engine.analyze(payload, request.includeCrops, request.confidence, request.maxDetections)
