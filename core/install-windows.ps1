$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$nodeVersion = (node --version).Trim().TrimStart('v').Split('.')
if ([int]$nodeVersion[0] -lt 22 -or ([int]$nodeVersion[0] -eq 22 -and [int]$nodeVersion[1] -lt 5)) {
  throw "Graf requires Node.js 22.5+. Found $(node --version). Install a current Node.js LTS release first."
}

function Invoke-CheckedNpm([string[]]$Arguments, [string]$Step) {
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Graf $Step failed (npm exit code $LASTEXITCODE). Installation was stopped; fix the reported issue and rerun install-windows.ps1."
  }
}

Write-Host "Running Graf verification..."
Invoke-CheckedNpm @('test') 'tests'
Invoke-CheckedNpm @('run', 'check') 'syntax checks'

Write-Host "Registering Graf CLI globally..."
Invoke-CheckedNpm @('link') 'CLI registration'

Write-Host "Graf CLI installed. Open a repository and run: graf init"
