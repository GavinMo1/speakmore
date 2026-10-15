import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALES } from "../src/lib/locale.js";
import media from "../src/media.json" with { type: "json" };

// 页面会按"名字.语言"去 src/media.json 里找图（src/config.js 的 shot）
const NAMES = [
  ...["ink", "cinnabar", "indigo"].flatMap((theme) => [`home-light-${theme}`, `home-dark-${theme}`, `bar-${theme}`]),
];

test("每种语言、每套主题的截图都传过了，并且记着大小", () => {
  for (const locale of LOCALES) {
    for (const name of NAMES) {
      const entry = media[`${name}.${locale}`];
      assert.ok(entry, `缺 ${name}.${locale}`);
      assert.match(entry.path, /^shots\/[\w.-]+\.[0-9a-f]{8}\.webp$/);
      assert.ok(entry.width > 0 && entry.height > 0);
    }
  }
});
