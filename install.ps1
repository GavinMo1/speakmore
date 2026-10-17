# SpeakMore 的 Windows 安装脚本：检查环境、下载、校验、装进 %USERPROFILE%\.speakmore，然后启动。
#
#   irm https://dl.zephyrxiang.com/speakmore/install.ps1 | iex
#
# 和 install.sh 是同一件事、同一种摆法：程序、运行环境，以及之后的设置、key、历史和录音全在 .speakmore 这一个目录里。
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
  # 下载的包约 150 MB，解开约 450 MB；升级时旧的要等新的放好才删
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

    $script:InstalledVersion = ''
    $manifest = Join-Path $script:HomeDir 'app\package.json'
    if (Test-Path $manifest) {
      $script:InstalledVersion = (Get-Content -Raw -Encoding UTF8 $manifest | ConvertFrom-Json).version
      Ok "Found $($script:InstalledVersion): replacing it; settings, keys, history and recordings stay"
    }
  }

  # 下载地址可以是本机的一个目录（测试发布包时用）
  $script:LocalBase = $false
  function Get-Remote($name, $destination) {
    if ($script:LocalBase) {
      $source = Join-Path $script:Base $name
      if (-not (Test-Path $source)) { throw "No such file: $source" }
      if ($destination) { Copy-Item -LiteralPath $source -Destination $destination; return }
      return [IO.File]::ReadAllText($source)
    }
    $url = "$($script:Base)/$name"
    if ($destination) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination -TimeoutSec 1800; return }
    return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 20).Content
  }

  # 定下装哪个版本：指定了就用指定的，没指定就问下载地址最新的是哪个
  function Resolve-Version {
    $version = $env:SPEAKMORE_VERSION
    if ($version) {
      if (-not $version.StartsWith('v')) { $version = "v$version" }
    } else {
      try { $version = ([string](Get-Remote 'latest')).Trim() } catch {
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

  function Get-Package {
    $script:TmpDir = Join-Path $script:HomeDir ".install.$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path $script:TmpDir | Out-Null
    $zip = Join-Path $script:TmpDir $Archive
    try {
      Get-Remote "$($script:Version)/$Archive" $zip
      Get-Remote "$($script:Version)/$Archive.sha256" "$zip.sha256"
    } catch {
      Fail "Couldn't download the package" "URL: $($script:Base)/$($script:Version)/$Archive" "Check your network. If you set SPEAKMORE_VERSION, make sure that version exists." "($($_.Exception.Message))"
    }
    Ok "Downloaded"

    $expected = ((Get-Content -Raw "$zip.sha256").Trim() -split '\s+')[0].ToLowerInvariant()
    $stream = [IO.File]::OpenRead($zip)
    try { $actual = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) } finally { $stream.Dispose() }
    if (-not $expected -or $expected -ne $actual) {
      Fail "Checksum mismatch: the download differs from the release" "It was probably damaged on the way. Run it again." "Expected $expected" "Got      $actual"
    }
    Ok "Checksum OK"

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try { [IO.Compression.ZipFile]::ExtractToDirectory($zip, $script:TmpDir) } catch { Fail "Couldn't unpack the package" "Run it again." "($($_.Exception.Message))" }
    Remove-Item -LiteralPath $zip, "$zip.sha256"
    $script:NewElectron = Join-Path $script:TmpDir 'runtime\electron.exe'
    if (-not (Test-Path (Join-Path $script:TmpDir 'app\bin\speakmore.mjs')) -or -not (Test-Path $script:NewElectron)) {
      Fail "The package is incomplete" "That's a problem with the release. Please open an issue at $RepoUrl/issues."
    }

    # 换掉旧的之前先在原地跑一下：这台机器上跑不起来的话现在就知道，不至于换完才发现
    $result = Invoke-NewCopy @('--version')
    if ($result.Code -ne 0) { Fail "The downloaded app won't run on this PC" $result.Output "Please open an issue at $RepoUrl/issues with your Windows version." }
    $script:NewVersion = $result.Output.Trim()
    Ok "Unpacked SpeakMore $($script:NewVersion)"
  }

  # 用刚下到的那一份程序跑一条命令。让它说英文：下面要靠它说的话判断停没停
  function Invoke-NewCopy([string[]]$arguments) {
    Invoke-Native $script:NewElectron (@((Join-Path $script:TmpDir 'app\bin\speakmore.mjs')) + $arguments) @{
      SPEAKMORE_HOME = $script:HomeDir; ELECTRON_RUN_AS_NODE = '1'; SPEAKMORE_LANGUAGE = 'en'
    }
  }

  # 把程序和运行环境换成刚下到的。正在跑的 exe 删不掉、但所在的目录改得了名：旧的先改名挪开，新的放进来，
  # 旧的删得掉就删，删不掉（比如正在跑的 speakmore update 自己）留着，下次安装时再删。中途出错就把原来的放回去
  function Install-Files {
    $result = Invoke-NewCopy @('stop')
    if ($result.Code -ne 0) { Fail "Couldn't stop the running SpeakMore" $result.Output "Quit it first, then install again." }
    if ($result.Output -match 'SpeakMore stopped\.|force-quit') { Ok "Stopped the running SpeakMore" }

    $names = @('app', 'runtime')
    foreach ($name in $names) {
      $current = Join-Path $script:HomeDir $name
      Get-ChildItem -LiteralPath $script:HomeDir -Directory -Filter "$name.old*" -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path $current) {
        try { Rename-Item -LiteralPath $current -NewName "$name.old.$([guid]::NewGuid().ToString('N').Substring(0, 8))" } catch {
          Fail "Can't move $(Pretty $current)" "Close any window that has a file in it open, then run again." "($($_.Exception.Message))"
        }
      }
    }
    try {
      foreach ($name in $names) { Move-Item -LiteralPath (Join-Path $script:TmpDir $name) -Destination (Join-Path $script:HomeDir $name) }
    } catch {
      foreach ($name in $names) {
        $old = Get-ChildItem -LiteralPath $script:HomeDir -Directory -Filter "$name.old.*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($old) {
          Remove-Item -LiteralPath (Join-Path $script:HomeDir $name) -Recurse -Force -ErrorAction SilentlyContinue
          Rename-Item -LiteralPath $old.FullName -NewName $name
        }
      }
      Fail "Couldn't put the new version into $(Pretty $script:HomeDir)" "Check the folder's permissions. SpeakMore was stopped; run speakmore to start it again." "($($_.Exception.Message))"
    }
    $left = $false
    foreach ($name in $names) {
      Get-ChildItem -LiteralPath $script:HomeDir -Directory -Filter "$name.old.*" | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $_.FullName) { $left = $true }
      }
    }
    if ($left) { Note "The previous version is still in use; it will be removed the next time you install or update." }

    $binDir = Join-Path $script:HomeDir 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    # 启动脚本只用相对它自己的路径：内容永远一样（升级时不用改写一个正在跑的批处理文件），路径里有中文也不用管 cmd 按什么编码读
    $launcher = @(
      '@echo off',
      'rem The speakmore command, generated by the SpeakMore installer.',
      'rem Runs on the bundled Electron as Node, so Node does not need to be installed.',
      'setlocal',
      'if not defined SPEAKMORE_HOME for %%I in ("%~dp0..") do set "SPEAKMORE_HOME=%%~fI"',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%~dp0..\runtime\electron.exe" "%~dp0..\app\bin\speakmore.mjs" %*'
    ) -join "`r`n"
    $script:Launcher = Join-Path $binDir 'speakmore.cmd'
    if (-not (Test-Path $script:Launcher) -or (Get-Content -Raw $script:Launcher) -ne "$launcher`r`n") {
      [IO.File]::WriteAllText($script:Launcher, "$launcher`r`n", [Text.Encoding]::ASCII)
    }
    Ok "Installed to $(Pretty $script:HomeDir)"
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
    $shortcut.TargetPath = Join-Path $script:HomeDir 'runtime\electron.exe'
    $shortcut.Arguments = '"' + (Join-Path $script:HomeDir 'app') + '"'
    $shortcut.WorkingDirectory = $script:HomeDir
    $shortcut.IconLocation = (Join-Path $script:HomeDir 'app\assets\icon.ico') + ',0'
    $shortcut.Description = 'SpeakMore: press a hotkey, speak, and polished text is pasted in'
    $shortcut.Save()
    Add-Link "shortcut $link"
    Ok "Start menu: SpeakMore"
  }

  function Remove-Tmp { if ($script:TmpDir -and (Test-Path $script:TmpDir)) { Remove-Item -LiteralPath $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue } }

  # ---------- 入口 ----------

  try {
    $script:HomeDir = if ($env:SPEAKMORE_HOME) { $env:SPEAKMORE_HOME } else { Join-Path $env:USERPROFILE '.speakmore' }
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
    Install-Files
    Add-ToPath
    Add-Shortcut
    Remove-Tmp

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
    Remove-Tmp
    $message = $_.Exception.Message
    if ($message.StartsWith('SPEAKMORE_INSTALL_FAILED')) {
      $lines = $message.Split("`n") | Select-Object -Skip 1 | Where-Object { $_ }
      Write-Host ""
      Write-Host "  x " -ForegroundColor Red -NoNewline
      Write-Host ($lines | Select-Object -First 1)
      $lines | Select-Object -Skip 1 | ForEach-Object { Write-Host "    $_" }
      Write-Host ""
      Write-Host "  Nothing was installed; what you had is untouched."
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
