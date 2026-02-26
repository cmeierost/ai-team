$ErrorActionPreference='Stop'
$config = Get-Content .ai-team/config.json -Raw | ConvertFrom-Json
$providerRef = $config.defaultLlmProvider
if (-not $providerRef) { $providerRef = ($config.providers.PSObject.Properties | Select-Object -First 1).Name }
$provider = $config.providers.$providerRef
$baseUrl = $provider.baseUrl
if (-not $baseUrl) { throw "No baseUrl for provider $providerRef" }

$envMap = @{}
if (Test-Path .ai-team/.env) {
  Get-Content .ai-team/.env | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $ErrorActionPreference='Stop'
$config = Get-Content .ai-team/config.json -Raw | ConvertFrom-Json
$providerRef = $config.defaultLlmProvider
if (-not $providerRef) { $providerRef = ($config.providers.PSObject.Properties | Select-Object -First 1).Name }
$provider = $config.providers.$providerRef
$baseUrl = $provider.baseUrl
if (-not $baseUrl) { throw "No baseUrl for provider $providerRef" }

$envMap = @{}
if (Test-Path .ai-team/.env) {
  Get-Content .ai-team/.env | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $_ -split '=',2
    if ($parts.Count -eq 2) { $envMap[$parts[0].Trim()] = $parts[1].Trim() }
  }
}
$keyName = if ($provider.apiKeyEnvVar) { [string]$provider.apiKeyEnvVar } else { 'AI_TEAM_LLM_API_KEY' }
$apiKey = (Get-Item -Path ("Env:" + $keyName) -ErrorAction SilentlyContinue).Value
if (-not $apiKey) { $apiKey = $envMap[$keyName] }
if (-not $apiKey) { $apiKey = $envMap['AI_TEAM_LLM_API_KEY'] }
if (-not $apiKey) { throw "No API key found in env or .ai-team/.env for $keyName" }

$headers = @{ Authorization = "Bearer $apiKey" }
Write-Output "ProviderRef: $providerRef"
Write-Output "BaseUrl: $baseUrl"
Write-Output "--- /models probe ---"
try {
  $modelsResp = Invoke-RestMethod -Uri "$baseUrl/models" -Headers $headers -Method GET -TimeoutSec 20
  $count = if ($modelsResp.data) { $modelsResp.data.Count } else { 0 }
  Write-Output "models: OK (count=$count)"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "models: FAIL (status=$status)"
}

$probeModels = @('best-chat','best-code','openai/gpt-oss-20b')
Write-Output "--- chat/completions probes ---"
foreach ($m in $probeModels) {
  $body = @{ model = $m; messages = @(@{ role='user'; content='Reply with exactly OK.' }); max_tokens = 8 } | ConvertTo-Json -Depth 6
  try {
    $null = Invoke-RestMethod -Uri "$baseUrl/chat/completions" -Headers (@{ Authorization = "Bearer $apiKey"; 'Content-Type'='application/json' }) -Method POST -Body $body -TimeoutSec 30
    Write-Output "$m => OK"
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $raw = $_.ErrorDetails.Message
    if (-not $raw) { $raw = $_.Exception.Message }
    $raw = ($raw -replace "`r|`n",' ')
    if ($raw.Length -gt 220) { $raw = $raw.Substring(0,220) + '...' }
    Write-Output "$m => FAIL (status=$status) $raw"
  }
}

 -split '=',2`n    if ($parts.Count -eq 2) {`n      $v = $parts[1].Trim()`n      if (($v.StartsWith("\"") -and $v.EndsWith("\"")) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v = $v.Substring(1, $v.Length - 2) }`n      $envMap[$parts[0].Trim()] = $v`n    }
  }
}
$keyName = if ($provider.apiKeyEnvVar) { [string]$provider.apiKeyEnvVar } else { 'AI_TEAM_LLM_API_KEY' }
$apiKey = (Get-Item -Path ("Env:" + $keyName) -ErrorAction SilentlyContinue).Value
if (-not $apiKey) { $apiKey = $envMap[$keyName] }
if (-not $apiKey) { $apiKey = $envMap['AI_TEAM_LLM_API_KEY'] }
if (-not $apiKey) { throw "No API key found in env or .ai-team/.env for $keyName" }

$headers = @{ Authorization = "Bearer $apiKey" }
Write-Output "ProviderRef: $providerRef"
Write-Output "BaseUrl: $baseUrl"
Write-Output "--- /models probe ---"
try {
  $modelsResp = Invoke-RestMethod -Uri "$baseUrl/models" -Headers $headers -Method GET -TimeoutSec 20
  $count = if ($modelsResp.data) { $modelsResp.data.Count } else { 0 }
  Write-Output "models: OK (count=$count)"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "models: FAIL (status=$status)"
}

$probeModels = @('best-chat','best-code','openai/gpt-oss-20b')
Write-Output "--- chat/completions probes ---"
foreach ($m in $probeModels) {
  $body = @{ model = $m; messages = @(@{ role='user'; content='Reply with exactly OK.' }); max_tokens = 8 } | ConvertTo-Json -Depth 6
  try {
    $null = Invoke-RestMethod -Uri "$baseUrl/chat/completions" -Headers (@{ Authorization = "Bearer $apiKey"; 'Content-Type'='application/json' }) -Method POST -Body $body -TimeoutSec 30
    Write-Output "$m => OK"
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $raw = $_.ErrorDetails.Message
    if (-not $raw) { $raw = $_.Exception.Message }
    $raw = ($raw -replace "`r|`n",' ')
    if ($raw.Length -gt 220) { $raw = $raw.Substring(0,220) + '...' }
    Write-Output "$m => FAIL (status=$status) $raw"
  }
}


