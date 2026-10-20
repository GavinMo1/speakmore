#!/bin/bash
# SpeakMore 的安装脚本：检查环境、下载、校验、装进 ~/.speakmore，然后启动。
#
#   curl -fsSL https://dl.zephyrxiang.com/speakmore/install.sh | bash
#
# 所有东西都装在 ~/.speakmore 这一个目录里（程序、运行环境，以及之后的设置、key、历史和录音），
# 目录以外只建一个指向命令的链接。不需要 Node、npm、Xcode，也不需要 sudo。
# 已经装过的话再运行一次就是升级：程序换成新的，你的东西不动。卸载用 speakmore uninstall。
# 这个脚本也随程序一起装进 app/ 里：speakmore update 拼好新版本后，用新版本自带的这一份把它换上（SPEAKMORE_INSTALL_FROM）。
#
# 可以用环境变量调整：
#   SPEAKMORE_HOME          装到哪（默认 ~/.speakmore）
#   SPEAKMORE_VERSION       装哪个版本，比如 v0.11.0（默认最新的；0.11.0 以前的包是 tar.gz，这个脚本不装）
#   SPEAKMORE_INSTALL_BASE  从哪下载：一个网址前缀，或者本机的一个目录（npm run release 打出来的 dist/release）
#   SPEAKMORE_BIN_DIR       命令的链接建在哪个目录（默认 ~/.local/bin）
#   SPEAKMORE_INSTALL_FROM  不下载，装一棵已经准备好的树（里面是 app/ 和 runtime/）：speakmore update 拼在家目录里
#                           .update- 开头的目录里，只认那里的
# 加 --no-start 只装不启动：curl … | bash -s -- --no-start
#
# 写法要能在 macOS 自带的 bash 3.2 上跑。全部逻辑都在函数里、最后一行才调用：
# 从管道里读脚本时，万一只下到一半，不会执行半截。

set -euo pipefail

REPO_URL="https://github.com/zephyr4123/speakmore"
# 发布包放在这里。根上是这个脚本和 channel.json（最新的版本号在它的 version 里），每个版本的包在各自的目录里：
# <版本号>/speakmore-darwin-<芯片>.tar.xz 和同名的 .sha256（摆法见 src/update/layout.mjs）
DOWNLOAD_URL="https://dl.zephyrxiang.com/speakmore"
# 能用的几家模型（名字和地址成对），整理文字要连其中一家。和 src/server/providers/index.mjs 里登记的一致
MODEL_HOSTS=("Gemini" "generativelanguage.googleapis.com" "OpenAI" "api.openai.com" "Bailian" "dashscope.aliyuncs.com")
MIN_MACOS_MAJOR=12
# 从这个版本起包是 tar.xz（摆法见 src/update/layout.mjs）；更早的只有 tar.gz，这个脚本不装它们。
# 0.10.0 及以前的 speakmore update 会下这个脚本、指定装 v0.10.1：到这里说清楚怎么办，而不是报"连不上"
MIN_VERSION="0.11.0"
# 下载的包约 95 MB，解开约 390 MB；升级时旧的要等新的放好才删
NEEDED_MB=1000
# macOS 上 Unix 套接字的路径最长 103 个字节，控制通道在 <目录>/run/control.sock
MAX_HOME_BYTES=86

TMP_DIR=""

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' DIM=$'\033[2m' RESET=$'\033[0m'
else
  GREEN="" YELLOW="" RED="" BOLD="" DIM="" RESET=""
fi

heading() { printf '\n  %s%s%s\n' "$BOLD" "$1" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }
# 说清楚哪里不行、怎么办，然后退出。到这一步为止没有换掉任何已经装好的东西
fail() {
  printf '  %s✗%s %s\n' "$RED" "$RESET" "$1" >&2
  shift
  for line in "$@"; do printf '    %s\n' "$line" >&2; done
  printf '\n  Nothing was installed; what you had is untouched.\n' >&2
  exit 1
}

# 给人看的路径：家目录写成 ~
pretty() { case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;; *) printf '%s' "$1" ;; esac; }
# 把一段文字写成 sh 里的单引号字面量，路径里有空格、引号也不会出错
quoted() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
on_path() { case ":$PATH:" in *":$1:"*) return 0 ;; *) return 1 ;; esac; }
cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
  # 什么都没装成的话，不留下一个空目录（里面有东西时这一句删不掉它，正好）
  rmdir "${HOME_DIR:-}" 2>/dev/null || true
}

