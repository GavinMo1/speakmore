# SpeakMore 的 Windows 安装脚本：检查环境、下载、校验、装进 %USERPROFILE%\.speakmore，然后启动。
#
#   irm https://dl.zephyrxiang.com/speakmore/install.ps1 | iex
#
# 和 install.sh 是同一件事：程序、运行环境，以及之后的设置、key、历史和录音全在 .speakmore 这一个目录里。
# 程序按版本放：versions\<版本>-<编号>\ 里是 app\ 和 runtime\，current 记着现在用哪个，bin\speakmore.cmd 照它找程序。
# 装新版本是解进一个新目录、试过能跑再把 current 指过去，不挪、不覆盖已有的任何文件（为什么见下面"安装"一节开头）。
# 目录以外只动两处，都记在 bin\links 里，speakmore uninstall 照着删：
#   - 用户的 Path 里加上 .speakmore\bin（新开的终端里敲 speakmore 就找得到）
#   - 开始菜单里一个"SpeakMore"快捷方式
# 不需要 Node、npm、管理员权限。已经装过的话再运行一次就是升级：程序换成新的，你的东西不动。
#
# 可以用环境变量调整（irm | iex 传不了参数，所以都走环境变量）：
#   SPEAKMORE_HOME          装到哪（默认 %USERPROFILE%\.speakmore）
#   SPEAKMORE_VERSION       装哪个版本，比如 v0.9.0（默认最新的）
#   SPEAKMORE_INSTALL_BASE  从哪下载：一个网址前缀，或者本机的一个目录（npm run release 打出来的 dist\release）
#   SPEAKMORE_NO_START=1    只装不启动
#
# 写法要能在 Windows 自带的 PowerShell 5.1 上跑，这些坑都踩过（见 docs/development.md 的 Windows 一节）：
#   - 整段包在一个脚本块里，出错时不 exit：irm | iex 跑在用户自己的窗口里，exit 关掉的是他的窗口
#   - 不用 Expand-Archive、Get-FileHash：前者画进度条极慢，后者在从 PowerShell 7 里开的 5.1 里加载不到；都用 .NET
#   - 调外部程序时放宽 ErrorActionPreference：5.1 在 Stop 下会把它写到标准错误的第一行当成异常
#   - 用户的 Path 按原样读写（REG_EXPAND_SZ、不展开），不然里面的 %USERPROFILE% 会被写死

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # 下载地址只认 TLS 1.2 以上；较早的 Windows 10 上 5.1 默认不开
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $RepoUrl = 'https://github.com/zephyr4123/speakmore'
  $DownloadUrl = 'https://dl.zephyrxiang.com/speakmore'
  $Archive = 'speakmore-win32-x64.zip'
  # Electron 44 要 Windows 10 1809（内部版本 17763）以上
  $MinBuild = 17763
  # 解开约 450 MB（下载的包约 150 MB，只在内存里）；升级时旧版本要等新的装好才删
  $NeededMB = 1200

  function Ok($text) { Write-Host "  " -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green -NoNewline; Write-Host " $text" }
  function Warn($text) { Write-Host "  ! " -ForegroundColor Yellow -NoNewline; Write-Host $text }
  function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }
  function Heading($text) { Write-Host ""; Write-Host "  $text" }
  # 说清楚哪里不行、怎么办，然后停下。到这一步为止没有换掉任何已经装好的东西
  function Fail($title) {
    $lines = @($args)
    throw [System.Management.Automation.RuntimeException]::new("SPEAKMORE_INSTALL_FAILED`n$title`n$($lines -join "`n")")
  }
  # 给人看的路径：家目录写成 ~
  function Pretty($path) { if ($path.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { '~' + $path.Substring($HOME.Length) } else { $path } }

  # 跑一个外部程序，交出它的输出（标准错误一起）和退出码。临时放宽：5.1 会把标准错误当成异常；
  # 输出按 UTF-8 读（SpeakMore 写的是 UTF-8，5.1 默认按系统编码读），读完把用户窗口的编码换回去
  function Invoke-Native([string]$file, [string[]]$arguments, [hashtable]$environment = @{}) {
    $saved = @{}
    foreach ($name in $environment.Keys) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $environment[$name]) }
    $previous = $ErrorActionPreference
    $encoding = [Console]::OutputEncoding
    $ErrorActionPreference = 'Continue'
    try {
      [Console]::OutputEncoding = [Text.Encoding]::UTF8
      $output = & $file @arguments 2>&1 | ForEach-Object { "$_" }
      return @{ Output = ($output -join "`n"); Code = $LASTEXITCODE }
    } finally {
      [Console]::OutputEncoding = $encoding
      $ErrorActionPreference = $previous
      foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    }
  }

  # ---------- 预检查 ----------

  function Test-System {
    $build = [Environment]::OSVersion.Version.Build
    if ($build -lt $MinBuild) { Fail "Windows (build $build) is too old" "SpeakMore needs Windows 10 version 1809 or newer, or Windows 11." }
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    switch ($arch) {
      'AMD64' { Ok "Windows (build $build), x64" }
      # Windows on ARM 跑得了 x64 的程序（系统自带的转译），本机转写用不上显卡加速
      'ARM64' { Ok "Windows (build $build), ARM"; Note "SpeakMore is built for x64; it runs here through Windows' x64 emulation." }
      default { Fail "Unsupported processor: $arch" "SpeakMore is built for 64-bit Windows (x64)." }
    }
  }

  # 只让自己（和 SYSTEM）进得去：里面会有录音和 key。和 SpeakMore 自己（src/storage/owner-only.mjs）做的一样
  function Protect-Home($dir) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $result = Invoke-Native 'icacls' @($dir, '/inheritance:r', '/grant:r', "*${sid}:(OI)(CI)F", '*S-1-5-18:(OI)(CI)F')
    if ($result.Code -ne 0) { Fail "Couldn't restrict access to $(Pretty $dir)" $result.Output }
  }

  function Test-Home {
    if (-not [IO.Path]::IsPathRooted($script:HomeDir)) { Fail "SPEAKMORE_HOME must be an absolute path, not $($script:HomeDir)" }
    try { New-Item -ItemType Directory -Force -Path $script:HomeDir | Out-Null } catch {
      Fail "Can't create $(Pretty $script:HomeDir)" "Check its permissions, or pick another place with SPEAKMORE_HOME."
    }
    Protect-Home $script:HomeDir
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($script:HomeDir))
    $freeMB = [int]($drive.AvailableFreeSpace / 1MB)
    if ($freeMB -lt $NeededMB) { Fail "Not enough disk space: $freeMB MB free" "About $NeededMB MB is needed. Free up some space and run again." }
    Ok "Installing to $(Pretty $script:HomeDir) ($([int]($freeMB / 1024)) GB free)"

    # 已经装着的是哪个版本：current 指着的那个；0.9.2 及以前没有 current，程序直接在 app 里
    $script:InstalledVersion = ''
    $manifest = Join-Path $script:HomeDir 'app\package.json'
    if (Test-Path -LiteralPath $script:CurrentFile) {
      $manifest = Join-Path $script:VersionsDir "$((Get-Content -Raw -LiteralPath $script:CurrentFile).Trim())\app\package.json"
    }
    if (Test-Path -LiteralPath $manifest) {
      $script:InstalledVersion = (Get-Content -Raw -Encoding UTF8 $manifest | ConvertFrom-Json).version
      Ok "Found $($script:InstalledVersion): replacing it; settings, keys, history and recordings stay"
    }
  }

  # 取下载地址上的一个文件，整个读进内存（一个 MemoryStream）：不落到磁盘上，就没有临时文件要删。
  # 下载地址可以是本机的一个目录（测试发布包、双击安装程序带着的那一份）
  $script:LocalBase = $false
  function Get-Remote($name, $timeoutSec = 20) {
    if ($script:LocalBase) {
      $source = Join-Path $script:Base $name
      if (-not (Test-Path -LiteralPath $source)) { throw "No such file: $source" }
      return [IO.MemoryStream]::new([IO.File]::ReadAllBytes($source))
    }
    $stream = (Invoke-WebRequest -UseBasicParsing -Uri "$($script:Base)/$name" -TimeoutSec $timeoutSec).RawContentStream
    $stream.Position = 0
    return $stream
  }
  function Get-RemoteText($name) { [Text.Encoding]::UTF8.GetString((Get-Remote $name).ToArray()) }

  # 定下装哪个版本：指定了就用指定的，没指定就问下载地址最新的是哪个
  function Resolve-Version {
    $version = $env:SPEAKMORE_VERSION
    if ($version) {
      if (-not $version.StartsWith('v')) { $version = "v$version" }
    } else {
      try { $version = (Get-RemoteText 'latest').Trim() } catch {
        Fail "Couldn't find the latest version" "URL: $($script:Base)/latest" "Check your network and try again in a bit." "($($_.Exception.Message))"
      }
    }
    # 版本号要拼进下载地址：不像版本号的不往下走（比如问到的其实是一个报错的网页）
    if ($version -notmatch '^v\d+\.\d+\.\d+([-+.][0-9A-Za-z.-]+)?$') {
      if ($env:SPEAKMORE_VERSION) { Fail "SPEAKMORE_VERSION doesn't look like a version: $($env:SPEAKMORE_VERSION)" "Write it like v0.9.0." }
      Fail "The download server returned a bad version number" "URL: $($script:Base)/latest" "Try again in a bit. If it keeps happening, please open an issue at $RepoUrl/issues."
    }
    $script:Version = $version
    Ok "Version $version"
  }

  # ---------- 安装 ----------
  #
  # 每个版本解进 versions 下自己的一个新目录，试过能跑，再把 current 指过去；不挪、不覆盖已有的任何文件。
  # 以前是解到临时目录再挪进 app\、runtime\，有两样东西让"挪"靠不住：
  #   - 刚解出来、刚跑过的文件，杀毒软件（还有索引、备份这类）正在一个个扫，扫的时候开着它又不许别人改名，
  #     挪就报"另一个进程正在使用此文件"（issue #5，真机上占住一个刚解出来的文件就能原样复现）。不挪就碰不上
  #   - 正在跑的 Electron（比如正在跑 speakmore update 的那一份）占着它所在的目录。新版本另放一个目录，旧的原地不动
  # 换下来的旧版本没人用了再删（Remove-Old）；删不掉不影响装好的这一份

  function Get-Package {
    # 包下载进内存，在内存里校验、解开：磁盘上不落临时文件。刚落地的文件杀毒软件要扫，扫的时候删不掉，会留下垃圾
    try {
      $package = Get-Remote "$($script:Version)/$Archive" 1800
      $expected = ((Get-RemoteText "$($script:Version)/$Archive.sha256").Trim() -split '\s+')[0].ToLowerInvariant()
    } catch {
      Fail "Couldn't download the package" "URL: $($script:Base)/$($script:Version)/$Archive" "Check your network. If you set SPEAKMORE_VERSION, make sure that version exists." "($($_.Exception.Message))"
    }
    Ok "Downloaded"

    $actual = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($package) | ForEach-Object { $_.ToString('x2') })
    if (-not $expected -or $expected -ne $actual) {
      Fail "Checksum mismatch: the download differs from the release" "It was probably damaged on the way. Run it again." "Expected $expected" "Got      $actual"
    }
    Ok "Checksum OK"

    # 名字是版本号加这次的编号：重装同一个版本也是一个新目录，碰不到正在用的那一份
    $script:VersionName = "$($script:Version.Substring(1))-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    $script:VersionDir = Join-Path $script:VersionsDir $script:VersionName
    New-Item -ItemType Directory -Force -Path $script:VersionDir | Out-Null
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    try {
      $package.Position = 0
      $archive = [IO.Compression.ZipArchive]::new($package)
      try { [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $script:VersionDir) } finally { $archive.Dispose() }
    } catch { Fail "Couldn't unpack the package" "Run it again." "($($_.Exception.Message))" }
    $script:NewElectron = Join-Path $script:VersionDir 'runtime\electron.exe'
    $script:NewApp = Join-Path $script:VersionDir 'app'
    if (-not (Test-Path (Join-Path $script:NewApp 'bin\speakmore.mjs')) -or -not (Test-Path $script:NewElectron)) {
      Fail "The package is incomplete" "That's a problem with the release. Please open an issue at $RepoUrl/issues."
    }

    # 切过去之前先在原地跑一下：这台机器上跑不起来的话现在就知道，装着的那一份照常用
    $result = Invoke-NewCopy @('--version')
    if ($result.Code -ne 0) { Fail "The downloaded app won't run on this PC" $result.Output "Please open an issue at $RepoUrl/issues with your Windows version." }
    $script:NewVersion = $result.Output.Trim()
    Ok "Unpacked SpeakMore $($script:NewVersion)"
  }

  # 用刚下到的那一份程序跑一条命令。让它说英文：下面要靠它说的话判断停没停
  function Invoke-NewCopy([string[]]$arguments) {
    Invoke-Native $script:NewElectron (@((Join-Path $script:NewApp 'bin\speakmore.mjs')) + $arguments) @{
      SPEAKMORE_HOME = $script:HomeDir; ELECTRON_RUN_AS_NODE = '1'; SPEAKMORE_LANGUAGE = 'en'
    }
  }

  # 启动脚本：照 current 找程序，只用相对它自己的路径（路径里有中文也不用管 cmd 按什么编码读）。内容不随版本变，平常不用改写。
  # 从 0.9.2 及以前升上来时要改写，而那时它可能正跑着（speakmore update 就是它起的）：cmd 等程序退出后，从原来读到的
  # 那个字节位置接着读这个文件。所以新内容不能比旧的长，读到的就是文件末尾（旧的 348 字节）。以后改这几行也守着这条：
  # 不比上一版长（test/install/install-ps1.test.mjs 查）
  $LauncherText = @(
    '@echo off',
    'setlocal',
    'if not defined SPEAKMORE_HOME for %%I in ("%~dp0..") do set "SPEAKMORE_HOME=%%~fI"',
    'set /p SPEAKMORE_CURRENT=<"%~dp0..\current"',
    'set ELECTRON_RUN_AS_NODE=1',
    '"%~dp0..\versions\%SPEAKMORE_CURRENT%\runtime\electron.exe" "%~dp0..\versions\%SPEAKMORE_CURRENT%\app\bin\speakmore.mjs" %*'
  ) -join "`r`n"

  # 切到新版本：停掉正在跑的（它跑的是旧版本），把 current 指过去，再写启动脚本。只写这两个小文件，不挪、不删任何东西
  function Use-Version {
    $result = Invoke-NewCopy @('stop')
    if ($result.Code -ne 0) { Fail "Couldn't stop the running SpeakMore" $result.Output "Quit it first, then install again." }
    if ($result.Output -match 'SpeakMore stopped\.|force-quit') { Ok "Stopped the running SpeakMore"; $script:Stopped = $true }

    try { [IO.File]::WriteAllText($script:CurrentFile, $script:VersionName, [Text.Encoding]::ASCII) } catch {
      $restart = if ($script:Stopped) { "SpeakMore was stopped; run speakmore to start it again." } else { "" }
      Fail "Couldn't switch to the new version" "Another program has $(Pretty $script:CurrentFile) open. Run again in a moment. $restart" "($($_.Exception.Message))"
    }
    $script:Switched = $true

    $binDir = Join-Path $script:HomeDir 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $script:Launcher = Join-Path $binDir 'speakmore.cmd'
    if (-not (Test-Path $script:Launcher) -or (Get-Content -Raw $script:Launcher) -ne "$LauncherText`r`n") {
      [IO.File]::WriteAllText($script:Launcher, "$LauncherText`r`n", [Text.Encoding]::ASCII)
    }
    Ok "Installed to $(Pretty $script:HomeDir)"
  }

  # 等这几个进程退出后把这几个目录删掉：交给一个隐藏的 PowerShell，这个窗口不用等。目录走环境变量传过去，脚本里不拼路径
  function Remove-AfterExit($ids, $dirs) {
    $cleanup = "Wait-Process -Id $(($ids | Sort-Object -Unique) -join ',') -ErrorAction SilentlyContinue`n" +
      "Start-Sleep -Milliseconds 800`n" +
      'foreach ($dir in $env:SPEAKMORE_REMOVE.Split([char]10)) { if ($dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue } }'
    $env:SPEAKMORE_REMOVE = $dirs -join "`n"
    try {
      Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanup)))
    } finally { Remove-Item Env:SPEAKMORE_REMOVE }
  }

  # 换下来的：versions 里别的版本、0.9.2 及以前直接放在家目录里的 app 和 runtime（连同那时换下来的 *.old.*、
  # 装到一半留下的下载临时目录 .install.*）。没有程序在用的现在删；有程序在用的（比如正在跑 speakmore update 的那个旧版本）等那些程序
  # 退出后再删。删不掉的说一声，下次安装时再删
  function Remove-Old {
    $old = @(Get-ChildItem -LiteralPath $script:HomeDir -Directory -Force | Where-Object { $_.Name -match '^(app|runtime)(\.old\..+)?$|^\.install\.' })
    $old += @(Get-ChildItem -LiteralPath $script:VersionsDir -Directory -Force | Where-Object { $_.Name -ne $script:VersionName })
    if ($old.Count -eq 0) { return }
    $running = @(Get-Process | Where-Object { $_.Path })
    $later = @(); $waitFor = @(); $left = @()
    foreach ($dir in $old) {
      $prefix = $dir.FullName.TrimEnd('\') + '\'
      $users = @($running | Where-Object { $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
      if ($users.Count -gt 0) { $later += $dir.FullName; $waitFor += $users.Id; continue }
      Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $dir.FullName) { $left += $dir.FullName }
    }
    if ($later.Count -gt 0) {
      Remove-AfterExit $waitFor $later
      Note "The previous version is still running; it will be removed once it exits."
    }
    if ($left.Count -gt 0) { Note "Another program still has files open in $(($left | ForEach-Object { Pretty $_ }) -join ', '); they'll be removed next time." }
  }

  # 记下在家目录以外动了什么，卸载时照着删（src/cli/commands/uninstall.mjs）
  function Add-Link($line) {
    $file = Join-Path $script:HomeDir 'bin\links'
    $lines = @()
    if (Test-Path $file) { $lines = @(Get-Content -Encoding UTF8 $file) }
    if ($lines -notcontains $line) { Add-Content -Encoding UTF8 -Path $file -Value $line }
  }

  # 用户的 Path 里加上 bin。按原样读写：读的时候不展开 %USERPROFILE% 这种写法，写回去还是可展开的那一种
  function Add-ToPath {
    $binDir = Join-Path $script:HomeDir 'bin'
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $entries = @($raw -split ';' | Where-Object { $_ })
      $present = $entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $binDir.TrimEnd('\') }
      # 默认的位置写成 %USERPROFILE%\.speakmore\bin：换了用户名、挪了用户目录也对
      $entry = $binDir
      if ($binDir -ieq (Join-Path $env:USERPROFILE '.speakmore\bin')) { $entry = '%USERPROFILE%\.speakmore\bin' }
      if (-not $present) {
        $key.SetValue('Path', (($entries + $entry) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # 借设一个环境变量让系统广播一次"环境变了"：之后新开的终端才认新的 Path
        [Environment]::SetEnvironmentVariable('SPEAKMORE_PATH_CHANGED', '1', 'User')
        [Environment]::SetEnvironmentVariable('SPEAKMORE_PATH_CHANGED', $null, 'User')
        Ok "Added $(Pretty $binDir) to your Path"
      } else {
        $entry = $present | Select-Object -First 1
        Ok "$(Pretty $binDir) is on your Path"
      }
      Add-Link "path $entry"
    } finally { $key.Dispose() }
    # 这个窗口里也马上能用
    if (($env:Path -split ';') -notcontains $binDir) { $env:Path = "$env:Path;$binDir" }
  }

  # 开始菜单里的快捷方式：直接起 Electron、把程序目录交给它（和 speakmore 命令起的是同一个，用同一套 key 和设置）
  function Add-Shortcut {
    $programs = [Environment]::GetFolderPath('Programs')
    $link = Join-Path $programs 'SpeakMore.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $script:NewElectron
    $shortcut.Arguments = '"' + $script:NewApp + '"'
    $shortcut.WorkingDirectory = $script:HomeDir
    $shortcut.IconLocation = (Join-Path $script:NewApp 'assets\icon.ico') + ',0'
    $shortcut.Description = 'SpeakMore: press a hotkey, speak, and polished text is pasted in'
    $shortcut.Save()
    Add-Link "shortcut $link"
    Ok "Start menu: SpeakMore"
  }

  # App 设置里开了开机启动的话，Run 里那一项指着旧版本的程序：改指到新版本，写法和 Electron 一样（程序、参数各加引号）。
  # Electron 读回来认开没开只比程序路径；任务管理器里停用与否另记在 StartupApproved 里，这里不动。只认程序在这个家目录里的
  function Update-LoginItem {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $value = (Get-ItemProperty -Path $key -Name 'SpeakMore' -ErrorAction SilentlyContinue).SpeakMore
    if (-not $value) { return }
    $program = if ($value.StartsWith('"')) { $value.Substring(1).Split('"')[0] } else { $value.Split(' ')[0] }
    if (-not $program.StartsWith("$($script:HomeDir.TrimEnd('\'))\", [StringComparison]::OrdinalIgnoreCase)) { return }
    Set-ItemProperty -Path $key -Name 'SpeakMore' -Value ('"{0}" "{1}"' -f $script:NewElectron, $script:NewApp)
    Ok "Start at login: SpeakMore $($script:NewVersion)"
  }

  # ---------- 入口 ----------

  try {
    $script:HomeDir = if ($env:SPEAKMORE_HOME) { $env:SPEAKMORE_HOME } else { Join-Path $env:USERPROFILE '.speakmore' }
    $script:VersionsDir = Join-Path $script:HomeDir 'versions'
    $script:CurrentFile = Join-Path $script:HomeDir 'current'
    # irm | iex 时这些记在用户窗口的全局作用域里：同一个窗口再跑一次，不能接着用上一次的
    $script:VersionDir = $null; $script:Stopped = $false; $script:Switched = $false
    $script:Base = if ($env:SPEAKMORE_INSTALL_BASE) { $env:SPEAKMORE_INSTALL_BASE.TrimEnd('/', '\') } else { $DownloadUrl }
    # 本机的一个目录也可以当下载地址
    $script:LocalBase = $script:Base -notmatch '^[a-z]+://'

    Write-Host ""
    Write-Host "  SpeakMore installer"
    Heading "Checks"
    Test-System
    Test-Home
    Resolve-Version

    Heading "Install"
    Get-Package
    Use-Version
    Add-ToPath
    Add-Shortcut
    Update-LoginItem
    Remove-Old

    Write-Host ""
    if ($script:InstalledVersion -and $script:InstalledVersion -ne $script:NewVersion) {
      Write-Host "  Upgraded: $($script:InstalledVersion) -> $($script:NewVersion)"
    } else {
      Write-Host "  Installed SpeakMore $($script:NewVersion)"
    }
    Note "To remove it: speakmore uninstall deletes all of $(Pretty $script:HomeDir)."

    if ($env:SPEAKMORE_NO_START -ne '1' -and [Environment]::UserInteractive) {
      Write-Host ""
      & $script:Launcher
    } else {
      Write-Host ""
      Write-Host "  Run speakmore in a new terminal to start, or open SpeakMore from the Start menu."
      Write-Host ""
    }
  } catch {
    # 还没切过去的话，解了一半（或者跑不起来）的新版本没人会用，删掉；删不掉的下次安装时删
    if (-not $script:Switched -and $script:VersionDir -and (Test-Path -LiteralPath $script:VersionDir)) {
      Remove-Item -LiteralPath $script:VersionDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    $message = $_.Exception.Message
    if ($message.StartsWith('SPEAKMORE_INSTALL_FAILED')) {
      $lines = $message.Split("`n") | Select-Object -Skip 1 | Where-Object { $_ }
      Write-Host ""
      Write-Host "  x " -ForegroundColor Red -NoNewline
      Write-Host ($lines | Select-Object -First 1)
      $lines | Select-Object -Skip 1 | ForEach-Object { Write-Host "    $_" }
      Write-Host ""
      if (-not $script:Switched) { Write-Host "  Nothing was installed; what you had is untouched." }
    } else {
      Write-Host ""
      Write-Host "  x Something went wrong: $message" -ForegroundColor Red
      Write-Host "    $($_.InvocationInfo.PositionMessage)"
      Write-Host "    Please open an issue at $RepoUrl/issues with the text above."
    }
    # 给调用的人（speakmore update）一个非零的结果，但不 exit：那会关掉用户的窗口
    $global:LASTEXITCODE = 1
  }
}
