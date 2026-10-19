// 下载地址上每个版本的包叫什么。打包发布（scripts/release/release-layout.mjs）和更新（这个目录）共用这一份，
// 安装脚本里写的名字也要和它一致：
//   latest                                       一行：最新的版本号，比如 v0.2.0
//   install.sh、install.ps1                      安装脚本
//   v0.2.0/speakmore-darwin-<芯片>.tar.gz         终端安装的包（install.sh 装），和同名的 .sha256
//   v0.2.0/SpeakMore-<芯片>.dmg                   Mac 的安装包：签了名、过了公证的 SpeakMore.app，和同名的 .sha256
//   v0.2.0/speakmore-win32-x64.zip               Windows 的包（install.ps1 装），和同名的 .sha256

export const archiveName = (arch) => `speakmore-darwin-${arch}.tar.gz`;
export const dmgName = (arch) => `SpeakMore-${arch}.dmg`;
/** Windows 只出 x64 的一个（Windows on ARM 靠系统自带的转译跑它） */
export const WINDOWS_ARCHIVE = "speakmore-win32-x64.zip";
/** Windows 直接下载的安装程序（scripts/build/windows-setup.mjs 打的） */
export const WINDOWS_SETUP = "SpeakMore-Setup-x64.exe";
export const versionDir = (version) => `v${version}`;

/**
 * 装在家目录里的那一份（安装脚本装的）用哪个包、哪个安装脚本。
 * @param {NodeJS.Platform} platform
 * @param {"arm64" | "x64"} arch Mac 上的芯片，按安装脚本的认法（见 home.mjs 的 homeArch）
 */
export function homePackage(platform, arch) {
  if (platform === "win32") return { archive: WINDOWS_ARCHIVE, script: "install.ps1" };
  return { archive: archiveName(arch), script: "install.sh" };
}
