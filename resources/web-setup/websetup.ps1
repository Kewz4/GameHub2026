# GameHub web-setup payload script. Runs inside the tiny NSIS bootstrapper:
# resolves the latest GitHub release, downloads the chosen flavor and hands
# off (install) or extracts in place (portable). Output is streamed into the
# bootstrapper's details pane, so keep every step on its own printed line.
param(
  [Parameter(Mandatory = $true)][ValidateSet("install", "portable")][string]$Mode,
  [string]$Dir = "",
  [string]$Repo = "Kewz4/hydra"
)

$ErrorActionPreference = "Stop"
# Invoke-WebRequest's console progress bar cripples download speed and cannot
# render in the installer pane anyway.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-Asset($release, [string]$pattern, [string]$exclude) {
  $release.assets |
    Where-Object { $_.name -match $pattern -and ($exclude -eq "" -or $_.name -notmatch $exclude) } |
    Select-Object -First 1
}

function Download($asset, [string]$destination) {
  $mb = [math]::Round($asset.size / 1MB, 1)
  Write-Output "Downloading $($asset.name) ($mb MB)..."
  $client = New-Object System.Net.WebClient
  $client.Headers.Add("User-Agent", "GameHub-WebSetup")
  $client.DownloadFile($asset.browser_download_url, $destination)
  Write-Output "Download complete."
}

Write-Output "Looking up the latest GameHub release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
  -Headers @{ "User-Agent" = "GameHub-WebSetup" }
Write-Output "Latest release: $($release.tag_name)"

if ($Mode -eq "install") {
  # Full NSIS installer ("GameHub Setup x.y.z.exe"), never our own web stub.
  $asset = Get-Asset $release "(?i)setup.*\.exe$" "(?i)web"
  if (-not $asset) { throw "No installer found in release $($release.tag_name)." }
  $target = Join-Path $env:TEMP $asset.name
  Download $asset $target
  Write-Output "Launching installer..."
  Start-Process -FilePath $target
} else {
  if ($Dir -eq "") { throw "Portable mode requires a destination folder." }
  # Portable zip (electron-builder "zip" target), never a blockmap.
  $asset = Get-Asset $release "(?i)\.zip$" "(?i)blockmap"
  if (-not $asset) { throw "No portable zip found in release $($release.tag_name)." }
  $target = Join-Path $env:TEMP $asset.name
  Download $asset $target
  Write-Output "Extracting to $Dir..."
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Expand-Archive -LiteralPath $target -DestinationPath $Dir -Force
  # The app treats a "portable" marker next to the exe as portable mode and
  # keeps all data inside this folder.
  New-Item -ItemType File -Force -Path (Join-Path $Dir "portable") | Out-Null
  Remove-Item $target -Force -ErrorAction SilentlyContinue

  $exe = Join-Path $Dir "GameHub.exe"
  if (Test-Path $exe) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop "GameHub Portable.lnk"))
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $Dir
    $shortcut.Save()
    Write-Output "Desktop shortcut created."
  }
  Write-Output "Portable setup complete."
}
