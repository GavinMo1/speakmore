import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURES, generate } from "../../../scripts/build/hotkey-fixtures.mjs";

// Go 和 Swift 的测试读的是生成好的两份样例：改了样例或键表却忘了重新生成，两边测的就不是同一套规矩了

test("生成的样例和仓库里的一字不差（不一致就跑 node scripts/build/hotkey-fixtures.mjs）", () => {
  const generated = generate();
  const onDisk = ["mac", "win"].flatMap((dir) => readdirSync(join(FIXTURES, dir)).map((name) => join(dir, name)));
  assert.deepEqual(onDisk.sort(), [...generated.keys()].sort(), "多出来或少了的文件");
  for (const [path, content] of generated) {
    assert.equal(readFileSync(join(FIXTURES, path), "utf8"), content, path);
  }
});

test("每个系统都有样例，每个 case 至少一步", () => {
  for (const dir of ["mac", "win"]) {
    const cases = readdirSync(join(FIXTURES, dir)).flatMap(
      (name) => JSON.parse(readFileSync(join(FIXTURES, dir, name), "utf8")).cases,
    );
    assert.ok(cases.length >= 25, `${dir} 只有 ${cases.length} 个`);
    for (const entry of cases) assert.ok(entry.steps.length > 0, entry.name);
  }
});
