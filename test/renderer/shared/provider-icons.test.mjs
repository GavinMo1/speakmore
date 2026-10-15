import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_ICON_PATHS } from "../../../src/renderer/shared/provider-icons.mjs";
import { PROVIDERS } from "../../../src/server/providers/index.mjs";

test("每一家模型都有图标：接了新的一家，设置和首次引导里不会只剩个名字", () => {
  for (const { id } of PROVIDERS) assert.match(PROVIDER_ICON_PATHS[id] ?? "", /^M[\d.\s,a-zA-Z-]+z$/, id);
});
