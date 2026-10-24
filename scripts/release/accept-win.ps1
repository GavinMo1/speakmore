# 发完版在 Windows 上验收线上的包（经 ssh 跑，进不了桌面，所以不碰桌面会话）：用户目录换成临时目录，先装上一个版本并让它开着，
# 再照 README 里 irm 那一行升到最新，走一遍升级路径（停掉正在跑的旧版本、删旧版本）；然后 update 应说已是最新，起来看日志。
# 由 scripts/release/accept-win.sh 传到开发机上跑，别直接调。
# 用户 Path 是真的，先备份、最后还原；开机启动项只有指向测试家目录时才会被改，真的不会动。
param(
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$To
)
$smvKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$smvPath = [string]$smvKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$smvRoot = Join-Path $env:TEMP ('smv-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
$smvHome = Join-Path $smvRoot '.speakmore'
$smvCmd = Join-Path $smvHome 'bin\speakmore.cmd'
$smvInstall = 'irm https://dl.zephyrxiang.com/speakmore/install.ps1 | iex'
try {
  # 快捷方式要建在假的开始菜单和桌面里：GetFolderPath 照 %USERPROFILE% 展开，目录不在就交回空路径
  New-Item -ItemType Directory -Force (Join-Path $smvRoot 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs'), (Join-Path $smvRoot 'Desktop'), (Join-Path $smvRoot 'AppData\Local') | Out-Null
  $env:USERPROFILE = $smvRoot
  $env:LOCALAPPDATA = Join-Path $smvRoot 'AppData\Local'
  $env:APPDATA = Join-Path $smvRoot 'AppData\Roaming'
  $env:SPEAKMORE_HOME = $smvHome
  $env:SPEAKMORE_NO_START = '1'

  "== 1. 装 $From"
  $env:SPEAKMORE_VERSION = $From
  powershell -NoProfile -ExecutionPolicy Bypass -Command $smvInstall 2>&1 | Select-Object -Last 4
  Remove-Item Env:SPEAKMORE_VERSION

  "== 2. 让 $From 开着"
  & $smvCmd start 2>&1 | Select-Object -Last 2
  $old = @(Get-Process | Where-Object { $_.Path -like "$smvHome\*" })
  "跑着的进程 $($old.Count) 个：$(($old | ForEach-Object ProcessName | Sort-Object -Unique) -join ', ')"

  "== 3. 照 irm 那一行升到最新（应该是 $To）"
  $out = @(powershell -NoProfile -ExecutionPolicy Bypass -Command $smvInstall 2>&1 | ForEach-Object { "$_" })
  $out | Where-Object { $_ -match 'Version|Stopped|Installed|Upgraded|went wrong|x |still running' }
  # 旧版本目录由后台等旧进程退出后再删
  Start-Sleep -Seconds 8
  "versions 里剩下：$((Get-ChildItem -LiteralPath (Join-Path $smvHome 'versions') -Directory | ForEach-Object Name) -join ', ')"

  "== 4. update 和版本号"
  & $smvCmd --version 2>&1 | Select-Object -Last 1
  & $smvCmd update 2>&1 | Select-Object -Last 2

  "== 5. 起 $To 看日志"
  & $smvCmd start 2>&1 | Select-Object -Last 2
  $log = Join-Path $smvHome 'logs\main.log'
  for ($i = 0; $i -lt 30 -and -not (Select-String -LiteralPath $log -Pattern 'helper_ready' -Quiet -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  Select-String -LiteralPath $log -Pattern '"started"|helper_ready|"helper_' -ErrorAction SilentlyContinue | Select-Object -Last 4 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(200, $_.Line.Length)) }
  "日志里的 error：$(@(Select-String -LiteralPath $log -Pattern '"level":"error"' -ErrorAction SilentlyContinue).Count) 条"
  Select-String -LiteralPath $log -Pattern '"level":"error"' -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { $_.Line.Substring(0, [Math]::Min(300, $_.Line.Length)) }
  & $smvCmd stop 2>&1 | Select-Object -Last 1
} finally {
  Get-Process | Where-Object { $_.Path -like "$smvRoot\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  $smvKey.SetValue('Path', $smvPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $back = [string]$smvKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  "== 还原用户 Path：$(if ($back -eq $smvPath) { '已还原' } else { '没还原上！' })"
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $smvRoot -Recurse -Force -ErrorAction SilentlyContinue
  "临时目录：$(if (Test-Path -LiteralPath $smvRoot) { "还在 $smvRoot" } else { '已删' })"
}
