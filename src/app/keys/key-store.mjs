import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { LocalizedError, msg } from "../../i18n/index.mjs";

/**
 * Gemini API key 的存放处：用系统钥匙串加密后存成一个文件，明文只在内存里。
 * 加密用的密钥在钥匙串里、归这个应用所有，所以文件被拷到别的机器或别的用户下是解不开的。
 *
 * @param {object} options
 * @param {string} options.file 密文文件的路径
 * @param {{ isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(data: Buffer): string }} options.safeStorage
 *   Electron 的 safeStorage；测试时换成假的
 */
export function createKeyStore({ file, safeStorage }) {
  return {
    /** @returns {string | null} 没存过时是 null。密文解不开（比如钥匙串里的密钥没了）会抛错 */
    load() {
      if (!existsSync(file)) return null;
      return safeStorage.decryptString(readFileSync(file));
    },

    save(key) {
      // 钥匙串不可用时 Electron 在有的平台上会退回到固定密钥，那等于存明文，所以直接拒绝
      if (!safeStorage.isEncryptionAvailable()) throw new LocalizedError(msg("key.keychainUnavailable"));
      // 先删再写：mode 只在新建文件时生效，覆盖旧文件会沿用旧权限
      rmSync(file, { force: true });
      writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
    },

    clear() {
      rmSync(file, { force: true });
    },

    /** 存过没有。只看文件在不在，不解密 */
    exists() {
      return existsSync(file);
    },
  };
}
