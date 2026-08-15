param(
  [ValidateSet('Baseline','Pending','Smoke')]
  [string]$Mode = 'Pending'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$StagingEnv = 'staging'
$D1Binding = 'DB'
$ExpectedStagingDb = 'travelkeeper-staging-v2'
$LedgerTable = 'travelkeeper_project_migration_ledger'
$ManifestPath = Join-Path $Root 'artifacts\d1-bootstrap\manifest.json'
$ExpectedForward = @(
  '0115_attribution_contract_v1.sql',
  '0116_tenant_first_touch_attribution.sql'
)
$RequiredTriggers = @(
  'trg_customers_referrer_immutable',
  'trg_distributor_referrer_immutable',
  'trg_customer_attribution_projection_insert',
  'trg_customer_attribution_projection_update',
  'trg_tenant_first_touch_validate_insert',
  'trg_tenant_first_touch_immutable',
  'trg_tenant_first_touch_no_delete'
)

function Assert-ReadOnlySql([string]$Sql) {
  if ([string]::IsNullOrWhiteSpace($Sql)) { throw 'EMPTY_SQL' }
  if ($Sql -match '(?i)\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b') {
    throw 'READ_ONLY_SQL_REQUIRED'
  }
}

function Invoke-Wrangler([string[]]$Arguments) {
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  try {
    & npx.cmd wrangler @Arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdout = [System.IO.File]::ReadAllText($stdoutPath)
    $stderr = [System.IO.File]::ReadAllText($stderrPath)
    if ($exitCode -ne 0) {
      throw (($stderr + "`n" + $stdout).Trim())
    }
    return [pscustomobject]@{ Stdout = $stdout; Stderr = $stderr }
  }
  finally {
    Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-D1Read([string]$Sql) {
  Assert-ReadOnlySql $Sql
  $result = Invoke-Wrangler @(
    'd1','execute',$D1Binding,
    '--env',$StagingEnv,
    '--remote','--json',
    '--command',$Sql
  )
  $parsed = $result.Stdout | ConvertFrom-Json
  $rows = @()
  foreach ($item in @($parsed)) {
    if ($null -ne $item.results) { $rows += @($item.results) }
  }
  return ,$rows
}

function Get-BaselineReview {
  $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
  $table = @(Invoke-D1Read "SELECT name FROM sqlite_master WHERE type='table' AND name='$LedgerTable'")
  if (-not ($table | Where-Object { $_.name -eq $LedgerTable })) {
    return [pscustomobject]@{
      safe = $false
      decision = 'NO-GO'
      reason = 'PROJECT_MIGRATION_LEDGER_MISSING'
      baseline_version = $manifest.baseline_version
      completed_forward_migrations = @()
      forward_blocked = $false
      baseline_checks = @{}
    }
  }

  $baselineRows = @(Invoke-D1Read @"
SELECT baseline_version, migration_start, migration_end,
       bootstrap_checksum, manifest_checksum, source_commit, schema_checksum,
       migration_count, statement_count, applied_statement_count,
       status, completed_at
FROM $LedgerTable
WHERE entry_type = 'baseline'
ORDER BY id DESC
LIMIT 1
"@)
  $row = $baselineRows | Select-Object -First 1
  $checks = [ordered]@{
    status_completed = ([string]$row.status -eq 'completed')
    baseline_version = ([string]$row.baseline_version -eq [string]$manifest.baseline_version)
    migration_start = ([string]$row.migration_start -eq [string]$manifest.migration_start)
    migration_end = ([string]$row.migration_end -eq [string]$manifest.migration_end)
    migration_count = ([int]$row.migration_count -eq [int]$manifest.migration_count)
    statement_count = ([int]$row.statement_count -eq [int]$manifest.statement_count)
    applied_statement_count = ([int]$row.applied_statement_count -eq [int]$manifest.statement_count)
    bootstrap_checksum = ([string]$row.bootstrap_checksum -eq [string]$manifest.bootstrap_checksum)
    manifest_checksum = ([string]$row.manifest_checksum -eq [string]$manifest.manifest_checksum)
    schema_checksum = ([string]$row.schema_checksum -eq [string]$manifest.schema_checksum)
    source_commit = ([string]$row.source_commit -eq [string]$manifest.source_commit)
  }
  $baselineSafe = -not ($checks.Values -contains $false)

  $forwardRows = @(Invoke-D1Read @"
SELECT migration_version, migration_checksum, status, created_at, completed_at
FROM $LedgerTable
WHERE entry_type = 'forward'
ORDER BY id ASC
"@)
  $latest = @{}
  foreach ($forward in $forwardRows) {
    $version = [string]$forward.migration_version
    if ($version) { $latest[$version] = $forward }
  }

  $unexpected = @($latest.Keys | Where-Object { $_ -and ($_ -notin $ExpectedForward) })
  $completed = @()
  $forwardChecks = [ordered]@{}
  $forwardBlocked = ($unexpected.Count -gt 0)

  foreach ($file in $ExpectedForward) {
    if (-not $latest.ContainsKey($file)) { continue }
    $forward = $latest[$file]
    $localHash = (Get-FileHash (Join-Path $Root "migrations\$file") -Algorithm SHA256).Hash.ToLowerInvariant()
    $status = [string]$forward.status
    $checksumMatches = ([string]$forward.migration_checksum -eq $localHash)
    $forwardChecks[$file] = [ordered]@{
      status = $status
      checksum_matches = $checksumMatches
    }
    if ($status -eq 'completed' -and $checksumMatches) { $completed += $file }
    else { $forwardBlocked = $true }
  }

  for ($i = 0; $i -lt $completed.Count; $i++) {
    if ($completed[$i] -ne $ExpectedForward[$i]) { $forwardBlocked = $true }
  }

  $safe = $baselineSafe -and (-not $forwardBlocked)
  return [pscustomobject]@{
    safe = $safe
    decision = $(if ($safe) { 'BASELINE_TRUSTED' } else { 'NO-GO' })
    baseline_version = [string]$manifest.baseline_version
    baseline_checks = $checks
    completed_forward_migrations = $completed
    forward_checks = $forwardChecks
    unexpected_forward_migrations = $unexpected
    forward_blocked = $forwardBlocked
  }
}

function Get-PendingReview {
  $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
  $baselineFiles = @($manifest.migrations | ForEach-Object { [string]$_.file })
  $raw = Invoke-Wrangler @('d1','migrations','list',$D1Binding,'--env',$StagingEnv,'--remote')
  $matches = [regex]::Matches($raw.Stdout, '\b\d{4}_[A-Za-z0-9_.-]+\.sql\b')
  $pending = New-Object System.Collections.Generic.List[string]
  foreach ($match in $matches) {
    if (-not $pending.Contains($match.Value)) { $pending.Add($match.Value) }
  }

  $nativeSafe = (($pending.Count -eq 0) -or
    ($pending.Count -eq 1 -and $pending[0] -eq $ExpectedForward[1]) -or
    ($pending.Count -eq 2 -and $pending[0] -eq $ExpectedForward[0] -and $pending[1] -eq $ExpectedForward[1]))

  if ($nativeSafe) {
    return [pscustomobject]@{
      safe = $true
      registry_mode = 'wrangler-native'
      raw_pending = @($pending)
      logical_pending = @($pending)
      apply_strategy = 'wrangler-migrations'
      decision = 'REVIEWED'
    }
  }

  $baseline = Get-BaselineReview
  $hasPrefix = $pending.Count -ge $baselineFiles.Count
  if ($hasPrefix) {
    for ($i = 0; $i -lt $baselineFiles.Count; $i++) {
      if ($pending[$i] -ne $baselineFiles[$i]) { $hasPrefix = $false; break }
    }
  }

  if (-not $hasPrefix -or -not $baseline.safe) {
    return [pscustomobject]@{
      safe = $false
      registry_mode = $(if ($hasPrefix) { 'bootstrap-ledger-untrusted' } else { 'unknown' })
      raw_pending = @($pending)
      logical_pending = @($pending)
      apply_strategy = 'none'
      decision = 'NO-GO'
      baseline = $baseline
    }
  }

  $rawForward = @($pending | Select-Object -Skip $baselineFiles.Count)
  if (@($rawForward | Where-Object { $_ -notin $ExpectedForward }).Count -gt 0) {
    return [pscustomobject]@{
      safe = $false
      registry_mode = 'bootstrap-ledger'
      raw_pending = @($pending)
      logical_pending = $rawForward
      apply_strategy = 'none'
      decision = 'NO-GO'
      baseline = $baseline
    }
  }

  $logical = @($rawForward | Where-Object { $_ -notin $baseline.completed_forward_migrations })
  $logicalSafe = (($logical.Count -eq 0) -or
    ($logical.Count -eq 1 -and $logical[0] -eq $ExpectedForward[1]) -or
    ($logical.Count -eq 2 -and $logical[0] -eq $ExpectedForward[0] -and $logical[1] -eq $ExpectedForward[1]))

  return [pscustomobject]@{
    safe = $logicalSafe
    registry_mode = 'bootstrap-ledger'
    raw_pending = @($pending)
    logical_pending = $logical
    completed_forward = @($baseline.completed_forward_migrations)
    apply_strategy = $(if ($logicalSafe) { 'project-forward-ledger-required' } else { 'none' })
    decision = $(if ($logicalSafe) { 'REVIEWED_BOOTSTRAP_BASELINE' } else { 'NO-GO' })
    baseline = $baseline
  }
}

function Get-SmokeReview {
  $customerColumns = @(Invoke-D1Read 'PRAGMA table_info(customers)')
  $distributorColumns = @(Invoke-D1Read 'PRAGMA table_info(tenant_distributor_profiles)')
  $firstTouchTable = @(Invoke-D1Read "SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_first_touch_attributions'")
  $triggerList = ($RequiredTriggers | ForEach-Object { "'$_'" }) -join ','
  $triggerRows = @(Invoke-D1Read "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ($triggerList) ORDER BY name")
  $foreignKeys = @(Invoke-D1Read 'PRAGMA foreign_key_check')

  $triggerNames = @($triggerRows | ForEach-Object { [string]$_.name })
  $missing = @($RequiredTriggers | Where-Object { $_ -notin $triggerNames })
  $checks = [ordered]@{
    customers_ref_uid = [bool]($customerColumns | Where-Object { $_.name -eq 'ref_uid' })
    tenant_distributor_profiles_ref_uid = [bool]($distributorColumns | Where-Object { $_.name -eq 'ref_uid' })
    first_touch_table = [bool]($firstTouchTable | Where-Object { $_.name -eq 'tenant_first_touch_attributions' })
    required_triggers = ($missing.Count -eq 0)
    foreign_keys_clean = ($foreignKeys.Count -eq 0)
  }
  $healthy = -not ($checks.Values -contains $false)
  return [pscustomobject]@{
    healthy = $healthy
    scope = 'all-tenants'
    checks = $checks
    missing_triggers = $missing
  }
}

try {
  $result = switch ($Mode) {
    'Baseline' { Get-BaselineReview }
    'Pending' { Get-PendingReview }
    'Smoke' { Get-SmokeReview }
  }
  [pscustomobject]@{
    mode = "windows-native-$($Mode.ToLowerInvariant())"
    remote_d1_touched = $true
    remote_d1_mutated = $false
    production_touched = $false
    staging_database_name = $ExpectedStagingDb
    result = $result
  } | ConvertTo-Json -Depth 12
  if (($null -ne $result.safe -and -not $result.safe) -or ($null -ne $result.healthy -and -not $result.healthy)) { exit 1 }
}
catch {
  [pscustomobject]@{
    ok = $false
    mode = "windows-native-$($Mode.ToLowerInvariant())"
    remote_d1_mutated = $false
    production_touched = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 8
  exit 1
}
