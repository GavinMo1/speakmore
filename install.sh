#!/bin/bash
# SpeakMore 的安装脚本：检查环境、下载、校验、装进 ~/.speakmore，然后启动。
#
#   curl -fsSL https://dl.zephyrxiang.com/speakmore/install.sh | bash
#
# 所有东西都装在 ~/.speakmore 这一个目录里（程序、运行环境，以及之后的设置、key、历史和录音），
# 目录以外只建一个指向命令的链接。不需要 Node、npm、Xcode，也不需要 sudo。
# 已经装过的话再运行一次就是升级：程序换成新的，你的东西不动。卸载用 speakmore uninstall。
#
# 可以用环境变量调整：
#   SPEAKMORE_HOME          装到哪（默认 ~/.speakmore）
#   SPEAKMORE_VERSION       装哪个版本，比如 v0.2.0（默认最新的）
#   SPEAKMORE_INSTALL_BASE  从哪下载：一个网址前缀，或者本机的一个目录（npm run release 打出来的 dist/release）
#   SPEAKMORE_BIN_DIR       命令的链接建在哪个目录（默认 ~/.local/bin）
# 加 --no-start 只装不启动：curl … | bash -s -- --no-start
#
# 写法要能在 macOS 自带的 bash 3.2 上跑。全部逻辑都在函数里、最后一行才调用：
# 从管道里读脚本时，万一只下到一半，不会执行半截。

set -euo pipefail

REPO_URL="https://github.com/zephyr4123/speakmore"
# 发布包放在这里。根上是这个脚本和 latest（一行，最新的版本号），每个版本的包在各自的目录里：
# <版本号>/speakmore-darwin-<芯片>.tar.gz 和同名的 .sha256
DOWNLOAD_URL="https://dl.zephyrxiang.com/speakmore"
# 能用的几家模型（名字和地址成对），整理文字要连其中一家。和 src/server/providers/index.mjs 里登记的一致
MODEL_HOSTS=("Gemini" "generativelanguage.googleapis.com" "OpenAI" "api.openai.com")
MIN_MACOS_MAJOR=12
# 下载的包约 120 MB，解开约 350 MB；升级时旧的要等新的放好才删
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
  printf '\n  没有装成，原来的东西没有动。\n' >&2
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
    fail "SpeakMore 目前只支持 macOS" "听热键和贴字靠的是 macOS 的系统接口。这台机器是 $(uname -s)。"

  [ "$(id -u)" -ne 0 ] ||
    fail "不要用 sudo 或 root 运行" "SpeakMore 装在你自己的家目录里，不需要管理员权限。去掉 sudo 再运行一次。"

  local version major
  version="$(sw_vers -productVersion)"
  major="${version%%.*}"
  [ "$major" -ge "$MIN_MACOS_MAJOR" ] 2>/dev/null ||
    fail "macOS 版本太旧：$version" "需要 macOS $MIN_MACOS_MAJOR 或更新的版本。"
  ok "macOS $version"

  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64)
      # Apple 芯片上从 Rosetta 转译的终端里运行时，报的是 x86_64
      if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi
      ;;
    *) fail "不认识的芯片：$(uname -m)" "SpeakMore 有 Apple 芯片（arm64）和 Intel（x86_64）两种包。" ;;
  esac
  if [ "$ARCH" = "arm64" ]; then ok "Apple 芯片"; else ok "Intel 芯片"; fi

  local tool missing=""
  for tool in curl tar shasum mktemp awk sed df; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  [ -z "$missing" ] || fail "缺少系统自带的工具：$missing" "它们本该随 macOS 一起装好。检查一下 PATH 是不是被改过。"
  ok "需要的系统工具都在"
}