# ---------- 预检查 ----------

check_system() {
  [ "$(uname -s)" = "Darwin" ] ||
    fail "SpeakMore only supports macOS for now" "Listening for the hotkey and pasting rely on macOS system APIs. This machine runs $(uname -s)."

  [ "$(id -u)" -ne 0 ] ||
    fail "Don't run this with sudo or as root" "SpeakMore installs into your home folder and doesn't need admin rights. Run it again without sudo."

  local version major
  version="$(sw_vers -productVersion)"
  major="${version%%.*}"
  [ "$major" -ge "$MIN_MACOS_MAJOR" ] 2>/dev/null ||
    fail "macOS $version is too old" "SpeakMore needs macOS $MIN_MACOS_MAJOR or newer."
  ok "macOS $version"

  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64)
      # Apple 芯片上从 Rosetta 转译的终端里运行时，报的是 x86_64
      if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi
      ;;
    *) fail "Unknown chip: $(uname -m)" "SpeakMore is built for Apple silicon (arm64) and Intel (x86_64)." ;;
  esac
  if [ "$ARCH" = "arm64" ]; then ok "Apple silicon"; else ok "Intel"; fi

  local tool missing=""
  for tool in curl tar shasum mktemp awk sed df; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  [ -z "$missing" ] || fail "Missing built-in tools:$missing" "They come with macOS. Check whether your PATH was changed."
  ok "System tools found"
}

