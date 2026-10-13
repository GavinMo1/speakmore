<h1 align="center">SpeakMore</h1>

<p align="center">
  按一下热键说话，再按一下，整理好的文字就贴进你正在用的输入框。<br>
  macOS 上的语音输入，用你自己的 Gemini API key。
</p>

口头禅、改口、重复会被整理掉，长一点的话会分段、分点。只做语音转写这一件事：不采集屏幕和输入框里的内容，没有账号，没有云同步。

名字和 Typeless 反着来：它是照着对 Typeless 的[逆向分析](../targets/typeless/README.md)做的独立实现，和 Typeless 官方没有关系。

## 装和用

需要 macOS 12 以上、Node 22.13 以上、Xcode 命令行工具（`xcode-select --install`），以及一把 [Gemini API key](https://aistudio.google.com/apikey)。

```bash
git clone https://github.com/zephyr4123/speakmore.git
cd speakmore/speakmore
npm install
npm link        # 把 speakmore 命令装进 PATH
speakmore
```

第一次运行 `speakmore` 会依次做这几件事，都不用你另外操作：

1. 编译一个听热键、贴文字的小程序，下载运行环境 Electron（约 100 MB）。
2. 在终端里问你要 key。粘贴后按回车，输入不会显示出来；验证通过后用系统钥匙串加密存在本机。
3. 系统弹出麦克风授权框，点“允许”。
4. 显示状态。还缺系统权限的话会顺手打开设置窗口，每一项旁边有去系统设置的按钮。

看到下面这样就可以用了：点进任意输入框，按一下右 Option，说话，再按一下。

```text
SpeakMore 0.1.0 · 运行中

  可以用了：点进任意输入框，按一下右 Option 键开始说话，再按一下结束，文字会贴进去。

  key       已保存，验证通过
  权限      麦克风 ✓   输入监控 ✓   辅助功能 ✓
  热键      右 Option 键
  模型      gemini-3.5-flash（MINIMAL）
  今天      12 次 · 1,024 字 · 3 分 20 秒
  累计      132 次 · 12,480 字 · 48 分钟 · 每分钟 260 字
```

它在后台运行，关掉终端窗口也还在，菜单栏上有“听写”两个字。电脑重启后要再运行一次 `speakmore`。

不想把命令装进 PATH 的话，在这个目录里用 `npm start` 代替 `speakmore`，子命令写在 `--` 后面，比如 `npm start -- history`。

## 命令

| 命令 | 做什么 |
| --- | --- |
| `speakmore` | 启动。已经在运行就只显示状态；没有 key 时问你要 |
| `speakmore stop` / `restart` | 停掉 / 重启 |
| `speakmore status [--json]` | 在不在运行、key、三项权限、今天和累计说了多少。能用时退出码是 0 |
| `speakmore history [-n 条数] [--json]` | 看说过的话，按天分组，新的在前。失败的那条会写原因，录音还留着 |
| `speakmore key` | 换一把 key。也可以从管道喂：`pbpaste \| speakmore key` |
| `speakmore key --forget` | 删掉存着的 key |
| `speakmore config` | 看设置，以及数据和日志在哪 |
| `speakmore config set <名字> <值>` | 改一项设置，正在运行的话自动重启生效。`unset` 回到默认 |
| `speakmore settings` | 打开设置窗口（去系统设置授权时用） |
| `speakmore logs [-n 行数] [-f]` | 看日志 |

## 三项系统权限

| 权限 | 用来做什么 | 没有时的表现 |
| --- | --- | --- |
| 麦克风 | 录音 | 按热键时屏幕下方提示没有麦克风权限 |
| 输入监控 | 听热键。只认你选的那一个键，别的按键不记录 | 热键没反应，`speakmore status` 里标出来 |
| 辅助功能 | 模拟 ⌘V 把文字贴进去 | 照样能用，文字放进剪贴板，自己按 ⌘V |

用 `speakmore` 命令启动时，这三项权限**记在你运行命令的那个终端程序名下**（“终端”、iTerm、Ghostty 等），在系统设置的列表里要找的是它，不是 SpeakMore。换一个终端程序启动，就要给那个终端再授权一次。

在系统设置里打开开关之后，运行 `speakmore status`，它会重新检查一遍。

## 设置

```bash
speakmore config set hotkey fn        # 换热键
speakmore config unset hotkey         # 回到默认
```

| 名字 | 默认值 | 能填什么 |
| --- | --- | --- |
| `hotkey` | `right_option` | `right_option` / `right_command` / `right_control` / `fn`，都是单独按一下。Typeless 用的是 `fn`，默认避开它，两个可以同时开着 |
| `model` | `gemini-3.5-flash` | Gemini 的模型名。换模型时留意下一项 |
| `thinking` | `MINIMAL` | `MINIMAL` / `LOW` / `MEDIUM` / `HIGH`，越高越慢。有的模型不接受 `MINIMAL` |

设置存在数据目录的 `settings.json` 里。只想临时换一次，可以用环境变量 `SPEAKMORE_HOTKEY`、`GEMINI_MODEL`、`GEMINI_THINKING_LEVEL`，它们优先于文件；`GEMINI_API_KEY` 设着的话，这次运行用它，不读也不写存着的那把。

## 你的数据

**发出去的只有录音**，直接发给 Google 的 Gemini 接口，用的是你自己的 key。没有别的服务器，没有统计上报，也不读屏幕和输入框里的内容。

留在本机的都在 `~/Library/Application Support/SpeakMore/`：

| 东西 | 说明 |
| --- | --- |
| `history.db`、`Recordings/` | 说过的话和录音。失败的听写也存录音，话不会白说 |
| `gemini-key.bin` | 加密后的 key，权限 600。解密用的密钥在系统钥匙串的“SpeakMore Safe Storage”里 |
| `settings.json` | 上面那几项设置 |
| `logs/main.log` | 日志，一行一条 JSON。只记长度和耗时，不记说的话，也不记 key |

想换个地方放，设环境变量 `SPEAKMORE_HOME`。想彻底删干净，停掉之后删这个目录，再在“钥匙串访问”里删掉“SpeakMore Safe Storage”。

## 现在的不足

和 Typeless 比：

- **专有名词和人名会听错。** Typeless 会把当前应用和屏幕上的文字一起上传当上下文，这里只有录音，也还没有个人词典。
- **列表用得比它少**，口吃偶尔删不干净（约每 60 条 1 条）。
- 只有听写，没有翻译和“问任何事”。

还没做的：

- 登录时自动启动。现在重启电脑后要再运行一次 `speakmore`。
- 失败的听写重试。录音留着，但还不能一键重新整理。
- 图形界面的主窗口，会用 Tauri 另做。现在的入口是命令行，加一个菜单栏图标和设置窗口。
- Windows 和 Linux。

## 开发

```bash
npm run check                 # 代码检查 + 全部测试（181 条，不联网、不开窗口）
npm run build:native          # 只重新编译原生小程序；平时不用管，启动时会按需编译
```

要真调 Gemini 的命令需要环境里有 `GEMINI_API_KEY`。仓库根目录的 `scripts/with-gemini-key.sh` 可以按你自己机器上的配置把它只喂给一条命令，见根目录的 `.machine.env.example`：

```bash
../scripts/with-gemini-key.sh node scripts/e2e.mjs 一段录音.wav   # 端到端：真的 Electron、录音编码、Gemini；麦克风和贴字是假的
../scripts/with-gemini-key.sh node scripts/eval-prompt.mjs --label v1   # 拿自己 Typeless 的历史录音评估提示词
../scripts/with-gemini-key.sh node src/server/main.mjs           # 单独启动听写服务，配合 SPEAKMORE_SERVER_URL 调试
node scripts/replay.mjs 块1.ogg 块2.ogg                           # 把现成的录音发给单独启动的服务
```

| 目录 | 内容 |
| --- | --- |
| `bin/`、`src/cli/` | `speakmore` 命令 |
| `src/app/` | 后台应用的主进程（Electron）：悬浮条、菜单栏、设置和历史窗口 |
| `src/renderer/`、`src/preload/` | 各个窗口的页面：状态机、录音、听写协议的客户端 |
| `src/server/` | 听写服务：收分块音频，交给 Gemini 整理。平时跑在后台应用的进程里 |
| `native/` | 听热键和贴字的小程序（Swift） |
| `src/*.mjs` | 命令和后台应用共用的：数据位置、设置、历史库、控制通道、日志 |

和原版的对应关系、模型怎么选的、提示词怎么调的，在[实现笔记](docs/implementation-notes.md)里。

### 打成 .app

平时用命令启动就够了。打成应用的区别是三项权限记在“SpeakMore”自己名下，并且可以在设置窗口里勾选登录时自动启动：

```bash
npm run install-app     # 打包并装进“应用程序”，然后打开
```

用的是不带身份的本机签名，所以每次重新打包系统都会把它当成一个新应用，权限要重新给，key 要重新填。

### 验证到哪一步

- 自动测试 181 条，在 Node 22.13、24.21、26.0 上都跑过。
- 真的启动过后台应用并用命令走了一遍：启动、重复启动、状态、从管道存 key、重启后读回、错的 key 被拒、删 key、停止。在伪终端里走过第一次使用时问 key 的流程，确认 key 不会显示在屏幕上。
- 把它打成 npm 包装到另一个目录，在找不到 Swift 编译器的环境下能启动（包里带着编好的小程序）。
- 端到端：合成的一段语音当麦克风输入，经过真的录音编码、Gemini、存历史，命令启动的和打成 .app 的都通过。
- **还没有人按着真键盘、对着真麦克风用这一版试过。** 上一版（开两个终端启动）试过，后台的代码是同一套，但启动方式变了。Intel 芯片的 Mac 上也没有跑过。

## 许可

[MIT](LICENSE)
