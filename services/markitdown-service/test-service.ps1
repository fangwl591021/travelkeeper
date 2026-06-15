param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceUrl,

  [string]$Token = ""
)

$ErrorActionPreference = "Stop"

$baseUri = [Uri]$ServiceUrl
$healthUri = [Uri]::new($baseUri, "/health").AbsoluteUri

$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($Token)) {
  $headers["Authorization"] = "Bearer $Token"
}

$health = Invoke-RestMethod -Method Get -Uri $healthUri -Headers $headers
if (-not $health.success) {
  throw "Health check failed"
}
Write-Host "Health OK"

$sample = "# Test Itinerary`n`nDay 1 Taipei city walk.`n"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($sample)
$body = @{
  filename = "sample.txt"
  contentType = "text/plain"
  base64 = [Convert]::ToBase64String($bytes)
} | ConvertTo-Json -Compress

$converted = Invoke-RestMethod -Method Post -Uri $ServiceUrl -Headers $headers -ContentType "application/json" -Body $body
if (-not $converted.success -or [string]::IsNullOrWhiteSpace($converted.markdown)) {
  throw "Convert check failed"
}
Write-Host "Convert OK"

