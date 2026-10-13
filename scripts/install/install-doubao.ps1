param([string]$Version='', [switch]$NoOpen, [switch]$DryRun)
$ErrorActionPreference='Stop'
$localInstaller=Join-Path $PSScriptRoot 'install.ps1'
$taskDir=Join-Path ([IO.Path]::GetTempPath()) ('map-data-doubao-install-'+[Guid]::NewGuid())
try {
 if (!(Test-Path $localInstaller)) {
  New-Item -ItemType Directory $taskDir | Out-Null
  $localInstaller=Join-Path $taskDir 'install.ps1'
  Invoke-WebRequest 'https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.ps1' -OutFile $localInstaller
 }
 & $localInstaller -Client doubao -Version $Version -NoOpen:$NoOpen -DryRun:$DryRun
} finally { if (Test-Path $taskDir) { Remove-Item -LiteralPath $taskDir -Recurse -Force } }
