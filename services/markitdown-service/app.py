import base64
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from markitdown import MarkItDown


app = FastAPI(title="TravelKeeper MarkItDown Service")


class ConvertRequest(BaseModel):
    filename: str = "document"
    contentType: str = "application/octet-stream"
    base64: str


def require_token(authorization: str | None) -> None:
    token = os.getenv("MARKITDOWN_SERVICE_TOKEN", "").strip()
    if not token:
      return
    expected = f"Bearer {token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")


def safe_suffix(filename: str) -> str:
    suffix = Path(filename or "document").suffix.lower()
    if suffix in {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".html", ".htm", ".csv", ".txt", ".md", ".markdown",
    }:
        return suffix
    return ".bin"


@app.get("/health")
def health():
    return {"success": True, "service": "markitdown"}


@app.post("/convert")
def convert(req: ConvertRequest, authorization: str | None = Header(default=None)):
    require_token(authorization)

    max_bytes = int(os.getenv("MAX_UPLOAD_BYTES", "8388608"))
    try:
        raw = base64.b64decode(req.base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="INVALID_BASE64")

    if not raw:
        raise HTTPException(status_code=400, detail="EMPTY_FILE")
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE")

    suffix = safe_suffix(req.filename)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"input{suffix}"
        path.write_bytes(raw)
        try:
            result = MarkItDown().convert(str(path))
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"CONVERT_FAILED: {exc}")

    markdown = str(getattr(result, "text_content", "") or "").strip()
    if not markdown:
        raise HTTPException(status_code=422, detail="EMPTY_MARKDOWN")
    return {"success": True, "markdown": markdown}