check_home() {
  local bytes
  bytes="$(printf '%s' "$HOME_DIR" | wc -c | tr -d ' ')"
  [ "$bytes" -le "$MAX_HOME_BYTES" ] ||
    fail "Install path is too long: $HOME_DIR" "Pick a shorter one with SPEAKMORE_HOME=/a/short/path and run again."
  case "$HOME_DIR" in /*) ;; *) fail "SPEAKMORE_HOME must be an absolute path, not $HOME_DIR" ;; esac

  mkdir -p "$HOME_DIR" 2>/dev/null && [ -w "$HOME_DIR" ] ||
    fail "Can't create or write to $(pretty "$HOME_DIR")" "Check its permissions, or pick another place with SPEAKMORE_HOME."
  # 里面会有录音和 key，只让自己进得去
  chmod 700 "$HOME_DIR"

  if [ -n "${SPEAKMORE_INSTALL_FROM:-}" ]; then
    # 从拼好的树装只是改名换上，不再占新的地方（拼的时候已经占过了）
    ok "Installing to $(pretty "$HOME_DIR")"
  else
    local free_mb
    free_mb="$(df -Pk "$HOME_DIR" | awk 'NR == 2 { printf "%d", $4 / 1024 }')"
    [ "$free_mb" -ge "$NEEDED_MB" ] 2>/dev/null ||
      fail "Not enough disk space: ${free_mb} MB free" "About ${NEEDED_MB} MB is needed. Free up some space and run again."
    ok "Installing to $(pretty "$HOME_DIR") ($((free_mb / 1024)) GB free)"
  fi

  INSTALLED_VERSION=""
  if [ -f "$HOME_DIR/app/package.json" ]; then
    INSTALLED_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HOME_DIR/app/package.json" | head -1)"
    ok "Found ${INSTALLED_VERSION:-an earlier version}: replacing it; settings, keys, history and recordings stay"
  fi
}

# 定下装哪个版本：指定了就用指定的，没指定就问下载地址最新的是哪个（channel.json 里的 version）
resolve_version() {
  local version="${SPEAKMORE_VERSION:-}"
  if [ -n "$version" ]; then
    case "$version" in v*) ;; *) version="v$version" ;; esac
  else
    version="$(curl -fsSL --max-time 20 "$DOWNLOAD_BASE/channel.json" 2>/dev/null |
      sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' | head -n 1)" || version=""
    [ -n "$version" ] || fail "Couldn't find the latest version" "URL: $DOWNLOAD_BASE/channel.json" "Check your network and try again in a bit."
    version="v$version"
  fi
  # 版本号要拼进下载地址：不像版本号的不往下走（比如问到的其实是一个报错的网页）
  if ! [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.-]+)?$ ]]; then
    [ -n "${SPEAKMORE_VERSION:-}" ] && fail "SPEAKMORE_VERSION doesn't look like a version: $SPEAKMORE_VERSION" "Write it like v0.2.0."
    fail "The download server returned a bad version number" "URL: $DOWNLOAD_BASE/channel.json" "Try again in a bit. If it keeps happening, please open an issue at $REPO_URL/issues."
  fi
  if older_than "${version#v}" "$MIN_VERSION"; then
    fail "This installer can't install $version" "Versions before v$MIN_VERSION are packaged differently." \
      "Run it again without SPEAKMORE_VERSION to install the latest, or download that version's installer:" \
      "$DOWNLOAD_BASE/$version/SpeakMore-$ARCH.dmg"
  fi
  BASE_URL="$DOWNLOAD_BASE/$version"
}

# 两个 x.y.z 比大小（不管预发版的后缀）：$1 比 $2 旧时成立
older_than() {
  local IFS=. i
  local -a a b
  read -r -a a <<<"${1%%[-+]*}"
  read -r -a b <<<"${2%%[-+]*}"
  for i in 0 1 2; do
    [ "${a[i]:-0}" -lt "${b[i]:-0}" ] && return 0
    [ "${a[i]:-0}" -gt "${b[i]:-0}" ] && return 1
  done
  return 1
}

check_network() {
  resolve_version
  # 顺带确认了这个版本、这种芯片的发布包确实存在
  curl -fsSL --max-time 20 -o /dev/null "$BASE_URL/$ARCHIVE.sha256" 2>/dev/null ||
    fail "Couldn't reach the release package" \
      "URL: $BASE_URL/$ARCHIVE" \
      "Check your network. If you set SPEAKMORE_VERSION, make sure that version exists."
  ok "Download server reachable"

  # 装得上不等于用得了：整理文字要连用的那一家，装的时候还不知道用哪家，所以都查。连不上只提醒，不拦着
  local i unreachable=0
  for ((i = 0; i < ${#MODEL_HOSTS[@]}; i += 2)); do
    if curl -s --max-time 8 -o /dev/null "https://${MODEL_HOSTS[i + 1]}/" 2>/dev/null; then
      ok "${MODEL_HOSTS[i]} reachable"
    else
      warn "Can't reach ${MODEL_HOSTS[i]} right now (${MODEL_HOSTS[i + 1]})"
      unreachable=1
    fi
  done
  if [ "$unreachable" = 1 ]; then
    note "Installing still works. You need to reach the provider you use; if you need a proxy, set it in the terminal that starts speakmore."
  fi
}

# ---------- 安装 ----------

download() {
  TMP_DIR="$(mktemp -d "$HOME_DIR/.install.XXXXXX")"
  local progress="-sS"
  [ -t 2 ] && progress="--progress-bar"
  curl -fL "$progress" -o "$TMP_DIR/$ARCHIVE" "$BASE_URL/$ARCHIVE" ||
    fail "Download interrupted" "Run it again. URL: $BASE_URL/$ARCHIVE"
  curl -fsSL -o "$TMP_DIR/$ARCHIVE.sha256" "$BASE_URL/$ARCHIVE.sha256" || fail "Couldn't download the checksum" "Run it again."
  ok "Downloaded"

  local expected actual
  expected="$(awk '{ print $1; exit }' "$TMP_DIR/$ARCHIVE.sha256")"
  actual="$(shasum -a 256 "$TMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] ||
    fail "Checksum mismatch: the download differs from the release" "It was probably damaged on the way. Run it again." "Expected $expected" "Got      $actual"
  ok "Checksum OK"

  tar -xJf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR" || fail "Couldn't unpack the package" "Run it again."
  try_new "Unpacked"
}

# 从一棵已经准备好的树装（SPEAKMORE_INSTALL_FROM）：只认直接放在家目录里、.update- 开头的目录，和要换上的在同一块盘上，改名就换上。
# 两边都先解析成真实路径再比：家目录可能写成 a//b、末尾带 /，或者经过符号链接（/tmp 其实是 /private/tmp），
# 而 speakmore update 交来的是规范化过的；也挡住 .update-x/../.. 这种绕出去的（失败时这个目录会被整个删掉）
use_tree() {
  [ -d "$SPEAKMORE_INSTALL_FROM" ] || fail "No such folder: $SPEAKMORE_INSTALL_FROM"
  local from home
  from="$(CDPATH="" cd -- "$SPEAKMORE_INSTALL_FROM" && pwd -P)" || fail "Can't open $SPEAKMORE_INSTALL_FROM"
  home="$(CDPATH="" cd -- "$HOME_DIR" && pwd -P)" || fail "Can't open $(pretty "$HOME_DIR")"
  case "$(basename "$from")" in .update-*) ;; *) from="" ;; esac
  [ -n "$from" ] && [ "$(dirname "$from")" = "$home" ] ||
    fail "SPEAKMORE_INSTALL_FROM must be a .update- folder inside $(pretty "$HOME_DIR")" "Got $SPEAKMORE_INSTALL_FROM"
  TMP_DIR="$from"
  try_new "Prepared"
}

# 换掉旧的之前先在原地跑一下：这台机器上跑不起来的话现在就知道，不至于换完才发现
try_new() {
  NEW_ELECTRON="$TMP_DIR/runtime/Electron.app/Contents/MacOS/Electron"
  [ -f "$TMP_DIR/app/bin/speakmore.mjs" ] && [ -x "$NEW_ELECTRON" ] || fail "The package is incomplete" "That's a problem with the release. Please open an issue at $REPO_URL/issues."
  NEW_VERSION="$(run_new --version 2>/dev/null)" ||
    fail "The downloaded app won't run on this Mac" "Please open an issue at $REPO_URL/issues with your macOS version and chip."
  ok "$1 SpeakMore $NEW_VERSION"
}

# 用刚下到的那一份程序跑一条命令
run_new() {
  SPEAKMORE_HOME="$HOME_DIR" ELECTRON_RUN_AS_NODE=1 "$NEW_ELECTRON" "$TMP_DIR/app/bin/speakmore.mjs" "$@"
}

# 把程序和运行环境换成刚下到的。两样要么都换成，要么都不换：中途出错就把原来的放回去
swap_in() {
  local name
  for name in app runtime; do
    rm -rf "$HOME_DIR/$name.old"
    if [ -e "$HOME_DIR/$name" ] && ! mv "$HOME_DIR/$name" "$HOME_DIR/$name.old"; then
      # app 已经挪开、runtime 挪不动：把 app 放回去，不然 speakmore 命令就坏了
      put_back
      fail "Can't move $(pretty "$HOME_DIR/$name")" "Check the folder's permissions."
    fi
  done
  if mv "$TMP_DIR/app" "$HOME_DIR/app" && mv "$TMP_DIR/runtime" "$HOME_DIR/runtime"; then
    rm -rf "$HOME_DIR/app.old" "$HOME_DIR/runtime.old"
    return
  fi
  put_back
  fail "Couldn't put the new version into $(pretty "$HOME_DIR")" "Check the folder's permissions. SpeakMore was stopped; run speakmore to start it again."
}

# 把挪开的旧版放回原处（换到一半出错时）
put_back() {
  local name
  for name in app runtime; do
    [ -e "$HOME_DIR/$name.old" ] || continue
    rm -rf "$HOME_DIR/$name"
    mv "$HOME_DIR/$name.old" "$HOME_DIR/$name"
  done
}

install_files() {
  # 正在运行的要先停：它开着旧程序的文件。用新的这份去停，新旧版本的后台应用它都认。
  # 0.1 版把数据放在别处，有的话这一步会顺带搬过来。
  # 下面靠它说的话判断停没停、搬没搬，命令行又按终端的语言说话：让它说英文，和这个脚本一致
  local output
  output="$(SPEAKMORE_LANGUAGE=en run_new stop 2>&1)" || fail "Couldn't stop the running SpeakMore" "$output" "Quit it first, then install again."
  case "$output" in *"Moved the old version's data"*) ok "$(printf '%s\n' "$output" | grep "Moved the old version's data" | head -1)" ;; esac
  case "$output" in *"SpeakMore stopped."* | *"force-quit"*) ok "Stopped the running SpeakMore" ;; esac

  swap_in

  mkdir -p "$HOME_DIR/bin"
  LAUNCHER="$HOME_DIR/bin/speakmore"
  # 目录的位置写死在启动脚本里：它会被别处的链接指着，不能靠"我在哪"来猜
  cat >"$LAUNCHER" <<EOF
#!/bin/sh
# The speakmore command, generated by the SpeakMore installer.
# Runs on the bundled Electron as Node, so Node doesn't need to be installed.
installed_in=$(quoted "$HOME_DIR")
SPEAKMORE_HOME="\${SPEAKMORE_HOME:-\$installed_in}"
export SPEAKMORE_HOME
ELECTRON_RUN_AS_NODE=1 exec $(quoted "$HOME_DIR/runtime/Electron.app/Contents/MacOS/Electron") $(quoted "$HOME_DIR/app/bin/speakmore.mjs") "\$@"
EOF
  chmod 755 "$LAUNCHER"
  ok "Installed to $(pretty "$HOME_DIR")"
}

link_command() {
  local dir link
  if [ -n "${SPEAKMORE_BIN_DIR:-}" ]; then
    dir="$SPEAKMORE_BIN_DIR"
  elif on_path "$HOME/.local/bin"; then
    dir="$HOME/.local/bin"
  elif on_path /usr/local/bin && [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    dir="/usr/local/bin"
  else
    dir="$HOME/.local/bin"
  fi
  link="$dir/speakmore"

  # 那个位置上已经有一个不是链接的同名文件：不是我们放的，不动它
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    warn "$(pretty "$link") is another speakmore; left it alone"
    note "To use the new one, run: $(pretty "$LAUNCHER")"
    return
  fi
  mkdir -p "$dir"
  ln -sfn "$LAUNCHER" "$link"
  # 记下在家目录以外建了什么，卸载时照着删
  grep -qxF "$link" "$HOME_DIR/bin/links" 2>/dev/null || printf '%s\n' "$link" >>"$HOME_DIR/bin/links"
  ok "speakmore command: $(pretty "$link")"

  if ! on_path "$dir"; then
    local rc=".zshrc"
    case "${SHELL:-}" in */bash) rc=".bash_profile" ;; esac
    warn "$(pretty "$dir") isn't on your PATH, so new terminals won't find speakmore"
    note "Add it: echo 'export PATH=\"$dir:\$PATH\"' >> ~/$rc"
    note "Or use the full path: $(pretty "$LAUNCHER")"
    return
  fi
  # PATH 里排在前面的要是另一个 speakmore（比如从源码目录 npm link 的），敲命令时用到的会是它
  local found
  found="$(command -v speakmore 2>/dev/null || true)"
  if [ -n "$found" ] && [ "$found" != "$link" ]; then
    warn "Another speakmore comes first on your PATH: $(pretty "$found")"
    note "Typing speakmore runs that one. It's likely an old npm link; remove it with: npm unlink -g speakmore"
  fi
}

