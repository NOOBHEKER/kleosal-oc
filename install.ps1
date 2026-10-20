#Requires -Version 5.1
# kleosal-oc installer - Windows
# Usage: irm https://raw.githubusercontent.com/NOOBHEKER/kleosal-oc/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo = 'NOOBHEKER/kleosal-oc'
$branch = if ($env:KLEOSAL_BRANCH) { $env:KLEOSAL_BRANCH } else { 'main' }
$configDir = Join-Path $env:USERPROFILE '.config\opencode'
$tmp = Join-Path $env:TEMP ("kleosal-oc-" + [guid]::NewGuid().ToString('N'))
$zip = "$tmp.zip"

try {
  Write-Host "Kleosal OC installer"
  Write-Host ""

  if ($env:KLEOSAL_SRC) {
    $src = $env:KLEOSAL_SRC.TrimEnd('\')
    Write-Host "Using local source: $src"
  } else {
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    Write-Host "Downloading $repo ($branch)..."
    Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $tmp -Force
    $src = Join-Path $tmp "kleosal-oc-$branch\kleosal-oc"
  }

  if (-not (Test-Path (Join-Path $src 'config'))) {
    throw "Source does not look like the kleosal-oc pack: $src"
  }

  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $configDir ".kleosal-backup-$stamp"
  New-Item -ItemType Directory -Path $backup -Force | Out-Null

  foreach ($item in @('config','agents','commands','rules','skills','themes','plugins','opencode.jsonc','tui.json')) {
    $path = Join-Path $configDir $item
    if (Test-Path $path) {
      $dest = Join-Path $backup $item
      New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
      if (Test-Path $path -PathType Container) {
        Copy-Item $path $dest -Recurse -Force
      } else {
        Copy-Item $path $dest -Force
      }
    }
  }
  Write-Host "Backup: $backup"

  New-Item -ItemType Directory -Path (Join-Path $configDir 'config') -Force | Out-Null
  if (Test-Path (Join-Path $configDir 'opencode.jsonc')) {
    Copy-Item (Join-Path $src 'config\opencode.jsonc') (Join-Path $configDir 'config\opencode.kleosal.jsonc') -Force
    Write-Host "Kept your opencode.jsonc; pack reference saved to config\opencode.kleosal.jsonc"
  } else {
    Copy-Item (Join-Path $src 'config\opencode.jsonc') (Join-Path $configDir 'opencode.jsonc') -Force
    Write-Host "Installed config\opencode.jsonc"
  }

  if (Test-Path (Join-Path $src 'config\tui.json')) {
    if (Test-Path (Join-Path $configDir 'tui.json')) {
      Copy-Item (Join-Path $src 'config\tui.json') (Join-Path $configDir 'config\tui.kleosal.json') -Force
      Write-Host "Kept your tui.json; pack reference saved to config\tui.kleosal.json"
    } else {
      Copy-Item (Join-Path $src 'config\tui.json') (Join-Path $configDir 'tui.json') -Force
    }
  }

  foreach ($dir in @('agents','commands','rules','skills','themes','plugins')) {
    $destDir = Join-Path $configDir $dir
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item (Join-Path $src "$dir\*") $destDir -Recurse -Force
  }

  if (-not $env:KLEOSAL_SKIP_NPM -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing plugin SDK..."
    Push-Location $configDir
    try {
      & npm install --silent '@opencode-ai/plugin' | Out-Null
      if ($LASTEXITCODE -ne 0) { Write-Warning "npm install @opencode-ai/plugin failed; run it manually in $configDir." }
    } catch {
      Write-Warning "npm install @opencode-ai/plugin failed; run it manually in $configDir."
    } finally {
      Pop-Location
    }
  }

  $server = (Join-Path $configDir 'plugins\cover-art\mcp\server.mjs').Replace('\','/')
  Write-Host ""
  Write-Host "Installed. Restart OpenCode, then try:"
  Write-Host "  /art      cover art presets, faintness, layout"
  Write-Host "  /goal     persistent goal tracking"
  Write-Host "  /review   structured code review"
  Write-Host ""
  Write-Host "Optional cover-art MCP entry for opencode.jsonc:"
  Write-Host ('  "mcp": { "servers": { "coverart": { "type": "local", "command": ["node", "' + $server + '"] } } }')
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