check_home() {
  local bytes
  bytes="$(printf '%s' "$HOME_DIR" | wc -c | tr -d ' ')"
  [ "$bytes" -le "$MAX_HOME_BYTES" ] ||
    fail "安装目录的路径太长：$HOME_DIR" "换一个短一些的：SPEAKMORE_HOME=/一个/短路径，再运行一次。"
  case "$HOME_DIR" in /*) ;; *) fail "SPEAKMORE_HOME 要写绝对路径，现在是 $HOME_DIR" ;; esac

  mkdir -p "$HOME_DIR" 2>/dev/null && [ -w "$HOME_DIR" ] ||
    fail "$(pretty "$HOME_DIR") 建不出来或者写不进去" "检查这个位置的权限，或者用 SPEAKMORE_HOME 换一个地方。"
  # 里面会有录音和 key，只让自己进得去
  chmod 700 "$HOME_DIR"

  local free_mb
  free_mb="$(df -Pk "$HOME_DIR" | awk 'NR == 2 { printf "%d", $4 / 1024 }')"
  [ "$free_mb" -ge "$NEEDED_MB" ] 2>/dev/null ||
    fail "磁盘空间不够：还剩 ${free_mb} MB" "需要大约 ${NEEDED_MB} MB。腾一些空间再运行一次。"
  ok "装在 $(pretty "$HOME_DIR")（磁盘还剩 $((free_mb / 1024)) GB）"

  INSTALLED_VERSION=""
  if [ -f "$HOME_DIR/app/package.json" ]; then
    INSTALLED_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HOME_DIR/app/package.json" | head -1)"
    ok "已经装着 ${INSTALLED_VERSION:-一个版本}：这次换成新的，设置、key、历史和录音不动"
  fi
}

# 定下装哪个版本：指定了就用指定的，没指定就问下载地址最新的是哪个
resolve_version() {
  local version="${SPEAKMORE_VERSION:-}"
  if [ -n "$version" ]; then
    case "$version" in v*) ;; *) version="v$version" ;; esac
  else
    version="$(curl -fsSL --max-time 20 "$DOWNLOAD_BASE/latest" 2>/dev/null | head -n 1 | tr -d '[:space:]')" || version=""
    [ -n "$version" ] || fail "问不到最新版本是哪个" "地址：$DOWNLOAD_BASE/latest" "检查网络，过一会儿再运行一次。"
  fi
  # 版本号要拼进下载地址：不像版本号的不往下走（比如问到的其实是一个报错的网页）
  if ! [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.-]+)?$ ]]; then
    [ -n "${SPEAKMORE_VERSION:-}" ] && fail "SPEAKMORE_VERSION 不像版本号：$SPEAKMORE_VERSION" "写成 v0.2.0 这样的。"
    fail "下载地址给的最新版本号不对" "地址：$DOWNLOAD_BASE/latest" "过一会儿再运行一次；一直这样的话请到 $REPO_URL/issues 说一声。"
  fi
  BASE_URL="$DOWNLOAD_BASE/$version"
}

check_network() {
  resolve_version
  # 顺带确认了这个版本、这种芯片的发布包确实存在
  curl -fsSL --max-time 20 -o /dev/null "$BASE_URL/$ARCHIVE.sha256" 2>/dev/null ||
    fail "下载不到发布包" \
      "地址：$BASE_URL/$ARCHIVE" \
      "检查网络。指定了 SPEAKMORE_VERSION 的话，确认有这个版本。"
  ok "下载地址连得上"

  # 装得上不等于用得了：整理文字要连用的那一家，装的时候还不知道用哪家，所以都查。连不上只提醒，不拦着
  local i unreachable=0
  for ((i = 0; i < ${#MODEL_HOSTS[@]}; i += 2)); do
    if curl -s --max-time 8 -o /dev/null "https://${MODEL_HOSTS[i + 1]}/" 2>/dev/null; then
      ok "连得上 ${MODEL_HOSTS[i]}"
    else
      warn "现在连不上 ${MODEL_HOSTS[i]}（${MODEL_HOSTS[i + 1]}）"
      unreachable=1
    fi
  done
  if [ "$unreachable" = 1 ]; then
    note "不影响安装。用哪一家就要能连上哪一家；需要代理的话，启动 speakmore 的那个终端里要设好。"
  fi
}

# ---------- 安装 ----------

download() {
  TMP_DIR="$(mktemp -d "$HOME_DIR/.install.XXXXXX")"
  local progress="-sS"
  [ -t 2 ] && progress="--progress-bar"
  curl -fL "$progress" -o "$TMP_DIR/$ARCHIVE" "$BASE_URL/$ARCHIVE" ||
    fail "下载中断了" "再运行一次。地址：$BASE_URL/$ARCHIVE"
  curl -fsSL -o "$TMP_DIR/$ARCHIVE.sha256" "$BASE_URL/$ARCHIVE.sha256" || fail "校验文件没有下到" "再运行一次。"
  ok "下载好了"

  local expected actual
  expected="$(awk '{ print $1; exit }' "$TMP_DIR/$ARCHIVE.sha256")"
  actual="$(shasum -a 256 "$TMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] ||
    fail "下到的包和发布时的不一样（校验没通过）" "多半是下载途中坏了，再运行一次。" "应该是 $expected" "下到的是 $actual"
  ok "校验通过"

  tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR" || fail "包解不开" "再运行一次。"
  NEW_ELECTRON="$TMP_DIR/runtime/Electron.app/Contents/MacOS/Electron"
  [ -f "$TMP_DIR/app/bin/speakmore.mjs" ] && [ -x "$NEW_ELECTRON" ] || fail "包里的东西不全" "这是发布包的问题，请到 $REPO_URL/issues 说一声。"

  # 换掉旧的之前先在原地跑一下：这台机器上跑不起来的话现在就知道，不至于换完才发现
  NEW_VERSION="$(run_new --version 2>/dev/null)" ||
    fail "下到的程序在这台机器上跑不起来" "请到 $REPO_URL/issues 说一声，带上 macOS 版本和芯片型号。"
  ok "解开了：SpeakMore $NEW_VERSION"
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
    [ ! -e "$HOME_DIR/$name" ] || mv "$HOME_DIR/$name" "$HOME_DIR/$name.old" ||
      fail "$(pretty "$HOME_DIR/$name") 挪不动" "检查这个目录的权限。"
  done
  if mv "$TMP_DIR/app" "$HOME_DIR/app" && mv "$TMP_DIR/runtime" "$HOME_DIR/runtime"; then
    rm -rf "$HOME_DIR/app.old" "$HOME_DIR/runtime.old"
    return
  fi
  for name in app runtime; do
    [ -e "$HOME_DIR/$name.old" ] || continue
    rm -rf "$HOME_DIR/$name"
    mv "$HOME_DIR/$name.old" "$HOME_DIR/$name"
  done
  fail "新的程序放不进 $(pretty "$HOME_DIR")" "检查这个目录的权限。后台已经停了，运行 speakmore 重新启动。"
}

install_files() {
  # 正在运行的要先停：它开着旧程序的文件。用新的这份去停，新旧版本的后台应用它都认。
  # 0.1 版把数据放在别处，有的话这一步会顺带搬过来。
  # 下面靠它说的话判断停没停、搬没搬，命令行又按终端的语言说话：让它说中文，和这个脚本一致
  local output
  output="$(SPEAKMORE_LANGUAGE=zh-CN run_new stop 2>&1)" || fail "正在运行的 SpeakMore 停不掉" "$output" "先把它退出，再安装。"
  case "$output" in *"已经搬到"*) ok "$(printf '%s\n' "$output" | grep "已经搬到" | head -1)" ;; esac
  case "$output" in *"已经停掉"* | *"强行结束"*) ok "停掉了正在运行的那一个" ;; esac

  swap_in

  mkdir -p "$HOME_DIR/bin"
  LAUNCHER="$HOME_DIR/bin/speakmore"
  # 目录的位置写死在启动脚本里：它会被别处的链接指着，不能靠"我在哪"来猜
  cat >"$LAUNCHER" <<EOF
#!/bin/sh
# SpeakMore 的命令，由安装脚本生成。
# 拿自带的 Electron 当 Node 来跑（它里面就有一个），所以不依赖系统里装没装 Node。
installed_in=$(quoted "$HOME_DIR")
SPEAKMORE_HOME="\${SPEAKMORE_HOME:-\$installed_in}"
export SPEAKMORE_HOME
ELECTRON_RUN_AS_NODE=1 exec $(quoted "$HOME_DIR/runtime/Electron.app/Contents/MacOS/Electron") $(quoted "$HOME_DIR/app/bin/speakmore.mjs") "\$@"
EOF
  chmod 755 "$LAUNCHER"
  ok "装进了 $(pretty "$HOME_DIR")"
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
    warn "$(pretty "$link") 已经有一个别的 speakmore，没有动它"
    note "要用新装的，运行：$(pretty "$LAUNCHER")"
    return
  fi
  mkdir -p "$dir"
  ln -sfn "$LAUNCHER" "$link"
  # 记下在家目录以外建了什么，卸载时照着删
  grep -qxF "$link" "$HOME_DIR/bin/links" 2>/dev/null || printf '%s\n' "$link" >>"$HOME_DIR/bin/links"
  ok "speakmore 命令：$(pretty "$link")"

  if ! on_path "$dir"; then
    local rc=".zshrc"
    case "${SHELL:-}" in */bash) rc=".bash_profile" ;; esac
    warn "$(pretty "$dir") 不在 PATH 里，新开的终端里会找不到 speakmore 命令"
    note "加进去：echo 'export PATH=\"$dir:\$PATH\"' >> ~/$rc"
    note "或者一直用完整的路径：$(pretty "$LAUNCHER")"
    return
  fi
  # PATH 里排在前面的要是另一个 speakmore（比如从源码目录 npm link 的），敲命令时用到的会是它
  local found
  found="$(command -v speakmore 2>/dev/null || true)"
  if [ -n "$found" ] && [ "$found" != "$link" ]; then
    warn "PATH 里排在前面的还有另一个 speakmore：$(pretty "$found")"
    note "敲 speakmore 时用到的会是它。多半是以前 npm link 的，不要了就运行：npm unlink -g speakmore"
  fi
}

