# MarkItDown Conversion Service

This service converts uploaded documents to Markdown for TravelKeeper.

Cloudflare Worker cannot run Python MarkItDown directly, so the Worker calls this service through:

`MARKITDOWN_SERVICE_URL`

Optional shared secret:

`MARKITDOWN_SERVICE_TOKEN`

## API Contract

`POST /convert`

Request JSON:

```json
{
  "filename": "itinerary.docx",
  "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "base64": "..."
}
```

Response JSON:

```json
{
  "success": true,
  "markdown": "# Converted content"
}
```

## Local Setup

```powershell
cd services\markitdown-service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8789
```

Local URL:

```text
http://127.0.0.1:8789/convert
```

## Environment Variables

- `MARKITDOWN_SERVICE_TOKEN`: optional bearer token. If set, requests must include `Authorization: Bearer <token>`.
- `MAX_UPLOAD_BYTES`: optional byte limit. Default: `8388608`.

## Deployment Notes

Recommended hosting:

- Google Cloud Run
- Railway
- Render
- VPS or internal Windows service

After deployment, set Cloudflare Worker secrets/vars:

```powershell
npx.cmd wrangler secret put MARKITDOWN_SERVICE_TOKEN
```

Add this non-secret var in `wrangler.toml` or Cloudflare dashboard:

```toml
MARKITDOWN_SERVICE_URL = "https://your-service.example.com/convert"
```

## Security Notes

- Keep this service private or token-protected.
- Do not log full document contents.
- Delete temporary files immediately after conversion.
- Treat document contents as untrusted input.
- Keep converted Markdown as draft material until operator review.

