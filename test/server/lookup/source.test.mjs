import assert from "node:assert/strict";
import { test } from "node:test";
import { looksUntranslated, sourceIs } from "../../../src/server/lookup/source.mjs";

test("原文已经是这种语言：靠文字系统分得清的直接认出来", () => {
  const yes = [
    ["zh-CN", "我们这边法务已经看过了，有两处需要再确认一下。"],
    ["zh-CN", "这个 bug 我看了一下，是 API 的问题"],
    ["zh-TW", "這個模型把音頻留在你的裝置上"],
    ["ja", "モデルは音声を端末に残し、文字起こしだけを送信します。"],
    ["ko", "모델은 오디오를 기기에 남겨 둡니다."],
    ["ru", "Модель хранит аудио на вашем устройстве."],
    ["ar", "يحتفظ النموذج بالصوت على جهازك."],
    ["th", "โมเดลเก็บเสียงไว้ในอุปกรณ์ของคุณ"],
    ["en", "Could you send us your comments on the contract by Friday?"],
    ["en", "It's not that the old approach was wrong."],
  ];
  for (const [language, text] of yes) assert.equal(sourceIs(text, language), true, `${language}：${text}`);
  const no = [
    // 繁体选给简体、简体选给繁体：是要转写，不算已经是
    ["zh-CN", "這個模型把音頻留在你的裝置上"],
    ["zh-TW", "这个模型把音频留在你的设备上"],
    // 日文里有汉字，但有假名就不是中文
    ["zh-CN", "モデルは音声を端末に残します"],
    ["ja", "我们这边法务已经看过了"],
    ["zh-CN", "The model keeps the audio on your device."],
    // 单个英文词、法文：拉丁字母分不出是哪种，交给模型
    ["en", "pipeline"],
    ["en", "Le modèle garde l'audio sur votre appareil et n'envoie que la transcription."],
    ["fr", "Le modèle garde l'audio sur votre appareil."],
    ["de", "Das Modell behält den Ton auf deinem Gerät."],
    ["zh-CN", "12345"],
  ];
  for (const [language, text] of no) assert.equal(sourceIs(text, language), false, `${language}：${text}`);
});

test("译出来的和原文几乎一样：当成没译（原文就是目标语言），要改译", () => {
  assert.equal(looksUntranslated("pipeline", "pipeline"), true);
  assert.equal(looksUntranslated("Hello, world!", "hello world"), true);
  assert.equal(
    looksUntranslated(
      "Could you send us your comments on the contract by Friday?",
      "Could you send me your comments on the contract by Friday?",
    ),
    true,
  );
  assert.equal(looksUntranslated("Le modèle garde l'audio", "The model keeps the audio"), false);
  assert.equal(looksUntranslated("pipeline", "流水线；管道"), false);
  assert.equal(looksUntranslated("bear", "熊"), false);
  assert.equal(looksUntranslated("Error: connection refused.", "错误：连接被拒绝。"), false);
});
