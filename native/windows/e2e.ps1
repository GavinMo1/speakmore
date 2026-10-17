# Windows 小帮手的真机检查：在桌面会话里起 key-helper.exe，用 SendInput 模拟按键和点击，看它报的事件对不对，
# 再往记事本里贴一段字、读回来对一遍。要在有人登录的桌面上跑（scripts/dev/win-desktop.sh - < 这个文件）。
# 会弹出一个记事本窗口、往里贴字，跑完自己关掉；剪贴板里原来的东西跑完还在。
# 读回记事本里的字靠全选、复制（Ctrl 组合键不经过输入法）；不模拟敲字母：中文系统默认开着拼音，字母会进候选框。
# 没查的：右 Alt 单按之后菜单栏会不会被叫出来（新版记事本不是老式菜单，查不了），要人在 Office 这类应用里试一下。
$ErrorActionPreference = 'Stop'
$repo = "$HOME\speakmore-dev\repo"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Fake {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYBDINPUT k; [FieldOffset(0)] public MOUSEINPUT m; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  // 钩子报的是物理像素；不声明的话这个进程看到的屏幕尺寸是按缩放换算过的，两边对不上
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Key(ushort vk, bool down) {
    var input = new INPUT { type = 1 };
    input.u.k = new KEYBDINPUT { vk = vk, flags = down ? 0u : 2u };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  // 屏幕物理像素 → SendInput 的绝对坐标（0..65535），按主屏
  public static void Click(int x, int y, bool down) {
    var input = new INPUT { type = 0 };
    int dx = x * 65535 / (GetSystemMetrics(0) - 1), dy = y * 65535 / (GetSystemMetrics(1) - 1);
    input.u.m = new MOUSEINPUT { dx = dx, dy = dy, flags = 0x8001u | (down ? 0x2u : 0x4u) };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

[Fake]::SetProcessDPIAware() | Out-Null
$results = [System.Collections.Generic.List[string]]::new()
function Check($name, $ok, $detail) {
  $results.Add(("{0} {1}{2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $(if ($detail) { " — $detail" } else { '' })))
}

function Start-Helper($key) {
  $info = [System.Diagnostics.ProcessStartInfo]::new("$repo\build\key-helper.exe", "--key $key")
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.StandardOutputEncoding = [Text.Encoding]::UTF8
  $process = [System.Diagnostics.Process]::Start($info)
  $queue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
  $reader = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -MessageData $queue -Action {
    if ($EventArgs.Data) { $Event.MessageData.Enqueue($EventArgs.Data) }
  }
  $process.BeginOutputReadLine()
  [pscustomobject]@{ Process = $process; Queue = $queue; Reader = $reader }
}

# 等下一条事件（JSON 解好），等不到是 $null
function Next-Event($helper, $ms = 1500) {
  $deadline = (Get-Date).AddMilliseconds($ms)
  $line = $null
  while ((Get-Date) -lt $deadline) {
    if ($helper.Queue.TryDequeue([ref]$line)) { return $line | ConvertFrom-Json }
    Start-Sleep -Milliseconds 20
  }
  return $null
}
function Drain($helper) { $line = $null; while ($helper.Queue.TryDequeue([ref]$line)) {} }
# 按 UTF-8 写：5.1 的 StandardInput 用的是系统编码（中文系统是 GBK），父进程（Node）写的是 UTF-8
function Send($helper, $object) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($object | ConvertTo-Json -Compress -Depth 5) + "`n")
  $helper.Process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $helper.Process.StandardInput.BaseStream.Flush()
}

$VK_RCONTROL = 0xA3; $VK_RMENU = 0xA5; $VK_ESCAPE = 0x1B; $VK_A = 0x41; $VK_CONTROL = 0x11

$saved = Get-Clipboard -Raw
$helper = Start-Helper 'right_ctrl'
try {
  $ready = Next-Event $helper 3000
  Check '启动报 ready，钩子装上了' ($ready.event -eq 'ready' -and $ready.listen -and $ready.capture) ($ready | ConvertTo-Json -Compress)

  # 热键按下、松开；按住时系统的自动重复不另报
  [Fake]::Key($VK_RCONTROL, $true); Start-Sleep -Milliseconds 50; [Fake]::Key($VK_RCONTROL, $true)
  $down = Next-Event $helper
  [Fake]::Key($VK_RCONTROL, $false)
  $up = Next-Event $helper
  Check '热键按下、松开各报一次' ($down.event -eq 'hotkey' -and $down.down -eq $true -and $up.event -eq 'hotkey' -and $up.down -eq $false) "$($down | ConvertTo-Json -Compress) $($up | ConvertTo-Json -Compress)"
  Check '自动重复不另报' ($null -eq (Next-Event $helper 300))

  # 按住热键再按别的键：报一次 other_key，不说是哪个键
  [Fake]::Key($VK_RCONTROL, $true); $null = Next-Event $helper
  [Fake]::Key($VK_A, $true); [Fake]::Key($VK_A, $false); [Fake]::Key($VK_A, $true); [Fake]::Key($VK_A, $false)
  $other = Next-Event $helper
  [Fake]::Key($VK_RCONTROL, $false); $null = Next-Event $helper
  Check '组合键报一次 other_key' ($other.event -eq 'other_key' -and @($other.PSObject.Properties).Count -eq 1) ($other | ConvertTo-Json -Compress)
  Drain $helper

  # 截住 esc 和一块区域里的点击
  $width = [Fake]::GetSystemMetrics(0); $height = [Fake]::GetSystemMetrics(1)
  $x = [int]($width / 2); $y = [int]($height - 60)
  $results.Add("INFO 主屏 ${width}x${height}（物理像素），点在 ($x, $y)")
  Send $helper @{ cmd = 'capture'; regions = @(@{ id = 'done'; x = $x - 20; y = $y - 20; width = 40; height = 40 }) }
  Start-Sleep -Milliseconds 200
  [Fake]::Key($VK_ESCAPE, $true); [Fake]::Key($VK_ESCAPE, $false)
  $escape = Next-Event $helper
  Check '截着时按 esc 报 escape' ($escape.event -eq 'escape') ($escape | ConvertTo-Json -Compress)
  [Fake]::Click($x, $y, $true); Start-Sleep -Milliseconds 50; [Fake]::Click($x, $y, $false)
  $click = Next-Event $helper
  Check '截着时点那一块报 click' ($click.event -eq 'click' -and $click.id -eq 'done') ($click | ConvertTo-Json -Compress)
  Send $helper @{ cmd = 'release' }
  Start-Sleep -Milliseconds 200
  [Fake]::Key($VK_ESCAPE, $true); [Fake]::Key($VK_ESCAPE, $false)
  [Fake]::Click($x, $y, $true); [Fake]::Click($x, $y, $false)
  Check '不截了之后 esc 和点击都不报' ($null -eq (Next-Event $helper 400))

  # 往记事本里贴一段字：中英混排、带换行和表情
  $text = "SpeakMore 真机检查：你好，world。`r`n第二行 🎙"
  # Win11 的记事本：起来的那个进程会把活交给另一个进程再退出，按名字找最新开的、有窗口的那个
  $startedAt = Get-Date
  Start-Process notepad
  $window = 0
  for ($i = 0; $i -lt 30 -and $window -eq 0; $i++) {
    Start-Sleep -Milliseconds 200
    $notepad = Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($notepad) { $window = $notepad.MainWindowHandle }
  }
  Check '记事本开起来了' ($window -ne 0) ''
  Start-Sleep -Milliseconds 800
  [Fake]::SetForegroundWindow($window) | Out-Null
  Start-Sleep -Milliseconds 500
  # Win11 的记事本会把上次没存的内容恢复出来：先清空
  [Fake]::Key($VK_CONTROL, $true); [Fake]::Key($VK_A, $true); [Fake]::Key($VK_A, $false); [Fake]::Key($VK_CONTROL, $false)
  [Fake]::Key(0x2E, $true); [Fake]::Key(0x2E, $false)
  Start-Sleep -Milliseconds 300
  Set-Clipboard -Value '贴之前用户复制的字'
  Send $helper @{ cmd = 'paste'; id = 1; text = $text }
  $pasted = Next-Event $helper 3000
  Check '贴完报 pasted ok' ($pasted.event -eq 'pasted' -and $pasted.id -eq 1 -and $pasted.ok) ($pasted | ConvertTo-Json -Compress)
  Check '贴完剪贴板还是原来的' ((Get-Clipboard -Raw) -eq '贴之前用户复制的字') (Get-Clipboard -Raw)
  # 全选、复制，读回记事本里的字
  [Fake]::Key($VK_CONTROL, $true); [Fake]::Key($VK_A, $true); [Fake]::Key($VK_A, $false); [Fake]::Key(0x43, $true); [Fake]::Key(0x43, $false); [Fake]::Key($VK_CONTROL, $false)
  Start-Sleep -Milliseconds 400
  $inNotepad = Get-Clipboard -Raw
  Check '记事本里是贴进去的那段字' ($inNotepad -eq $text) ($inNotepad)

} finally {
  $helper.Process.StandardInput.Close()
  if (-not $helper.Process.WaitForExit(2000)) { $helper.Process.Kill() }
  Check '关掉标准输入后自己退出' ($helper.Process.HasExited) ''
  Unregister-Event -SourceIdentifier $helper.Reader.Name -ErrorAction SilentlyContinue
  # 只关这次开的（不碰用户自己开着的记事本）
  if ($startedAt) { Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $startedAt } | Stop-Process -Force -ErrorAction SilentlyContinue }
  if ($null -ne $saved) { Set-Clipboard -Value $saved }
}
$results
$checks = @($results | Where-Object { $_ -notlike 'INFO*' })
"{0}/{1} 通过" -f @($checks | Where-Object { $_ -like 'PASS*' }).Count, $checks.Count
