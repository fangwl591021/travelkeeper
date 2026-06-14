param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [string]$OutputPath = "",

  [string]$MarkItDownExe = "markitdown"
)

$ErrorActionPreference = "Stop"

$resolvedInput = Resolve-Path -LiteralPath $InputPath
$inputFile = Get-Item -LiteralPath $resolvedInput

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = [System.IO.Path]::ChangeExtension($inputFile.FullName, ".md")
}

$outputDir = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDir) -and -not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$tmpOutput = "$OutputPath.tmp"

try {
  $command = Get-Command $MarkItDownExe -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Cannot find '$MarkItDownExe'. Install MarkItDown first: py -m pip install `"markitdown[all]`""
  }

  & $command.Source "$($inputFile.FullName)" | Set-Content -LiteralPath $tmpOutput -Encoding UTF8

  if ($LASTEXITCODE -ne 0) {
    throw "MarkItDown conversion failed with exit code $LASTEXITCODE"
  }

  Move-Item -LiteralPath $tmpOutput -Destination $OutputPath -Force
  Write-Host "Converted Markdown:"
  Write-Host $OutputPath
} catch {
  if (Test-Path -LiteralPath $tmpOutput) {
    Remove-Item -LiteralPath $tmpOutput -Force
  }
  throw
}
