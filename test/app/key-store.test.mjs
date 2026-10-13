import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createKeyStore } from "../../src/app/key-store.mjs";

// 假的钥匙串：把字节逐个异或一下，够区分"存的是密文还是明文"
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a),
  decryptString: (buffer) => Buffer.from(buffer.map((byte) => byte ^ 0x5a)).toString("utf8"),
});

function tempStore(safeStorage = fakeSafeStorage()) {
  const dir = mkdtempSync(join(tmpdir(), "speakmore-key-"));
  const file = join(dir, "gemini-key.bin");
  return { file, store: createKeyStore({ file, safeStorage }), cleanup: () => rmSync(dir, { recursive: true }) };
}

test("没存过时读出来是 null", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  assert.equal(store.load(), null);
});

test("存进去能原样读回来；磁盘上不是明文，文件只有自己能读写", (t) => {
  const { file, store, cleanup } = tempStore();
  t.after(cleanup);
  store.save("AIza-not-a-real-key");
  assert.equal(store.load(), "AIza-not-a-real-key");
  assert.ok(!readFileSync(file).includes("AIza-not-a-real-key"));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("清掉之后读出来是 null，重复清不报错", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  store.save("AIza-not-a-real-key");
  store.clear();
  store.clear();
  assert.equal(store.load(), null);
});

test("系统钥匙串不可用时拒绝保存，不退回到存明文", (t) => {
  const { file, store, cleanup } = tempStore(fakeSafeStorage(false));
  t.after(cleanup);
  assert.throws(() => store.save("AIza-not-a-real-key"), /钥匙串/);
  assert.throws(() => statSync(file), { code: "ENOENT" });
});
