# MarkItDown Service Deployment SOP

This SOP describes how to deploy the Python MarkItDown conversion service used by TravelKeeper admin.

## 1. What This Service Does

The service receives a document from TravelKeeper Worker, converts it to Markdown with Microsoft MarkItDown, and returns Markdown for AI itinerary drafting.

It is intentionally separate from Cloudflare Worker because Cloudflare Worker cannot run this Python document-conversion stack directly.

## 2. Deployment Options

Recommended first choice:

- Render Web Service with Docker

Other acceptable options:

- Google Cloud Run
- Railway
- VPS or internal Windows/Linux service

## 3. Required Files

Service folder:

```text
services/markitdown-service/
```

Important files:

- `app.py`
- `requirements.txt`
- `Dockerfile`
- `render.yaml`
- `.env.example`
- `test-service.ps1`

## 4. Required Environment Variables

Set these on the service host:

```text
MAX_UPLOAD_BYTES=8388608
MARKITDOWN_SERVICE_TOKEN=<strong random token>
```

`MARKITDOWN_SERVICE_TOKEN` is optional in code, but required in production.

## 5. Render Deployment

Use this path when you want the fastest hosted test.

1. Open Render.
2. Create a new Web Service or Blueprint from the GitHub repo.
3. Set root directory to:

```text
services/markitdown-service
```

4. Use Docker environment.
5. Add environment variables:

```text
MAX_UPLOAD_BYTES=8388608
MARKITDOWN_SERVICE_TOKEN=<strong random token>
```

6. Deploy.
7. After deploy, the conversion endpoint is:

```text
https://<render-service-host>/convert
```

8. Health endpoint:

```text
https://<render-service-host>/health
```

## 6. Google Cloud Run Deployment

Run from:

```powershell
cd "D:\OneDrive\文件\威果旅行社\services\markitdown-service"
```

Deploy:

```powershell
gcloud run deploy travelkeeper-markitdown `
  --source . `
  --region asia-east1 `
  --allow-unauthenticated `
  --set-env-vars MAX_UPLOAD_BYTES=8388608
```

Then set `MARKITDOWN_SERVICE_TOKEN` in Cloud Run environment variables.

The conversion endpoint is:

```text
https://<cloud-run-host>/convert
```

## 7. Service Verification

After deployment, test from the repo root:

```powershell
.\services\markitdown-service\test-service.ps1 `
  -ServiceUrl "https://<host>/convert" `
  -Token "<same token>"
```

Expected result:

```text
Health OK
Convert OK
```

## 8. Wire It Into TravelKeeper

Open TravelKeeper admin:

```text
系統參數 -> MarkItDown 轉檔服務
```

Fill:

```text
服務 URL = https://<host>/convert
服務 Token = <same token>
```

Then:

1. Check `啟用後台文件轉 Markdown`.
2. Click `儲存轉檔服務設定`.
3. Click `測試連線`.
4. Go to `新增行程`.
5. Open `MarkItDown 文件草稿`.
6. Click `上傳文件轉 Markdown`.

## 9. Failure Handling

Common errors:

- `MARKITDOWN_SERVICE_NOT_CONFIGURED`: URL is not saved or feature is disabled.
- `MARKITDOWN_HEALTH_REQUEST_FAILED`: Worker cannot reach the service host.
- `MARKITDOWN_HEALTH_FAILED_401`: Token mismatch or auth rejected.
- `FILE_TOO_LARGE`: file exceeds the Worker or service byte limit.
- `EMPTY_MARKDOWN_RESULT`: service converted but returned no useful Markdown.

## 10. Production Rules

- Keep token enabled.
- Do not log full document content.
- Do not put customer-private converted Markdown into public knowledge base.
- Keep AI-generated itinerary as draft until operator review.
- Test with real WeGo source files before enabling for non-admin operators.