main() {
  local start="yes" arg
  for arg in "$@"; do
    case "$arg" in
      --no-start) start="no" ;;
      *) fail "Unknown option: $arg" "The only option is --no-start (install without starting)." ;;
    esac
  done

  HOME_DIR="${SPEAKMORE_HOME:-$HOME/.speakmore}"
  DOWNLOAD_BASE="${SPEAKMORE_INSTALL_BASE:-$DOWNLOAD_URL}"
  # 本机的一个目录也可以当下载地址
  case "$DOWNLOAD_BASE" in /*) DOWNLOAD_BASE="file://$DOWNLOAD_BASE" ;; esac

  printf '\n  %sSpeakMore installer%s\n' "$BOLD" "$RESET"
  trap cleanup EXIT

  heading "Checks"
  check_system
  ARCHIVE="speakmore-darwin-$ARCH.tar.xz"
  check_home
  # 从准备好的树装（speakmore update）不用联网
  [ -n "${SPEAKMORE_INSTALL_FROM:-}" ] || check_network

  heading "Install"
  if [ -n "${SPEAKMORE_INSTALL_FROM:-}" ]; then use_tree; else download; fi
  install_files
  link_command

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" != "$NEW_VERSION" ]; then
    printf '\n  %sUpgraded: %s → %s%s\n' "$BOLD" "$INSTALLED_VERSION" "$NEW_VERSION" "$RESET"
  else
    printf '\n  %sInstalled SpeakMore %s%s\n' "$BOLD" "$NEW_VERSION" "$RESET"
  fi
  note "To remove it: speakmore uninstall deletes all of $(pretty "$HOME_DIR")."

  cleanup
  TMP_DIR=""
  # 从管道里读脚本时标准输入不是终端，而问 key 要用键盘：接到终端上再启动
  if [ "$start" = "yes" ] && [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
    printf '\n'
    exec "$LAUNCHER" </dev/tty
  fi
  printf '\n  Run speakmore to start.\n\n'
}

main "$@"
