param([ValidateSet('auto','codex','claude','doubao','none')][string]$Client='auto',[string]$Version='', [switch]$NoOpen, [switch]$DryRun)
$ErrorActionPreference='Stop'
if ([Environment]::Is64BitOperatingSystem -ne $true) { throw '仅支持Windows x64' }
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw '请使用x64设备，当前未发布Windows ARM64原生包' }
if (!$Version) { $Version=(Invoke-RestMethod 'https://api.github.com/repos/FeiXueOpen/map-data-studio/releases/latest').tag_name }
if ($Version -notmatch '^v\d+\.\d+\.\d+$') { throw '版本格式应为v0.1.6' }
$name="map-data-studio-$($Version.Substring(1))-windows-x64.zip"
$base="https://github.com/FeiXueOpen/map-data-studio/releases/download/$Version"
$parent=Join-Path $env:LOCALAPPDATA 'Programs'
$target=Join-Path $parent 'Map Data Studio'
if ($DryRun) { Write-Output "版本：$Version`n下载：$base/$name`n安装目录：$target`nAI客户端：$Client"; exit 0 }
$taskDir=Join-Path ([IO.Path]::GetTempPath()) ('map-data-install-'+[Guid]::NewGuid())
New-Item -ItemType Directory $taskDir | Out-Null
try {
 $zip=Join-Path $taskDir $name
 Invoke-WebRequest "$base/$name" -OutFile $zip -UseBasicParsing
 $hashText=(Invoke-WebRequest "$base/$name.sha256" -UseBasicParsing).Content
 $expected=($hashText.Trim() -split '\s+')[0]
 if ($expected -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash $zip -Algorithm SHA256).Hash -ne $expected) { throw '下载文件SHA256校验失败' }
 $unpacked=Join-Path $taskDir 'unpacked'
 Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
 $app=Join-Path $unpacked 'Map Data Studio'
 if (!(Test-Path (Join-Path $app 'map-data-studio.exe'))) { throw '压缩包结构无效' }
 New-Item -ItemType Directory -Force $parent | Out-Null
 if (Test-Path $target) { Move-Item $target ($target+'.backup-'+(Get-Date -Format 'yyyyMMddHHmmss')) }
 Move-Item $app $target
 & (Join-Path $target 'image-runtime/node.exe') (Join-Path $target 'automation/setup-ai.mjs') --client $Client --command (Join-Path $target 'map-data-studio.exe')
 if ($LASTEXITCODE -ne 0) { throw 'AI配置失败，安装文件已保留，可依README手动配置' }
 if (!$NoOpen) {
  Start-Process (Join-Path $target 'map-data-studio.exe')
  & (Join-Path $target 'image-runtime/node.exe') (Join-Path $target 'automation/check-connection.mjs') (Join-Path $target 'map-data-studio.exe')
  if ($LASTEXITCODE -ne 0) { Write-Warning '应用已安装，但本地服务预检未通过，请完成首次打开确认后重试。' }
 }
 Write-Output "客户端已安装：$target"
} finally { Remove-Item -LiteralPath $taskDir -Recurse -Force }
