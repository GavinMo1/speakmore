import { homedir } from "node:os";
import { join } from "node:path";

// 数据、设置、日志、控制通道各在哪。命令行和后台应用是两个进程，靠这一份约定找到同一批文件。
// 全都放在一个目录里：想看、想备份、想删干净，只用找这一处。

/** macOS 上 Unix 套接字的路径最长 103 个字节（sockaddr_un.sun_path 是 104，含结尾的 0） */
const MAX_SOCKET_PATH_BYTES = 103;

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} home 家目录，测试时换掉
 */
export function resolvePaths(env = process.env, home = homedir()) {
  // SPEAKMORE_HOME：把全部数据换到别处。测试用它指到临时目录，不碰真实的历史
  const dataDir = env.SPEAKMORE_HOME || join(home, "Library", "Application Support", "SpeakMore");
  const controlSocket = join(dataDir, "control.sock");
  if (Buffer.byteLength(controlSocket) > MAX_SOCKET_PATH_BYTES) {
    throw new Error(`数据目录的路径太长，控制通道建不起来：${dataDir}\n用环境变量 SPEAKMORE_HOME 换一个短一些的目录。`);
  }
  return {
    dataDir,
    historyDb: join(dataDir, "history.db"),
    recordingsDir: join(dataDir, "Recordings"),
    settingsFile: join(dataDir, "settings.json"),
    controlSocket,
    logFile: join(dataDir, "logs", "main.log"),
    // 加密后的 key。加密用的密钥在钥匙串里是按应用存的：命令启动的和打成应用的是两个应用，
    // 互相解不开对方的密文，所以各存各的文件
    keyFile: join(dataDir, "gemini-key.bin"),
    appKeyFile: join(dataDir, "gemini-key.app.bin"),
  };
}
