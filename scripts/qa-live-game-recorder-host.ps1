param(
  [Parameter(Mandatory = $true)]
  [string]$PlaywrightPackage,

  [Parameter(Mandatory = $true)]
  [string]$GameHubLiveData,

  [Parameter(Mandatory = $true)]
  [ValidateSet("I_UNDERSTAND_THIS_LAUNCHES_A_GAME")]
  [string]$Acknowledge
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$signalPath = Join-Path ([IO.Path]::GetTempPath()) (
  "gamehub-recorder-qa-cleanup-{0}.json" -f [guid]::NewGuid().ToString("N")
)
$allowedProcessNames = @(
  "hades2.exe",
  "steamclient_loader_x64.exe",
  "bbq-win64-shipping.exe"
)
$cleanupJob = $null
$exitCode = 1

try {
  $cleanupJob = Start-Job -ArgumentList $signalPath, $allowedProcessNames -ScriptBlock {
    param($SignalPath, $AllowedProcessNames)

    $deadline = [DateTime]::UtcNow.AddMinutes(12)
    while (-not (Test-Path -LiteralPath $SignalPath)) {
      if ([DateTime]::UtcNow -gt $deadline) {
        throw "Timed out waiting for the recorder QA cleanup signal."
      }
      Start-Sleep -Milliseconds 100
    }

    $request = Get-Content -LiteralPath $SignalPath -Raw | ConvertFrom-Json
    if (
      $request.schemaVersion -ne 1 -or
      [string]::IsNullOrWhiteSpace([string]$request.runId)
    ) {
      throw "Invalid recorder QA cleanup request."
    }

    $terminatedPids = @()
    foreach ($entry in @($request.processes)) {
      $targetPid = [int]$entry.pid
      if ($targetPid -le 4) {
        throw "Refusing an unsafe recorder QA cleanup PID."
      }

      $actual = Get-CimInstance Win32_Process -Filter (
        "ProcessId = {0}" -f $targetPid
      ) -ErrorAction SilentlyContinue
      if ($null -eq $actual) {
        continue
      }

      $actualName = [string]$actual.Name
      $expectedName = [string]$entry.name
      if (
        $AllowedProcessNames -notcontains $actualName.ToLowerInvariant() -or
        $actualName -ine $expectedName
      ) {
        throw "Recorder QA cleanup identity mismatch for PID $targetPid."
      }

      Stop-Process -Id $targetPid -Force
      $terminatedPids += $targetPid
    }

    $response = @{
      runId = [string]$request.runId
      terminatedPids = $terminatedPids
    } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText("$SignalPath.done", $response)
  }

  $env:PLAYWRIGHT_PACKAGE = (Resolve-Path -LiteralPath $PlaywrightPackage).Path
  $env:GAMEHUB_LIVE_DATA = (Resolve-Path -LiteralPath $GameHubLiveData).Path
  $env:GAMEHUB_QA_LIVE_RECORDER_ACK = $Acknowledge
  $env:GAMEHUB_QA_ELEVATED_CLEANUP_SIGNAL = $signalPath

  Push-Location $repositoryRoot
  try {
    & node scripts/qa-live-game-recorder.mjs
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }

  $finishedJob = Wait-Job -Job $cleanupJob -Timeout 30
  if ($null -eq $finishedJob) {
    Stop-Job -Job $cleanupJob
  }
  elseif ($cleanupJob.State -eq "Failed") {
    Receive-Job -Job $cleanupJob
    $exitCode = 1
  }
  else {
    Receive-Job -Job $cleanupJob
  }
}
finally {
  if ($null -ne $cleanupJob) {
    Remove-Job -Job $cleanupJob -Force -ErrorAction SilentlyContinue
  }
  foreach ($candidate in @($signalPath, "$signalPath.done", "$signalPath.part")) {
    Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
  }
  foreach ($environmentName in @(
    "GAMEHUB_QA_LIVE_RECORDER_ACK",
    "GAMEHUB_QA_ELEVATED_CLEANUP_SIGNAL"
  )) {
    Remove-Item -LiteralPath "Env:$environmentName" -ErrorAction SilentlyContinue
  }
}

exit $exitCode
