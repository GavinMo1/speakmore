import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 命令行在 Windows 上要动系统的那几处：install.ps1 在家目录以外留下的（用户 Path 里的一项、开始菜单的快捷方式）、
// App 里开过的开机启动，卸载时照着删；还有删不掉正在跑的程序这件事。都经 PowerShell 做，要用的值走环境变量，
// 脚本里不拼外来的字。macOS 上用不到这里。

/** 跑一段 PowerShell，交出它的标准输出 */
function powershell(script, env = {}) {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

/**
 * 从用户的 Path 里删掉这一项（install.ps1 加的那一项，原样记在 bin\links 里）。按原样读写：读的时候不展开
 * %USERPROFILE% 这种写法，写回去还是可展开的那一种；改完借设一个环境变量让系统广播一次
 * @returns {boolean} 本来有没有
 */
export function removePathEntry(entry) {
  const output = powershell(
    `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
     $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
     $entries = @($raw -split ';' | Where-Object { $_ })
     $kept = @($entries | Where-Object { $_ -ine $env:SPEAKMORE_PATH_ENTRY })
     if ($kept.Count -ne $entries.Count) {
       $key.SetValue('Path', ($kept -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
       [Environment]::SetEnvironmentVariable('SPEAKMORE_PATH_CHANGED', '1', 'User')
       [Environment]::SetEnvironmentVariable('SPEAKMORE_PATH_CHANGED', $null, 'User')
       'removed'
     }
     $key.Dispose()`,
    { SPEAKMORE_PATH_ENTRY: entry },
  );
  return output.trim() === "removed";
}

/**
 * 这个快捷方式是不是指着这个家目录里的程序。清单里记的东西卸载前要再认一遍：那个位置上可能已经换成了别的。
 * 快捷方式文件里存着目标的路径（UTF-16 和本地编码各一份，哪份都可能在），找得到家目录就算
 */
export function isOurShortcut(file, home, read = readFileSync) {
  let bytes;
  try {
    bytes = read(file);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const wanted = `${home}\\runtime\\`.toLowerCase();
  return [bytes.toString("utf16le"), bytes.toString("latin1")].some((text) => text.toLowerCase().includes(wanted));
}

const RUN_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
];

/**
 * 去掉开机启动（App 设置里开的，Electron 记在注册表的 Run 里，名字是 SpeakMore）。只删指着这个家目录的那一条
 * @returns {boolean} 本来有没有
 */
export function removeLoginItem(home) {
  const output = powershell(
    `$run = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'SpeakMore' -ErrorAction SilentlyContinue
     if ($run -and $run.SpeakMore -like "*$env:SPEAKMORE_HOME_DIR\\runtime\\*") {
       foreach ($key in $env:SPEAKMORE_RUN_KEYS.Split([char]10)) { & reg.exe delete $key /v SpeakMore /f 2>&1 | Out-Null }
       'removed'
     }`,
    { SPEAKMORE_HOME_DIR: home, SPEAKMORE_RUN_KEYS: RUN_KEYS.join("\n") },
  );
  return output.trim() === "removed";
}

/**
 * 等这个进程退出之后再把这几个目录删掉。Windows 上正在跑的程序删不掉，而卸载、升级时正在跑的就是这条命令自己
 * （装好的那份 Electron）：交给一个隐藏的 PowerShell，等它退出、稍等一下再删，不留窗口。
 * 要隔一层起：Node 在 Windows 上把直接起的子进程放进一个"自己退出就全部结束"的作业对象，这条命令一退出它就没了；
 * 加 detached 能躲开，可那样起的 PowerShell 没有控制台，一行都不跑就以 0 退出（真机上都试过）。
 * 所以先同步跑一个 PowerShell，由它 Start-Process 干活的那个：孙进程不在那个作业对象里
 */
export function removeAfterExit(dirs, pid = process.pid) {
  const cleanup = `Wait-Process -Id $env:SPEAKMORE_WAIT_PID -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
foreach ($dir in $env:SPEAKMORE_REMOVE.Split([char]10)) { if ($dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue } }`;
  powershell(
    "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$env:SPEAKMORE_CLEANUP",
    {
      SPEAKMORE_WAIT_PID: String(pid),
      SPEAKMORE_REMOVE: dirs.join("\n"),
      SPEAKMORE_CLEANUP: Buffer.from(cleanup, "utf16le").toString("base64"),
    },
  );
}
