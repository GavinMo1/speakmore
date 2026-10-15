import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createDelivery } from "../../src/app/delivery.mjs";
import { createTranslator } from "../../src/i18n/index.mjs";

const zh = createTranslator("zh-CN");

const AUDIO_ID = "0b6f1c1e-5a44-4f0e-9d0b-2f9f3a1c7e55";
const audio = () => Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 7]).buffer;

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "speakmore-delivery-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(paste = async () => ({ ok: true, reason: null })) {
  const rows = [];
  const pasted = [];
  const clipboard = [];
  const delivery = createDelivery({
    recordingsDir: join(dir, "Recordings"),
    history: { add: (row) => rows.push(row) },
    paste: (text) => {
      pasted.push(text);
      return paste(text);
    },
    writeClipboard: (text) => clipboard.push(text),
    log: { warn() {}, error() {} },
    now: () => new Date("2026-10-13T08:00:00.000Z"),
  });
  return { delivery, rows, pasted, clipboard };
}

const payload = (overrides = {}) => ({
  audioId: AUDIO_ID,
  text: "我们后天开会。",
  durationSeconds: 4.2,
  audio: audio(),
  ...overrides,
});

test("成品：存录音、记历史、贴出去", async () => {
  const { delivery, rows, pasted } = setup();
  assert.deepEqual(await delivery.completed(payload()), { notice: null });

  const audioLocalPath = join(dir, "Recordings", `${AUDIO_ID}.webm`);
  assert.deepEqual([...readFileSync(audioLocalPath)], [0x1a, 0x45, 0xdf, 0xa3, 7]);
  assert.deepEqual(rows, [
    {
      id: AUDIO_ID,
      status: "completed",
      refinedText: "我们后天开会。",
      error: null,
      duration: 4.2,
      audioLocalPath,
      createdAt: "2026-10-13T08:00:00.000Z",
    },
  ]);
  assert.deepEqual(pasted, ["我们后天开会。"]);
});

test("没有听到声音：记历史但不去贴", async () => {
  const { delivery, rows, pasted } = setup();
  const { notice: silent } = await delivery.completed(payload({ text: "" }));
  assert.equal(zh.text(silent), "没有听到声音");
  assert.equal(rows.length, 1);
  assert.deepEqual(pasted, []);
});

test("没有辅助功能权限：提示用户自己粘贴", async () => {
  const { delivery, clipboard } = setup(async () => ({ ok: false, reason: "not_trusted" }));
  const { notice } = await delivery.completed(payload());
  assert.match(zh.text(notice), /没有辅助功能权限.*⌘V/);
  // 这种情况小帮手自己已经写过剪贴板，这里不重复写
  assert.deepEqual(clipboard, []);
});

test("粘贴出错：文字放进剪贴板，历史照样记上", async () => {
  const { delivery, rows, clipboard } = setup(async () => {
    throw new Error("原生小帮手退出了");
  });
  const { notice } = await delivery.completed(payload());
  assert.match(zh.text(notice), /没能自动粘贴.*⌘V/);
  assert.deepEqual(clipboard, ["我们后天开会。"]);
  assert.equal(rows.length, 1);
});

test("失败的听写：录音和原因都留下", () => {
  const { delivery, rows, pasted } = setup();
  delivery.failed({ audioId: AUDIO_ID, error: "等了 20 秒没有等到成品", durationSeconds: 9, audio: audio() });
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].refinedText, "");
  assert.equal(rows[0].error, "等了 20 秒没有等到成品");
  assert.ok(existsSync(rows[0].audioLocalPath));
  assert.deepEqual(pasted, []);
});

test("录音是某个缓冲区里的一段时，只存那一段", async () => {
  const { delivery, rows } = setup();
  const whole = Uint8Array.from([9, 9, 0x1a, 0x45, 9]);
  await delivery.completed(payload({ audio: whole.subarray(2, 4) }));
  assert.deepEqual([...readFileSync(rows[0].audioLocalPath)], [0x1a, 0x45]);
});

test("来自页面的参数不合格时拒绝，不落任何文件", async () => {
  const { delivery, rows } = setup();
  const bad = [
    payload({ audioId: "../../etc/passwd" }),
    payload({ audioId: `${AUDIO_ID}/x` }),
    payload({ durationSeconds: Number.NaN }),
    payload({ audio: "不是二进制" }),
    payload({ text: 42 }),
  ];
  for (const item of bad) await assert.rejects(delivery.completed(item), TypeError);
  assert.throws(() => delivery.failed(payload({ error: undefined })), TypeError);
  assert.deepEqual(rows, []);
  assert.equal(existsSync(join(dir, "Recordings")) ? readdirSync(join(dir, "Recordings")).length : 0, 0);
});