main() {
  local start="yes" arg
  for arg in "$@"; do
    case "$arg" in
      --no-start) start="no" ;;
      *) fail "不认识的参数：$arg" "只认 --no-start（只装不启动）。" ;;
    esac
  done

  HOME_DIR="${SPEAKMORE_HOME:-$HOME/.speakmore}"
  DOWNLOAD_BASE="${SPEAKMORE_INSTALL_BASE:-$DOWNLOAD_URL}"
  # 本机的一个目录也可以当下载地址
  case "$DOWNLOAD_BASE" in /*) DOWNLOAD_BASE="file://$DOWNLOAD_BASE" ;; esac

  printf '\n  %sSpeakMore 安装%s\n' "$BOLD" "$RESET"
  trap cleanup EXIT

  heading "预检查"
  check_system
  ARCHIVE="speakmore-darwin-$ARCH.tar.gz"
  check_home
  check_network

  heading "安装"
  download
  install_files
  link_command

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" != "$NEW_VERSION" ]; then
    printf '\n  %s升级好了：%s → %s%s\n' "$BOLD" "$INSTALLED_VERSION" "$NEW_VERSION" "$RESET"
  else
    printf '\n  %s装好了：SpeakMore %s%s\n' "$BOLD" "$NEW_VERSION" "$RESET"
  fi
  note "不想用了：speakmore uninstall 会把 $(pretty "$HOME_DIR") 整个删掉。"

  cleanup
  TMP_DIR=""
  # 从管道里读脚本时标准输入不是终端，而问 key 要用键盘：接到终端上再启动
  if [ "$start" = "yes" ] && [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
    printf '\n'
    exec "$LAUNCHER" </dev/tty
  fi
  printf '\n  运行 speakmore 启动。\n\n'
}

main "$@"
