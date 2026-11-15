import base64
import binascii
from fastapi import HTTPException
from .config import settings


def decode_image_base64(value: str) -> bytes:
    raw = value.strip()
    max_bytes = settings.max_image_mb * 1024 * 1024
    if len(raw) > 4 * ((max_bytes + 2) // 3) + 128:
        raise HTTPException(status_code=413, detail=f"Image exceeds {settings.max_image_mb}MB")
    if raw.startswith("data:"):
        try:
            header, raw = raw.split(",", 1)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid image data URI") from exc
        if not header.lower().startswith(("data:image/jpeg", "data:image/png", "data:image/webp")):
            raise HTTPException(status_code=400, detail="Image must be JPEG, PNG or WEBP")
    try:
        payload = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid image base64") from exc
    if not payload:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(payload) > settings.max_image_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Image exceeds {settings.max_image_mb}MB")
    return payload

from io import BytesIO
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_PIXELS = 25_000_000


def validate_image_dimensions(payload: bytes) -> None:
    try:
        with Image.open(BytesIO(payload), formats=["JPEG", "PNG", "WEBP"]) as image:
            width, height = image.size
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image dimensions exceed the processing limit")
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="Image could not be decoded") from exc


class RequestSizeLimit:
    """Bound request memory before FastAPI parses JSON, including chunked bodies."""
    def __init__(self, app):
        self.app = app
        self.limit = 4 * ((settings.max_image_mb * 1024 * 1024 + 2) // 3) + 16384

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        chunks = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            total += len(body)
            if total > self.limit:
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": b'{"detail":"Request body exceeds image limit"}'})
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break
        replayed = False

        async def bounded_receive():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)



def validate_magic(payload: bytes) -> None:
    valid = (
        payload.startswith(b"\xff\xd8\xff")
        or payload.startswith(b"\x89PNG\r\n\x1a\n")
        or (payload.startswith(b"RIFF") and payload[8:12] == b"WEBP")
    )
    if not valid:
        raise HTTPException(status_code=400, detail="Payload is not a supported image")

