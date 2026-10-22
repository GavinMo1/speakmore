# Windows 小帮手的真机检查：在桌面会话里起 key-helper.exe，用 bind 下发热键，用 SendInput 模拟按键和点击，
# 看它报的事件对不对，再往记事本里贴一段字、读回来对一遍。要在有人登录的桌面上跑（scripts/dev/win-desktop.sh - < 这个文件）。
# 会弹出一个记事本窗口、往里贴字，跑完自己关掉；剪贴板里原来的东西跑完还在。
# 读回记事本里的字靠全选、复制（Ctrl 组合键不经过输入法）；不模拟敲字母：中文系统默认开着拼音，字母会进候选框。
# 热键只用右 Ctrl、F13、esc：单按它们哪个应用都不会有反应；不碰 Win（会开开始菜单）。Alt 只在记事本里查菜单栏时按：
# 那几下要的就是看它叫不叫出菜单栏。
# 按键分三种模拟法各来一遍（docs/hotkey-research.md 4.2）：只给扫描码（KEYEVENTF_SCANCODE，最像真键盘）、
# 只给 vk（别的工具常这么发，扫描码是 0）、两个都给。
# 录键（record）、查组合有没有被占（probe）、info 也各查一遍：录键只按右 Ctrl、F13，录到的键整段吞掉，前台应用收不到。
# 录键里有一段要等 30 秒（查到点自己停），整个脚本要多跑半分钟：win-desktop.sh 默认只等 60 秒，
# 跑的时候写 WAIT=120 scripts/dev/win-desktop.sh - < 这个文件。
# 菜单栏叫没叫出来看 UI Automation 报的焦点：Win11 的记事本选中菜单栏时焦点在"文件"那个菜单项上（10-22 实测）。
# 没查的：Office 这类应用、开始菜单（Win 键）。
$ErrorActionPreference = 'Stop'
$repo = "$HOME\speakmore-dev\repo"

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
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
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  // 系统认为这个键按着没有。低级钩子吞掉的按下系统不记（所有钩子都放行了才更新），拿它看录到的键吞没吞
  public static bool KeyDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  // 钩子报的是物理像素；不声明的话这个进程看到的屏幕尺寸是按缩放换算过的，两边对不上
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // mode：scan 只给扫描码（KEYEVENTF_SCANCODE，系统自己换出 vk）；vk 只给 vk（扫描码 0）；both 两个都给（系统照 vk 走）。
  // 扩展键（右 Ctrl、Delete）带 KEYEVENTF_EXTENDEDKEY，钩子才报 LLKHF_EXTENDED
  public static void Key(ushort vk, ushort scan, bool extended, bool down, string mode) {
    var input = new INPUT { type = 1 };
    uint flags = (extended ? 1u : 0u) | (down ? 0u : 2u);
    if (mode == "scan") { flags |= 8u; vk = 0; }
    if (mode == "vk") scan = 0;
    input.u.k = new KEYBDINPUT { vk = vk, scan = scan, flags = flags };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  // 小帮手的输出由一条后台线程按行读进队列：PowerShell 的 OutputDataReceived 事件回调在一阵连发里会乱序
  // （升级时紧挨着的"打断""按下"两行实测颠倒过），这里要的是先来后到
  public static System.Collections.Concurrent.ConcurrentQueue<string> ReadLines(System.IO.StreamReader reader) {
    var queue = new System.Collections.Concurrent.ConcurrentQueue<string>();
    var thread = new System.Threading.Thread(() => { string line; while ((line = reader.ReadLine()) != null) if (line.Length > 0) queue.Enqueue(line); });
    thread.IsBackground = true;
    thread.Start();
    return queue;
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

function Start-Helper {
  $info = [System.Diagnostics.ProcessStartInfo]::new("$repo\build\key-helper.exe")
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.StandardOutputEncoding = [Text.Encoding]::UTF8
  $process = [System.Diagnostics.Process]::Start($info)
  [pscustomobject]@{ Process = $process; Queue = [Fake]::ReadLines($process.StandardOutput) }
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

# 每个键：vk、扫描码、是不是扩展键
$RCtrl = 0xA3, 0x1D, $true; $Esc = 0x1B, 0x01, $false; $KeyA = 0x41, 0x1E, $false; $KeyC = 0x43, 0x2E, $false
$Ctrl = 0x11, 0x1D, $false; $Delete = 0x2E, 0x53, $true; $F13 = 0x7C, 0x64, $false; $F14 = 0x7D, 0x65, $false
$LAlt = 0xA4, 0x38, $false; $RAlt = 0xA5, 0x38, $true; $Space = 0x20, 0x39, $false
# 不分左右的 VK_CONTROL 加扩展位：有的工具这样模拟右 Ctrl，小帮手要自己分出是右边
$GenericRCtrl = 0x11, 0x1D, $true
function Press($key, $down, $mode = 'both') { [Fake]::Key($key[0], $key[1], $key[2], $down, $mode) }
# 录键报的集合是不是这几个：mods、keys 都要有，空的也是 []
function Is-Recording($e, $mods, $keys) {
  $e.event -eq 'recording' -and $e.on -eq $true -and $null -ne $e.mods -and $null -ne $e.keys -and
    (@($e.mods) -join ',') -eq ($mods -join ',') -and (@($e.keys) -join ',') -eq ($keys -join ',')
}
function Show($events) { ($events | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ' ' }

$saved = Get-Clipboard -Raw
$helper = Start-Helper
try {
  $ready = Next-Event $helper 3000
  Check '启动报 ready，钩子装上了' ($ready.event -eq 'ready' -and $ready.listen -and $ready.capture) ($ready | ConvertTo-Json -Compress)
  # 锁屏解锁、睡眠唤醒、前台窗口三样通知登记不上会报 error（前台恰好是管理员窗口时会报 elevated_foreground）
  $extra = Next-Event $helper 500
  Check '系统通知都登记上了，没报别的' ($null -eq $extra) ($extra | ConvertTo-Json -Compress)

  # 热键由父进程下发：右 Ctrl 当听写，右 Ctrl+F13（扫描码 0x64）当另一个动作，esc（扫描码 1）当截着时的取消
  Send $helper @{ cmd = 'bind'; bindings = @(
      @{ id = 'dictate#0'; mods = @(0xA3); when = 'always' },
      @{ id = 'x#0'; mods = @(0xA3); key = 0x64; when = 'always' },
      @{ id = 'cancel#0'; mods = @(); key = 1; when = 'capturing' }) }
  $bound = Next-Event $helper
  Check 'bind 都装上了' ($bound.event -eq 'bound' -and $null -ne $bound.rejected -and @($bound.rejected).Count -eq 0) ($bound | ConvertTo-Json -Compress)

  # 热键按下、松开；按住时系统的自动重复不另报
  Press $RCtrl $true 'scan'; Start-Sleep -Milliseconds 50; Press $RCtrl $true 'scan'
  $down = Next-Event $helper
  Press $RCtrl $false 'scan'
  $up = Next-Event $helper
  Check '热键按下、松开各报一次' ($down.event -eq 'binding' -and $down.id -eq 'dictate#0' -and $down.down -eq $true -and $up.event -eq 'binding' -and $up.id -eq 'dictate#0' -and $up.down -eq $false) "$($down | ConvertTo-Json -Compress) $($up | ConvertTo-Json -Compress)"
  Check '自动重复不另报' ($null -eq (Next-Event $helper 300))

  # 右 Ctrl 按着再按 F13：升级成 x#0（先报打断带 to，再报 x#0 按下），松开右 Ctrl 报 x#0 松开。三种模拟法各一遍
  foreach ($mode in 'scan', 'vk', 'both') {
    Press $RCtrl $true $mode; $first = Next-Event $helper
    Press $F13 $true $mode; $upgrade = Next-Event $helper; $chord = Next-Event $helper
    Press $F13 $false $mode; Press $RCtrl $false $mode; $chordUp = Next-Event $helper
    $seen = @($first, $upgrade, $chord, $chordUp) | ForEach-Object { $_ | ConvertTo-Json -Compress }
    Check "右 Ctrl+F13 升级（$mode）" ($first.id -eq 'dictate#0' -and $first.down -eq $true -and $upgrade.event -eq 'interrupted' -and $upgrade.to -eq 'x#0' -and $chord.id -eq 'x#0' -and $chord.down -eq $true -and $chordUp.id -eq 'x#0' -and $chordUp.down -eq $false) ($seen -join ' ')
    Check "F13 的松开不另报（$mode）" ($null -eq (Next-Event $helper 300))
  }

  # 不分左右的 VK_CONTROL 加扩展位：认成右 Ctrl
  Press $GenericRCtrl $true 'vk'; $down = Next-Event $helper
  Press $GenericRCtrl $false 'vk'; $up = Next-Event $helper
  Check '不分左右的 VK_CONTROL 加扩展位认成右 Ctrl' ($down.id -eq 'dictate#0' -and $down.down -eq $true -and $up.id -eq 'dictate#0' -and $up.down -eq $false) "$($down | ConvertTo-Json -Compress) $($up | ConvertTo-Json -Compress)"

  # 按住热键再按别的键：报一次 interrupted，不说是哪个键；被打断的松开不报
  Press $RCtrl $true 'scan'; $null = Next-Event $helper
  # 别的键用 F14：右 Ctrl+A 会在前台应用里全选
  Press $F14 $true 'scan'; Press $F14 $false 'scan'; Press $F14 $true 'scan'; Press $F14 $false 'scan'
  $other = Next-Event $helper
  Press $RCtrl $false 'scan'
  Check '组合键报一次 interrupted' ($other.event -eq 'interrupted' -and $other.id -eq 'dictate#0' -and @($other.PSObject.Properties).Count -eq 2) ($other | ConvertTo-Json -Compress)
  Check '被打断以后松开不报' ($null -eq (Next-Event $helper 300))
  Drain $helper

  # 录键（docs/hotkey-research.md 5.6）。热键还是上面那三个：录键期间右 Ctrl、右 Ctrl+F13 都不该认。
  # 对照：没在录时右 Ctrl 不吞（修饰键从来不吞），系统看得到它按下；看不到的话，下面"吞掉了"那条也不作数
  Press $RCtrl $true 'scan'; $null = Next-Event $helper; Start-Sleep -Milliseconds 100
  $seenOutside = [Fake]::KeyDown(0xA3)
  Press $RCtrl $false 'scan'; $null = Next-Event $helper
  Check '对照：没在录时右 Ctrl 按下，系统看得到' $seenOutside ''

  Send $helper @{ cmd = 'record'; on = $true }
  $entered = Next-Event $helper
  Check '进入录键报一次空的集合' (Is-Recording $entered @() @()) (Show $entered)
  Press $RCtrl $true 'scan'; $s1 = Next-Event $helper
  Start-Sleep -Milliseconds 100; $seenInside = [Fake]::KeyDown(0xA3)
  Press $F13 $true 'scan'; $s2 = Next-Event $helper
  Press $F13 $true 'scan'   # 自动重复：不改集合，不另报
  Press $F13 $false 'scan'; $s3 = Next-Event $helper
  Press $RCtrl $false 'scan'; $s4 = Next-Event $helper
  Check '按右 Ctrl+F13 集合变两次、松开再变两次，热键不认' ((Is-Recording $s1 @(0xA3) @()) -and (Is-Recording $s2 @(0xA3) @(0x64)) -and (Is-Recording $s3 @(0xA3) @()) -and (Is-Recording $s4 @() @())) (Show @($s1, $s2, $s3, $s4))
  Check '录到的右 Ctrl 吞掉了，系统没看到它按下' (-not $seenInside) ''
  $extra = Next-Event $helper 300
  Check '录键期间没有多报（自动重复不报）' ($null -eq $extra) (Show $extra)

  Send $helper @{ cmd = 'record'; on = $false }
  $left = Next-Event $helper
  Check '离开录键报 on:false' ($left.event -eq 'recording' -and $left.on -eq $false -and @($left.PSObject.Properties).Count -eq 2) (Show $left)
  Press $RCtrl $true 'scan'; $down = Next-Event $helper
  Press $RCtrl $false 'scan'; $up = Next-Event $helper
  Check '离开以后热键照常认' ($down.id -eq 'dictate#0' -and $down.down -eq $true -and $up.id -eq 'dictate#0' -and $up.down -eq $false) (Show @($down, $up))

  # 离开时还按着的键：之后的松开照样吞、不报；松开以后热键照常认
  Send $helper @{ cmd = 'record'; on = $true }; $null = Next-Event $helper
  Press $RCtrl $true 'scan'; $null = Next-Event $helper
  Send $helper @{ cmd = 'record'; on = $false }; $left = Next-Event $helper
  Press $RCtrl $false 'scan'
  $extra = Next-Event $helper 300
  Check '离开时还按着的右 Ctrl，松开不报' ($left.event -eq 'recording' -and $left.on -eq $false -and $null -eq $extra) (Show @($left, $extra))
  Press $RCtrl $true 'scan'; $down = Next-Event $helper
  Press $RCtrl $false 'scan'; $up = Next-Event $helper
  Check '它松开以后热键照常认' ($down.id -eq 'dictate#0' -and $down.down -eq $true -and $up.id -eq 'dictate#0' -and $up.down -eq $false) (Show @($down, $up))

  # 已经在录时再让录：从头录，再报一次空的集合；之前按着的 F13 松开不改集合、不报
  Send $helper @{ cmd = 'record'; on = $true }; $null = Next-Event $helper
  Press $F13 $true 'scan'; $null = Next-Event $helper
  Send $helper @{ cmd = 'record'; on = $true }; $again = Next-Event $helper
  Press $F13 $false 'scan'
  $extra = Next-Event $helper 300
  Check '再让录：报一次空的集合，之前按着的松开不报' ((Is-Recording $again @() @()) -and $null -eq $extra) (Show @($again, $extra))
  # 从再让录那一下起 30 秒没人说停：先报 error，再报 on:false，之后热键照常认
  $timeout = Next-Event $helper 32000; $left = Next-Event $helper
  Check '录了 30 秒自己停：先报 error 再报 on:false' ($timeout.event -eq 'error' -and $left.event -eq 'recording' -and $left.on -eq $false) (Show @($timeout, $left))
  Press $RCtrl $true 'scan'; $down = Next-Event $helper
  Press $RCtrl $false 'scan'; $up = Next-Event $helper
  Check '自己停了以后热键照常认' ($down.id -eq 'dictate#0' -and $down.down -eq $true -and $up.id -eq 'dictate#0' -and $up.down -eq $false) (Show @($down, $up))

  # probe（docs/hotkey-research.md 5.5）：只试登记、马上注销，不按任何键
  Send $helper @{ cmd = 'probe'; id = 1; mods = @(0xA3); key = 0x64 }
  $probed = Next-Event $helper
  Check 'probe 右 Ctrl+F13 没被占' ($probed.event -eq 'probed' -and $probed.id -eq 1 -and $probed.conflict -eq $false -and @($probed.PSObject.Properties).Count -eq 3) (Show $probed)
  # Win+R（R 的扫描码 0x13）：系统自己的组合报不报冲突，照实记下，不算过或不过
  Send $helper @{ cmd = 'probe'; id = 2; mods = @(0x5B); key = 0x13 }
  $results.Add("INFO probe Win+R：$(Show @((Next-Event $helper), (Next-Event $helper 300)))")
  Send $helper @{ cmd = 'probe'; id = 3; mods = @(0xA3) }
  $probed = Next-Event $helper
  Check 'probe 只有修饰键的，直接回没被占' ($probed.event -eq 'probed' -and $probed.id -eq 3 -and $probed.conflict -eq $false) (Show $probed)
  Send $helper @{ cmd = 'probe'; id = 4; mods = 'x'; key = 0x64 }
  $probed = Next-Event $helper; $why = Next-Event $helper
  Check 'probe 形状不对：照样回 probed，另报 error' ($probed.event -eq 'probed' -and $probed.id -eq 4 -and $probed.conflict -eq $false -and $why.event -eq 'error') (Show @($probed, $why))
  Send $helper @{ cmd = 'probe'; mods = @(0xA3); key = 0x64 }
  $why = Next-Event $helper; $extra = Next-Event $helper 300
  Check 'probe 没有 id：只报 error' ($why.event -eq 'error' -and $null -eq $extra) (Show @($why, $extra))
  Send $helper @{ cmd = 'info' }
  $info = Next-Event $helper
  Check 'info 只回 event' ($info.event -eq 'info' -and @($info.PSObject.Properties).Count -eq 1) (Show $info)
  Drain $helper

  # 截住 esc 和一块区域里的点击
  $width = [Fake]::GetSystemMetrics(0); $height = [Fake]::GetSystemMetrics(1)
  $x = [int]($width / 2); $y = [int]($height - 60)
  $results.Add("INFO 主屏 ${width}x${height}（物理像素），点在 ($x, $y)")
  Send $helper @{ cmd = 'capture'; regions = @(@{ id = 'done'; x = $x - 20; y = $y - 20; width = 40; height = 40 }) }
  Start-Sleep -Milliseconds 200
  Press $Esc $true 'scan'; Press $Esc $false 'scan'
  $cancelDown = Next-Event $helper
  $cancelUp = Next-Event $helper
  Check '截着时按 esc 报取消的按下、松开' ($cancelDown.event -eq 'binding' -and $cancelDown.id -eq 'cancel#0' -and $cancelDown.down -eq $true -and $cancelUp.event -eq 'binding' -and $cancelUp.id -eq 'cancel#0' -and $cancelUp.down -eq $false) "$($cancelDown | ConvertTo-Json -Compress) $($cancelUp | ConvertTo-Json -Compress)"
  [Fake]::Click($x, $y, $true); Start-Sleep -Milliseconds 50; [Fake]::Click($x, $y, $false)
  $click = Next-Event $helper
  Check '截着时点那一块报 click' ($click.event -eq 'click' -and $click.id -eq 'done') ($click | ConvertTo-Json -Compress)
  Send $helper @{ cmd = 'release' }
  Start-Sleep -Milliseconds 200
  Press $Esc $true 'scan'; Press $Esc $false 'scan'
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
  Press $Ctrl $true; Press $KeyA $true; Press $KeyA $false; Press $Ctrl $false
  Press $Delete $true; Press $Delete $false
  Start-Sleep -Milliseconds 300

  # 菜单栏（docs/hotkey-research.md 4.2 的掩码）：Alt 按着时我们触发了绑定、吞了空格，前台应用不该当成单按了一下 Alt。
  # 掩码排到 Alt 按下前面和不插一样，记事本照样选中菜单栏：语音输入、语音翻译的默认键 10-22 在这里栽过。
  # 左 Alt 没绑，是对照：它该选中菜单栏，不然后两项查不出东西。空格没吞住的话弹的是窗口菜单，焦点也在菜单项上
  Send $helper @{ cmd = 'bind'; bindings = @(
      @{ id = 'dictate#0'; mods = @(0xA5); when = 'always' },
      @{ id = 'x#0'; mods = @(0xA5); key = 0x39; when = 'always' }) }
  $null = Next-Event $helper
  $menuCases = [ordered]@{
    '对照：左 Alt 单按（没绑）选中了菜单栏' = @($true, { Press $LAlt $true 'scan'; Start-Sleep -Milliseconds 80; Press $LAlt $false 'scan' })
    '右 Alt 单按触发绑定，菜单栏没被选中' = @($false, { Press $RAlt $true 'scan'; Start-Sleep -Milliseconds 80; Press $RAlt $false 'scan' })
    '右 Alt 再补空格升级，菜单栏、窗口菜单都没出来' = @($false, {
        Press $RAlt $true 'scan'; Start-Sleep -Milliseconds 120; Press $Space $true 'scan'; Press $Space $false 'scan'
        Start-Sleep -Milliseconds 30; Press $RAlt $false 'scan' })
  }
  foreach ($name in $menuCases.Keys) {
    [Fake]::SetForegroundWindow($window) | Out-Null
    Start-Sleep -Milliseconds 300
    & $menuCases[$name][1]
    Start-Sleep -Milliseconds 500
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement.Current
    $onMenu = $focused.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem
    Check $name ($onMenu -eq $menuCases[$name][0]) "焦点在 $($focused.ControlType.ProgrammaticName) '$($focused.Name)'"
    # 选中了菜单栏就退出来；没截着，esc 照常到记事本
    Press $Esc $true 'scan'; Press $Esc $false 'scan'
    Start-Sleep -Milliseconds 300
    Drain $helper
  }
  Set-Clipboard -Value '贴之前用户复制的字'
  Send $helper @{ cmd = 'paste'; id = 1; text = $text }
  $pasted = Next-Event $helper 3000
  Check '贴完报 pasted ok' ($pasted.event -eq 'pasted' -and $pasted.id -eq 1 -and $pasted.ok) ($pasted | ConvertTo-Json -Compress)
  Check '贴完剪贴板还是原来的' ((Get-Clipboard -Raw) -eq '贴之前用户复制的字') (Get-Clipboard -Raw)
  # 全选、复制，读回记事本里的字
  Press $Ctrl $true; Press $KeyA $true; Press $KeyA $false; Press $KeyC $true; Press $KeyC $false; Press $Ctrl $false
  Start-Sleep -Milliseconds 400
  $inNotepad = Get-Clipboard -Raw
  Check '记事本里是贴进去的那段字' ($inNotepad -eq $text) ($inNotepad)

} finally {
  $helper.Process.StandardInput.Close()
  if (-not $helper.Process.WaitForExit(2000)) { $helper.Process.Kill() }
  Check '关掉标准输入后自己退出' ($helper.Process.HasExited) ''
  # 只关这次开的（不碰用户自己开着的记事本）
  if ($startedAt) { Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge $startedAt } | Stop-Process -Force -ErrorAction SilentlyContinue }
  if ($null -ne $saved) { Set-Clipboard -Value $saved }
}
$results
$checks = @($results | Where-Object { $_ -notlike 'INFO*' })
"{0}/{1} 通过" -f @($checks | Where-Object { $_ -like 'PASS*' }).Count, $checks.Count
