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

### Docker

Build locally:

```powershell
docker build -t travelkeeper-markitdown .
```

Run locally:

```powershell
docker run --rm -p 8789:8080 `
  -e MARKITDOWN_SERVICE_TOKEN="change-me" `
  travelkeeper-markitdown
```

Test:

```powershell
curl.exe -s http://127.0.0.1:8789/health
```

### Render

This folder includes `render.yaml`.

1. Create a new Render Blueprint or Web Service from this repo.
2. Set the root directory to `services/markitdown-service` if Render asks for it.
3. Set `MARKITDOWN_SERVICE_TOKEN` as a secret environment variable.
4. After deploy, copy the `/convert` URL.

Example Worker variable:

```text
https://travelkeeper-markitdown.onrender.com/convert
```

### Google Cloud Run

From this folder:

```powershell
gcloud run deploy travelkeeper-markitdown `
  --source . `
  --region asia-east1 `
  --allow-unauthenticated `
  --set-env-vars MAX_UPLOAD_BYTES=8388608
```

Set `MARKITDOWN_SERVICE_TOKEN` in Cloud Run environment variables.

Use the Cloud Run URL plus `/convert` as `MARKITDOWN_SERVICE_URL`.

## Worker Wiring

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
