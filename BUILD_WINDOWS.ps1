$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host 'Graf Desktop 1.0.1 | Windows x64 release build' -ForegroundColor White
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12+ is required. Install it from https://nodejs.org/.' }
$NodeVersion = node --version
Write-Host "Using Node $NodeVersion"

npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax checks failed.' }
npm test -- --test-concurrency=1
if ($LASTEXITCODE -ne 0) { throw 'Automated tests failed.' }
npm run build:win
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }

$Installer = Join-Path $ProjectRoot 'release\Graf-Setup-1.0.1-x64.exe'
if (-not (Test-Path $Installer)) {
  $Installer = Get-ChildItem (Join-Path $ProjectRoot 'release') -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Installer) { throw 'Build completed but no installer EXE was found in release/.' }
Write-Host "Installer created: $Installer" -ForegroundColor Green
